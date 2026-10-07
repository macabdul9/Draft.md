import {
  autocompletion,
  completionKeymap,
  acceptCompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { ChangeSet, Prec, type Extension } from '@codemirror/state';
import { keymap, placeholder } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { basename, relative } from '../filesystem/adapter';
import { blockCommands, tableCommands } from './commands';
import { editTable } from './table';

export function completionTrigger(context: CompletionContext) {
  if (!context.state.selection.main.empty) return null;
  const match = context.matchBefore(/(?:^|[\s|])[\\@][\p{L}\p{N}_. /-]*$/u);
  if (!match) return null;
  const offset = /^[\\@]/.test(match.text) ? 0 : 1;
  const trigger = match.text[offset];
  const from = match.from + offset;
  let node = syntaxTree(context.state).resolveInner(from, -1);
  while (node.parent) {
    if (/Code|Link|URL|Autolink/.test(node.name)) return null;
    node = node.parent;
  }
  const line = context.state.doc.lineAt(from);
  const prefix = context.state.sliceDoc(line.from, from).replace(/\\\$/g, '');
  if ((prefix.match(/\$/g)?.length ?? 0) % 2) return null;
  return { trigger, from, query: match.text.slice(offset + 1) };
}

export function editorShortcuts(
  documentPath: string,
  referenceQuery: (query: string) => Promise<{ path: string }[]>,
  onError: (message: string) => void,
): Extension {
  return [
    placeholder(() => {
      const guide = document.createElement('div');
      guide.className = 'editor-empty-guide';
      const title = document.createElement('strong');
      title.textContent = 'Start writing, or try a shortcut';
      guide.append(title);
      for (const [key, description] of [
        ['\\', 'Headings, lists, tasks, tables, code, and more'],
        ['@', 'Link a workspace note or insert today’s date'],
        ['↑ / ↓ · Enter / Tab · Esc', 'Choose a suggestion, insert it, or dismiss'],
        ['⌘ / Ctrl B · I · K', 'Bold, italic, and link'],
        ['⌘ / Ctrl S', 'Save immediately'],
      ]) {
        const row = document.createElement('div');
        const keyboard = document.createElement('kbd');
        keyboard.textContent = key;
        const label = document.createElement('span');
        label.textContent = description;
        row.append(keyboard, label);
        guide.append(row);
      }
      return guide;
    }),
    autocompletion({
      defaultKeymap: false,
      interactionDelay: 0,
      activateOnTypingDelay: 50,
      override: [
        async (context) => {
          const match = completionTrigger(context);
          if (!match) return null;
          const from = match.from + 1;
          if (match.trigger === '\\') {
            const options: Completion[] = blockCommands.map((command) => ({
              label: command.label,
              type: 'keyword',
              apply(view, _completion, from, to) {
                const start = from - 1;
                const inline = ['Inline math', 'Link', 'Image', 'Bold', 'Italic'].includes(
                  command.label,
                );
                const prefix =
                  !inline && view.state.sliceDoc(view.state.doc.lineAt(start).from, start).trim()
                    ? '\n\n'
                    : '';
                view.dispatch({
                  changes: { from: start, to, insert: prefix + command.insert },
                  selection: {
                    anchor: start + prefix.length + (command.cursor ?? command.insert.length),
                  },
                  userEvent: 'input.complete',
                });
              },
            }));
            options.push(
              ...tableCommands.map(([action, label]): Completion => ({
                label,
                detail: 'Cursor must be in a table',
                type: 'function',
                apply(view, _completion, from, to) {
                  const start = from - 1;
                  const text = view.state.doc.toString();
                  const clean = text.slice(0, start) + text.slice(to);
                  const line = clean.slice(0, start).split('\n').length;
                  const change = editTable(clean, line, action);
                  if (!change) {
                    onError(
                      'Place the cursor in a Markdown table. Keep at least one body row and one column.',
                    );
                    return;
                  }
                  const changes = view.state
                    .changes({ from: start, to })
                    .compose(ChangeSet.of(change, clean.length));
                  view.dispatch({
                    changes,
                    selection: { anchor: changes.mapPos(start) },
                    userEvent: 'input.complete',
                  });
                },
              })),
            );
            return {
              from,
              options,
              validFor: (text, from, _to, state) =>
                from > 0 &&
                state.sliceDoc(from - 1, from) === '\\' &&
                /^[\p{L}\p{N}_. /-]*$/u.test(text),
            };
          }
          const now = new Date();
          const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const insertValue = (label: string, value: string, detail: string): Completion => ({
            label,
            detail,
            type: 'text',
            apply(view, _completion, from, to) {
              view.dispatch({
                changes: { from: from - 1, to, insert: value },
                selection: { anchor: from - 1 + value.length },
                userEvent: 'input.complete',
              });
            },
          });
          const options = [
            insertValue('Today', date, 'Local date'),
            insertValue('Timestamp', now.toLocaleString(), 'Local date and time'),
          ].filter((item) => item.label.toLowerCase().includes(match.query.toLowerCase()));
          const files = await referenceQuery(match.query);
          if (context.aborted) return null;
          for (const file of files.slice(0, 60)) {
            if (file.path === documentPath) continue;
            const label = basename(file.path).replace(/\.(md|markdown)$/i, '');
            const target = relative(documentPath, file.path)
              .split('/')
              .map((segment) => encodeURIComponent(segment))
              .join('/');
            const escapedLabel = label.replace(/[\\[\]]/g, '\\$&');
            options.push(insertValue(label, `[${escapedLabel}](<${target}>)`, file.path));
          }
          return { from, options, filter: false };
        },
      ],
    }),
    Prec.highest(keymap.of([...completionKeymap, { key: 'Tab', run: acceptCompletion }])),
  ];
}
