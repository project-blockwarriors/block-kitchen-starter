import { recipes, potRecipe, type Command, type Ingredient, type KitchenObservation } from '../game.ts';
export type Option = Command & { id: string; value: number; reason: string };
export type Style = 'specialists' | 'generalists';
/** Replace this entire policy, add your own memory, or generate a different legal option set. */
export function options(o: KitchenObservation, style: Style = 'specialists'): Option[] {
  const c = o.self,
    out: Option[] = [];
  const add = (task: Command['task'], target: string, value: number, reason: string) =>
    out.push({ id: task + ':' + target, task, target, value, reason });
  const prep = style === 'specialists' && c.seat === 0;
  if (c.busyUntil) return [{ id: 'wait:', task: 'wait', target: '', value: 0, reason: 'Finish chopping' }];
  if (c.item?.kind === 'raw') {
    for (const id of ['board0', 'board1'])
      if (!(o.teammate.busyUntil && o.teammate.command.target === id))
        add('chop', id, 100, 'Chop the ingredient');
  } else if (c.item?.kind === 'soup') {
    const recipe = c.item.recipe;
    if (o.orders.some((x) => x.recipe === recipe))
      add('serve', 'serve', 200, 'Deliver a requested soup before the deadline');
    else add('discard', 'bin', 10, 'Discard soup no current order needs');
  } else if (c.item?.kind === 'chopped') {
    for (const [id, p] of Object.entries(o.pots))
      if (!p.readyAt && !p.burned) {
        const after = [...p.ingredients, c.item.ingredient];
        if (
          o.orders.some((x) =>
            after.every(
              (v, i) =>
                after.slice(0, i + 1).filter((y) => y === v).length <=
                recipes[x.recipe].filter((y) => y === v).length,
            ),
          )
        )
          add('cook', id, prep ? 70 : 110, 'Load an ingredient into a matching soup');
      }
    if (prep)
      for (const [id, item] of Object.entries(o.pass))
        if (!item) add('put', id, 100, 'Hand off to the serving chef');
    if (!out.length) add('discard', 'bin', 5, 'Clear an ingredient that cannot be used');
  } else {
    for (const [id, p] of Object.entries(o.pots)) {
      if (p.burned) add('discard', id, 130, 'Clear the burned stove');
      else if (p.readyAt && o.tick >= p.readyAt)
        add('take', id, 250 - (p.burnAt - o.tick) / 10, 'Rescue finished soup before it burns');
    }
    for (const [id, item] of Object.entries(o.pass))
      if (item && !prep) add('take', id, 120, 'Collect a handoff');
    const demand: Ingredient[] = [];
    const remaining = o.orders.map((x) => x.recipe);
    for (const p of Object.values(o.pots)) {
      if (p.readyAt) {
        const index = remaining.indexOf(potRecipe(p));
        if (index >= 0) remaining.splice(index, 1);
        continue;
      }
      const index = remaining.findIndex((r) => p.ingredients.every((v) => recipes[r].includes(v)));
      if (index < 0) continue;
      const needed = [...recipes[remaining.splice(index, 1)[0]!]];
      for (const v of p.ingredients) {
        const i = needed.indexOf(v);
        if (i >= 0) needed.splice(i, 1);
      }
      demand.push(...needed);
    }
    for (const item of [...Object.values(o.pass), o.teammate.item])
      if (item && item.kind !== 'soup') {
        const i = demand.indexOf(item.ingredient);
        if (i >= 0) demand.splice(i, 1);
      }
    const other = o.teammate.command.task;
    if (!o.teammate.item && (other === 'tomato' || other === 'mushroom')) {
      const i = demand.indexOf(other);
      if (i >= 0) demand.splice(i, 1);
    }
    const wanted = demand[0];
    if (wanted) add(wanted, wanted, prep ? 90 : 50, 'Prepare the next missing ingredient');
  }
  for (const item of out) {
    const s = o.stations[item.target]!;
    item.value -= Math.abs(c.x - s.x) + Math.abs(c.z - s.z);
  }
  return out.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, 12);
}
