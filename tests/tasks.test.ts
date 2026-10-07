import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { taskProgress } from '../src/editor/markdown-editor';
const progress = (text: string) =>
  taskProgress(EditorState.create({ doc: text, extensions: [markdown({ extensions: GFM })] }));
describe('Markdown task progress', () => {
  it('counts checked, unchecked, and nested tasks', () => {
    expect(progress('- [ ] First\n- [x] Second\n  - [X] Nested\n')).toEqual({
      total: 3,
      completed: 2,
    });
  });
  it('does not count task-looking text in code or normal paragraphs', () => {
    expect(
      progress('```md\n- [x] Example\n```\n\nAn inline [ ] example.\n\n- [ ] Real task\n'),
    ).toEqual({ total: 1, completed: 0 });
  });
});
