import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadRepository, parseRepository, writeRepository } from '../src/filesystem/repository';
import { MemoryFileSystemAdapter } from '../src/filesystem/memory-filesystem';

const commit = 'b'.repeat(40);
const treeSha = 'a'.repeat(40);
const source = { owner: 'research', repo: 'notes' };
const entries = [
  { path: 'README.md', type: 'blob', mode: '100644', size: 8 },
  { path: 'papers', type: 'tree', mode: '040000' },
  { path: 'papers/image.png', type: 'blob', mode: '100644', size: 3 },
  { path: 'link', type: 'blob', mode: '120000', size: 8 },
  { path: 'module', type: 'commit', mode: '160000' },
];
function mockGitHub(tree = entries, truncated = false) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('raw.githubusercontent.com'))
      return new Response(url.endsWith('.png') ? new Uint8Array([0, 255, 128]) : '# Notes\n');
    if (url.includes('/git/trees/')) return Response.json({ tree, truncated });
    if (url.includes('/commits/'))
      return Response.json({ sha: commit, commit: { tree: { sha: treeSha } } });
    return Response.json({ default_branch: 'main' });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe('public repository import', () => {
  it('accepts GitHub URLs, .git suffixes, and owner/repo shorthand', () => {
    for (const value of [
      'research/notes',
      'https://github.com/research/notes/',
      'https://github.com/research/notes.git',
    ])
      expect(parseRepository(value)).toEqual(source);
    for (const value of [
      'http://github.com/a/b',
      'https://gitlab.com/a/b',
      'https://github.com/a/b/tree/main',
      'https://secret@github.com/a/b',
      'https://github.com/a/b?token=secret',
      '../notes',
      'https://github.com/a/..',
      'https://github.com/a/b#main',
    ])
      expect(() => parseRepository(value)).toThrow();
  });
  it('pins downloads to one commit and preserves nested binary bytes', async () => {
    const fetcher = mockGitHub();
    const progress = vi.fn();
    const snapshot = await downloadRepository(source, '', new AbortController().signal, progress);
    expect(snapshot.commit).toBe(commit);
    expect(snapshot.skipped).toBe(2);
    const fs = new MemoryFileSystemAdapter();
    await writeRepository(fs, snapshot, new AbortController().signal, progress);
    expect(await fs.readText('README.md')).toBe('# Notes\n');
    expect(
      Array.from(new Uint8Array(await (await fs.readBlob('papers/image.png')).arrayBuffer())),
    ).toEqual([0, 255, 128]);
    expect(await fs.exists('link')).toBe(false);
    const rawCalls = fetcher.mock.calls.filter(([url]) =>
      String(url).includes('raw.githubusercontent.com'),
    );
    expect(rawCalls.every(([url]) => String(url).includes(`/${commit}/`))).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({
      stage: 'Saving workspace',
      completed: 2,
      total: 2,
    });
  });
  it('supports branch names with slashes without changing the API path', async () => {
    const fetcher = mockGitHub();
    await downloadRepository(source, 'feature/notes', new AbortController().signal, vi.fn());
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith('/commits/feature%2Fnotes')),
    ).toBe(true);
  });
  it('rejects truncated listings and unsafe paths before downloading files', async () => {
    const fetcher = mockGitHub(entries, true);
    await expect(
      downloadRepository(source, '', new AbortController().signal, vi.fn()),
    ).rejects.toThrow('too large');
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('raw.githubusercontent.com')),
    ).toBe(false);
    mockGitHub([{ path: '../secret.md', type: 'blob', mode: '100644', size: 1 }]);
    await expect(
      downloadRepository(source, '', new AbortController().signal, vi.fn()),
    ).rejects.toThrow('traversal');
  });
  it('rejects oversized files and duplicate paths', async () => {
    mockGitHub([{ path: 'large.bin', type: 'blob', mode: '100644', size: 26 * 1024 * 1024 }]);
    await expect(
      downloadRepository(source, '', new AbortController().signal, vi.fn()),
    ).rejects.toThrow('25 MB');
    mockGitHub([entries[0], entries[0]]);
    await expect(
      downloadRepository(source, '', new AbortController().signal, vi.fn()),
    ).rejects.toThrow('duplicate');
  });
  it('explains private/missing repositories and rate limits', async () => {
    for (const [status, message] of [
      [404, 'Only public'],
      [403, 'rate limit'],
      [409, 'empty'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status })),
      );
      await expect(
        downloadRepository(source, '', new AbortController().signal, vi.fn()),
      ).rejects.toThrow(message);
    }
  });
  it('rejects mismatched downloads and cancellation without writing files', async () => {
    mockGitHub([{ path: 'README.md', type: 'blob', mode: '100644', size: 99 }]);
    await expect(
      downloadRepository(source, '', new AbortController().signal, vi.fn()),
    ).rejects.toThrow('Unexpected file size');
    mockGitHub();
    const controller = new AbortController();
    controller.abort();
    await expect(downloadRepository(source, '', controller.signal, vi.fn())).rejects.toThrow();
  });
  it('never overwrites destination files and retains earlier files on write failure', async () => {
    mockGitHub();
    const snapshot = await downloadRepository(source, '', new AbortController().signal, vi.fn());
    const fs = new MemoryFileSystemAdapter();
    await fs.createDirectory('papers');
    await fs.createFile('papers/image.png', 'original');
    snapshot.files.sort((a) => (a.path === 'README.md' ? -1 : 1));
    await expect(
      writeRepository(fs, snapshot, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('Exists');
    expect(await fs.readText('README.md')).toBe('# Notes\n');
    expect(await fs.readText('papers/image.png')).toBe('original');
  });
});
