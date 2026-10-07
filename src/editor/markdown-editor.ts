import { Compartment, EditorState, Facet, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { draftly } from 'draftly/src/editor/draftly.ts';
import { HeadingPlugin } from 'draftly/src/plugins/heading-plugin.ts';
import { InlinePlugin } from 'draftly/src/plugins/inline-plugin.ts';
import { ListPlugin } from 'draftly/src/plugins/list-plugin.ts';
import { QuotePlugin } from 'draftly/src/plugins/quote-plugin.ts';
import { CodePlugin } from 'draftly/src/plugins/code-plugin.ts';
import { TablePlugin } from 'draftly/src/plugins/table-plugin.ts';
import { HRPlugin } from 'draftly/src/plugins/hr-plugin.ts';
import { ResearchPlugin } from './research-plugin';
import type { DocumentController, DocumentRecord } from '../state/documents';
import type { Preferences } from '../storage/preferences';
export type EditorMode = 'rich' | 'source' | 'preview';
const typewriter = Facet.define<boolean, boolean>({ combine: (values) => values[0] ?? false });
const mode = new Compartment(),
  settings = new Compartment(),
  session = new Compartment();
const theme = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-content': {
    maxWidth: '860px',
    margin: '0 auto',
    padding: '44px 52px 180px',
    fontFamily: 'var(--editor-font)',
    fontSize: 'var(--editor-size)',
    lineHeight: 'var(--editor-line-height)',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)' },
  '.cm-activeLineGutter': { background: 'var(--hover)' },
  '.cm-selectionBackground': { background: 'var(--selection) !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
});
function formatting(view: EditorView, marker: string, suffix = marker) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: marker + view.state.sliceDoc(from, to) + suffix },
    selection: { anchor: from + marker.length, head: to + marker.length },
  });
  return true;
}
export function insert(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  view.focus();
}
function modeExtensions(
  value: EditorMode,
  doc: DocumentRecord,
  controller: DocumentController,
  preferences: Preferences,
  click: (target: HTMLElement) => void,
): Extension {
  if (value !== 'rich')
    return [markdown({ codeLanguages: languages, extensions: GFM }), lineNumbers()];
  const extensions = draftly({
    history: false,
    defaultKeybindings: false,
    indentWithTab: false,
    markdown: GFM,
    plugins: [
      new HeadingPlugin(),
      new InlinePlugin(),
      new ListPlugin(),
      new QuotePlugin(),
      new CodePlugin(),
      new TablePlugin(),
      new HRPlugin(),
      new ResearchPlugin(doc.path, controller.fs, preferences, click),
    ],
  });
  return preferences.wrap
    ? extensions
    : extensions.filter((extension) => extension !== EditorView.lineWrapping);
}
function preferenceExtensions(preferences: Preferences): Extension {
  return [
    typewriter.of(preferences.typewriter),
    preferences.wrap ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(preferences.tabWidth),
    EditorView.contentAttributes.of({
      'aria-label': 'Markdown editor',
      spellcheck: String(preferences.spellcheck),
    }),
  ];
}
export function createEditor(
  container: HTMLElement,
  doc: DocumentRecord,
  controller: DocumentController,
  value: EditorMode,
  preferences: Preferences,
  onChange: () => void,
  click: (target: HTMLElement) => void,
  importImages: (files: File[]) => void,
): EditorView {
  const view = new EditorView({
    parent: container,
    state:
      doc.editorState ??
      EditorState.create({
        doc: doc.text,
        extensions: [
          history(),
          keymap.of([
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
            { key: 'Mod-b', run: (view) => formatting(view, '**') },
            { key: 'Mod-i', run: (view) => formatting(view, '*') },
            { key: 'Mod-k', run: (view) => formatting(view, '[', '](url)') },
          ]),
          theme,
          syntaxHighlighting(defaultHighlightStyle),
          mode.of(modeExtensions(value, doc, controller, preferences, click)),
          settings.of(preferenceExtensions(preferences)),
          session.of([]),
        ],
      }),
  });
  const handlers: Extension = [
    EditorView.updateListener.of((update) => {
      doc.editorState = update.state;
      if (update.docChanged) {
        controller.changed(doc);
        onChange();
      }
      if (update.state.facet(typewriter) && (update.docChanged || update.selectionSet))
        queueMicrotask(() => {
          if (view.dom.isConnected)
            view.dispatch({
              effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }),
            });
        });
    }),
    EditorView.domEventHandlers({
      paste(event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length) {
          event.preventDefault();
          importImages(files);
          return true;
        }
        return false;
      },
      drop(event) {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length) {
          event.preventDefault();
          importImages(files);
          return true;
        }
        return false;
      },
    }),
  ];
  view.dispatch({
    effects: [
      mode.reconfigure(modeExtensions(value, doc, controller, preferences, click)),
      settings.reconfigure(preferenceExtensions(preferences)),
      session.reconfigure(handlers),
    ],
  });
  view.scrollDOM.scrollTop = doc.scroll;
  doc.getText = () => view.state.doc.toString();
  return view;
}
export function configureEditor(
  view: EditorView,
  doc: DocumentRecord,
  controller: DocumentController,
  value: EditorMode,
  preferences: Preferences,
  click: (target: HTMLElement) => void,
) {
  view.dispatch({
    effects: [
      mode.reconfigure(modeExtensions(value, doc, controller, preferences, click)),
      settings.reconfigure(preferenceExtensions(preferences)),
    ],
  });
}
export interface Heading {
  title: string;
  level: number;
  line: number;
  from: number;
}
export function outline(state: EditorState): Heading[] {
  const headings: Heading[] = [];
  const frontmatter =
    state
      .sliceDoc(0, Math.min(8192, state.doc.length))
      .match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from < frontmatter && node.name !== 'Document') return false;
      if (/^ATXHeading[1-6]$|^SetextHeading[12]$/.test(node.name)) {
        headings.push({
          title: state
            .sliceDoc(node.from, node.to)
            .replace(/^#+\s*|\s*#+$/g, '')
            .split('\n')[0],
          level: Number(node.name.at(-1)),
          line: state.doc.lineAt(node.from).number,
          from: node.from,
        });
        return false;
      }
      if (/FencedCode|CodeBlock/.test(node.name)) return false;
    },
  });
  return headings;
}
