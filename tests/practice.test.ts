import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPractice } from '../tools/practice.ts';

const fixture = (delay: number) => `
import { createInterface } from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if(m.type==='prepare') console.log(JSON.stringify({type:'ready',version:1,nonce:m.nonce}));
 if(m.type==='observation') setTimeout(()=>console.log(JSON.stringify({type:'action',action:{seq:m.observation.tick+1,observedTick:m.observation.tick,task:'tomato',target:'tomato'}})),${delay});
}`;

test(
  'slow chef does not delay the clock or its partner; custom bot files are executed',
  { timeout: 16000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kitchen-practice-'));
    try {
      const fast = join(dir, 'fast.mjs'),
        slow = join(dir, 'slow.mjs');
      await writeFile(fast, fixture(0));
      await writeFile(slow, fixture(250));
      const result = await runPractice({ out: join(dir, 'run'), bots: [fast, slow], seconds: 10 });
      assert.equal(result.status, 'completed');
      assert.equal(result.ticks, 100);
      assert.ok(result.gameplayWallMs >= 9950 && result.gameplayWallMs < 11500, JSON.stringify(result));
      assert.ok(result.chefs[0].calls > 85);
      assert.ok(result.chefs[1].calls >= 25 && result.chefs[1].calls <= 40);
      const states = (await readFile(join(dir, 'run/replay.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
        .filter((r) => r.type === 'state');
      assert.equal(states.length, 101);
      assert.equal(states[100].chefs[1].item.ingredient, 'tomato');
      assert.equal(result.modelMode, 'disabled');
      await assert.rejects(runPractice({ out: join(dir, 'run'), bots: [fast, slow], seconds: 10 }), /EEXIST/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('invalid startup retains a failure and never advances the clock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-practice-'));
  try {
    const broken = join(dir, 'broken.mjs');
    await writeFile(broken, "console.log('not json');setInterval(()=>{},1000)");
    const result = await runPractice({ out: join(dir, 'run'), bots: [broken, broken], seconds: 10 });
    assert.equal(result.status, 'failed');
    assert.equal(result.ticks, 0);
    assert.match(result.error!, /SyntaxError/);
    assert.equal(JSON.parse(await readFile(join(dir, 'run/summary.json'), 'utf8')).status, 'failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancellation during preparation closes silent children and retains the failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-practice-'));
  try {
    const silent = join(dir, 'silent.mjs');
    await writeFile(silent, 'setInterval(()=>{},1000)');
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), 200);
    const started = performance.now();
    try {
      const result = await runPractice({
        out: join(dir, 'run'),
        bots: [silent, silent],
        seconds: 10,
        signal: c.signal,
      });
      assert.equal(result.status, 'failed');
      assert.equal(result.ticks, 0);
      assert.match(result.error!, /cancelled/);
      assert.ok(performance.now() - started < 2000);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a mid-shift exit is retained while the other chef completes its work', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-practice-'));
  try {
    const fast = join(dir, 'fast.mjs'),
      broken = join(dir, 'broken.mjs');
    await writeFile(fast, fixture(0));
    await writeFile(
      broken,
      fixture(0).replace(
        "if(m.type==='observation') setTimeout",
        "if(m.type==='observation'&&m.observation.tick>=5) process.exit(2); if(m.type==='observation') setTimeout",
      ),
    );
    const result = await runPractice({ out: join(dir, 'run'), bots: [broken, fast], seconds: 10 });
    assert.equal(result.status, 'failed');
    assert.equal(result.ticks, 100);
    assert.match(result.chefs[0].error!, /exited/);
    assert.ok(result.chefs[1].calls > 85);
    const rows = (await readFile(join(dir, 'run/replay.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(rows.some((r) => r.type === 'dispatch' && r.seat === 0 && r.payload.kind === 'unavailable'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
