import { StartScreen } from './StartScreen';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { lazy, Suspense } from 'preact/compat';
import {
  FileText,
  FolderOpen,
  Plus,
  ChevronDown,
  Settings as SettingsIcon,
  Sun,
  Moon,
  PanelLeft,
  Command,
  BookOpen,
  ArrowLeft,
  Folder,
} from 'lucide-preact';

import { basename } from '../filesystem/adapter';
import { getRecovery } from '../storage/indexed-db';
import { download } from '../filesystem/archive';
import { Dialog, RequestDialog } from '../components/Dialog';
import { WorkspacePicker, TemplatePicker } from '../components/WorkspacePicker';

import { Tabs } from '../components/Tabs';
import { Palette } from '../components/Palette';
import { Settings } from '../components/Settings';
import { useWorkspace } from './useWorkspace';
import { RepositoryPicker } from '../components/RepositoryPicker';
const EditorPane = lazy(() => import('../components/EditorPane'));
const AssetViewer = lazy(() => import('../components/AssetViewer'));
export default function App() {
  const {
    focus,
    session,
    setDialog,
    setPalette,
    setPreferences,
    openFolder,
    recent,
    openRecent,
    ready,
    sidebar,
    preferences,
    setWorkspaceMenu,
    workspaceMenu,
    backup,
    input,
    folderInput,
    showRecovery,
    closeWorkspace,
    navigation,
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
    setSidebar,
    tabs,
    closeTab,
    setFocus,
    doc,
    toggleStar,
    openLink,
    notify,
    line,
    mode,
    setMode,
    showOutline,
    setShowOutline,
    exportAction,
    dialog,
    createWorkspace,
    importRepository,
    palette,
    commands,
    request,
    setRequest,
    permission,
    setPermission,
    knowledge,
    setKnowledge,
    toast,
    setToast,
    busy,
  } = useWorkspace();
  return (
    <div class={`app-shell ${focus ? 'focus-mode' : ''}`}>
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">
            <FileText size={17} />
          </span>
          <strong>
            Draft<span>.md</span>
          </strong>
        </div>
        {session && (
          <>
            <div class="topbar-divider" />
            <button class="workspace-switch" onClick={() => setDialog('workspace')}>
              <Folder size={14} />
              {session.record.name}
              <ChevronDown size={13} />
            </button>
            <span class="storage-label">
              {session.record.kind === 'local' ? 'Local folder' : 'Browser workspace'}
            </span>
          </>
        )}
        <div class="topbar-right">
          <button
            class="icon-button"
            aria-label="Command palette"
            title="Command palette"
            onClick={() => setPalette('command')}
          >
            <Command size={16} />
          </button>
          <button
            class="icon-button"
            aria-label="Switch theme"
            title="Switch theme"
            onClick={() =>
              setPreferences((p) => ({
                ...p,
                theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
              }))
            }
          >
            {document.documentElement.dataset.theme === 'dark' ? (
              <Sun size={16} />
            ) : (
              <Moon size={16} />
            )}
          </button>
          <button
            class="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setDialog('settings')}
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>
      {!session ? (
        <StartScreen {...{ openFolder, setDialog, recent, openRecent, ready }} />
      ) : (
        <>
          <div class="workspace-body">
            {sidebar && !focus && (
              <WorkspaceSidebar
                {...{
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
                }}
              />
            )}
            <main class="document-area">
              <div class="tabs-row">
                <button
                  class="icon-button"
                  aria-label="Toggle sidebar"
                  onClick={() => setSidebar((v) => !v)}
                >
                  <PanelLeft size={16} />
                </button>
                <Tabs
                  paths={tabs}
                  active={active}
                  controller={session.controller}
                  onOpen={(p) => {
                    void openFile(p);
                  }}
                  onClose={(p) => {
                    void closeTab(p);
                  }}
                  onNew={() => {
                    void fileAction('note');
                  }}
                />
                {focus && (
                  <button class="exit-focus" onClick={() => setFocus(false)}>
                    <ArrowLeft size={14} />
                    Exit focus
                  </button>
                )}
              </div>
              {active ? (
                <Suspense fallback={<div class="quiet-empty">Opening editor…</div>}>
                  {doc ? (
                    <EditorPane
                      doc={doc}
                      controller={session.controller}
                      workspaceName={session.record.name}
                      preferences={preferences}
                      starred={favorites.includes(active)}
                      onStar={toggleStar}
                      onFolder={(folder) => {
                        setSelected(folder);
                        setSidebar(true);
                        setNavigation('Files');
                      }}
                      onLink={(reference, wiki) => {
                        void openLink(reference, wiki);
                      }}
                      onError={notify}
                      onReferenceQuery={(query) => session.search.query(query, true)}
                      onIndexed={(p, text) => session.search.update(p, text)}
                      focus={focus}
                      onFocus={() => setFocus((v) => !v)}
                      line={line}
                      mode={mode}
                      onMode={setMode}
                      showOutline={showOutline}
                      onOutline={() => setShowOutline((v) => !v)}
                      exportAction={exportAction}
                    />
                  ) : (
                    <>
                      <div class="asset-breadcrumb">
                        {session.record.name} / {active}
                      </div>
                      <AssetViewer fs={session.fs} path={active} />
                    </>
                  )}
                </Suspense>
              ) : (
                <div
                  class="empty-editor"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void importFiles(Array.from(event.dataTransfer?.files ?? []));
                  }}
                >
                  <div class="empty-icon">
                    <BookOpen size={36} strokeWidth={1} />
                  </div>
                  <h2>{indexing.count ? 'Room for your next idea' : 'No notes yet'}</h2>
                  <p>
                    {indexing.count
                      ? 'Open a note from the sidebar, or start something new.'
                      : 'Create your first note.'}
                  </p>
                  <button
                    class="primary"
                    onClick={() => {
                      void fileAction('note');
                    }}
                  >
                    <Plus size={16} />
                    New Note
                  </button>
                  <div class="empty-shortcuts">
                    <span>
                      Find a note <kbd>⌘ P</kbd>
                    </span>
                    <span>
                      Commands <kbd>⌘ ⇧ P</kbd>
                    </span>
                  </div>
                  <button class="subtle-link" onClick={() => input.current?.click()}>
                    Import Markdown files or drop them here
                  </button>
                </div>
              )}
            </main>
          </div>
        </>
      )}
      <input
        hidden
        type="file"
        multiple
        ref={input}
        accept=".md,.markdown,.txt,.zip,.bib,.png,.jpg,.jpeg,.svg,.webp,.pdf"
        onChange={(e) => {
          void importFiles(Array.from(e.currentTarget.files ?? []));
        }}
      />
      <input
        hidden
        type="file"
        multiple
        ref={folderInput}
        {...{ webkitdirectory: true }}
        onChange={(e) => {
          void importFiles(Array.from(e.currentTarget.files ?? []), '');
        }}
      />
      {dialog === 'workspace' && (
        <WorkspacePicker
          recent={recent}
          onOpenFolder={() => {
            void openFolder();
          }}
          onRecent={(record) => {
            void openRecent(record);
          }}
          onNew={() => setDialog('template')}
          onRepository={() => setDialog('repository')}
          onClose={() => setDialog(null)}
        />
      )}{' '}
      {dialog === 'template' && (
        <TemplatePicker
          onCreate={(template, name, kind) => {
            void createWorkspace(template, name, kind);
          }}
          onClose={() => setDialog(null)}
        />
      )}{' '}
      {dialog === 'settings' && (
        <Settings value={preferences} onChange={setPreferences} onClose={() => setDialog(null)} />
      )}{' '}
      {dialog === 'repository' && (
        <RepositoryPicker onImport={importRepository} onClose={() => setDialog(null)} />
      )}
      {palette && (
        <Palette
          kind={palette}
          search={session?.search}
          commands={commands}
          onOpen={(p, line) => {
            void openFile(p, line);
          }}
          onClose={() => setPalette(null)}
        />
      )}{' '}
      {request && <RequestDialog request={request} onClose={() => setRequest(null)} />}{' '}
      {permission && (
        <Dialog title="Grant folder access" onClose={() => setPermission(null)}>
          <div class="dialog-body">
            <FolderOpen size={28} />
            <p>
              Draft.md needs permission to access <strong>{permission.name}</strong>.
            </p>
            <p>
              Your workspace and recent notes are still here. Grant access to continue editing the
              same files.
            </p>
          </div>
          <footer>
            <button onClick={() => setPermission(null)}>Cancel</button>
            <button
              class="primary"
              onClick={() => {
                void openRecent(permission, true);
              }}
            >
              Grant Access
            </button>
          </footer>
        </Dialog>
      )}
      {knowledge && (
        <Dialog title={knowledge.title} onClose={() => setKnowledge(null)}>
          <div class="knowledge-list">
            {knowledge.items.length ? (
              knowledge.items.map((item) => (
                <button
                  onClick={() => {
                    if (knowledge.title.startsWith('Recovery')) {
                      if (session)
                        void getRecovery(session.record.id, item.path).then((r) => {
                          if (r) download(new Blob([r.content]), basename(r.path));
                        });
                    } else void openFile(item.path);
                    setKnowledge(null);
                  }}
                >
                  <FileText size={15} />
                  {item.label}
                </button>
              ))
            ) : (
              <p class="quiet-empty">No matches yet.</p>
            )}
          </div>
        </Dialog>
      )}
      {toast && (
        <div class="toast" role="status" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
      {busy && (
        <div class="busy-indicator" role="status">
          Working locally…
        </div>
      )}
    </div>
  );
}
