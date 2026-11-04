import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runResult, parseReplay, replayData } from '../tools/run-result.ts';

const states = [{ type: 'state', tick: 100, score: 80, status: 'completed' }];
const receipt = { status: 'completed', ticks: 100, duration: 100, score: 80, chefs: [{}, {}] };

test('a completed clock does not hide either hosted or local chef errors', () => {
  for (const local of [true, false]) {
    const result = runResult(
      {
        ...receipt,
        status: local ? 'failed' : 'completed',
        error: local ? 'process exited 2' : undefined,
        chefs: [{ [local ? 'error' : 'failure']: 'process exited 2' }, {}],
      },
      states,
    );
    assert.equal(result.heading, 'Shift ended with a chef unavailable');
    assert.equal(result.complete, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].label, 'Chef 1');
  }
});

test('model errors warn without invalidating a completed run', () => {
  const result = runResult(
    { ...receipt, models: [[{ ok: false, error: 'deadline' }, { ok: true }], []] },
    states,
  );
  assert.equal(result.complete, true);
  assert.equal(result.heading, 'Run completed with model errors');
  assert.equal(result.modelErrors, 1);
  assert.match(result.issues[0].detail, /1 of 2/);
});

test('cleanup uncertainty takes precedence over retry advice', () => {
  const result = runResult({ ...receipt, cleanupConfirmed: false, chefs: [{ failure: 'timeout' }] }, states);
  assert.equal(result.complete, false);
  assert.match(result.heading, /cleanup/);
  assert.equal(result.next, 'Contact the organizer before retrying.');
});

test('unknown errors remain unattributed and worker clock errors are explicit', () => {
  const unknown = runResult({ status: 'failed', ticks: 0, error: 'request failed' }, []);
  assert.equal(unknown.heading, 'Run failed before play');
  assert.equal(unknown.issues[0].label, 'Reported run error');
  const worker = runResult(
    { status: 'failed', ticks: 20, error: 'Game clock stalled for more than one second' },
    [],
  );
  assert.equal(worker.issues[0].label, 'Game worker');
  assert.match(worker.next, /organizer/);
});

test('unconfirmed, missing and partial recordings do not become successful replays', () => {
  assert.equal(runResult({ ...receipt, status: 'preparing' }, states).complete, false);
  assert.equal(runResult({ ...receipt, validForComparison: false }, states).complete, false);
  const missing = runResult(receipt, []);
  assert.equal(missing.complete, true); // Preserve the summary outcome, qualify the absent recording.
  assert.equal(missing.replayComplete, false);
  assert.equal(missing.heading, 'Run completed · replay incomplete');
  assert.equal(runResult(receipt, [{ ...states[0], tick: 50 }]).replayComplete, false);
  const local = runResult({ ...receipt, modelMode: 'disabled' }, states);
  assert.match(local.next, /models disabled/);
});

test('a damaged NDJSON suffix preserves the readable prefix with a warning', () => {
  const parsed = parseReplay(JSON.stringify(states[0]) + '\n{"type":');
  assert.deepEqual(parsed.rows, states);
  assert.match(parsed.issue!, /line 2/);
  assert.equal(runResult(receipt, parsed.rows, parsed.issue).replayComplete, false);
  assert.deepEqual(parseReplay(' \n'), { rows: [] });
});

test('legacy empty polls are omitted; action ticks and unique events survive', () => {
  const event = { id: 'e1', kind: 'delivered', tick: 5, text: 'served', points: 80 };
  const data = replayData([
    { type: 'state', tick: 10, events: [event] },
    { type: 'state', tick: 5, events: [event] },
    { type: 'dispatch', tick: 6, payload: { kind: 'received', action: null, observedTick: 6 } },
    {
      type: 'dispatch',
      tick: 8,
      payload: { kind: 'received', action: { observedTick: 5 }, observedTick: 8 },
    },
    { type: 'dispatch', tick: 9, payload: { kind: 'unavailable', error: 'deadline' } },
  ]);
  assert.deepEqual(
    data.states.map((s) => s.tick),
    [5, 10],
  );
  assert.deepEqual(data.events, [event]);
  assert.equal(data.responses.length, 2);
  assert.equal(data.responses[0].payload.observedTick, 5);
  assert.equal(data.responses[1].payload.error, 'deadline');
});

test('CLI renders missing and empty recordings, escapes data, and refuses output overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-replay-'));
  try {
    await writeFile(
      join(dir, 'summary.json'),
      JSON.stringify({ status: 'failed', ticks: 0, error: '</script><script>bad()</script>' }),
    );
    for (const name of ['missing', 'empty']) {
      if (name === 'empty') await writeFile(join(dir, 'replay.ndjson'), '\n');
      const output = join(dir, name + '.html');
      execFileSync(process.execPath, [new URL('../tools/replay.ts', import.meta.url).pathname, dir, output]);
      const html = await readFile(output, 'utf8');
      assert.match(html, /Run failed before play/);
      assert.ok(!html.includes('</script><script>bad()'));
      assert.match(html, /No replay available/);
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            [new URL('../tools/replay.ts', import.meta.url).pathname, dir, output],
            { stdio: 'pipe' },
          ),
        /EEXIST/,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
