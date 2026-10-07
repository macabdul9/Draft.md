import { it, expect } from 'vitest';
import { searchDocuments } from '../src/search/index';
it('searches filenames, snippets, updates and correct line numbers', () => {
  const documents = new Map([
    [
      'a',
      { path: 'papers/Audio-reasoning.md', text: '# Results\n\nAccuracy improved with compute.' },
    ],
    ['b', { path: 'meetings/tuesday.md', text: 'Discuss accuracy.' }],
  ]);
  expect(searchDocuments(documents.values(), 'aure', true)[0].path).toBe(
    'papers/Audio-reasoning.md',
  );
  expect(searchDocuments(documents.values(), 'improved')[0].line).toBe(3);
  documents.set('a', { path: 'renamed.md', text: 'Updated result' });
  expect(searchDocuments(documents.values(), 'improved')).toEqual([]);
  documents.delete('a');
  expect(searchDocuments(documents.values(), 'renamed')).toEqual([]);
});
