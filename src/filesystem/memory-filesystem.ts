import {
  basename,
  parent,
  path,
  safeMove,
  FileSystemError,
  type Entry,
  type WorkspaceFileSystem,
} from './adapter';
export class MemoryFileSystemAdapter implements WorkspaceFileSystem {
  readonly kind = 'memory' as const;
  files = new Map<string, { data: Blob | null; modified: number }>();
  async listDirectory(value: string): Promise<Entry[]> {
    value = path(value);
    return [...this.files]
      .filter(([p]) => parent(p) === value)
      .map(([p, r]) => ({ path: p, name: basename(p), kind: r.data ? 'file' : 'directory' }));
  }
  async readBlob(value: string) {
    const r = this.files.get(path(value));
    if (!r?.data) throw new FileSystemError('NOT_FOUND', 'Missing file.');
    return r.data;
  }
  async readText(value: string) {
    return (await this.readBlob(value)).text();
  }
  async stat(value: string) {
    const r = this.files.get(path(value));
    if (!r) throw new Error('Missing');
    return { size: r.data?.size ?? 0, lastModified: r.modified };
  }
  async writeFile(value: string, data: string | Blob) {
    await this.readBlob(value);
    this.files.set(path(value), {
      data: typeof data === 'string' ? new Blob([data]) : data,
      modified: Date.now(),
    });
  }
  async createFile(value: string, data: string | Blob = '') {
    if (await this.exists(value)) throw new FileSystemError('COLLISION', 'Exists');
    this.files.set(path(value), { data: new Blob(), modified: Date.now() });
    await this.writeFile(value, data);
  }
  async createDirectory(value: string) {
    if (await this.exists(value)) throw new FileSystemError('COLLISION', 'Exists');
    this.files.set(path(value), { data: null, modified: Date.now() });
  }
  async exists(value: string) {
    return !path(value) || this.files.has(path(value));
  }
  async delete(value: string) {
    value = path(value);
    if (!value) throw new FileSystemError('INVALID_PATH', 'Root');
    for (const p of this.files.keys())
      if (p === value || p.startsWith(`${value}/`)) this.files.delete(p);
  }
  async move(from: string, to: string) {
    await safeMove(this, from, to);
  }
}
