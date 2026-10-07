// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderMarkdown } from '../src/editor/render';
import { renderLatexTable } from '../src/editor/latex-table';
import { MemoryFileSystemAdapter } from '../src/filesystem/memory-filesystem';
import { defaults } from '../src/storage/preferences';
import { blockCommands } from '../src/editor/commands';

const empty = String.raw`\begin{table}[]
\begin{tabular}{lll}
 &  &  \\
 &  &  \\
 &  &
\end{tabular}
\end{table}`;
const parse = (source: string) => {
  const node = document.createElement('div');
  node.innerHTML = renderLatexTable(source, (math) => `<span>${math}</span>`);
  return node;
};
it('renders the supplied empty table as three rows and three columns', () => {
  const node = parse(empty);
  expect(node.querySelectorAll('tr')).toHaveLength(3);
  expect(node.querySelectorAll('td')).toHaveLength(9);
});
it('renders the LaTeX table starter offered by Writing tools and shortcuts', () => {
  const starter = blockCommands.find((command) => command.label === 'LaTeX table')!;
  const node = parse(starter.insert.replace(/^```latex\n|\n```\n$/g, ''));
  expect(node.querySelectorAll('tr')).toHaveLength(2);
  expect(node.querySelector('caption')?.textContent).toBe('Overview');
});
it('preserves alignment, booktabs rules, caption, escaped separators, and merged columns', () => {
  const node = parse(String.raw`\begin{table}[ht]
\centering
\caption{A \textbf{summary}}
\label{tab:summary}
\begin{tabular}{|lcr|}
\toprule
\multicolumn{2}{c}{Group} & Total \\
\midrule
R\&D & \textit{Ready} & $x^2$ \\
50\% & {A \& B} & 12 \\
\bottomrule
\end{tabular}
\end{table}`);
  expect(node.querySelector('caption strong')?.textContent).toBe('summary');
  expect(node.querySelector('td')?.getAttribute('colspan')).toBe('2');
  expect(node.querySelectorAll('.latex-align-right')).toHaveLength(3);
  expect(node.querySelector('.latex-rule-toprule')).not.toBeNull();
  expect(node.querySelector('.latex-rule-midrule')).not.toBeNull();
  expect(node.querySelector('.latex-bottom-rule')).not.toBeNull();
  expect(node.textContent).toContain('R&D');
  expect(node.textContent).toContain('50%');
  expect(node.textContent).toContain('A & B');
});
it('escapes HTML, rejects unknown commands and malformed or oversized tables', () => {
  const node = parse(String.raw`\begin{tabular}{l}<img src=x onerror=alert(1)>\end{tabular}`);
  expect(node.querySelector('img')).toBeNull();
  for (const source of [
    String.raw`\begin{tabular}{l}\input{secret}\end{tabular}`,
    String.raw`\begin{tabular}{l}a & b\end{tabular}`,
    String.raw`\begin{tabular}{l}\textbf{unclosed\end{tabular}`,
    String.raw`\begin{tabular}{l}\multicolumn{99}{l}{x}\end{tabular}`,
    'x'.repeat(100001),
  ])
    expect(() => parse(source)).toThrow();
});
it('renders only latex fences, retains error source, and renders cell math', async () => {
  const fs = new MemoryFileSystemAdapter();
  const result = await renderMarkdown(
    '```latex\n' +
      empty +
      '\n```\n\n```text\n' +
      empty +
      '\n```\n\n```latex\n\\begin{tabular}{r}$x^2$\\end{tabular}\n```',
    'note.md',
    fs,
    defaults,
  );
  const node = document.createElement('div');
  node.innerHTML = result.html;
  expect(node.querySelectorAll('.latex-table')).toHaveLength(2);
  expect(node.querySelector('.katex')).not.toBeNull();
  expect(node.querySelector('code.language-text')?.textContent).toContain('\\begin{table}');
  const error = await renderMarkdown(
    '```latex\n\\begin{tabular}{l}\\input{file}\\end{tabular}\n```',
    'note.md',
    fs,
    defaults,
  );
  expect(error.html).toContain('LaTeX table could not be rendered');
  expect(error.html).toContain('\\input{file}');
  result.dispose();
  error.dispose();
});
