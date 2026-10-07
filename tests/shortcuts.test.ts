import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { completionTrigger } from '../src/editor/shortcuts';

const trigger = (doc: string) => {
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ extensions: GFM })],
  });
  return completionTrigger(new CompletionContext(state, doc.length, false));
};
describe('editor shortcut triggers', () => {
  it('recognizes filtered blocks and Unicode note names', () => {
    expect(trigger('\\task')).toEqual({ trigger: '\\', from: 0, query: 'task' });
    expect(trigger('See @résumé.md')).toEqual({ trigger: '@', from: 4, query: 'résumé.md' });
    expect(trigger('| cell |\\Add table row')).not.toBeNull();
  });
  it('leaves email addresses, paths, code, links, and math alone', () => {
    for (const doc of [
      'person@example',
      'C:\\folder',
      '```text\n\\task',
      '`\\task',
      '[label](https://host/@note',
      '$x + @note',
    ]) {
      expect(trigger(doc), doc).toBeNull();
    }
  });
});
