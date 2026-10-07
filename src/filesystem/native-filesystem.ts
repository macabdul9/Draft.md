import {
  basename,
  parent,
  path,
  safeMove,
  type Entry,
  type WorkspaceFileSystem,
  FileSystemError,
} from './adapter';
export class NativeFileSystemAdapter implements WorkspaceFileSystem {
  readonly kind: 'local' | 'browser' = 'local';
  constructor(readonly root: FileSystemDirectoryHandle) {}
  async permission(request = false): Promise<PermissionState> {
    const options = { mode: 'readwrite' } as const;
    const state = await this.root.queryPermission(options);
    return state === 'prompt' && request ? this.root.requestPermission(options) : state;
  }
  private async directory(value: string, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.root;
    for (const segment of path(value).split('/').filter(Boolean))
      handle = await handle.getDirectoryHandle(segment, { create });
    return handle;
  }
  private async file(value: string, create = false) {
    value = path(value);
    return (await this.directory(parent(value))).getFileHandle(basename(value), { create });
  }
  async listDirectory(value: string): Promise<Entry[]> {
    const result: Entry[] = [];
    for await (const [name, handle] of (await this.directory(value)).entries())
      result.push({ name, kind: handle.kind, path: path([value, name].filter(Boolean).join('/')) });
    return result;
  }
  async readBlob(value: string) {
    return (await this.file(value)).getFile();
  }
  async readText(value: string) {
    return (await this.readBlob(value)).text();
  }
  async stat(value: string) {
    const file = await this.readBlob(value);
    return { size: file.size, lastModified: file.lastModified };
  }
  async writeFile(value: string, data: string | Blob) {
    // Existing-file writes never recreate an externally deleted file silently.
    const writable = await (await this.file(value)).createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }
  async createFile(value: string, data: string | Blob = '') {
    if (await this.exists(value))
      throw new FileSystemError('COLLISION', `“${value}” already exists.`);
    await this.file(value, true);
    await this.writeFile(value, data);
  }
  async createDirectory(value: string) {
    if (await this.exists(value))
      throw new FileSystemError('COLLISION', `“${value}” already exists.`);
    await this.directory(value, true);
  }
  async delete(value: string) {
    value = path(value);
    if (!value) throw new FileSystemError('INVALID_PATH', 'The workspace root cannot be deleted.');
    await (await this.directory(parent(value))).removeEntry(basename(value), { recursive: true });
  }
  async exists(value: string) {
    try {
      if (!path(value)) return true;
      const folder = await this.directory(parent(value));
      try {
        await folder.getFileHandle(basename(value));
        return true;
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          !['NotFoundError', 'TypeMismatchError'].includes(error.name)
        )
          throw error;
      }
      try {
        await folder.getDirectoryHandle(basename(value));
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return false;
        throw error;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false;
      throw error;
    }
  }
  async move(from: string, to: string) {
    await safeMove(this, from, to);
  }
}
export class OPFSFileSystemAdapter extends NativeFileSystemAdapter {
  override readonly kind = 'browser' as const;
  override async permission() {
    return 'granted' as const;
  }
  static async open(id: string) {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(`draft-${id}`, { create: true });
    return new OPFSFileSystemAdapter(directory);
  }
}
export const supportsLocalFolders = () => window.isSecureContext && 'showDirectoryPicker' in window;
