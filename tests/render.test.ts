// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { sanitize, renderMarkdown } from '../src/editor/render';
import { MemoryFileSystemAdapter } from '../src/filesystem/memory-filesystem';
import { defaults } from '../src/storage/preferences';
it('sanitizes scripts, event handlers, dangerous links, remote images and embeds', () => {
  const result = sanitize(
    '<script>alert(1)</script><img src="https://tracker/a" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><iframe src="https://tracker"></iframe><svg><image href="https://tracker"/></svg>',
  );
  expect(result).not.toContain('<script');
  expect(result).not.toContain('onerror');
  expect(result).not.toContain('javascript:');
  expect(result).not.toContain('<iframe');
  expect(result).not.toContain('src=');
});
it('renders research Markdown, citations, frontmatter, footnotes, safe math and callouts', async () => {
  const fs = new MemoryFileSystemAdapter();
  const result = await renderMarkdown(
    '---\ntags: [research]\n---\n# Findings\n\n**Bold** ~~removed~~ $E=mc^2$\n\n> [!HYPOTHESIS]\n> A testable idea.\n\n[@key]\n\nA footnote[^1].\n\n[^1]: Detail\n\n| A | B |\n|---|---|\n|1|2|',
    'note.md',
    fs,
    defaults,
  );
  expect(result.html).toContain('<h1>Findings');
  expect(result.html).toContain('katex');
  expect(result.html).toContain('hypothesis');
  expect(result.html).toContain('data-citation');
  expect(result.html).toContain('footnote-1');
  expect(result.html).toContain('<table>');
  result.dispose();
});
it('loads local assets and never fetches remote image references', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:local');
  URL.revokeObjectURL = vi.fn();
  const fs = new MemoryFileSystemAdapter();
  await fs.createDirectory('assets');
  await fs.createFile('assets/a.png', new Blob(['bytes']));
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const result = await renderMarkdown(
    '![local](../assets/a.png)\n\n![remote](https://tracker/a.png)',
    'papers/note.md',
    fs,
    defaults,
  );
  expect(result.html).toContain('blob:local');
  expect(result.html).toContain('remote resources are blocked');
  expect(fetchSpy).not.toHaveBeenCalled();
  result.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
  fetchSpy.mockRestore();
});
it('keeps footnote-looking text and math-looking syntax inside code blocks untouched', async () => {
  const result = await renderMarkdown(
    '```text\n[^a]: literal definition\n$not_math$\n```',
    'note.md',
    new MemoryFileSystemAdapter(),
    defaults,
  );
  expect(result.html).toContain('[^a]: literal definition');
  expect(result.html).toContain('$not_math$');
  expect(result.html).not.toContain('class="footnotes"');
  result.dispose();
});
