import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { BrowserFileSystemAdapter } from '../src/filesystem/browser-filesystem';
import {
  remember,
  recentWorkspaces,
  putRecovery,
  getRecovery,
  clearRecovery,
} from '../src/storage/indexed-db';
it('browser fallback persists hierarchy, exact text, and binary data across adapters', async () => {
  const first = new BrowserFileSystemAdapter('test');
  await first.createDirectory('papers');
  await first.createFile('papers/a.md', '# Exact\n');
  await first.createFile('papers/a.png', new Blob([new Uint8Array([0, 255])]));
  const reopened = new BrowserFileSystemAdapter('test');
  expect(await reopened.readText('papers/a.md')).toBe('# Exact\n');
  expect((await reopened.readBlob('papers/a.png')).size).toBe(2);
  await expect(reopened.createFile('papers/a.md')).rejects.toThrow();
  await reopened.move('papers/a.md', 'papers/b.md');
  expect(await first.exists('papers/a.md')).toBe(false);
});
it('persists recent workspace identity and temporary recovery independently from files', async () => {
  await remember({
    id: 'identity',
    name: 'Research',
    kind: 'browser',
    lastOpened: 1,
    tabs: ['paper.md'],
  });
  expect((await recentWorkspaces()).some((w) => w.id === 'identity')).toBe(true);
  await putRecovery({
    workspace: 'identity',
    path: 'paper.md',
    content: 'draft',
    baseline: 'disk',
    updated: 1,
  });
  expect((await getRecovery('identity', 'paper.md'))?.content).toBe('draft');
  await clearRecovery('identity', 'paper.md');
  expect(await getRecovery('identity', 'paper.md')).toBeUndefined();
});
