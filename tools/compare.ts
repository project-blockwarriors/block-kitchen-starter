import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

type Receipt = Record<string, any>;
const metrics = {
  score: 'Points',
  delivered: 'Orders served',
  missed: 'Orders missed',
  burned: 'Burns',
  rejectedActions: 'Rejected actions',
  tickLateP95Ms: 'Clock lateness p95 (ms)',
} as const;
const digest = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const count = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const clean = (x: unknown) => String(x).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

/** Describe a local pair; never turn a single score difference into a strength claim. */
export function compareRuns(before: Receipt, after: Receipt) {
  const blockers: string[] = [],
    warnings: string[] = [];
  const runs = [before, after];
  for (const [i, r] of runs.entries()) {
    const label = i === 0 ? 'Before' : 'After';
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error(label + ': expected a summary object.');
    if (typeof r.id !== 'string' || !r.id) blockers.push(label + ': run identity is missing.');
    if (r.status !== 'completed' || r.error || r.cleanupConfirmed === false || r.validForComparison === false)
      blockers.push(label + ': run did not finish successfully. Inspect its replay and errors first.');
    if (
      !count(r.duration) ||
      r.duration < 100 ||
      r.duration > 1800 ||
      r.duration % 10 !== 0 ||
      r.ticks !== r.duration
    )
      blockers.push(label + ': a complete 10–180 second shift is required.');
    if (!Number.isSafeInteger(r.seed)) blockers.push(label + ': seed is missing or invalid.');
    if (r.protocol !== 'dream-kitchen.v1' || typeof r.ruleset !== 'string' || !r.ruleset)
      blockers.push(label + ': Kitchen rules identity is missing.');
    if (
      r.execution !== 'local-process' ||
      r.modelMode !== 'disabled' ||
      r.dispatch !== 'independent-local-practice'
    )
      blockers.push(label + ': use two local practice runs with models disabled.');
    if (!digest(r.practiceEngineSha256) || !digest(r.practiceRunnerSha256))
      blockers.push(
        label + ': rules or practice-tool hash is missing. Rerun with the current practice tool.',
      );
    if (
      !r.practiceRuntime ||
      !['node', 'platform', 'arch'].every(
        (k) => typeof r.practiceRuntime[k] === 'string' && r.practiceRuntime[k],
      )
    )
      blockers.push(label + ': practice runtime is missing. Rerun with the current practice tool.');
    for (const key of ['delivered', 'missed', 'burned', 'rejectedActions', 'droppedLogs'])
      if (!count(r[key])) blockers.push(label + ': invalid or missing ' + key + '.');
    if (!Number.isSafeInteger(r.score)) blockers.push(label + ': invalid or missing score.');
    if (!finite(r.tickLateP95Ms)) blockers.push(label + ': invalid or missing clock timing.');
    if (
      !Array.isArray(r.chefs) ||
      r.chefs.length !== 2 ||
      ![0, 1].every((seat) => r.chefs.filter((c: any) => c?.seat === seat).length === 1)
    )
      blockers.push(label + ': both chef results are required.');
    else
      for (const chef of r.chefs) {
        if (
          chef.error ||
          chef.failure ||
          !count(chef.calls) ||
          chef.calls === 0 ||
          !finite(chef.responseP95Ms)
        )
          blockers.push(
            label + ': chef ' + (chef.seat + 1) + ' failed or has incomplete response measurements.',
          );
      }
    if (
      !Array.isArray(r.sources) ||
      r.sources.length !== 2 ||
      !r.sources.every((s: any) => s && typeof s.kind === 'string')
    )
      blockers.push(label + ': both source identities are required.');
    else if (
      r.sources.some(
        (s: any) => s.kind !== 'git-archive' || !/^[a-f0-9]{40}$/.test(s.sha) || !digest(s.archiveSha256),
      )
    )
      warnings.push(
        label + ': working files or loose entrypoints were used. Commit and test --ref before submitting.',
      );
    if (r.rejectedActions > 0)
      warnings.push(
        label + ': actions were rejected. Inspect the replay before attributing the score to policy.',
      );
    if (r.droppedLogs > 0) warnings.push(label + ': some diagnostic logs were dropped.');
    if (r.tickLateP95Ms >= 50)
      warnings.push(label + ': clock lateness reached the 50 ms target. Timing may affect this result.');
  }
  if (before.id && before.id === after.id)
    blockers.push('These are the same run. Select two separate attempts.');
  for (const [key, label] of Object.entries({
    seed: 'Seed',
    duration: 'Shift length',
    protocol: 'Protocol',
    ruleset: 'Ruleset',
    practiceEngineSha256: 'Rules code',
    practiceRunnerSha256: 'Practice tool',
  }))
    if (before[key] !== after[key])
      blockers.push(label + ' differs. Rerun both versions under the same conditions.');
  for (const key of ['node', 'platform', 'arch'])
    if (before.practiceRuntime?.[key] !== after.practiceRuntime?.[key])
      blockers.push('Practice runtime ' + key + ' differs.');
  const values = Object.entries(metrics).map(([key, label]) => ({
    key,
    label,
    before: Number.isFinite(before[key]) ? before[key] : null,
    after: Number.isFinite(after[key]) ? after[key] : null,
    delta: Number.isFinite(before[key]) && Number.isFinite(after[key]) ? after[key] - before[key] : null,
  }));
  return {
    comparable: blockers.length === 0,
    blockers,
    warnings,
    metrics: values,
    runs: runs.map((r) => ({
      id: r.id,
      seed: r.seed,
      duration: r.duration,
      status: r.status,
      error: r.error ?? null,
      sources: Array.isArray(r.sources) ? r.sources : [],
      chefs: Array.isArray(r.chefs) ? r.chefs : [],
    })),
    next: blockers.length
      ? 'Fix the listed issues, then compare fresh runs.'
      : 'Review both replays. Repeat the pair on other seeds before choosing a version.',
    limitations:
      'One local pair with models disabled. Summary files are self-reported; replay contents are not verified. Matching settings do not control machine load or prove bot strength, Jev quality, hosted capacity or Minecraft fidelity.',
  };
}

