import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareSource } from './practice-source.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { Kitchen, validAction, type KitchenAction, type KitchenObservation } from '../game.ts';

type Pending = { resolve: (a: KitchenAction) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type BotSource = {
  entry: string;
  root: string;
  command: string;
  args?: string[];
  identity: Record<string, unknown>;
};
type RecordRow = (row: Record<string, unknown>) => void;

/** Local developer tool. Child code runs with the user's permissions, not in the hosted sandbox. */
class ChefProcess {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  readyOK!: () => void;
  readyFail!: (error: Error) => void;
  pending?: Pending;
  error: string | null = null;
  closed = false;
  prepared = false;
  calls = 0;
  modelRequests = 0;
  responseMs: number[] = [];
  exit: Promise<void>;
  readonly seat: number;
  readonly record: RecordRow;
  constructor(source: BotSource, seat: number, record: RecordRow) {
    this.seat = seat;
    this.record = record;
    const nonce = randomUUID();
    this.ready = new Promise((yes, no) => {
      this.readyOK = yes;
      this.readyFail = no;
    });
    this.child = spawn(source.command, [...(source.args ?? []), source.entry], {
      cwd: source.root,
      stdio: 'pipe',
    });
    this.exit = new Promise((done) =>
      this.child.once('close', () => {
        if (!this.closed) this.fail('Process exited before the shift ended');
        done();
      }),
    );
    this.child.on('error', (e) => this.fail(e.message));
    this.child.stdin.on('error', (e) => this.fail(e.message));
    const readiness = setTimeout(() => this.fail('No matching ready response within 5 seconds'), 5000);
    this.ready.then(
      () => clearTimeout(readiness),
      () => clearTimeout(readiness),
    );
    const consume = (stream: 'stdout' | 'stderr', limit: number) => {
      let buffer = '',
        bytes = 0;
      this.child[stream].setEncoding('utf8');
      this.child[stream].on('data', (chunk: string) => {
        if (this.closed || this.error) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) return this.fail(stream + ' exceeded its output budget');
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.length > 65536) return this.fail(stream + ' line exceeds 64 KiB');
          if (stream === 'stderr')
            this.record({ type: 'decision', seat, kind: 'log', payload: { text: line.slice(0, 4096) } });
          else if (line.trim()) {
            try {
              const m = JSON.parse(line);
              if (m.type === 'ready' && !this.prepared && m.version === 1 && m.nonce === nonce) {
                this.prepared = true;
                this.readyOK();
              } else if (m.type === 'action') {
                if (!this.pending || !validAction(m.action)) throw Error('Invalid or unsolicited action');
                const pending = this.pending;
                this.pending = undefined;
                clearTimeout(pending.timer);
                pending.resolve(m.action);
              } else if (m.type === 'model') {
                // Exercise the documented fallback path; never call a provider from local practice.
                this.modelRequests++;
                this.send({
                  type: 'model-response',
                  requestId: m.requestId,
                  error: 'Models are disabled in local practice. Use local fallback.',
                });
              } else throw Error('Unexpected protocol message');
            } catch (e) {
              this.fail(String(e));
              return;
            }
          }
        }
        if (buffer.length > 65536) this.fail(stream + ' line exceeds 64 KiB');
      });
    };
    consume('stdout', 6 * 1024 * 1024);
    consume('stderr', 1024 * 1024);
    this.send({ type: 'prepare', version: 1, nonce });
  }
  send(value: unknown) {
    if (!this.closed && !this.error) this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  fail(message: string) {
    if (this.error || this.closed) return;
    this.error = message;
    this.record({ type: 'dispatch', seat: this.seat, payload: { kind: 'unavailable', error: message } });
    this.readyFail(Error(message));
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error(message));
      this.pending = undefined;
    }
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 500);
    this.exit.then(() => clearTimeout(timer));
  }
  async step(observation: KitchenObservation) {
    if (!this.prepared || this.pending || this.error || this.closed)
      throw Error(this.error ?? 'Chef is not available');
    const began = performance.now();
    this.calls++;
    const result = new Promise<KitchenAction>((yes, no) => {
      this.pending = {
        resolve: yes,
        reject: no,
        timer: setTimeout(() => this.fail('Action response exceeded 3 seconds'), 3000),
      };
    });
    this.send({ type: 'observation', observation });
    const action = await result;
    this.responseMs.push(performance.now() - began);
    return action;
  }
  async stop() {
    this.closed = true;
    this.readyFail(Error('Practice stopped'));
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error('Practice stopped'));
      this.pending = undefined;
    }
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 500);
    try {
      await this.exit;
    } finally {
      clearTimeout(timer);
    }
  }
}

