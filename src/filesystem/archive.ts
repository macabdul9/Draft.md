import { path, parent, join, uniquePath, walk, type WorkspaceFileSystem } from './adapter';
export async function ensureDirectory(fs: WorkspaceFileSystem, value: string) {
  let current = '';
  for (const part of path(value).split('/').filter(Boolean)) {
    current = join(current, part);
    if (!(await fs.exists(current))) await fs.createDirectory(current);
  }
}
export async function exportZip(fs: WorkspaceFileSystem): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const entry of await walk(fs))
    files[entry.kind === 'directory' ? `${entry.path}/` : entry.path] =
      entry.kind === 'file'
        ? new Uint8Array(await (await fs.readBlob(entry.path)).arrayBuffer())
        : new Uint8Array();
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
export async function importZip(fs: WorkspaceFileSystem, archive: Blob) {
  const { unzipSync } = await import('fflate');
  if (archive.size > 100 * 1024 * 1024) throw new Error('ZIP exceeds the 100 MB import limit.');
  let expandedSize = 0;
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()), {
    filter(file) {
      path(file.name);
      expandedSize += file.originalSize;
      if (expandedSize > 250 * 1024 * 1024)
        throw new Error('Expanded ZIP exceeds the 250 MB import limit.');
      return true;
    },
  });
  // Validate all paths and total decompressed size before mutating the workspace.
  const validated = Object.entries(entries).map(([name, bytes]) => ({
    name: path(name),
    directory: name.endsWith('/'),
    bytes,
  }));
  if (validated.reduce((n, e) => n + e.bytes.length, 0) > 250 * 1024 * 1024)
    throw new Error('Expanded ZIP exceeds the 250 MB import limit.');
  // An isolated import root preserves all internal references and avoids overwriting existing files.
  const root = await uniquePath(fs, 'Imported');
  await fs.createDirectory(root);
  for (const e of validated) {
    if (!e.name) continue;
    const target = join(root, e.name);
    await ensureDirectory(fs, e.directory ? target : parent(target));
    if (!e.directory) await fs.createFile(target, new Blob([e.bytes as Uint8Array<ArrayBuffer>]));
  }
  return root;
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
