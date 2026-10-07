import { useEffect, useRef, useState } from 'preact/hooks';
import {
  ListTree,
  ChevronRight,
  Star,
  Check,
  AlertCircle,
  Focus,
  Download,
  MoreHorizontal,
  PlusSquare,
} from 'lucide-preact';
import type { EditorView } from '@codemirror/view';
import {
  createEditor,
  configureEditor,
  outline,
  insert,
  taskProgress,
  type EditorMode,
  type Heading,
} from '../editor/markdown-editor';
import type { DocumentController, DocumentRecord } from '../state/documents';
import type { Preferences } from '../storage/preferences';
import { ensureDirectory, download } from '../filesystem/archive';
import { join, uniquePath, relative, basename } from '../filesystem/adapter';
import { editTable, type TableAction } from '../editor/table';
import { blockCommands, tableCommands } from '../editor/commands';
import { Dialog } from './Dialog';
import { renderMarkdown, standaloneHTML, type RenderResult } from '../editor/render';
interface Props {
  doc: DocumentRecord;
  controller: DocumentController;
  workspaceName: string;
  preferences: Preferences;
  starred: boolean;
  onStar: () => void;
  onFolder: (path: string) => void;
  onLink: (reference: string, wiki: boolean) => void;
  onError: (message: string) => void;
  onReferenceQuery: (query: string) => Promise<{ path: string }[]>;
  onIndexed: (path: string, text: string) => void;
  focus: boolean;
  onFocus: () => void;
  line: number;
  mode: EditorMode;
  onMode: (mode: EditorMode) => void;
  showOutline: boolean;
  onOutline: () => void;
  exportAction: number;
}
export default function EditorPane(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>(),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const [meta, setMeta] = useState({
      words: 0,
      characters: 0,
      headings: [] as Heading[],
      text: '',
      tasks: { total: 0, completed: 0 },
    }),
    [save, setSave] = useState({ status: props.doc.status, error: props.doc.error }),
    [compare, setCompare] = useState(false),
    [exportMenu, setExportMenu] = useState(false),
    [writingMenu, setWritingMenu] = useState(false);
  const [newTask, setNewTask] = useState('');
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWritingMenu(false);
        setExportMenu(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  const active = useRef(props);
  active.current = props;
  const revision = useRef(0),
    [renderRevision, setRenderRevision] = useState(0);
  const refresh = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = active.current,
        text = p.controller.content(p.doc);
      setMeta({
        words: (text.match(/\S+/g) ?? []).length,
        characters: text.length,
        headings: p.doc.editorState ? outline(p.doc.editorState) : [],
        text,
        tasks: p.doc.editorState ? taskProgress(p.doc.editorState) : { total: 0, completed: 0 },
      });
      p.onIndexed(p.doc.path, text);
      setRenderRevision(++revision.current);
    }, 300);
  };
  const click = (target: HTMLElement) => {
    const p = active.current;
    if (target.dataset.wiki) p.onLink(target.dataset.wiki, true);
    else if (target.dataset.localLink) p.onLink(target.dataset.localLink, false);
  };
  async function importImages(files: File[]) {
    const p = active.current,
      doc = p.doc,
      position =
        view.current?.state.selection.main.from ?? doc.editorState?.selection.main.from ?? 0;
    try {
      await ensureDirectory(p.controller.fs, p.preferences.assets);
      const references: string[] = [];
      for (const file of files) {
        const filename =
          file.name && file.name !== 'image.png'
            ? file.name
            : `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const destination = await uniquePath(p.controller.fs, join(p.preferences.assets, filename));
        await p.controller.fs.createFile(destination, file);
        references.push(
          `![${file.name === 'image.png' ? '' : file.name}](<${relative(doc.path, destination)}>)`,
        );
      }
      const text = references.join('\n') + '\n';
      if (active.current.doc === doc && view.current) {
        view.current.dispatch({
          changes: { from: Math.min(position, view.current.state.doc.length), insert: text },
        });
        view.current.focus();
      } else if (doc.editorState) {
        doc.editorState = doc.editorState.update({
          changes: { from: Math.min(position, doc.editorState.doc.length), insert: text },
        }).state;
        p.controller.changed(doc);
      } else {
        doc.text = doc.text.slice(0, position) + text + doc.text.slice(position);
        p.controller.changed(doc);
      }
      window.dispatchEvent(new Event('draft-files-changed'));
    } catch (error) {
      p.onError(String(error));
    }
  }
  useEffect(() => {
    const { doc, controller } = props;
    setNewTask('');
    setSave({ status: doc.status, error: doc.error });
    const editor = createEditor(
      host.current!,
      doc,
      controller,
      props.mode,
      props.preferences,
      refresh,
      click,
      (files) => {
        void importImages(files);
      },
      (query) => active.current.onReferenceQuery(query),
      (message) => active.current.onError(message),
    );
    view.current = editor;
    if (props.mode !== 'preview') editor.focus();
    refresh();
    const unsubscribe = controller.subscribe(() => {
      setSave({ status: doc.status, error: doc.error });
      if (!doc.editorState && doc.status === 'saved' && editor.state.doc.toString() !== doc.text) {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: doc.text } });
        doc.baseline = doc.text;
        doc.status = 'saved';
        refresh();
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
      doc.scroll = editor.scrollDOM.scrollTop;
      doc.editorState = editor.state;
      doc.getText = undefined;
      editor.destroy();
      view.current = undefined;
    };
  }, [props.doc, props.controller]);
  useEffect(() => {
    if (view.current)
      configureEditor(
        view.current,
        props.doc,
        props.controller,
        props.mode,
        props.preferences,
        click,
      );
    refresh();
  }, [props.mode, props.preferences]);
  useEffect(() => {
    if (props.line && view.current) {
      const state = view.current.state;
      const line = state.doc.line(Math.min(props.line, state.doc.lines));
      view.current.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.current.focus();
    }
  }, [props.line, props.doc]);
  useEffect(() => {
    const focus = () => {
      void props.controller.checkExternal();
    };
    window.addEventListener('focus', focus);
    const visibility = () => {
      if (document.visibilityState === 'visible') focus();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [props.controller]);
  useEffect(() => {
    if (props.mode !== 'preview' && props.mode !== 'split') return;
    let alive = true,
      result: RenderResult | undefined;
    void renderMarkdown(
      props.controller.content(props.doc),
      props.doc.path,
      props.controller.fs,
      props.preferences,
    )
      .then((value) => {
        result = value;
        if (!alive) {
          value.dispose();
          return;
        }
        if (preview.current) preview.current.innerHTML = value.html;
      })
      .catch((error) => props.onError(String(error)));
    return () => {
      alive = false;
      result?.dispose();
    };
  }, [props.mode, props.doc, props.preferences, renderRevision]);
  const jump = (heading: Heading) => {
    if (props.mode === 'preview') {
      const elements = preview.current?.querySelectorAll('h1,h2,h3,h4,h5,h6');
      elements?.item(meta.headings.indexOf(heading))?.scrollIntoView({ behavior: 'smooth' });
    } else if (view.current) {
      view.current.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true });
      view.current.focus();
    }
  };
  async function exportDocument(kind: 'md' | 'html' | 'copy' | 'print') {
    setExportMenu(false);
    try {
      await props.controller.save(props.doc);
      const text = props.controller.content(props.doc);
      if (kind === 'md') {
        download(new Blob([text], { type: 'text/markdown' }), basename(props.doc.path));
        return;
      }
      const result = await renderMarkdown(
        text,
        props.doc.path,
        props.controller.fs,
        props.preferences,
      );
      try {
        const html = await standaloneHTML(result, basename(props.doc.path));
        if (kind === 'html')
          download(
            new Blob([html], { type: 'text/html' }),
            basename(props.doc.path).replace(/\.[^.]+$/, '.html'),
          );
        else if (kind === 'copy')
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' }),
            }),
          ]);
        else {
          const frame = document.createElement('iframe');
          frame.className = 'print-frame';
          frame.srcdoc = html;
          document.body.append(frame);
          frame.onload = () => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            setTimeout(() => frame.remove(), 60000);
          };
        }
      } finally {
        result.dispose();
      }
    } catch (error) {
      props.onError(String(error));
    }
  }
  useEffect(() => {
    if (props.exportAction) void exportDocument('print');
  }, [props.exportAction]);
  function writingInsert(text: string) {
    setWritingMenu(false);
    if (view.current) {
      if (props.mode === 'preview') props.onMode('rich');
      insert(view.current, text);
    }
  }
  function tableAction(action: TableAction) {
    setWritingMenu(false);
    if (!view.current) return;
    const state = view.current.state;
    const change = editTable(
      state.doc.toString(),
      state.doc.lineAt(state.selection.main.head).number,
      action,
    );
    if (change) {
      view.current.dispatch({ changes: change });
      view.current.focus();
    } else
      props.onError(
        'Place the cursor in a Markdown table. Keep at least one body row and one column.',
      );
  }
  const pathParts = props.doc.path.split('/');
  const diskLines = compare ? (props.doc.disk ?? '').split('\n') : [],
    draftLines = compare ? props.controller.content(props.doc).split('\n') : [];
  const diskSet = new Set(diskLines),
    draftSet = new Set(draftLines);
  return (
    <>
      <div class="document-toolbar">
        <div class="breadcrumbs">
          <button onClick={() => props.onFolder('')}>{props.workspaceName}</button>
          {pathParts.map((part, i) => (
            <>
              <ChevronRight size={12} />
              {i === pathParts.length - 1 ? (
                <span>{part}</span>
              ) : (
                <button onClick={() => props.onFolder(pathParts.slice(0, i + 1).join('/'))}>
                  {part}
                </button>
              )}
            </>
          ))}
        </div>
        <div class="toolbar-actions">
          <button
            class={`icon-button ${props.starred ? 'starred' : ''}`}
            aria-label={props.starred ? 'Remove favorite' : 'Add favorite'}
            onClick={props.onStar}
          >
            <Star size={15} fill={props.starred ? 'currentColor' : 'none'} />
          </button>
          <div class="mode-switch" role="group" aria-label="Editor mode">
            {(['split', 'rich', 'source', 'preview'] as EditorMode[]).map((mode) => (
              <button
                class={props.mode === mode ? 'selected' : ''}
                onClick={() => props.onMode(mode)}
              >
                {mode === 'split'
                  ? 'Split'
                  : mode === 'rich'
                    ? 'Rich Markdown'
                    : mode === 'source'
                      ? 'Source'
                      : 'Preview'}
              </button>
            ))}
          </div>
          <button
            class="icon-button"
            aria-label="Writing tools"
            title="Insert Markdown / table tools"
            onClick={() => setWritingMenu((v) => !v)}
          >
            <PlusSquare size={15} />
          </button>
          {writingMenu && (
            <div class="writing-menu context-menu">
              {blockCommands.map((command) => (
                <button onClick={() => writingInsert(command.insert)}>{command.label}</button>
              ))}
              <div class="menu-divider" />
              {tableCommands.map(([action, label]) => (
                <button onClick={() => tableAction(action)}>{label}</button>
              ))}
            </div>
          )}
          <button
            class="icon-button"
            aria-label="Focus mode"
            title="Focus mode"
            onClick={props.onFocus}
          >
            <Focus size={16} />
          </button>
          <button
            class="icon-button"
            aria-label="Toggle outline"
            title="Toggle outline"
            onClick={props.onOutline}
          >
            <ListTree size={16} />
          </button>
          <button
            class="icon-button"
            aria-label="Export document"
            title="Export document"
            onClick={() => setExportMenu((v) => !v)}
          >
            <MoreHorizontal size={18} />
          </button>
          {exportMenu && (
            <div class="export-menu context-menu">
              {(['md', 'html', 'copy', 'print'] as const).map((kind) => (
                <button
                  onClick={() => {
                    void exportDocument(kind);
                  }}
                >
                  <Download size={14} />
                  {
                    {
                      md: 'Download Markdown',
                      html: 'Export standalone HTML',
                      copy: 'Copy as HTML',
                      print: 'Print / Export PDF',
                    }[kind]
                  }
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {save.status === 'conflict' && (
        <div class="conflict-banner" role="alert">
          <AlertCircle size={17} />
          <span>This file changed outside Draft.md. Autosave is paused.</span>
          <button onClick={() => setCompare(true)}>Compare</button>
          <button
            onClick={() => {
              void props.controller
                .resolve(props.doc, 'reload')
                .catch((error) => props.onError(String(error)));
            }}
          >
            Reload disk version
          </button>
          <button
            onClick={() => {
              void props.controller
                .resolve(props.doc, 'keep')
                .catch((error) => props.onError(String(error)));
            }}
          >
            Keep Draft.md version
          </button>
        </div>
      )}
      {save.status === 'error' && (
        <div class="conflict-banner" role="alert">
          <AlertCircle size={17} />
          <span>{save.error}</span>
          <button
            onClick={() => {
              void props.controller.save(props.doc).catch((error) => props.onError(String(error)));
            }}
          >
            Retry save
          </button>
          <button
            onClick={() =>
              download(new Blob([props.controller.content(props.doc)]), basename(props.doc.path))
            }
          >
            Download draft
          </button>
        </div>
      )}
      {(meta.tasks.total > 0 || /^# To-do list(?:\r?\n|$)/i.test(meta.text)) && (
        <form
          class="task-tools"
          onSubmit={(event) => {
            event.preventDefault();
            const text = newTask.trim();
            const editor = view.current;
            if (!text || !editor) return;
            const content = editor.state.doc.toString();
            editor.dispatch({
              changes: {
                from: content.length,
                insert: `${content.endsWith('\n') ? '' : '\n'}- [ ] ${text}\n`,
              },
            });
            setNewTask('');
          }}
        >
          <span>
            {meta.tasks.completed} of {meta.tasks.total} completed
          </span>
          <input
            aria-label="New task"
            placeholder="Add a task…"
            value={newTask}
            onInput={(event) => setNewTask(event.currentTarget.value)}
          />
          <button type="submit" disabled={!newTask.trim()}>
            Add task
          </button>
        </form>
      )}
      <div class={`writing-layout ${props.focus ? 'focused' : ''}`}>
        <div class={`editor-column ${props.mode === 'split' ? 'split-view' : ''}`}>
          <div
            ref={host}
            class="editor-host"
            style={{ display: props.mode === 'preview' ? 'none' : 'block' }}
          />
          {(props.mode === 'preview' || props.mode === 'split') && (
            <article
              class="markdown preview"
              aria-label="Markdown preview"
              ref={preview}
              onClick={(event) => {
                const target = (event.target as HTMLElement).closest<HTMLElement>(
                  '[data-local-link],[data-wiki],[data-copy-code]',
                );
                if (target) {
                  event.preventDefault();
                  if (target.hasAttribute('data-copy-code'))
                    void navigator.clipboard.writeText(
                      target.closest('.code-block')?.querySelector('code')?.textContent ?? '',
                    );
                  else click(target);
                }
              }}
            />
          )}
        </div>
        {props.showOutline && !props.focus && (
          <aside class="outline-panel">
            <div class="section-label">ON THIS PAGE</div>
            {meta.headings.length ? (
              meta.headings.map((heading) => (
                <button
                  style={{ paddingLeft: 16 + (heading.level - 1) * 12 }}
                  onClick={() => jump(heading)}
                >
                  {heading.title}
                </button>
              ))
            ) : (
              <p class="outline-empty">Headings will appear here as you write.</p>
            )}
            <div class="outline-foot">
              <span>Make room for ideas.</span>
              <kbd>⌘ ⇧ ↵</kbd>
            </div>
          </aside>
        )}
      </div>
      {!props.focus && (
        <div class="status-bar">
          <span>Markdown</span>
          <span>UTF-8</span>
          <span>{meta.words.toLocaleString()} words</span>
          <span>{meta.characters.toLocaleString()} characters</span>
          <span>{Math.max(1, Math.ceil(meta.words / 200))} min read</span>
          <button
            class={`save-state ${save.status}`}
            onClick={() => {
              void props.controller.save(props.doc).catch((error) => props.onError(String(error)));
            }}
          >
            {save.status === 'saved' ? (
              <Check size={12} />
            ) : save.status === 'error' || save.status === 'conflict' ? (
              <AlertCircle size={12} />
            ) : (
              <span class="tiny-dot" />
            )}
            {
              {
                saved: 'Saved',
                saving: 'Saving…',
                dirty: 'Unsaved changes',
                error: 'Save failed — retry',
                conflict: 'External change',
              }[save.status]
            }
          </button>
        </div>
      )}
      {compare && (
        <Dialog title="Compare external changes" onClose={() => setCompare(false)} wide>
          <p class="compare-description">
            The two full versions are preserved below. Keeping Draft.md explicitly overwrites the
            current disk version.
          </p>
          <div class="compare-grid">
            <section>
              <h3>Disk version</h3>
              <pre>
                {diskLines.map((line, index) => (
                  <span class={`diff-line ${draftSet.has(line) ? '' : 'removed'}`}>
                    <span class="diff-number">{index + 1}</span>
                    {line || ' '}
                  </span>
                ))}
              </pre>
            </section>
            <section>
              <h3>Draft.md version</h3>
              <pre>
                {draftLines.map((line, index) => (
                  <span class={`diff-line ${diskSet.has(line) ? '' : 'added'}`}>
                    <span class="diff-number">{index + 1}</span>
                    {line || ' '}
                  </span>
                ))}
              </pre>
            </section>
          </div>
          <footer>
            <button onClick={() => setCompare(false)}>Close comparison</button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
