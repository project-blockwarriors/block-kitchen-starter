import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
/** Inspect the exact committed artifact without executing any bot or build script. */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error('Invalid manifest');
  if (!['dreamweaver.v4', 'dream-kitchen.v1'].includes(manifest.protocol))
    throw Error('Use the current game protocol');
  if (!['node24', 'python312'].includes(manifest.runtime)) throw Error('Use node24 or python312');
  if (typeof manifest.name !== 'string' || !manifest.name.length || manifest.name.length > 60)
    throw Error('Provide a name of 1–60 characters');
  if (Object.keys(manifest).some((k) => !['protocol', 'runtime', 'entrypoint', 'name'].includes(k)))
    throw Error('Unknown manifest field');
  const entry = manifest.entrypoint;
  if (
    typeof entry !== 'string' ||
    !/^[a-zA-Z0-9_./-]{1,120}$/.test(entry) ||
    entry.startsWith('/') ||
    entry.split('/').includes('..')
  )
    throw Error('Entrypoint must stay inside the repository');
  return manifest;
}

export function loadSubmission(ref = 'HEAD', cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 22 * 1024 * 1024 });
  if (!/^[a-zA-Z0-9_./-]{1,160}$/.test(ref) || ref.startsWith('-'))
    throw Error('Use a pushed tag or commit SHA');
  if (git('rev-parse', '--show-prefix').trim()) throw Error('Run this check from the bot repository root.');
  const sha = git('rev-parse', '--verify', ref + '^{commit}').trim();
  const files = git('ls-tree', '-r', '-l', '-z', sha)
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t');
      const meta = row.slice(0, tab),
        path = row.slice(tab + 1);
      const [mode, type, object, size] = meta.trim().split(/\s+/);
      return { mode, type, object, size: Number(size), path };
    });
  if (files.length > 10000 || files.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024)
    throw Error('Snapshot exceeds 10,000 files or 40 MiB expanded');
  if (files.some((f) => !['100644', '100755'].includes(f.mode)))
    throw Error('Remove committed symlinks and submodules');
  if (files.some((f) => /(^|\/)\.env($|\.(?!example$))|\.(pem|key|p12)$/.test(f.path)))
    throw Error('Remove credential/environment files from the committed snapshot');
  if (
    files.some(
      (f) =>
        f.path.startsWith('/') ||
        /^[a-zA-Z]:/.test(f.path) ||
        /[\\\r\n\t]/.test(f.path) ||
        f.path.split('/').some((p) => ['', '.', '..', '.git'].includes(p)),
    )
  )
    throw Error('Unsupported path in committed snapshot');
  const read = (path) => {
    const f = files.find((f) => f.path === path);
    if (!f) throw Error('Missing committed ' + path);
    return git('show', sha + ':' + path);
  };
  const manifest = JSON.parse(read('dreamweaver.json'));
  validateManifest(manifest);
  const entry = manifest.entrypoint;
  read(entry);
  if (manifest.runtime === 'node24') {
    JSON.parse(read('package-lock.json'));
    const pkg = JSON.parse(read('package.json'));
    if (Object.keys(pkg.dependencies ?? {}).length)
      throw Error(
        'Runtime packages are not installed: prebundle them and remove runtime dependencies from package.json',
      );
  } else if (read('requirements.txt').trim())
    throw Error('Runtime packages are not installed: vendor supported code and leave requirements.txt empty');
  const archive = execFileSync('git', ['archive', '--format=tar.gz', sha], {
    cwd,
    maxBuffer: 21 * 1024 * 1024,
  });
  if (archive.length > 20 * 1024 * 1024) throw Error('Source archive exceeds 20 MiB');
  const names = new Set(
    execFileSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8', maxBuffer: 22 * 1024 * 1024 })
      .trim()
      .split('\n'),
  );
  for (const path of [
    'dreamweaver.json',
    entry,
    ...(manifest.runtime === 'node24' ? ['package.json', 'package-lock.json'] : ['requirements.txt']),
  ])
    if (!names.has(path)) throw Error('Archive omits ' + path + '; check export-ignore attributes');
  const dirty = git('status', '--porcelain').trim().length > 0;
  const receipt = {
    sha,
    manifest,
    files: files.length,
    expandedBytes: files.reduce((n, f) => n + f.size, 0),
    archiveBytes: archive.length,
    archiveSha256: createHash('sha256').update(archive).digest('hex'),
    uncommittedChanges: dirty,
  };
  return { receipt, archive };
}
export function inspectSubmission(ref = 'HEAD', cwd = process.cwd()) {
  return loadSubmission(ref, cwd).receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = inspectSubmission(process.argv[2]);
    console.log(JSON.stringify(r, null, 2));
    console.log(
      r.uncommittedChanges
        ? 'Uncommitted changes are NOT included. Commit, check again, then push.'
        : 'This committed snapshot passed packaging checks. Push it before importing.',
    );
    console.log('Import this exact SHA: ' + r.sha);
    console.log(
      'Next: practice this SHA locally, push it, then import it in My team. Choose Block Kitchen when hosted practice is open. Kitchen is a closed preview. This check does not run the bot or verify hosted compatibility.',
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
