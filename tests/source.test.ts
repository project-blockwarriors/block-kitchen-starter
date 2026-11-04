import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  access,
  realpath,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSource } from '../tools/practice-source.ts';
import { loadSubmission } from '../tools/submission.mjs';
import { runPractice } from '../tools/practice.ts';

const nodeBot = `import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
const ingredient=readFileSync('ingredient.txt','utf8').trim();
if(existsSync('owned.txt')) throw Error('Shared source directory');
writeFileSync('owned.txt','chef');
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if(m.type==='prepare') console.log(JSON.stringify({type:'ready',version:1,nonce:m.nonce}));
 if(m.type==='observation') console.log(JSON.stringify({type:'action',action:{seq:m.observation.tick+1,observedTick:m.observation.tick,task:ingredient,target:ingredient}}));
}`;
const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
async function repository(runtime = 'node24') {
  const root = await mkdtemp(join(tmpdir(), 'kitchen-source-test-'));
  await mkdir(join(root, 'agent'));
  await writeFile(
    join(root, 'dreamweaver.json'),
    JSON.stringify({
      name: 'Test kitchen',
      protocol: 'dream-kitchen.v1',
      runtime,
      entrypoint: runtime === 'node24' ? 'agent/bot.mjs' : 'agent/bot.py',
    }),
  );
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'package-lock.json'), '{}');
  await writeFile(join(root, 'requirements.txt'), '');
  await writeFile(join(root, 'ingredient.txt'), 'tomato');
  await writeFile(join(root, 'agent/bot.mjs'), nodeBot);
  git(root, 'init', '-q');
  return root;
}
function commit(root: string) {
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'fixture',
  );
  return git(root, 'rev-parse', 'HEAD');
}

