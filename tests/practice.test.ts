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

test('a response for a future observation cannot start the local clock', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-response-'));
  try {
    const bot = join(dir, 'future.mjs');
    await writeFile(
      bot,
      fixture(0).replace('observedTick:m.observation.tick', 'observedTick:m.observation.tick+1'),
    );
    const result = await runPractice({ out: join(dir, 'run'), bots: [bot, bot], seconds: 10 });
    assert.equal(result.status, 'failed');
    assert.equal(result.ticks, 0);
    assert.match(result.error!, /matching action response.*3 seconds/);
    assert.equal(result.chefs[0].calls, 1);
    assert.equal(result.chefs[0].ignoredActions, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'reused action sequences do not release the lane while its partner keeps playing',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kitchen-response-'));
    try {
      const bot = join(dir, 'duplicate.mjs'),
        fast = join(dir, 'fast.mjs');
      await writeFile(bot, fixture(0).replace('seq:m.observation.tick+1', 'seq:1'));
      await writeFile(fast, fixture(0));
      const result = await runPractice({ out: join(dir, 'run'), bots: [bot, fast], seconds: 10 });
      assert.equal(result.status, 'failed');
      assert.equal(result.ticks, 100);
      assert.equal(result.chefs[0].calls, 2);
      assert.equal(result.chefs[0].ignoredActions, 1);
      assert.match(result.chefs[0].error!, /matching action response.*3 seconds/);
      assert.ok(result.chefs[1].calls > 85);
      assert.equal(result.rejectedActions, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'unmatched replies are ignored until a matching reply arrives, without consuming its sequence',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kitchen-response-'));
    try {
      const bot = join(dir, 'recover.mjs');
      await writeFile(
        bot,
        `
import { createInterface } from 'node:readline';
const send=(action)=>console.log(JSON.stringify({type:'action',action}));
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if(m.type==='prepare') console.log(JSON.stringify({type:'ready',version:1,nonce:m.nonce}));
 if(m.type==='observation') {
  const tick=m.observation.tick, action={seq:tick+1,observedTick:tick,task:'wait',target:''};
  send({...action,observedTick:tick+1,seq:999999});
  if(tick>0) {
   send({...action,observedTick:tick-1});
   send({...action,seq:0});
  }
  send(action);
  send(action);
 }
}`,
      );
      const result = await runPractice({ out: join(dir, 'run'), bots: [bot, bot], seconds: 10 });
      assert.equal(result.status, 'completed');
      assert.equal(result.ticks, 100);
      assert.equal(result.rejectedActions, 0);
      for (const chef of result.chefs) {
        assert.ok(chef.calls > 85);
        assert.equal(chef.ignoredActions, chef.calls * 4 - 2);
      }
      const rows = (await readFile(join(dir, 'run/replay.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.ok(
        rows.some((r) => r.type === 'decision' && r.kind === 'log' && /Ignored action/.test(r.payload.text)),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('actions sent before the first observation still fail preparation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-response-'));
  try {
    const bot = join(dir, 'early.mjs');
    await writeFile(
      bot,
      fixture(0).replace(
        "if(m.type==='prepare') console.log(JSON.stringify({type:'ready',version:1,nonce:m.nonce}));",
        "if(m.type==='prepare') process.stdout.write(JSON.stringify({type:'ready',version:1,nonce:m.nonce})+'\\n'+JSON.stringify({type:'action',action:{seq:1,observedTick:0,task:'wait',target:''}})+'\\n');",
      ),
    );
    const result = await runPractice({ out: join(dir, 'run'), bots: [bot, bot], seconds: 10 });
    assert.equal(result.status, 'failed');
    assert.equal(result.ticks, 0);
    assert.match(result.error!, /first observation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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
      assert.match(result.practiceEngineSha256!, /^[a-f0-9]{64}$/);
      assert.match(result.practiceRunnerSha256!, /^[a-f0-9]{64}$/);
      assert.equal(result.practiceRuntime.node, process.version);
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
