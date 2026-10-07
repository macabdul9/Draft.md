import { path, parent, type WorkspaceFileSystem } from './adapter';
import { ensureDirectory } from './archive';

export interface RepositorySource {
  owner: string;
  repo: string;
}
export interface RepositorySnapshot {
  source: RepositorySource;
  commit: string;
  files: { path: string; bytes: Uint8Array<ArrayBuffer> }[];
  directories: string[];
  skipped: number;
}
export interface RepositoryProgress {
  stage: string;
  completed: number;
  total: number;
}
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export function parseRepository(value: string): RepositorySource {
  let input = value.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(input)) input = `https://github.com/${input}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a public GitHub repository URL or owner/repository.');
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2
  )
    throw new Error('Use https://github.com/owner/repository. Enter the branch separately.');
  const [owner, rawRepo] = parts;
  const repo = rawRepo.replace(/\.git$/, '');
  if (![owner, repo].every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'))
    throw new Error('The GitHub owner or repository name is invalid.');
  return { owner, repo };
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Repository download exceeds the size limit.');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Repository download exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function downloadRepository(
  source: RepositorySource,
  reference: string,
  signal: AbortSignal,
  progress: (value: RepositoryProgress) => void,
): Promise<RepositorySnapshot> {
  const cancellation = new AbortController();
  signal = AbortSignal.any([signal, cancellation.signal, AbortSignal.timeout(600000)]);
  signal.throwIfAborted();
  const prefix = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  const api = async (suffix: string) => {
    const response = await fetch(prefix + suffix, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429)
        throw new Error(
          'GitHub denied the request or its API rate limit was reached. Try again later.',
        );
      if (response.status === 404)
        throw new Error(
          'Repository or branch not found. Only public GitHub repositories are supported.',
        );
      if (response.status === 409)
        throw new Error('This repository is empty or has no usable commit.');
      throw new Error(`GitHub request failed (${response.status}). Try again later.`);
    }
    return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 10 * 1024 * 1024)));
  };
  progress({ stage: 'Reading repository', completed: 0, total: 0 });
  let ref = reference.trim();
  if (!ref) ref = (await api('')).default_branch;
  if (!ref || /[\0\r\n]/.test(ref)) throw new Error('Enter a valid branch, tag, or commit.');
  const resolved = await api(`/commits/${encodeURIComponent(ref)}`);
  const commit = resolved.sha;
  const treeSha = resolved.commit?.tree?.sha;
  if (!/^[a-f0-9]{40,64}$/.test(commit) || !/^[a-f0-9]{40,64}$/.test(treeSha))
    throw new Error('GitHub returned an invalid commit.');
  const result = await api(`/git/trees/${treeSha}?recursive=1`);
  if (result.truncated || !Array.isArray(result.tree))
    throw new Error('This repository is too large to import completely. Download a ZIP instead.');
  const directories: string[] = [];
  const entries: { path: string; size: number }[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of result.tree) {
    const clean = path(entry.path);
    if (!clean || clean !== entry.path || seen.has(clean) || clean.split('/').includes('.git'))
      throw new Error('The repository contains an unsafe or duplicate path.');
    seen.add(clean);
    if (entry.type === 'tree') directories.push(clean);
    else if (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)) {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES)
        throw new Error('A repository file exceeds the 25 MB file limit.');
      entries.push({ path: clean, size: entry.size });
    } else skipped++;
  }
  if (
    seen.size > 10000 ||
    entries.length > MAX_FILES ||
    entries.reduce((n, e) => n + e.size, 0) > MAX_TOTAL_BYTES
  )
    throw new Error('Repository import is limited to 5,000 files and 100 MB in total.');
  const files: RepositorySnapshot['files'] = [];
  let index = 0;
  let totalBytes = 0;
  const workers = Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (index < entries.length) {
      signal.throwIfAborted();
      const entry = entries[index++];
      const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(
        `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${commit}/${encodedPath}`,
        {
          signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!response.ok)
        throw new Error(
          `Could not download “${entry.path}” (${response.status}). No workspace files were written.`,
        );
      const bytes = await boundedBytes(response, MAX_FILE_BYTES);
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error('Repository exceeds the 100 MB download limit.');
      // Raw GitHub must return the Git blob itself, including LFS pointer files.
      if (bytes.length !== entry.size)
        throw new Error(
          `Unexpected file size for “${entry.path}”. Import stopped before writing files.`,
        );
      files.push({ path: entry.path, bytes });
      progress({ stage: 'Downloading files', completed: files.length, total: entries.length });
    }
  });
  const settled = await Promise.allSettled(
    workers.map((worker) =>
      worker.catch((error) => {
        cancellation.abort(error);
        throw error;
      }),
    ),
  );
  const failure = settled.find((item) => item.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  signal.throwIfAborted();
  return { source, commit, files, directories, skipped };
}

export async function writeRepository(
  fs: WorkspaceFileSystem,
  snapshot: RepositorySnapshot,
  signal: AbortSignal,
  progress: (value: RepositoryProgress) => void,
) {
  for (const directory of snapshot.directories) {
    signal.throwIfAborted();
    await ensureDirectory(fs, directory);
  }
  let completed = 0;
  for (const file of snapshot.files) {
    signal.throwIfAborted();
    await ensureDirectory(fs, parent(file.path));
    await fs.createFile(file.path, new Blob([file.bytes]));
    progress({ stage: 'Saving workspace', completed: ++completed, total: snapshot.files.length });
  }
}
