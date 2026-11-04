import type { KitchenAction, KitchenObservation } from '../game.ts';
import { options, type Style } from './policy.ts';
export type Mode = 'scripted' | 'jev' | 'hybrid';
export const config: { mode: Mode; style: Style } = { mode: 'jev', style: 'specialists' };
/** Two instances run independently. Only the public observation communicates teammate state. */
export class KitchenAgent {
  seq = 0;
  serial = 0;
  nextJev = 0;
  nextPlanner = 0;
  tick = 0;
  pending = new Map<string, { provider: string; tick: number; ids: string[] }>();
  advice: { id: string; expires: number } | null = null;
  plan = '';
  planExpires = 0;
  readonly mode: Mode;
  readonly style: Style;
  constructor(mode: Mode = config.mode, style: Style = config.style) {
    this.mode = mode;
    this.style = style;
  }
  respond(r: any) {
    const p = this.pending.get(r.requestId);
    if (!p) return;
    this.pending.delete(r.requestId);
    if (r.error || this.tick - p.tick > (p.provider === 'jev' ? 15 : 80)) return;
    if (p.provider === 'jev') {
      const id = r.result?.answers?.task?.choice;
      if (p.ids.includes(id)) this.advice = { id, expires: p.tick + 15 };
    } else {
      this.plan = (r.result?.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join(' ')
        .slice(0, 300);
      this.planExpires = p.tick + 150;
    }
  }
  step(o: KitchenObservation) {
    this.tick = o.tick;
    if (o.tick >= this.planExpires) this.plan = '';
    const candidates = options(o, this.style),
      requests: any[] = [];
    const advised =
      this.advice && this.advice.expires > o.tick
        ? candidates.find((x) => x.id === this.advice!.id)
        : undefined;
    // Avoid changing destination while travelling; emergencies (finished soup) may interrupt.
    const continuing = candidates.find(
      (x) => x.task === o.self.command.task && x.target === o.self.command.target,
    );
    const chosen = candidates[0]?.value > 200 ? candidates[0] : (continuing ?? advised ?? candidates[0]);
    const action: KitchenAction = {
      seq: ++this.seq,
      observedTick: o.tick,
      task: chosen?.task ?? 'wait',
      target: chosen?.target ?? '',
    };
    const busy = (provider: string) => [...this.pending.values()].some((p) => p.provider === provider);
    if (
      o.status === 'running' &&
      this.mode !== 'scripted' &&
      o.tick >= this.nextJev &&
      !busy('jev') &&
      candidates.length > 1
    ) {
      const requestId = 'chef-' + o.self.seat + '-' + ++this.serial;
      this.nextJev = o.tick + 10;
      this.pending.set(requestId, { provider: 'jev', tick: o.tick, ids: candidates.map((c) => c.id) });
      requests.push({
        type: 'model',
        provider: 'jev',
        requestId,
        state: {
          chef: o.self,
          teammate: o.teammate,
          orders: o.orders,
          pots: o.pots,
          pass: o.pass,
          tick: o.tick,
          plan: this.plan,
        },
        questions: {
          task: {
            type: 'choice',
            instructions:
              'Cooperate to serve matching soups. Prevent burns, avoid duplicate work and respect deadlines. Choose the next useful task.',
            criteria: Object.fromEntries(candidates.map((c) => [c.id, c.reason])),
          },
        },
      });
    }
    if (o.status === 'running' && this.mode === 'hybrid' && o.tick >= this.nextPlanner && !busy('claude')) {
      const requestId = 'plan-' + o.self.seat + '-' + ++this.serial;
      this.nextPlanner = o.tick + 150;
      this.pending.set(requestId, { provider: 'claude', tick: o.tick, ids: [] });
      requests.push({
        type: 'model',
        provider: 'claude',
        requestId,
        prompt:
          'Give one short public instruction for this chef to cooperate, not hidden reasoning. Two chopped ingredients cook for 4 seconds; soup burns after another 6. Serve matching orders. State: ' +
          JSON.stringify({
            self: o.self,
            teammate: o.teammate,
            orders: o.orders,
            pots: o.pots,
            pass: o.pass,
          }),
      });
    }
    return {
      action,
      requests,
      trace: {
        tick: o.tick,
        chef: o.self.seat,
        task: action.task,
        target: action.target,
        source:
          chosen === advised && advised
            ? 'jev'
            : chosen === continuing && continuing
              ? 'continuing'
              : 'local',
        reason: chosen?.reason ?? 'Wait for work',
      },
    };
  }
}
