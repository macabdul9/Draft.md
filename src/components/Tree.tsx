import { useEffect, useState, useRef } from 'preact/hooks';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Image,
  File,
  Plus,
  FolderPlus,
  RefreshCw,
  ArrowDownAZ,
  MoreHorizontal,
} from 'lucide-preact';
import type { Entry, WorkspaceFileSystem } from '../filesystem/adapter';
export type FileAction =
  'note' | 'folder' | 'rename' | 'duplicate' | 'move' | 'delete' | 'copy' | 'refresh';
interface Props {
  fs: WorkspaceFileSystem;
  active: string;
  selected: string;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
  onAction: (action: FileAction, entry?: Entry) => void;
  onMove: (from: string, to: string) => void;
  onImport: (files: File[], folder: string) => void;
  revision: number;
  hidden: boolean;
}
interface Menu {
  entry: Entry;
  x: number;
  y: number;
}
function FileIcon({ name }: { name: string }) {
  return /\.(md|txt|bib|tex)$/i.test(name) ? (
    <FileText size={15} />
  ) : /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? (
    <Image size={15} />
  ) : (
    <File size={15} />
  );
}
function Branch({
  props,
  folder,
  depth,
  descending,
  onMenu,
}: {
  props: Props;
  folder: string;
  depth: number;
  descending: boolean;
  onMenu: (menu: Menu) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [error, setError] = useState(''),
    [first, setFirst] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const virtual = entries.length > 250 && entries.every((entry) => entry.kind === 'file');
  const rowHeight = document.documentElement.dataset.density === 'compact' ? 27 : 32;
  useEffect(() => {
    if (!virtual) return;
    const element = container.current!,
      scroll = element.closest('.tree')!;
    const update = () => {
      const offset =
        element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setFirst(Math.max(0, Math.floor((scroll.scrollTop - offset) / rowHeight) - 8));
    };
    scroll.addEventListener('scroll', update, { passive: true });
    update();
    return () => scroll.removeEventListener('scroll', update);
  }, [virtual, rowHeight, entries.length]);
  useEffect(() => {
    let alive = true;
    void props.fs
      .listDirectory(folder)
      .then((value) => {
        if (alive) {
          setEntries(value);
          setError('');
        }
      })
      .catch((error) => {
        if (alive) setError(String(error));
      });
    return () => {
      alive = false;
    };
  }, [props.fs, folder, props.revision]);
  // Reveal ancestor directories selected through breadcrumbs or Quick Open.
  useEffect(() => {
    if (props.selected.startsWith(folder ? `${folder}/` : '')) {
      const rest = folder ? props.selected.slice(folder.length + 1) : props.selected;
      const first = rest.split('/')[0];
      if (first) setExpanded((old) => new Set([...old, folder ? `${folder}/${first}` : first]));
    }
  }, [props.selected, folder]);
  const sorted = entries
    .filter((e) => props.hidden || !e.name.startsWith('.'))
    .sort((a, b) =>
      a.kind === b.kind
        ? (descending ? -1 : 1) * a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.kind === 'directory'
          ? -1
          : 1,
    );
  const visible = virtual ? sorted.slice(first, first + 70) : sorted;
  return (
    <div
      ref={container}
      role="group"
      style={
        virtual
          ? {
              paddingTop: first * rowHeight,
              paddingBottom: Math.max(0, (sorted.length - first - visible.length) * rowHeight),
            }
          : {}
      }
    >
      {error && <p class="inline-error">{error}</p>}
      {!folder && !sorted.length && (
        <div class="tree-empty">
          No notes yet
          <br />
          <button onClick={() => props.onAction('note')}>New note</button>
        </div>
      )}
      {visible.map((entry) => (
        <div
          key={entry.path}
          role="treeitem"
          aria-expanded={entry.kind === 'directory' ? expanded.has(entry.path) : undefined}
        >
          <button
            aria-label={entry.name}
            class={`tree-row ${props.active === entry.path ? 'active' : ''} ${props.selected === entry.path ? 'selected-folder' : ''}`}
            style={{ paddingLeft: 12 + depth * 16 }}
            draggable
            onDragStart={(event) => {
              event.dataTransfer?.setData('application/x-draft-path', entry.path);
            }}
            onDragOver={(event) => {
              if (entry.kind === 'directory') event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const from = event.dataTransfer?.getData('application/x-draft-path');
              if (entry.kind === 'directory') {
                if (from) props.onMove(from, entry.path);
                else props.onImport(Array.from(event.dataTransfer?.files ?? []), entry.path);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu({ entry, x: event.clientX, y: event.clientY });
            }}
            onClick={() => {
              if (entry.kind === 'directory') {
                props.onSelect(entry.path);
                setExpanded((old) => {
                  const next = new Set(old);
                  if (next.has(entry.path)) next.delete(entry.path);
                  else next.add(entry.path);
                  return next;
                });
              } else props.onOpen(entry.path);
            }}
          >
            {entry.kind === 'directory' ? (
              <>
                {expanded.has(entry.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Folder size={15} />
              </>
            ) : (
              <>
                <span class="tree-spacer" />
                <FileIcon name={entry.name} />
              </>
            )}
            <span class="truncate">{entry.name}</span>
            <span
              class="row-menu"
              role="button"
              tabIndex={0}
              aria-label={`Actions for ${entry.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onMenu({ entry, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  onMenu({ entry, x: rect.x, y: rect.bottom });
                }
              }}
            >
              <MoreHorizontal size={14} />
            </span>
          </button>
          {entry.kind === 'directory' && expanded.has(entry.path) && (
            <Branch
              props={props}
              folder={entry.path}
              depth={depth + 1}
              descending={descending}
              onMenu={onMenu}
            />
          )}
        </div>
      ))}
    </div>
  );
}
export function Tree(props: Props) {
  const [descending, setDescending] = useState(false),
    [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    document.querySelector<HTMLElement>('.context-menu [role=menuitem]')?.focus();
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  const onMenu = (value: Menu) =>
    setMenu({
      ...value,
      x: Math.min(value.x, window.innerWidth - 205),
      y: Math.min(value.y, window.innerHeight - 300),
    });
  return (
    <>
      <div class="section-label">
        <button onClick={() => props.onSelect('')} class="plain">
          WORKSPACE FILES
        </button>
        <div>
          <button
            class="icon-button"
            title="New note"
            aria-label="New note"
            onClick={() => props.onAction('note')}
          >
            <Plus size={14} />
          </button>
          <button
            class="icon-button"
            title="New folder"
            aria-label="New folder"
            onClick={() => props.onAction('folder')}
          >
            <FolderPlus size={14} />
          </button>
          <button
            class="icon-button"
            title="Refresh workspace"
            aria-label="Refresh workspace"
            onClick={() => props.onAction('refresh')}
          >
            <RefreshCw size={13} />
          </button>
          <button
            class="icon-button"
            title="Reverse sort"
            aria-label="Reverse sort"
            onClick={() => setDescending((v) => !v)}
          >
            <ArrowDownAZ size={13} />
          </button>
        </div>
      </div>
      <div
        class="tree"
        role="tree"
        aria-label="Workspace files"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const from = event.dataTransfer?.getData('application/x-draft-path');
          if (from) props.onMove(from, '');
          else props.onImport(Array.from(event.dataTransfer?.files ?? []), '');
        }}
      >
        <Branch props={props} folder="" depth={0} descending={descending} onMenu={onMenu} />
      </div>
      {menu && (
        <div
          class="context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
              );
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
              ]?.focus();
            }
          }}
        >
          {(
            ['note', 'folder', 'rename', 'duplicate', 'move', 'copy', 'delete'] as Exclude<
              FileAction,
              'refresh'
            >[]
          )
            .filter((a) => a !== 'duplicate' || menu.entry.kind === 'file')
            .map((action) => (
              <button
                role="menuitem"
                class={action === 'delete' ? 'danger-text' : ''}
                onClick={() => {
                  props.onAction(action, menu.entry);
                  setMenu(null);
                }}
              >
                {
                  {
                    note: 'New Note',
                    folder: 'New Folder',
                    rename: 'Rename',
                    duplicate: 'Duplicate',
                    move: 'Move',
                    copy: 'Copy Path',
                    delete: 'Delete',
                  }[action]
                }
              </button>
            ))}
        </div>
      )}
    </>
  );
}