test(
  'manifest root and frozen archives include assets, exclude edits and isolate chef writes',
  { timeout: 16000 },
  async () => {
    const root = await repository();
    const sources: Awaited<ReturnType<typeof prepareSource>>[] = [];
    try {
      const sha = commit(root);
      await writeFile(join(root, 'ingredient.txt'), 'mushroom');
      await writeFile(join(root, 'agent/bot.mjs'), 'throw Error("uncommitted bot executed")');
      sources.push(await prepareSource({ root, ref: sha }), await prepareSource({ root, ref: sha }));
      assert.notEqual(sources[0].root, sources[1].root);
      assert.equal(sources[0].identity.sha, sha);
      assert.equal(sources[0].identity.uncommittedChanges, true);
      assert.equal(sources[0].identity.archiveSha256, sources[1].identity.archiveSha256);
      const result = await runPractice({
        out: join(root, 'results'),
        bots: [sources[0], sources[1]],
        seconds: 10,
      });
      assert.equal(result.status, 'completed', result.error);
      const rows = (await readFile(join(root, 'results/replay.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse as (s: string) => any);
      assert.deepEqual(
        rows
          .filter((r) => r.type === 'state')
          .at(-1)
          .chefs.map((c: any) => c.item.ingredient),
        ['tomato', 'tomato'],
      );
      assert.ok(result.chefs.every((c) => c.calls > 85));
      const live = await prepareSource({ root });
      assert.equal(live.root, await realpath(root));
      assert.equal(live.identity.kind, 'working-tree');
    } finally {
      for (const source of sources) {
        await source.dispose();
        await assert.rejects(access(source.root));
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('archive checking rejects omitted required files, symlinks and unsafe paths', async () => {
  const root = await repository();
  try {
    commit(root);
    for (const name of ['dreamweaver.json', 'agent/bot.mjs', 'package-lock.json']) {
      await writeFile(join(root, '.gitattributes'), name + ' export-ignore\n');
      commit(root);
      assert.throws(() => loadSubmission('HEAD', root), /Archive omits/);
    }
    await rm(join(root, '.gitattributes'));
    await symlink('ingredient.txt', join(root, 'link'));
    commit(root);
    assert.throws(() => loadSubmission('HEAD', root), /symlinks/);
    await rm(join(root, 'link'));
    await writeFile(join(root, 'bad\nname'), 'x');
    commit(root);
    assert.throws(() => loadSubmission('HEAD', root), /Unsupported path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('different refs retain separate identities; protocol and interpreter mismatch fail before execution', async () => {
  const root = await repository();
  const sources: Awaited<ReturnType<typeof prepareSource>>[] = [];
  try {
    const first = commit(root);
    await writeFile(join(root, 'ingredient.txt'), 'mushroom');
    const second = commit(root);
    for (const ref of [first, second]) sources.push(await prepareSource({ root, ref }));
    assert.notEqual(sources[0].identity.sha, sources[1].identity.sha);
    assert.notEqual(sources[0].identity.archiveSha256, sources[1].identity.archiveSha256);
    await assert.rejects(prepareSource({ root, ref: first, bot: 'agent/bot.mjs' }), /not both/);
    await assert.rejects(prepareSource({ root, ref: '' }), /tag or commit SHA/);
    const manifest = JSON.parse(await readFile(join(root, 'dreamweaver.json'), 'utf8'));
    await writeFile(
      join(root, 'dreamweaver.json'),
      JSON.stringify({ ...manifest, protocol: 'dreamweaver.v4' }),
    );
    await assert.rejects(prepareSource({ root }), /Dream Relay/);
    await writeFile(join(root, 'dreamweaver.json'), JSON.stringify({ ...manifest, runtime: 'python312' }));
    await assert.rejects(prepareSource({ root, python: process.execPath }), /requires Python 3.12/);
    await writeFile(join(root, 'dreamweaver.json'), JSON.stringify({ ...manifest, entrypoint: '../escape' }));
    await assert.rejects(prepareSource({ root }), /inside the repository/);
  } finally {
    await Promise.all(sources.map((s) => s.dispose()));
    await rm(root, { recursive: true, force: true });
  }
});

let python = process.env.KITCHEN_PYTHON ?? 'python3.12';
let hasPython = false;
try {
  hasPython = /^Python 3\.12\./.test(
    execFileSync(python, ['--version'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }),
  );
} catch {}
test(
  'Python 3.12 runs unbuffered from the manifest root beside a Node chef',
  { skip: !hasPython, timeout: 16000 },
  async () => {
    const root = await repository('python312'),
      other = await repository();
    const sources: Awaited<ReturnType<typeof prepareSource>>[] = [];
    try {
      await writeFile(
        join(root, 'agent/bot.py'),
        `import sys,json\ningredient=open('ingredient.txt').read().strip()\nfor line in sys.stdin:\n m=json.loads(line)\n if m['type']=='prepare': print(json.dumps(dict(type='ready',version=1,nonce=m['nonce'])))\n if m['type']=='observation':\n  tick=m['observation']['tick']\n  print(json.dumps(dict(type='action',action=dict(seq=tick+1,observedTick=tick,task=ingredient,target=ingredient))))\n`,
      );
      sources.push(
        await prepareSource({ root, ref: commit(root), python }),
        await prepareSource({ root: other, ref: commit(other) }),
      );
      const result = await runPractice({
        out: join(root, 'run'),
        bots: [sources[0], sources[1]],
        seconds: 10,
      });
      assert.equal(result.status, 'completed', result.error);
      assert.ok(result.chefs.every((c) => c.calls > 85));
      assert.deepEqual(
        result.sources.map((s) => s.runtime),
        ['python312', 'node24'],
      );
    } finally {
      await Promise.all(sources.map((s) => s.dispose()));
      await rm(root, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  },
);

test('CLI cleans the first archive if teammate preparation fails', async () => {
  const root = await repository();
  const temporary = await mkdtemp(join(tmpdir(), 'kitchen-cleanup-test-'));
  try {
    commit(root);
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          new URL('../tools/practice.ts', import.meta.url).pathname,
          '--project',
          root,
          '--ref',
          'HEAD',
          '--teammate-project',
          join(root, 'missing'),
          '--out',
          join(root, 'never-started'),
        ],
        { env: { ...process.env, TMPDIR: temporary }, stdio: 'pipe' },
      ),
    );
    assert.deepEqual(await readdir(temporary), []);
    await assert.rejects(access(join(root, 'never-started')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
});
