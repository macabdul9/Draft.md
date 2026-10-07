import {
  FileText,
  FolderOpen,
  Plus,
  ChevronDown,
  Search,
  Star,
  Clock,
  Upload,
  Tag,
  Link2,
  LogOut,
  Download,
} from 'lucide-preact';

import { Tree } from '../components/Tree';

import type { useWorkspace } from './useWorkspace';

export function WorkspaceSidebar({
  preferences,
  setWorkspaceMenu,
  session,
  workspaceMenu,
  setDialog,
  backup,
  input,
  folderInput,
  showRecovery,
  closeWorkspace,
  navigation,
  setPalette,
  setNavigation,
  favorites,
  active,
  selected,
  setSelected,
  openFile,
  fileAction,
  moveInto,
  importFiles,
  revision,
  recentNotes,
  showKnowledge,
  indexing,
  resize,
  setPreferences,
}: Pick<
  ReturnType<typeof useWorkspace>,
  | 'preferences'
  | 'setWorkspaceMenu'
  | 'workspaceMenu'
  | 'setDialog'
  | 'backup'
  | 'input'
  | 'folderInput'
  | 'showRecovery'
  | 'closeWorkspace'
  | 'navigation'
  | 'setPalette'
  | 'setNavigation'
  | 'favorites'
  | 'active'
  | 'selected'
  | 'setSelected'
  | 'openFile'
  | 'fileAction'
  | 'moveInto'
  | 'importFiles'
  | 'revision'
  | 'recentNotes'
  | 'showKnowledge'
  | 'indexing'
  | 'resize'
  | 'setPreferences'
> & { session: NonNullable<ReturnType<typeof useWorkspace>['session']> }) {
  return (
    <aside class="sidebar" style={{ width: preferences.sidebarWidth }}>
      <div class="sidebar-workspace">
        <button onClick={() => setWorkspaceMenu((v) => !v)}>
          <span class="workspace-avatar">{session.record.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{session.record.name}</strong>
            <small>
              {session.record.kind === 'local' ? 'On your computer' : 'Stored in this browser'}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        {workspaceMenu && (
          <div class="context-menu workspace-menu">
            <button
              onClick={() => {
                setWorkspaceMenu(false);
                setDialog('workspace');
              }}
            >
              <FolderOpen size={14} />
              Switch workspace
            </button>
            <button
              onClick={() => {
                setWorkspaceMenu(false);
                setDialog('template');
              }}
            >
              <Plus size={14} />
              New workspace
            </button>
            <button
              onClick={() => {
                void backup();
              }}
            >
              <Download size={14} />
              Export ZIP / Back up
            </button>
            <button onClick={() => input.current?.click()}>
              <Upload size={14} />
              Import files / ZIP
            </button>
            <button onClick={() => folderInput.current?.click()}>
              <FolderOpen size={14} />
              Import folder
            </button>
            <button
              onClick={() => {
                void showRecovery();
                setWorkspaceMenu(false);
              }}
            >
              <Clock size={14} />
              Recovery drafts
            </button>
            <button
              onClick={() => {
                void closeWorkspace();
              }}
            >
              <LogOut size={14} />
              Close workspace
            </button>
          </div>
        )}
      </div>
      <nav class="sidebar-nav">
        {[
          { name: 'Files', icon: FolderOpen },
          { name: 'Search', icon: Search },
          { name: 'Favorites', icon: Star },
          { name: 'Recent', icon: Clock },
        ].map(({ name, icon: Icon }) => (
          <button
            class={navigation === name ? 'selected' : ''}
            onClick={() => {
              if (name === 'Search') setPalette('search');
              else setNavigation(name);
            }}
          >
            <Icon size={16} />
            <span>{name}</span>
            {name === 'Search' && <kbd>⌘ ⇧ F</kbd>}
            {name === 'Favorites' && favorites.length > 0 && (
              <span class="nav-count">{favorites.length}</span>
            )}
          </button>
        ))}
      </nav>
      <div class="sidebar-separator" />
      {navigation === 'Files' ? (
        <Tree
          fs={session.fs}
          active={active}
          selected={selected}
          onSelect={(folder) => {
            setSelected(folder);
          }}
          onOpen={(p) => {
            void openFile(p);
          }}
          onAction={(action, entry) => {
            void fileAction(action, entry);
          }}
          onMove={(from, to) => {
            void moveInto(from, to);
          }}
          onImport={(files, folder) => {
            void importFiles(files, folder);
          }}
          revision={revision}
          hidden={preferences.hidden}
        />
      ) : (
        <>
          <div class="section-label">{navigation.toUpperCase()}</div>
          <div class="tree">
            {(navigation === 'Favorites' ? favorites : recentNotes).map((p) => (
              <button
                class={`tree-row ${active === p ? 'active' : ''}`}
                onClick={() => {
                  void openFile(p);
                }}
              >
                <FileText size={15} />
                <span class="truncate">{p}</span>
              </button>
            ))}
            {!(navigation === 'Favorites' ? favorites : recentNotes).length && (
              <p class="quiet-empty">
                {navigation === 'Favorites'
                  ? 'Star a note to keep it close.'
                  : 'Your recently opened notes appear here.'}
              </p>
            )}
          </div>
        </>
      )}
      <div class="sidebar-bottom">
        <div>
          <button
            onClick={() => {
              void showKnowledge('Tags');
            }}
          >
            <Tag size={14} />
            Tags
          </button>
          <button
            onClick={() => {
              void showKnowledge('Backlinks');
            }}
          >
            <Link2 size={14} />
            Backlinks
          </button>
        </div>
        <button
          class="new-note-button"
          onClick={() => {
            void fileAction('note');
          }}
        >
          <Plus size={16} />
          New note<kbd>⌘ N</kbd>
        </button>
        <small>
          <span class="local-dot" />
          {indexing.done
            ? `${indexing.count} files indexed locally`
            : `Indexing locally · ${indexing.count} files`}
        </small>
      </div>
      <div
        class="sidebar-resize"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={resize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            setPreferences((p) => ({
              ...p,
              sidebarWidth: Math.max(
                200,
                Math.min(380, p.sidebarWidth + (event.key === 'ArrowRight' ? 10 : -10)),
              ),
            }));
        }}
      />
    </aside>
  );
}
