import { database } from '../storage/indexed-db';
import {
  basename,
  parent,
  path,
  FileSystemError,
  safeMove,
  type Entry,
  type WorkspaceFileSystem,
} from './adapter';
interface StoredFile {
  workspace: string;
  path: string;
  kind: 'file' | 'directory';
  blob?: Blob;
  modified: number;
}
/** IndexedDB fallback where OPFS is unavailable. Binary bytes are stored as Blobs. */
export class BrowserFileSystemAdapter implements WorkspaceFileSystem {
  readonly kind = 'browser' as const;
  constructor(private workspace: string) {}
  private async records(): Promise<StoredFile[]> {
    return (await (await database()).getAll('files')).filter((r) => r.workspace === this.workspace);
  }
  private async get(value: string): Promise<StoredFile> {
    const record: StoredFile | undefined = await (
      await database()
    ).get('files', [this.workspace, path(value)]);
    if (!record) throw new FileSystemError('NOT_FOUND', `“${value}” was not found.`);
    return record;
  }
  async listDirectory(value: string): Promise<Entry[]> {
    value = path(value);
    return (await this.records())
      .filter((r) => parent(r.path) === value)
      .map((r) => ({ path: r.path, name: basename(r.path), kind: r.kind }));
  }
  async readBlob(value: string) {
    const r = await this.get(value);
    if (!r.blob) throw new Error('Not a file.');
    return r.blob;
  }
  async readText(value: string) {
    return (await this.readBlob(value)).text();
  }
  async stat(value: string) {
    const r = await this.get(value);
    return { size: r.blob?.size ?? 0, lastModified: r.modified };
  }
  async writeFile(value: string, data: string | Blob) {
    const r = await this.get(value);
    if (r.kind !== 'file') throw new Error('Not a file.');
    await (
      await database()
    ).put('files', {
      ...r,
      blob: typeof data === 'string' ? new Blob([data]) : data,
      modified: Date.now(),
    });
  }
  private async create(value: string, kind: StoredFile['kind'], data?: string | Blob) {
    value = path(value);
    if (!value || (await this.exists(value)))
      throw new FileSystemError('COLLISION', 'That name already exists.');
    if (parent(value) && !(await this.exists(parent(value))))
      throw new FileSystemError('NOT_FOUND', 'Parent directory does not exist.');
    await (
      await database()
    ).add('files', {
      workspace: this.workspace,
      path: value,
      kind,
      modified: Date.now(),
      ...(kind === 'file'
        ? { blob: typeof data === 'string' ? new Blob([data]) : (data ?? new Blob()) }
        : {}),
    });
  }
  async createFile(value: string, data: string | Blob = '') {
    await this.create(value, 'file', data);
  }
  async createDirectory(value: string) {
    await this.create(value, 'directory');
  }
  async exists(value: string) {
    if (!path(value)) return true;
    return Boolean(await (await database()).get('files', [this.workspace, path(value)]));
  }
  async delete(value: string) {
    value = path(value);
    if (!value) throw new FileSystemError('INVALID_PATH', 'Cannot delete the root.');
    for (const r of await this.records())
      if (r.path === value || r.path.startsWith(`${value}/`))
        await (await database()).delete('files', [this.workspace, r.path]);
  }
  async move(from: string, to: string) {
    await safeMove(this, from, to);
  }
}
export async function browserAdapter(id: string): Promise<WorkspaceFileSystem> {
  if ('getDirectory' in navigator.storage) {
    const { OPFSFileSystemAdapter } = await import('./native-filesystem');
    return OPFSFileSystemAdapter.open(id);
  }
  return new BrowserFileSystemAdapter(id);
}
