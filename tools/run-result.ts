import { readFile } from 'node:fs/promises';

export type ReplayRow = { type: string; tick: number; [key: string]: any };
type Issue = { label: string; detail: string };

/** Keep a readable prefix if storage stopped halfway through an NDJSON record. */
export function parseReplay(source: string): { rows: ReplayRow[]; issue?: string } {
  const rows: ReplayRow[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row.type !== 'string' || !Number.isFinite(row.tick)) throw Error();
      rows.push(row);
    } catch {
      return {
        rows,
        issue: `Recording is unreadable at line ${index + 1}. Only the preceding records are shown.`,
      };
    }
  }
  return { rows };
}

export async function readReplay(directory: string) {
  try {
    return parseReplay(await readFile(directory + '/replay.ndjson', 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { rows: [], issue: 'No replay file was saved.' };
  }
}

/** Derive presentation from recorded facts, without assigning unknown failures to bot authors. */
export function runResult(receipt: any, rows: ReplayRow[], recordingIssue?: string) {
  const states = rows.filter((r) => r.type === 'state').sort((a, b) => a.tick - b.tick);
  const last = states.at(-1);
  const issues: Issue[] = [];
  const chefs = (receipt.chefs ?? []).flatMap((chef: any, index: number) => {
    const detail = chef.failure || chef.error;
    return detail ? [{ label: `Chef ${(chef.seat ?? index) + 1}`, detail: String(detail) }] : [];
  });
  issues.push(...chefs);
  const error = typeof receipt.error === 'string' ? receipt.error : '';
  // Local practice repeats chef errors in its top-level error; don't call those worker failures.
  const duplicateChefError = error && chefs.map((c: Issue) => c.detail).join('; ') === error;
  const clockFailure = error === 'Game clock stalled for more than one second';
  if (error && !duplicateChefError)
    issues.push({ label: clockFailure ? 'Game worker' : 'Reported run error', detail: error });
  const models = (receipt.models ?? []).flat();
  const modelErrors = models.filter((m: any) => m.ok === false);
  if (modelErrors.length)
    issues.push({
      label: 'Model calls',
      detail: `${modelErrors.length} of ${models.length} calls failed. ${[...new Set(modelErrors.map((m: any) => m.error || 'No error detail recorded'))].join('; ')}. A failed call does not by itself stop a chef.`,
    });
  if (receipt.cleanupConfirmed === false)
    issues.push({
      label: 'Worker cleanup',
      detail: 'Cleanup was not confirmed. Ask the organizer to check this run before starting another.',
    });
  if (recordingIssue) issues.push({ label: 'Recording', detail: recordingIssue });
  else if (!last) issues.push({ label: 'Recording', detail: 'No game states were saved.' });
  const ticks = Number.isFinite(receipt.ticks) ? receipt.ticks : last?.tick;
  const duration = Number.isFinite(receipt.duration) ? receipt.duration : undefined;
  const completedClock = last?.status === 'completed' || (duration > 0 && ticks >= duration);
  const complete =
    receipt.status === 'completed' &&
    chefs.length === 0 &&
    !error &&
    receipt.validForComparison !== false &&
    receipt.cleanupConfirmed !== false;
  const replayComplete = !!last && !recordingIssue && (ticks === undefined || last.tick >= ticks);
  if (last && Number.isFinite(ticks) && last.tick < ticks)
    issues.push({
      label: 'Recording',
      detail: `Recording ends at tick ${last.tick}; the run summary reports tick ${ticks}.`,
    });
  const heading =
    receipt.cleanupConfirmed === false
      ? 'Worker cleanup needs attention'
      : chefs.length
        ? completedClock
          ? 'Shift ended with a chef unavailable'
          : 'Chef unavailable during this run'
        : receipt.status === 'failed'
          ? ticks === 0
            ? 'Run failed before play'
            : 'Run stopped early'
          : !complete
            ? 'Run not confirmed complete'
            : !replayComplete
              ? 'Run completed · replay incomplete'
              : modelErrors.length
                ? 'Run completed with model errors'
                : 'Run completed';
  const next =
    receipt.cleanupConfirmed === false
      ? 'Contact the organizer before retrying.'
      : chefs.length
        ? 'Review the chef error below. Check your bot locally; share worker errors with the organizer.'
        : clockFailure
          ? 'The worker stopped the clock. Share the run ID with the organizer; this run cannot compare bot strength.'
          : error
            ? 'Review the reported error below. Its cause may be in the bot or the worker.'
            : !complete
              ? 'This receipt does not confirm a successful run. Check the run details before comparing scores.'
              : !replayComplete
                ? 'Use the run summary for the outcome; this recording cannot show the full run.'
                : modelErrors.length
                  ? 'Review failed calls and how the bot continued without advice.'
                  : receipt.modelMode === 'disabled'
                    ? 'Local practice · models disabled. This tests your code, not hosted capacity.'
                    : 'Practice result · not an official competition score.';
  return {
    heading,
    next,
    issues,
    complete,
    replayComplete,
    ticks,
    duration,
    score: Number.isFinite(receipt.score) ? receipt.score : last?.score,
    modelsRecorded: Array.isArray(receipt.models),
    modelCalls: models.length,
    modelErrors: modelErrors.length,
  };
}

export function replayData(rows: ReplayRow[]) {
  const states = rows.filter((r) => r.type === 'state').sort((a, b) => a.tick - b.tick);
  const events = [
    ...new Map(
      states
        .flatMap((s) => s.events ?? [])
        .map((e: any) => [e.id ?? JSON.stringify([e.tick, e.kind, e.seat, e.text, e.points]), e]),
    ).values(),
  ].sort((a, b) => a.tick - b.tick);
  // Legacy workers emitted received rows for empty HTTP polls. They are not bot responses.
  const responses = rows
    .filter((r) => r.type === 'dispatch' && (r.payload?.kind === 'unavailable' || r.payload?.action))
    .map((r) => ({
      ...r,
      payload: { ...r.payload, observedTick: r.payload.action?.observedTick ?? r.payload.observedTick },
    }))
    .sort((a, b) => a.tick - b.tick);
  return { states, events, responses };
}