const p95 = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]! : 0;
export async function runPractice(input: {
  out: string;
  bots: [string | BotSource, string | BotSource];
  seed?: number;
  seconds?: number;
  signal?: AbortSignal;
}) {
  if (input.bots.length !== 2) throw Error('Provide exactly two bot entrypoints');
  const sources = input.bots.map((bot) =>
    typeof bot === 'string'
      ? {
          entry: bot,
          root: dirname(bot),
          command: process.execPath,
          identity: { kind: 'loose-file', runtime: 'node24', entrypoint: bot.split(/[\\/]/).at(-1) },
        }
      : bot,
  );
  const seed = input.seed ?? 42,
    seconds = input.seconds ?? 60;
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 180)
    throw Error('Practice duration must be an integer from 10 to 180 seconds');
  const game = new Kitchen(seed, seconds * 10, randomUUID());
  const out = resolve(input.out);
  // Reserve a new result directory. Never overwrite earlier experiments.
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { recursive: false });
  const rows: Record<string, unknown>[] = [{ type: 'state', ...structuredClone(game.state) }];
  let logRows = 0,
    droppedLogs = 0,
    ending = false,
    failure = '',
    elapsed = 0;
  const record: RecordRow = (row) => {
    if (ending) return;
    if (row.type === 'decision' && ++logRows > 4000) {
      droppedLogs++;
      return;
    }
    rows.push({ tick: game.state.tick, ...row });
  };
  let began: number | undefined;
  const chefs: ChefProcess[] = [],
    timings: number[] = [];
  const pending = [false, false],
    latest: (KitchenAction | null)[] = [null, null];
  let sourceHashes: string[] = [];
  const abort = () => {
    failure = 'Practice cancelled';
    ending = true;
    for (const chef of chefs) void chef.stop();
  };
  input.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (input.signal?.aborted) throw Error('Practice cancelled');
    sourceHashes = await Promise.all(
      sources.map(async ({ entry }) =>
        createHash('sha256')
          .update(await readFile(entry))
          .digest('hex'),
      ),
    );
    if (ending) throw Error(failure);
    for (const [seat, source] of sources.entries()) chefs.push(new ChefProcess(source, seat, record));
    await Promise.all(chefs.map((chef) => chef.ready));
    const opening = await Promise.all(chefs.map((chef, seat) => chef.step(game.observe(seat))));
    if (ending || chefs.some((c) => c.error)) throw Error(failure || chefs.find((c) => c.error)!.error!);
    latest.splice(0, 2, ...opening);
    began = performance.now();
    while (game.state.tick < game.state.duration && !ending) {
      const due = began + (game.state.tick + 1) * 100;
      await sleep(Math.max(0, due - performance.now()));
      if (ending) break;
      const lateness = Math.max(0, performance.now() - due);
      timings.push(lateness);
      if (lateness > 1000) throw Error('Local clock stalled by more than one second');
      const actions = [...latest];
      latest.fill(null);
      game.step(actions);
      record({ type: 'state', ...structuredClone(game.state) });
      for (const [seat, action] of actions.entries())
        if (action)
          record({
            type: 'dispatch',
            seat,
            payload: { kind: 'action', observedTick: action.observedTick, action },
          });
      if (game.state.status === 'completed') break;
      for (const [seat, chef] of chefs.entries()) {
        if (pending[seat] || chef.error) continue;
        pending[seat] = true;
        void chef
          .step(game.observe(seat))
          .then(
            (action) => {
              if (!ending) latest[seat] = action;
            },
            (e) => {
              if (!ending)
                record({ type: 'dispatch', seat, payload: { kind: 'unavailable', error: String(e) } });
            },
          )
          .finally(() => {
            pending[seat] = false;
          });
      }
    }
    elapsed = performance.now() - began;
  } catch (e) {
    failure ||= String(e);
  } finally {
    if (began !== undefined) elapsed = performance.now() - began;
    ending = true;
    input.signal?.removeEventListener('abort', abort);
    await Promise.all(chefs.map((chef) => chef.stop()));
  }
  const summary = {
    id: game.state.matchId,
    protocol: game.state.protocol,
    ruleset: game.state.ruleset,
    seed,
    duration: seconds * 10,
    mode: 'submission-config',
    style: 'custom',
    execution: 'local-process',
    dispatch: 'independent-local-practice',
    modelMode: 'disabled',
    status:
      !failure && chefs.every((c) => !c.error) && game.state.status === 'completed' ? 'completed' : 'failed',
    error:
      failure ||
      chefs
        .map((c) => c.error)
        .filter(Boolean)
        .join('; ') ||
      undefined,
    ticks: game.state.tick,
    score: game.state.score,
    delivered: game.state.delivered,
    missed: game.state.missed,
    burned: game.state.burned,
    gameplayWallMs: elapsed,
    tickLateP95Ms: p95(timings),
    droppedLogs,
    rejectedActions: rows
      .filter((r) => r.type === 'state')
      .flatMap((r) => (r.events ?? []) as { kind: string }[])
      .filter((e) => e.kind === 'rejected').length,
    sources: sources.map((s) => s.identity),
    entrypointSha256: sourceHashes, // Entrypoint only; not an immutable submission/archive identity.
    chefs: chefs.map((c) => ({
      seat: c.seat,
      calls: c.calls,
      responseP95Ms: p95(c.responseMs),
      error: c.error,
      disabledModelRequests: c.modelRequests,
    })),
    limitations:
      'Local code runs with your permissions. Models disabled. Entrypoint hashes omit dependencies. Not a hosted result, sandbox test or capacity measurement.',
  };
  await writeFile(out + '/replay.ndjson', rows.map((r) => JSON.stringify(r)).join('\n') + '\n', {
    flag: 'wx',
  });
  await writeFile(out + '/summary.json', JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values: v } = parseArgs({
    options: {
      out: { type: 'string' },
      seconds: { type: 'string', default: '60' },
      seed: { type: 'string', default: '42' },
      bot: { type: 'string' },
      ref: { type: 'string' },
      project: { type: 'string' },
      'teammate-project': { type: 'string' },
      'teammate-ref': { type: 'string' },
      teammate: { type: 'string' },
    },
  });
  if (!v.out)
    throw Error(
      'Usage: npm run practice -- --out NEW_DIRECTORY [--seconds 10..180] [--seed 42] [--ref TAG_OR_SHA] [--project DIRECTORY] [--teammate-project DIRECTORY] [--teammate-ref TAG_OR_SHA]',
    );
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const prepared: Awaited<ReturnType<typeof prepareSource>>[] = [];
  let result: Awaited<ReturnType<typeof runPractice>>;
  try {
    prepared.push(await prepareSource({ root: v.project, ref: v.ref, bot: v.bot }));
    prepared.push(
      await prepareSource({
        root: v['teammate-project'] ?? v.project,
        ref:
          v['teammate-ref'] ??
          (v.teammate || v['teammate-project'] ? undefined : (prepared[0]!.identity.sha ?? v.ref)),
        bot: v.teammate ?? (v['teammate-project'] || v['teammate-ref'] ? undefined : v.bot),
      }),
    );
    for (const [seat, source] of prepared.entries())
      console.log(
        'Chef ' +
          (seat + 1) +
          ': ' +
          source.identity.runtime +
          ' · ' +
          source.identity.entrypoint +
          ' · ' +
          (source.identity.sha ?? source.identity.kind),
      );
    if (prepared.some((s) => s.identity.uncommittedChanges))
      console.log('Uncommitted edits are excluded from the committed practice snapshot.');
    console.log('Running two independent local agents. Models disabled; local fallback stays active.');
    result = await runPractice({
      out: v.out,
      bots: [prepared[0]!, prepared[1]!],
      seed: Number(v.seed),
      seconds: Number(v.seconds),
      signal: controller.signal,
    });
  } finally {
    await Promise.all(prepared.map((s) => s.dispose()));
  }
  // The renderer is also shipped in the starter; keep both entry points on one implementation.
  const renderer = spawn(
    process.execPath,
    [fileURLToPath(new URL('./replay.ts', import.meta.url)), resolve(v.out), resolve(v.out, 'replay.html')],
    { stdio: 'inherit' },
  );
  const rendered = await new Promise<boolean>((done) => {
    renderer.once('error', () => done(false));
    renderer.once('close', (code) => done(code === 0));
  });
  console.log(
    `${result.status}: ${result.score} points, ${result.delivered} orders. Open ${v.out}/replay.html`,
  );
  if (result.status !== 'completed' || !rendered) process.exitCode = 1;
}
