import { todoTemplate } from './note-templates';
import type { TableAction } from './table';
export const blockCommands: { label: string; insert: string; cursor?: number }[] = [
  { label: 'Heading 1', insert: '# ' },
  { label: 'Heading 2', insert: '## ' },
  { label: 'Heading 3', insert: '### ' },
  { label: 'Bullet list', insert: '- ' },
  { label: 'Numbered list', insert: '1. ' },
  { label: 'Task list', insert: '- [ ] ' },
  { label: 'To-do List', insert: todoTemplate },
  { label: 'Quote', insert: '> ' },
  { label: 'Code block', insert: '```text\n\n```\n', cursor: 8 },
  { label: 'Math block', insert: '$$\n\n$$\n', cursor: 3 },
  { label: 'Inline math', insert: '$equation$', cursor: 1 },
  { label: 'Table', insert: '| Item | Status |\n| --- | --- |\n|  |  |\n', cursor: 33 },
  {
    label: 'LaTeX table',
    insert:
      '```latex\n\\begin{table}[]\n\\centering\n\\caption{Overview}\n\\begin{tabular}{lrr}\n\\toprule\nItem & Quantity & Total \\\\\n\\midrule\nExample & 1 & 10 \\\\\n\\bottomrule\n\\end{tabular}\n\\end{table}\n```\n',
  },
  { label: 'Mermaid', insert: '```mermaid\ngraph LR\n  A --> B\n```\n', cursor: 10 },
  { label: 'Callout', insert: '> [!NOTE]\n> \n', cursor: 12 },
  { label: 'Divider', insert: '\n---\n' },
  { label: 'Link', insert: '[label](url)', cursor: 1 },
  { label: 'Image', insert: '![description](assets/image.png)', cursor: 2 },
  { label: 'Bold', insert: '**text**', cursor: 2 },
  { label: 'Italic', insert: '*text*', cursor: 1 },
];
export const tableCommands: [TableAction, string][] = [
  ['add-row', 'Add table row'],
  ['delete-row', 'Delete table row'],
  ['add-column', 'Add table column'],
  ['delete-column', 'Delete table column'],
  ['align', 'Cycle table alignment'],
];
