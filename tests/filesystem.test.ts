import { describe, it, expect } from 'vitest';
import { MemoryFileSystemAdapter } from '../src/filesystem/memory-filesystem';
import { NativeFileSystemAdapter } from '../src/filesystem/native-filesystem';
import {
  path,
  resolveAsset,
  relative,
  copyEntry,
  uniquePath,
  safeMove,
} from '../src/filesystem/adapter';
import { exportZip, importZip } from '../src/filesystem/archive';
describe('portable files', () => {
  it('persists exact Markdown and safely moves nested binary files', async () => {
    const fs = new MemoryFileSystemAdapter();
    await fs.createDirectory('paper');
    const text = '# Research\n\n$E=mc^2$\n\n[@key]\n';
    await fs.createFile('paper/note.md', text);
    await fs.createDirectory('paper/assets');
    await fs.createFile('paper/assets/image.png', new Blob([new Uint8Array([0, 255, 128, 1])]));
    await fs.move('paper', 'renamed');
    expect(await fs.readText('renamed/note.md')).toBe(text);
    expect(
      Array.from(
        new Uint8Array(await (await fs.readBlob('renamed/assets/image.png')).arrayBuffer()),
      ),
    ).toEqual([0, 255, 128, 1]);
    expect(await fs.exists('paper')).toBe(false);
    await fs.delete('renamed');
    expect(await fs.listDirectory('')).toEqual([]);
  });
  it('rejects collisions and descendant moves without destroying originals', async () => {
    const fs = new MemoryFileSystemAdapter();
    await fs.createDirectory('a');
    await fs.createFile('a/n.md', 'original');
    await fs.createFile('b.md', 'other');
    await expect(copyEntry(fs, 'a/n.md', 'b.md')).rejects.toThrow('already exists');
    await expect(fs.move('a', 'a/nested')).rejects.toThrow('inside itself');
    expect(await fs.readText('a/n.md')).toBe('original');
    expect(await uniquePath(fs, 'b.md')).toBe('b 2.md');
  });
  it('retains the original if copying fails', async () => {
    const fs = new MemoryFileSystemAdapter();
    await fs.createFile('a.md', 'safe');
    fs.createFile = async () => {
      throw new Error('quota');
    };
    await expect(fs.move('a.md', 'b.md')).rejects.toThrow('quota');
    expect(await fs.readText('a.md')).toBe('safe');
  });
  it('reports both copies if source removal fails', async () => {
    const fs = new MemoryFileSystemAdapter();
    await fs.createFile('a.md', 'safe');
    fs.delete = async () => {
      throw new Error('permission');
    };
    await expect(safeMove(fs, 'a.md', 'b.md')).rejects.toThrow('Both copies');
    expect(await fs.readText('a.md')).toBe('safe');
    expect(await fs.readText('b.md')).toBe('safe');
  });
  it('validates paths and resolves nested document-relative assets', () => {
    for (const p of ['../secret', 'a/../../secret', '/etc', 'a\\b', 'https:foo', 'a\0b'])
      expect(() => path(p)).toThrow();
    expect(resolveAsset('papers/note.md', '../assets/result.png')).toBe('assets/result.png');
    expect(() => resolveAsset('papers/note.md', '../../secret')).toThrow();
    expect(() => resolveAsset('n.md', 'https://example.com/a.png')).toThrow();
    expect(relative('papers/note.md', 'assets/result.png')).toBe('../assets/result.png');
  });
  it('backs up and imports empty directories and binary assets without overwriting', async () => {
    const original = new MemoryFileSystemAdapter();
    await original.createDirectory('figures');
    await original.createDirectory('empty');
    await original.createFile('note.md', '![Figure](figures/a.png)');
    await original.createFile('figures/a.png', new Blob([new Uint8Array([1, 0, 250])]));
    const destination = new MemoryFileSystemAdapter();
    await destination.createFile('note.md', 'existing');
    const root = await importZip(destination, await exportZip(original));
    expect(await destination.readText('note.md')).toBe('existing');
    expect(await destination.readText(`${root}/note.md`)).toBe('![Figure](figures/a.png)');
    expect(await destination.exists(`${root}/empty`)).toBe(true);
    expect((await destination.readBlob(`${root}/figures/a.png`)).size).toBe(3);
  });
  it('rejects ZIP traversal before importing anything', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const fs = new MemoryFileSystemAdapter();
    await expect(
      importZip(
        fs,
        new Blob([zipSync({ '../evil.md': strToU8('bad') }) as Uint8Array<ArrayBuffer>]),
      ),
    ).rejects.toThrow('traversal');
    expect(fs.files.size).toBe(0);
  });
  it('native writes use existing handles and propagate denied access', async () => {
    const root = {
      getFileHandle: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    } as unknown as FileSystemDirectoryHandle;
    const fs = new NativeFileSystemAdapter(root);
    await expect(fs.writeFile('note.md', 'data')).rejects.toThrow('denied');
  });
});
it('retains concurrent external source changes during a move', async () => {
  const fs = new MemoryFileSystemAdapter();
  await fs.createFile('a.md', 'baseline');
  const create = fs.createFile.bind(fs);
  fs.createFile = async (value, data) => {
    await create(value, data);
    if (value === 'b.md') await fs.writeFile('a.md', 'changed externally');
  };
  await expect(fs.move('a.md', 'b.md')).rejects.toThrow('Both copies retained');
  expect(await fs.readText('a.md')).toBe('changed externally');
  expect(await fs.readText('b.md')).toBe('baseline');
});
it('checks persisted permissions and only prompts on explicit access requests', async () => {
  let state: PermissionState = 'prompt';
  let requested = 0;
  const handle = {
    queryPermission: async () => state,
    requestPermission: async () => {
      requested++;
      return 'granted';
    },
  } as unknown as FileSystemDirectoryHandle;
  const fs = new NativeFileSystemAdapter(handle);
  expect(await fs.permission()).toBe('prompt');
  expect(requested).toBe(0);
  expect(await fs.permission(true)).toBe('granted');
  expect(requested).toBe(1);
  state = 'denied';
  expect(await fs.permission()).toBe('denied');
  state = 'granted';
  expect(await fs.permission(true)).toBe('granted');
  expect(requested).toBe(1);
});
it('includes hidden directory contents in complete workspace backups', async () => {
  const source = new MemoryFileSystemAdapter();
  await source.createDirectory('.private');
  await source.createFile('.private/note.md', 'hidden content');
  const destination = new MemoryFileSystemAdapter();
  const root = await importZip(destination, await exportZip(source));
  expect(await destination.readText(`${root}/.private/note.md`)).toBe('hidden content');
});
it('recognizes filesystem-native case-insensitive collisions before creating a file', async () => {
  const root = {
    getFileHandle: async (name: string) => {
      if (name.toLowerCase() === 'existing.md') return {};
      throw new DOMException('Missing', 'NotFoundError');
    },
    getDirectoryHandle: async () => {
      throw new DOMException('Missing', 'NotFoundError');
    },
  } as unknown as FileSystemDirectoryHandle;
  const fs = new NativeFileSystemAdapter(root);
  expect(await fs.exists('EXISTING.md')).toBe(true);
  await expect(fs.createFile('EXISTING.md', 'overwrite')).rejects.toThrow('already exists');
  expect(await fs.exists('new.md')).toBe(false);
});
