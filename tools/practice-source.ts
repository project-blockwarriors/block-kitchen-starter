import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { loadSubmission, validateManifest, type SubmissionReceipt } from './submission.mjs';

export type SourceInput = { root?: string; ref?: string; bot?: string; python?: string };

/** Resolve the same root/runtime/entrypoint as a submission. Executes no bot code. */
export async function prepareSource({
  root = process.cwd(),
  ref,
  bot,
  python = process.env.KITCHEN_PYTHON ?? 'python3.12',
}: SourceInput = {}) {
  if (ref && bot) throw Error('Use --ref for a committed submission or --bot for a loose file, not both.');
  let temporary: string | undefined;
  const dispose = async () => {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  };
  try {
    root = await realpath(root);
    let receipt: SubmissionReceipt | undefined;
    if (ref) {
      const loaded = loadSubmission(ref, root);
      receipt = loaded.receipt;
      temporary = await mkdtemp(join(tmpdir(), 'block-kitchen-source-'));
      const archive = join(temporary, 'source.tar.gz');
      await writeFile(archive, loaded.archive, { mode: 0o600 });
      root = join(temporary, 'source');
      await mkdir(root);
      execFileSync('tar', ['-xzf', archive, '-C', root], { stdio: 'pipe' });
      root = await realpath(root);
    }
    const manifest = bot
      ? {
          protocol: 'dream-kitchen.v1',
          runtime: 'node24',
          entrypoint: resolve(root, bot),
          name: 'Loose Node file',
        }
      : validateManifest(JSON.parse(await readFile(join(root, 'dreamweaver.json'), 'utf8')));
    if (manifest.protocol !== 'dream-kitchen.v1')
      throw Error('This is a Dream Relay submission. Use the Relay practice tools.');
    if (receipt && JSON.stringify(manifest) !== JSON.stringify(receipt.manifest))
      throw Error('Archived manifest differs from the checked commit; check export attributes.');
    const entry = resolve(root, manifest.entrypoint);
    if (!(await lstat(entry)).isFile()) throw Error('Entrypoint must be a regular file.');
    const actual = await realpath(entry);
    const path = relative(root, actual);
    if (!bot && (path.split(/[\\/]/)[0] === '..' || isAbsolute(path)))
      throw Error('Entrypoint must stay inside the submission.');
    let command = process.execPath;
    if (manifest.runtime === 'python312') {
      command = python;
      let version;
      try {
        version = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
      } catch {
        throw Error('Install Python 3.12 or set KITCHEN_PYTHON to its executable.');
      }
      if (!/^Python 3\.12\./.test(version))
        throw Error('This submission requires Python 3.12. Set KITCHEN_PYTHON to that interpreter.');
    } else if (Number(process.versions.node.split('.')[0]) !== 24)
      throw Error('Use Node 24 for this submission.');
    return {
      entry: actual,
      root: bot ? dirname(actual) : root,
      command,
      args: manifest.runtime === 'python312' ? ['-u'] : [],
      identity: {
        kind: ref ? 'git-archive' : bot ? 'loose-file' : 'working-tree',
        name: manifest.name,
        runtime: manifest.runtime,
        entrypoint: bot ? actual.split(/[\\/]/).at(-1) : manifest.entrypoint,
        ...(receipt
          ? {
              sha: receipt.sha,
              archiveSha256: receipt.archiveSha256,
              uncommittedChanges: receipt.uncommittedChanges,
            }
          : {}),
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
