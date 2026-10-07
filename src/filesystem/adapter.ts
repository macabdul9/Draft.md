export type Entry = { path: string; name: string; kind: 'file' | 'directory' };
export type FileMetadata = { size: number; lastModified: number };
export interface WorkspaceFileSystem {
  readonly kind: 'local' | 'browser' | 'memory';
  listDirectory(path: string): Promise<Entry[]>;
  readText(path: string): Promise<string>;
  readBlob(path: string): Promise<Blob>;
  stat(path: string): Promise<FileMetadata>;
  writeFile(path: string, data: string | Blob): Promise<void>;
  createFile(path: string, data?: string | Blob): Promise<void>;
  createDirectory(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  move(from: string, to: string): Promise<void>;
}
export class FileSystemError extends Error {
  constructor(
    public code: 'INVALID_PATH' | 'COLLISION' | 'PARTIAL_MOVE' | 'NOT_FOUND' | 'PERMISSION',
    message: string,
  ) {
    super(message);
    this.name = 'FileSystemError';
  }
}
/** Paths are relative to the granted root. Never normalize an operation out of it. */
export function path(value: string): string {
  if (value.startsWith('/') || /[\\\0]/.test(value) || /^[a-z]+:/i.test(value))
    throw new FileSystemError('INVALID_PATH', 'Use a workspace-relative path.');
  const parts = value.split('/').filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..'))
    throw new FileSystemError('INVALID_PATH', 'Path traversal is not allowed.');
  return parts.join('/');
}
export const parent = (value: string) => value.split('/').slice(0, -1).join('/');
export const basename = (value: string) => value.split('/').at(-1) ?? '';
export const join = (...parts: string[]) => path(parts.filter(Boolean).join('/'));
export function resolveAsset(documentPath: string, reference: string): string {
  const decoded = decodeURIComponent(reference.split('#')[0]);
  if (/^[a-z]+:|^\/|[\\\0]/i.test(decoded))
    throw new FileSystemError('INVALID_PATH', 'Only workspace assets are allowed.');
  const parts = parent(documentPath).split('/').filter(Boolean);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length)
        throw new FileSystemError('INVALID_PATH', 'Asset is outside the workspace.');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return path(parts.join('/'));
}
export function relative(from: string, to: string): string {
  const a = parent(from).split('/').filter(Boolean),
    b = path(to).split('/');
  while (a.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => '..'), ...b].join('/');
}
export async function uniquePath(fs: WorkspaceFileSystem, requested: string): Promise<string> {
  const clean = path(requested),
    dot = basename(clean).lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, clean.length - basename(clean).length + dot) : clean;
  const extension = dot > 0 ? basename(clean).slice(dot) : '';
  let candidate = clean,
    n = 2;
  while (await fs.exists(candidate)) candidate = `${stem} ${n++}${extension}`;
  return candidate;
}
export async function walk(
  fs: WorkspaceFileSystem,
  folder = '',
  signal?: AbortSignal,
): Promise<Entry[]> {
  const result: Entry[] = [];
  for (const entry of await fs.listDirectory(folder)) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    result.push(entry);
    if (entry.kind === 'directory') result.push(...(await walk(fs, entry.path, signal)));
  }
  return result;
}
/** Copy first, verify byte-for-byte, remove only after all destinations verify. */
export async function copyEntry(fs: WorkspaceFileSystem, from: string, to: string): Promise<void> {
  from = path(from);
  to = path(to);
  if (!from || !to || to === from || to.startsWith(`${from}/`))
    throw new FileSystemError('INVALID_PATH', 'A folder cannot be placed inside itself.');
  if (await fs.exists(to)) throw new FileSystemError('COLLISION', `“${to}” already exists.`);
  const entry = (await fs.listDirectory(parent(from))).find((e) => e.path === from);
  if (!entry) throw new FileSystemError('NOT_FOUND', `“${from}” was not found.`);
  if (entry.kind === 'directory') {
    await fs.createDirectory(to);
    for (const child of await fs.listDirectory(from))
      await copyEntry(fs, child.path, join(to, child.name));
  } else {
    const original = await fs.readBlob(from);
    await fs.createFile(to, original);
    const copied = await fs.readBlob(to);
    const [a, b] = await Promise.all([original.arrayBuffer(), copied.arrayBuffer()]);
    if (
      a.byteLength !== b.byteLength ||
      new Uint8Array(a).some((v, i) => v !== new Uint8Array(b)[i])
    )
      throw new Error(`Copy verification failed for ${to}. Original retained.`);
  }
}
export async function safeMove(fs: WorkspaceFileSystem, from: string, to: string): Promise<void> {
  await copyEntry(fs, from, to);
  // Recheck the source against the verified destination before removing it.
  async function verify(original: string, copy: string): Promise<void> {
    const children = await fs.listDirectory(parent(original));
    const entry = children.find((e) => e.path === original);
    if (!entry) throw new Error('Source disappeared during the move.');
    if (entry.kind === 'directory') {
      const [a, b] = await Promise.all([fs.listDirectory(original), fs.listDirectory(copy)]);
      if (
        a.length !== b.length ||
        a.some((e) => !b.some((other) => e.name === other.name && e.kind === other.kind))
      )
        throw new Error('Source directory changed during the move.');
      for (const child of a) await verify(child.path, join(copy, child.name));
    } else {
      const [a, b] = await Promise.all([
        (await fs.readBlob(original)).arrayBuffer(),
        (await fs.readBlob(copy)).arrayBuffer(),
      ]);
      if (
        a.byteLength !== b.byteLength ||
        new Uint8Array(a).some((value, index) => value !== new Uint8Array(b)[index])
      )
        throw new Error('Source content changed during the move.');
    }
  }
  try {
    await verify(from, to);
  } catch (error) {
    throw new FileSystemError(
      'PARTIAL_MOVE',
      String(error) + ' Both copies retained; the original was not deleted.',
    );
  }
  try {
    await fs.delete(from);
  } catch {
    throw new FileSystemError(
      'PARTIAL_MOVE',
      `Copy at “${to}” verified, but “${from}” could not be removed. Both copies have been retained.`,
    );
  }
}
export const isText = (name: string) =>
  /\.(md|markdown|txt|bib|tex|csv|json|ya?ml|py|sh|js|ts|rs|r|jl|sql|cpp|h|log)$/i.test(name);