export function formatComparison(result: ReturnType<typeof compareRuns>) {
  const lines = [
    result.comparable ? 'Same settings · local practice comparison' : 'Not a like-for-like comparison',
  ];
  for (const [i, r] of result.runs.entries()) {
    lines.push(
      `${i ? 'After' : 'Before'}: seed ${clean(r.seed)}, ${Number(r.duration) / 10}s, ${clean(r.status)}`,
    );
    for (const [seat, s] of r.sources.entries())
      lines.push(`  Chef ${seat + 1}: ${clean(s?.sha ?? s?.kind ?? 'unknown source')}`);
    if (r.error) lines.push('  Run error: ' + clean(r.error));
    for (const chef of r.chefs)
      if (chef?.error || chef?.failure) lines.push('  Chef error: ' + clean(chef.error || chef.failure));
  }
  lines.push('', 'Measure                      Before       After      Change');
  const value = (n: number | null) => (n === null ? 'unknown' : Number(n.toFixed(2)).toString());
  for (const m of result.metrics)
    lines.push(
      m.label.padEnd(28) +
        value(m.before).padStart(8) +
        value(m.after).padStart(12) +
        (m.delta === null ? 'unknown' : (m.delta > 0 ? '+' : '') + value(m.delta)).padStart(12),
    );
  lines.push(
    '',
    ...result.blockers.map((s) => 'Check: ' + s),
    ...result.warnings.map((s) => 'Note: ' + s),
    result.next,
    result.limitations,
  );
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { json: { type: 'boolean' } },
    });
    if (positionals.length !== 2)
      throw Error('Usage: npm run compare -- BEFORE_DIRECTORY AFTER_DIRECTORY [--json]');
    const receipts = await Promise.all(
      positionals.map(async (dir) => JSON.parse(await readFile(resolve(dir, 'summary.json'), 'utf8'))),
    );
    const result = compareRuns(receipts[0], receipts[1]);
    console.log(values.json ? JSON.stringify(result, null, 2) : formatComparison(result));
    if (!result.comparable) process.exitCode = 1;
  } catch (error) {
    console.error('Comparison failed: ' + clean(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
