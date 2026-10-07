import { it, expect } from 'vitest';
import { knowledge } from '../src/search/knowledge';
import { editTable } from '../src/editor/table';
it('indexes inline/YAML tags and wiki links while ignoring headings and code', () => {
  const result = knowledge(
    '---\ntags: [audio, research]\n---\n# Heading\n\n#experiment and [[audio reasoning#results]].\n\n`#inline`\n\n```python\n#not-a-tag\n[[not-a-link]]\n```',
  );
  expect(result.tags).toEqual(['audio', 'research', 'experiment']);
  expect(result.links).toEqual(['audio reasoning']);
});
it('adds portable table rows/columns, aligns and safely rejects non-tables', () => {
  const text = '# Results\n\n| Model | Accuracy |\n| --- | ---: |\n| A | 72.1 |\n| B | 75.3 |';
  expect(editTable(text, 5, 'add-row')?.insert).toContain('|  |  |');
  expect(editTable(text, 5, 'add-column')?.insert).toContain('| Model | Accuracy |  |');
  expect(editTable(text, 5, 'delete-row')?.insert).not.toContain('72.1');
  expect(editTable(text, 5, 'align')?.insert).toContain(':---:');
  expect(editTable('regular text', 1, 'add-row')).toBeNull();
});
