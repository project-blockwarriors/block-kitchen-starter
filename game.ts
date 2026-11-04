/** Rush Kitchen: a deterministic cooperative prototype, independent of Paper physics. */
export const KITCHEN_PROTOCOL = 'dream-kitchen.v1';
export const KITCHEN_RULESET = 'rush-kitchen.0.1';
export type Ingredient = 'tomato' | 'mushroom';
export type Recipe = 'tomato' | 'mushroom' | 'garden';
export type Item = { kind: 'raw' | 'chopped'; ingredient: Ingredient } | { kind: 'soup'; recipe: Recipe };
export type Task = 'tomato' | 'mushroom' | 'chop' | 'put' | 'take' | 'cook' | 'serve' | 'discard' | 'wait';
export type Command = { task: Task; target: string };
export type KitchenAction = Command & { seq: number; observedTick: number };
export const stations: Record<string, { x: number; z: number; kind: string }> = {
  tomato: { x: 0, z: 0, kind: 'supply' },
  mushroom: { x: 0, z: 4, kind: 'supply' },
  board0: { x: 2, z: 1, kind: 'board' },
  board1: { x: 2, z: 3, kind: 'board' },
  pass0: { x: 4, z: 0, kind: 'pass' },
  pass1: { x: 4, z: 1, kind: 'pass' },
  pass2: { x: 4, z: 3, kind: 'pass' },
  pass3: { x: 4, z: 4, kind: 'pass' },
  stove0: { x: 6, z: 1, kind: 'stove' },
  stove1: { x: 6, z: 3, kind: 'stove' },
  serve: { x: 8, z: 2, kind: 'serve' },
  bin: { x: 4, z: 2, kind: 'bin' },
};
export const recipes: Record<Recipe, Ingredient[]> = {
  tomato: ['tomato', 'tomato'],
  mushroom: ['mushroom', 'mushroom'],
  garden: ['tomato', 'mushroom'],
};
export type Chef = {
  seat: number;
  x: number;
  z: number;
  item: Item | null;
  command: Command;
  busyUntil: number;
  seq: number;
  completed: number;
};
export type Pot = { ingredients: Ingredient[]; readyAt: number; burnAt: number; burned: boolean };
export type Order = { id: number; recipe: Recipe; expiresAt: number };
export type KitchenEvent = {
  id: number;
  tick: number;
  kind: string;
  seat?: number;
  text: string;
  points?: number;
};
export type KitchenState = {
  protocol: typeof KITCHEN_PROTOCOL;
  ruleset: typeof KITCHEN_RULESET;
  matchId: string;
  seed: number;
  tick: number;
  duration: number;
  status: 'idle' | 'running' | 'completed';
  score: number;
  delivered: number;
  missed: number;
  burned: number;
  combo: number;
  chefs: Chef[];
  pots: Record<string, Pot>;
  pass: Record<string, Item | null>;
  orders: Order[];
  events: KitchenEvent[];
};
export type KitchenObservation = KitchenState & {
  self: Chef;
  teammate: Chef;
  stations: typeof stations;
  recipes: typeof recipes;
  ticksPerSecond: number;
};
export function validAction(value: unknown): value is KitchenAction {
  if (!value || typeof value !== 'object') return false;
  const a = value as KitchenAction;
  return (
    Number.isSafeInteger(a.seq) &&
    a.seq >= 0 &&
    Number.isSafeInteger(a.observedTick) &&
    a.observedTick >= 0 &&
    ['tomato', 'mushroom', 'chop', 'put', 'take', 'cook', 'serve', 'discard', 'wait'].includes(a.task) &&
    typeof a.target === 'string' &&
    (a.task === 'wait' ? a.target === '' : Object.hasOwn(stations, a.target)) &&
    Object.keys(a).every((k) => ['seq', 'observedTick', 'task', 'target'].includes(k))
  );
}
const emptyPot = (): Pot => ({ ingredients: [], readyAt: 0, burnAt: 0, burned: false });
export function potRecipe(p: Pot): Recipe {
  return p.ingredients[0] === p.ingredients[1] ? p.ingredients[0]! : 'garden';
}
export class Kitchen {
  state: KitchenState;
  private random: number;
  private nextOrder = 0;
  private nextEvent = 0;
  constructor(seed = 42, duration = 1800, matchId = 'kitchen-' + seed) {
    if (
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 2147483647 ||
      !Number.isSafeInteger(duration) ||
      duration < 100 ||
      duration > 1800
    )
      throw Error('Invalid kitchen seed/duration');
    this.random = seed || 1;
    this.state = {
      protocol: KITCHEN_PROTOCOL,
      ruleset: KITCHEN_RULESET,
      matchId,
      seed,
      tick: 0,
      duration,
      status: 'idle',
      score: 0,
      delivered: 0,
      missed: 0,
      burned: 0,
      combo: 0,
      chefs: [0, 1].map((seat) => ({
        seat,
        x: seat ? 7 : 1,
        z: 2,
        item: null,
        command: { task: 'wait', target: '' },
        busyUntil: 0,
        seq: -1,
        completed: 0,
      })),
      pots: { stove0: emptyPot(), stove1: emptyPot() },
      pass: { pass0: null, pass1: null, pass2: null, pass3: null },
      orders: [],
      events: [],
    };
    for (let i = 0; i < 3; i++) this.order(i * 100);
  }
  private order(extra = 0) {
    this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
    this.state.orders.push({
      id: ++this.nextOrder,
      recipe: (['tomato', 'mushroom', 'garden'] as const)[this.random % 3]!,
      expiresAt: this.state.tick + 450 + extra,
    });
  }
  private event(kind: string, text: string, seat?: number, points?: number) {
    this.state.events.push({ id: ++this.nextEvent, tick: this.state.tick, kind, text, seat, points });
  }
  observe(seat: number): KitchenObservation {
    if (seat !== 0 && seat !== 1) throw Error('Invalid chef seat');
    return structuredClone({
      ...this.state,
      self: this.state.chefs[seat]!,
      teammate: this.state.chefs[1 - seat]!,
      stations,
      recipes,
      ticksPerSecond: 10,
    });
  }
  step(actions: (KitchenAction | null)[]) {
    const s = this.state;
    if (s.status === 'completed') return s;
    s.events = [];
    for (const seat of [0, 1]) {
      const a = actions[seat],
        c = s.chefs[seat]!;
      if (!a) continue;
      if (!validAction(a) || a.seq <= c.seq || a.observedTick > s.tick || s.tick - a.observedTick > 10) {
        this.event('rejected', 'Chef action was invalid, duplicate or stale', seat);
        continue;
      }
      c.seq = a.seq;
      if (!c.busyUntil) c.command = { task: a.task, target: a.target };
    }
    s.status = 'running';
    s.tick++;
    for (const [id, p] of Object.entries(s.pots))
      if (p.burnAt && s.tick >= p.burnAt && !p.burned) {
        p.burned = true;
        s.burned++;
        s.combo = 0;
        this.event('burn', id + ' burned. Empty it at the stove.');
      }
    for (const o of [...s.orders])
      if (s.tick >= o.expiresAt) {
        s.orders = s.orders.filter((x) => x.id !== o.id);
        s.missed++;
        s.combo = 0;
        s.score -= 10;
        this.event('miss', 'Order ' + o.id + ' expired', undefined, -10);
        this.order();
      }
    // Alternate contested station priority; array order does not grant a permanent advantage.
    for (const seat of s.tick % 2 ? [0, 1] : [1, 0]) this.advance(s.chefs[seat]!);
    if (s.tick >= s.duration) {
      s.status = 'completed';
      this.event('finished', 'Shift finished: ' + s.delivered + ' orders, ' + s.score + ' points');
    }
    return s;
  }
  private advance(c: Chef) {
    const s = this.state;
    if (c.busyUntil) {
      if (s.tick < c.busyUntil) return;
      if (c.item?.kind === 'raw') c.item = { kind: 'chopped', ingredient: c.item.ingredient };
      c.busyUntil = 0;
      c.completed++;
      c.command = { task: 'wait', target: '' };
      this.event('chopped', 'Ingredient chopped', c.seat);
      return;
    }
    const { task, target } = c.command,
      station = stations[target];
    if (task === 'wait' || !station) return;
    if (c.x !== station.x || c.z !== station.z) {
      if (s.tick % 2 === 0) {
        if (c.x !== station.x) c.x += Math.sign(station.x - c.x);
        else c.z += Math.sign(station.z - c.z);
      }
      return;
    }
    let done = false;
    if ((task === 'tomato' || task === 'mushroom') && target === task && !c.item) {
      c.item = { kind: 'raw', ingredient: task };
      done = true;
    }
    if (
      task === 'chop' &&
      station.kind === 'board' &&
      c.item?.kind === 'raw' &&
      !s.chefs.some((o) => o !== c && o.busyUntil && o.command.target === target)
    ) {
      c.busyUntil = s.tick + 15;
      return;
    }
    if (task === 'put' && station.kind === 'pass' && c.item && !s.pass[target]) {
      s.pass[target] = c.item;
      c.item = null;
      done = true;
      this.event('handoff', 'Chef ' + (c.seat + 1) + ' left an ingredient on ' + target, c.seat);
    }
    if (task === 'take' && station.kind === 'pass' && !c.item && s.pass[target]) {
      c.item = s.pass[target]!;
      s.pass[target] = null;
      done = true;
    }
    const p = s.pots[target];
    if (task === 'cook' && p && !p.readyAt && p.ingredients.length < 2 && c.item?.kind === 'chopped') {
      p.ingredients.push(c.item.ingredient);
      c.item = null;
      done = true;
      if (p.ingredients.length === 2) {
        p.readyAt = s.tick + 40;
        p.burnAt = p.readyAt + 60;
        this.event('cooking', potRecipe(p) + ' soup cooking at ' + target, c.seat);
      }
    }
    if (task === 'take' && p && !c.item && p.readyAt && s.tick >= p.readyAt && !p.burned) {
      c.item = { kind: 'soup', recipe: potRecipe(p) };
      s.pots[target] = emptyPot();
      done = true;
      this.event('ready', 'Soup collected from ' + target, c.seat);
    }
    if (task === 'discard' && p?.burned && !c.item) {
      s.pots[target] = emptyPot();
      done = true;
      this.event('cleaned', target + ' cleared', c.seat);
    }
    if (task === 'discard' && target === 'bin' && c.item) {
      c.item = null;
      done = true;
    }
    if (task === 'serve' && target === 'serve' && c.item?.kind === 'soup') {
      const recipe = c.item.recipe,
        order = s.orders.find((o) => o.recipe === recipe);
      if (order) {
        const points =
          60 + Math.min(20, Math.floor((order.expiresAt - s.tick) / 20)) + Math.min(30, s.combo * 5);
        s.score += points;
        s.delivered++;
        s.combo++;
        s.orders = s.orders.filter((o) => o.id !== order.id);
        c.item = null;
        done = true;
        this.event('delivered', recipe + ' soup served for order ' + order.id, c.seat, points);
        this.order();
      }
    }
    if (done) {
      c.completed++;
      c.command = { task: 'wait', target: '' };
    }
  }
}
