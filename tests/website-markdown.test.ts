// @vitest-environment jsdom
import { expect, test } from 'vitest';
// @ts-expect-error The extension ships browser-native JavaScript.
import { toMarkdown } from '../extension/website/dom.js';
function convert(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return toMarkdown(root);
}
test('website task lists preserve editable checkboxes and headings', () => {
  expect(
    convert(
      '<h1>Tasks</h1><ul><li><input type="checkbox" disabled>Draft</li><li><input type="checkbox" checked disabled>Review</li></ul>',
    ),
  ).toBe('# Tasks\n\n- [ ] Draft\n- [x] Review');
});
test('website tables and fenced code remain Markdown', () => {
  expect(
    convert(
      '<table><tr><th>Task</th><th>Status</th></tr><tr><td>Draft</td><td>Open</td></tr></table>',
    ),
  ).toBe('| Task | Status |\n| --- | --- |\n| Draft | Open |');
  expect(convert('<pre><code class="language-python">print(1)\n</code></pre>')).toBe(
    '```python\nprint(1)\n```',
  );
});
test('response extraction excludes controls and hidden reasoning', () => {
  expect(
    convert(
      '<div data-testid="thinking">Private reasoning</div><p>Actual <strong>writing</strong>.</p><button>Copy</button><div aria-hidden="true">Hidden</div>',
    ),
  ).toBe('Actual **writing**.');
});
