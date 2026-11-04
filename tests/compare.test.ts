import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRuns, formatComparison } from '../tools/compare.ts';

const receipt = (id: string) => ({
  id,
  seed: 42,
  duration: 600,
  ticks: 600,
  protocol: 'dream-kitchen.v1',
  ruleset: 'rush-kitchen.0.1',
  execution: 'local-process',
  modelMode: 'disabled',
  dispatch: 'independent-local-practice',
  status: 'completed',
  practiceEngineSha256: 'a'.repeat(64),
  practiceRunnerSha256: 'b'.repeat(64),
  practiceRuntime: { node: 'v24.22.1', platform: 'linux', arch: 'x64' },
  score: 518,
  delivered: 6,
  missed: 0,
  burned: 0,
  rejectedActions: 0,
  droppedLogs: 0,
  tickLateP95Ms: 2,
  sources: [0, 1].map(() => ({ kind: 'git-archive', sha: 'c'.repeat(40), archiveSha256: 'd'.repeat(64) })),
  chefs: [0, 1].map((seat) => ({ seat, calls: 600, error: null, responseP95Ms: 4 })),
});

test('compares all outcomes with signed deltas, preserves source identities and avoids a winner claim', () => {
  const a = receipt('a'),
    b = { ...receipt('b'), score: 746, delivered: 8, missed: 1, burned: 2 };
  const result = compareRuns(a, b);
  assert.equal(result.comparable, true);
  assert.equal(result.metrics.find((m) => m.key === 'score')!.delta, 228);
  assert.equal(result.metrics.find((m) => m.key === 'burned')!.delta, 2);
  const text = formatComparison(result);
  assert.match(text, /\+228/);
  assert.match(text, /other seeds/);
  assert.doesNotMatch(text, /winner|stronger|wins/i);
  assert.equal(result.runs[0].sources[0].sha, a.sources[0].sha);
  assert.match(text, /not verified/);
});

test('rejects mismatched rules, seeds, duration, runtime, hosted/model execution and missing provenance', () => {
  const variants = [
    { seed: 43 },
    { duration: 1800, ticks: 1800 },
    { ruleset: 'other' },
    { protocol: 'dreamweaver.v4' },
    { practiceEngineSha256: 'e'.repeat(64) },
    { practiceRunnerSha256: 'f'.repeat(64) },
    { practiceRuntime: { node: 'v24.22.1', platform: 'darwin', arch: 'arm64' } },
    { execution: 'sandbox' },
    { modelMode: 'jev' },
    { dispatch: 'synchronous' },
    { practiceEngineSha256: undefined },
    { practiceRuntime: undefined },
    { seed: NaN },
    { id: 'a' },
  ];
  for (const change of variants) {
    const result = compareRuns(receipt('a'), { ...receipt('b'), ...change });
    assert.equal(result.comparable, false, JSON.stringify(change));
    assert.ok(result.blockers.length);
  }
});

test('retains partial scores but blocks failed, incomplete or malformed runs', () => {
  for (const change of [
    { status: 'failed', score: 50, ticks: 140, error: 'Clock stalled' },
    { status: 'completed', ticks: 599 },
    { error: 'failure' },
    { cleanupConfirmed: false },
    { validForComparison: false },
    { chefs: [{ seat: 0, calls: 1, error: null, responseP95Ms: 1 }] },
    { chefs: [receipt('b').chefs[0], receipt('b').chefs[0]] },
    { chefs: [{ ...receipt('b').chefs[0], error: 'chef exited' }, receipt('b').chefs[1]] },
    { chefs: {} },
    { sources: null },
    { score: '800' },
    { missed: -1 },
    { droppedLogs: undefined },
    { tickLateP95Ms: Infinity },
  ]) {
    const result = compareRuns(receipt('a'), { ...receipt('b'), ...change });
    assert.equal(result.comparable, false, JSON.stringify(change));
    assert.doesNotThrow(() => formatComparison(result));
  }
  const result = compareRuns(receipt('a'), {
    ...receipt('b'),
    status: 'failed',
    score: 50,
    error: 'Clock stalled',
  });
  assert.equal(result.metrics[0].after, 50);
  assert.match(formatComparison(result), /Clock stalled/);
});

test('working files, rejected actions, dropped logs and late clocks get explicit cautions', () => {
  const b = {
    ...receipt('b'),
    sources: [{ kind: 'working-tree' }, { kind: 'loose-file' }],
    rejectedActions: 3,
    droppedLogs: 7,
    tickLateP95Ms: 60,
  };
  const result = compareRuns(receipt('a'), b);
  assert.equal(result.comparable, true);
  assert.equal(result.warnings.length, 4);
  assert.match(formatComparison(result), /Commit and test --ref/);
});

test('CLI emits JSON and fails mismatched/missing inputs without changing the run files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-compare-'));
  try {
    const before = join(dir, 'before'),
      after = join(dir, 'after');
    await mkdir(before);
    await mkdir(after);
    const a = receipt('a'),
      b = receipt('b');
    await writeFile(join(before, 'summary.json'), JSON.stringify(a));
    await writeFile(join(after, 'summary.json'), JSON.stringify(b));
    const cli = fileURLToPath(new URL('../tools/compare.ts', import.meta.url));
    const run = () => spawnSync(process.execPath, [cli, before, after, '--json'], { encoding: 'utf8' });
    let output = run();
    assert.equal(output.status, 0, output.stderr);
    assert.equal(JSON.parse(output.stdout).comparable, true);
    await writeFile(join(after, 'summary.json'), JSON.stringify({ ...b, seed: 77 }));
    output = run();
    assert.equal(output.status, 1);
    assert.equal(JSON.parse(output.stdout).comparable, false);
    await writeFile(join(after, 'summary.json'), '{');
    output = run();
    assert.equal(output.status, 1);
    assert.match(output.stderr, /Comparison failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
