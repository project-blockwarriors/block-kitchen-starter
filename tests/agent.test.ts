import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kitchen, validAction } from '../game.ts';
import { KitchenAgent } from '../agent/harness.ts';
test('two independent agents produce valid actions and serve soup', () => {
  const game = new Kitchen(42, 600),
    agents = [new KitchenAgent('scripted'), new KitchenAgent('scripted')];
  for (let tick = 0; tick < 600; tick++) {
    const actions = agents.map((a, s) => a.step(game.observe(s)).action);
    assert(actions.every(validAction));
    game.step(actions);
  }
  assert(game.state.delivered > 0);
});
