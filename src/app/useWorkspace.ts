import { useEffect, useRef, useState } from 'preact/hooks';
import { NativeFileSystemAdapter, supportsLocalFolders } from '../filesystem/native-filesystem';
import { browserAdapter } from '../filesystem/browser-filesystem';
import {
  basename,
  join,
  parent,
  path,
  uniquePath,
  copyEntry,
  resolveAsset,
  isText,
  walk,
  type Entry,
  type WorkspaceFileSystem,
} from '../filesystem/adapter';
import {
  recentWorkspaces,
  remember,
  getRecovery,
  putRecovery,
  clearRecovery,
  listRecovery,
  loadPreference,
  storePreference,
  type WorkspaceRecord,
} from '../storage/indexed-db';
import { defaults, type Preferences } from '../storage/preferences';
import { DocumentController, type DocumentRecord } from '../state/documents';
import { SearchClient } from '../search/client';
import { download, exportZip, importZip, ensureDirectory } from '../filesystem/archive';
import type { RequestSpec } from '../components/Dialog';
import type { Template } from '../components/WorkspacePicker';
import type { FileAction } from '../components/Tree';
import type { CommandItem } from '../components/Palette';
import type { EditorMode } from '../editor/markdown-editor';
import { noteTemplates } from '../editor/note-templates';
import {
  downloadRepository,
  parseRepository,
  writeRepository,
  type RepositoryProgress,
} from '../filesystem/repository';
import type { RepositoryRequest } from '../components/RepositoryPicker';
export interface Session {
  record: WorkspaceRecord;
  fs: WorkspaceFileSystem;
  controller: DocumentController;
  search: SearchClient;
}
export function useWorkspace() {
  const [recent, setRecent] = useState<WorkspaceRecord[]>([]),
    [session, setSession] = useState<Session | null>(null),
    [tabs, setTabs] = useState<string[]>([]),
    [active, setActive] = useState(''),
    [doc, setDoc] = useState<DocumentRecord | null>(null),
    [selected, setSelected] = useState(''),
    [revision, setRevision] = useState(0),
    [preferences, setPreferences] = useState<Preferences>(defaults),
    [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<'workspace' | 'template' | 'settings' | 'repository' | null>(
      null,
    ),
    [palette, setPalette] = useState<'quick' | 'command' | 'search' | null>(null),
    [request, setRequest] = useState<RequestSpec | null>(null),
    [permission, setPermission] = useState<WorkspaceRecord | null>(null),
    [toast, setToast] = useState(''),
    [navigation, setNavigation] = useState('Files'),
    [sidebar, setSidebar] = useState(true),
    [showOutline, setShowOutline] = useState(true),
    [focus, setFocus] = useState(false),
    [mode, setMode] = useState<EditorMode>('split'),
    [line, setLine] = useState(0),
    [favorites, setFavorites] = useState<string[]>([]),
    [recentNotes, setRecentNotes] = useState<string[]>([]),
    [workspaceMenu, setWorkspaceMenu] = useState(false),
    [indexing, setIndexing] = useState({ count: 0, done: false }),
    [exportAction, setExportAction] = useState(0),
    [knowledge, setKnowledge] = useState<{
      title: string;
      items: { path: string; label: string }[];
    } | null>(null),
    [busy, setBusy] = useState(false);
  const closed = useRef<string[]>([]),
    input = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    openToken = useRef(0),
    workspaceToken = useRef(0),
    latest = useRef({ session, tabs, active, favorites, recentNotes });
  latest.current = { session, tabs, active, favorites, recentNotes };
  useEffect(() => {
    void Promise.all([recentWorkspaces(), loadPreference<Preferences>('ui')])
      .then(([records, prefs]) => {
        setRecent(records);
        if (prefs) setPreferences({ ...defaults, ...prefs });
        setReady(true);
      })
      .catch((error) => {
        setToast(`Browser storage unavailable: ${String(error)}`);
        setReady(true);
      });
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (root.dataset.theme =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme);
    apply();
    media.addEventListener('change', apply);
    root.dataset.density = preferences.density;
    root.style.setProperty(
      '--editor-font',
      preferences.font === 'serif'
        ? 'Georgia, serif'
        : preferences.font === 'mono'
          ? 'ui-monospace, SFMono-Regular, monospace'
          : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    root.style.setProperty('--editor-size', `${preferences.fontSize}px`);
    root.style.setProperty('--editor-line-height', String(preferences.lineHeight));
    if (session) session.controller.delay = preferences.autosave;
    void storePreference('ui', preferences).catch(() => undefined);
    return () => media.removeEventListener('change', apply);
  }, [preferences]);
  useEffect(() => {
    if (!session) return;
    const record = { ...session.record, tabs, active, favorites, recent: recentNotes };
    session.record = record;
    void remember(record).catch((error) => notify(String(error)));
  }, [session, tabs, active, favorites, recentNotes]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const changed = () => setRevision((v) => v + 1);
    window.addEventListener('draft-files-changed', changed);
    return () => window.removeEventListener('draft-files-changed', changed);
  }, []);
  useEffect(() => {
    if (!session) return;
    const warn = (event: BeforeUnloadEvent) => {
      if ([...session.controller.documents.values()].some((doc) => doc.status !== 'saved')) {
        event.preventDefault();
        event.returnValue = '';
        void session.controller.checkpointAll();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);
  const notify = (message: string) => setToast(message);
  const ask = (
    title: string,
    initial?: string,
    message?: string,
    confirm?: string,
    danger = false,
    choice?: RequestSpec['choice'],
  ) =>
    new Promise<string | null>((resolve) =>
      setRequest({ title, initial, message, confirm, danger, choice, resolve }),
    );
  async function activate(record: WorkspaceRecord, fs: WorkspaceFileSystem) {
    const token = ++workspaceToken.current;
    const old = latest.current.session;
    if (old) {
      await old.controller.flush();
      old.controller.dispose();
      old.search.dispose();
    }
    if (token !== workspaceToken.current) return;
    openToken.current++;
    setDoc(null);
    setActive('');
    setTabs([]);
    setSelected('');
    closed.current = [];
    const controller = new DocumentController(fs, preferences.autosave, {
      put: (path, content, baseline) =>
        putRecovery({ workspace: record.id, path, content, baseline, updated: Date.now() }),
      clear: (path) => clearRecovery(record.id, path),
    });
    const search = new SearchClient();
    const next = { record: { ...record, lastOpened: Date.now() }, fs, controller, search };
    setSession(next);
    latest.current.session = next;
    setFavorites(record.favorites ?? []);
    setRecentNotes(record.recent ?? []);
    setDialog(null);
    setPermission(null);
    setNavigation('Files');
    setRevision((v) => v + 1);
    setIndexing({ count: 0, done: false });
    search.onError = (message) => notify('Indexing interrupted: ' + message);
    search.onProgress = (count, done) => setIndexing({ count, done });
    await remember(next.record);
    const records = await recentWorkspaces();
    if (token !== workspaceToken.current) return;
    setRecent(records);
    void search
      .index(fs, fs instanceof NativeFileSystemAdapter ? fs.root : undefined)
      .catch((error) => notify(`Indexing interrupted: ${String(error)}`));
    const paths = record.tabs ?? [];
    for (const p of paths) {
      try {
        if (isText(p)) await controller.open(p);
      } catch {
        /* Missing tabs do not prevent opening the workspace. */
      }
    }
    const recovery = await listRecovery(record.id);
    if (token !== workspaceToken.current) return;
    const assetTabs = paths.filter((p) => !isText(p));
    const presentAssets = (
      await Promise.all(assetTabs.map(async (p) => ((await fs.exists(p)) ? p : null)))
    ).filter((p): p is string => p !== null);
    const valid = [
      ...new Set([
        ...paths.filter((p) => controller.documents.has(p)),
        ...presentAssets,
        ...recovery.map((r) => r.path),
      ]),
    ];
    setTabs(valid);
    for (const saved of recovery) {
      try {
        const d = await controller.open(saved.path);
        if (saved.content !== d.baseline) {
          controller.restore(d, saved.content, saved.baseline);
          if (d.baseline !== (await fs.readText(d.path))) {
            d.disk = await fs.readText(d.path);
            d.status = 'conflict';
          }
        }
      } catch {
        notify(
          `Recovery draft retained for unavailable file “${saved.path}”. Use Recovery drafts in the workspace menu to download it.`,
        );
      }
    }
    const first = record.active && valid.includes(record.active) ? record.active : valid[0];
    if (first) await openFile(first, 1, next);
  }
  async function openFolder() {
    if (!supportsLocalFolders()) {
      setDialog('workspace');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const records = await recentWorkspaces();
      let record: WorkspaceRecord | undefined;
      for (const r of records)
        if (r.handle && (await r.handle.isSameEntry(handle))) {
          record = r;
          break;
        }
      record ??= {
        id: crypto.randomUUID(),
        name: handle.name,
        kind: 'local',
        handle,
        lastOpened: Date.now(),
      };
      await activate({ ...record, handle }, new NativeFileSystemAdapter(handle));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(String(error));
    }
  }
  async function openRecent(record: WorkspaceRecord, grant = false) {
    try {
      if (record.kind === 'browser') {
        await activate(record, await browserAdapter(record.id));
        return;
      }
      if (!record.handle)
        throw new Error(
          'This workspace handle is unavailable. Choose the same folder with Open Folder.',
        );
      const fs = new NativeFileSystemAdapter(record.handle),
        state = await fs.permission(grant);
      if (state !== 'granted') {
        setPermission(record);
        if (state === 'denied')
          notify('Folder access was denied. You can retry or select the folder again.');
        return;
      }
      await activate(record, fs);
    } catch (error) {
      notify(String(error));
    }
  }
  async function createWorkspace(template: Template, name: string, kind: 'local' | 'browser') {
    try {
      name = path(name.trim());
      if (!name || name.includes('/')) throw new Error('Use a single folder name.');
      let fs: WorkspaceFileSystem;
      let handle: FileSystemDirectoryHandle | undefined;
      const id = crypto.randomUUID();
      if (kind === 'local') {
        const root = await window.showDirectoryPicker({ mode: 'readwrite' }),
          adapter = new NativeFileSystemAdapter(root);
        const destination = await uniquePath(adapter, name);
        handle = await root.getDirectoryHandle(destination, { create: true });
        name = destination;
        fs = new NativeFileSystemAdapter(handle);
      } else fs = await browserAdapter(id);
      setBusy(true);
      for (const folder of template.folders) await fs.createDirectory(folder);
      for (const [file, text] of Object.entries(template.files))
        await fs.createFile(
          file,
          text.replaceAll('{{date}}', new Date().toLocaleDateString('en-CA')),
        );
      await activate({ id, name, kind, handle, lastOpened: Date.now() }, fs);
      const first = Object.keys(template.files).find((p) => p.endsWith('.md'));
      if (first) await openFile(first, 1, latest.current.session!);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function importRepository(
    request: RepositoryRequest,
    signal: AbortSignal,
    progress: (value: RepositoryProgress) => void,
  ) {
    const source = parseRepository(request.url);
    const name = path(request.name.trim());
    if (!name || name.includes('/')) throw new Error('Use a single workspace folder name.');
    // The picker must run before network awaits to retain browser user activation.
    const root =
      request.kind === 'local'
        ? await window.showDirectoryPicker({ mode: 'readwrite' })
        : undefined;
    const snapshot = await downloadRepository(source, request.reference, signal, progress);
    signal.throwIfAborted();
    await latest.current.session?.controller.flush();
    const id = crypto.randomUUID();
    let fs: WorkspaceFileSystem;
    let handle: FileSystemDirectoryHandle | undefined;
    let destination = name;
    if (root) {
      destination = await uniquePath(new NativeFileSystemAdapter(root), name);
      handle = await root.getDirectoryHandle(destination, { create: true });
      fs = new NativeFileSystemAdapter(handle);
    } else fs = await browserAdapter(id);
    const record: WorkspaceRecord = {
      id,
      name: destination,
      kind: request.kind,
      handle,
      lastOpened: Date.now(),
    };
    try {
      await writeRepository(fs, snapshot, signal, progress);
      signal.throwIfAborted();
      await activate(record, fs);
      const readme = snapshot.files.find((file) => /^readme\.(md|markdown)$/i.test(file.path));
      const first = readme ?? snapshot.files.find((file) => /\.(md|markdown)$/i.test(file.path));
      if (first) await openFile(first.path, 1, latest.current.session!);
      notify(
        `Imported ${snapshot.files.length} files from ${source.owner}/${source.repo} (${snapshot.commit.slice(0, 7)}).${snapshot.skipped ? ` Skipped ${snapshot.skipped} symbolic links or submodules.` : ''}`,
      );
    } catch (error) {
      // Preserve partial imports and make them reopenable; never delete recovered bytes.
      await remember(record).catch(() => undefined);
      setRecent(await recentWorkspaces());
      throw new Error(
        `Import did not finish. Any saved files remain in “${destination}”, available in Recent Workspaces. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  async function openFile(filePath: string, targetLine = 0, current = latest.current.session) {
    if (!current) return;
    const token = ++openToken.current;
    try {
      let document: DocumentRecord | null = null;
      if (isText(filePath)) document = await current.controller.open(filePath);
      else await current.fs.stat(filePath);
      if (token !== openToken.current || current !== latest.current.session) return;
      const saved = await getRecovery(current.record.id, filePath);
      if (token !== openToken.current || current !== latest.current.session) return;
      if (document && saved && document.status === 'saved' && saved.content !== document.baseline) {
        current.controller.restore(document, saved.content, saved.baseline);
      }
      setTabs((old) => (old.includes(filePath) ? old : [...old, filePath]));
      setActive(filePath);
      if (window.innerWidth < 580) setSidebar(false);
      setDoc(document);
      setLine(targetLine);
      setSelected(parent(filePath));
      setRecentNotes((old) => [filePath, ...old.filter((p) => p !== filePath)].slice(0, 30));
    } catch (error) {
      notify(`Could not open “${filePath}”: ${String(error)}`);
    }
  }
  async function closeTab(filePath: string) {
    const current = latest.current.session;
    if (!current) return;
    try {
      await current.controller.close(filePath);
      const remaining = latest.current.tabs.filter((p) => p !== filePath);
      setTabs(remaining);
      closed.current.push(filePath);
      if (latest.current.active === filePath) {
        setDoc(null);
        setActive('');
        if (remaining.length) await openFile(remaining.at(-1)!);
      }
    } catch (error) {
      notify(`Tab kept open to preserve pending edits. ${String(error)}`);
    }
  }
  async function closeWorkspace() {
    if (!session) return;
    try {
      await session.controller.flush();
      session.controller.dispose();
      session.search.dispose();
      setSession(null);
      latest.current.session = null;
      setTabs([]);
      setActive('');
      setDoc(null);
      setWorkspaceMenu(false);
    } catch (error) {
      notify(`Workspace kept open to preserve unsaved text. ${String(error)}`);
    }
  }
  async function refresh() {
    if (!session) return;
    setRevision((v) => v + 1);
    await session.controller.checkExternal();
    void session.search.index(
      session.fs,
      session.fs instanceof NativeFileSystemAdapter ? session.fs.root : undefined,
    );
  }
  async function fileAction(action: FileAction, entry?: Entry) {
    const current = latest.current.session;
    if (!current) return;
    try {
      const fs = current.fs;
      if (action === 'refresh') {
        await refresh();
        return;
      }
      if (action === 'copy') {
        if (!entry?.path) {
          await refresh();
          return;
        }
        await navigator.clipboard.writeText(entry.path);
        notify('Relative path copied.');
        return;
      }
      if (action === 'note' || action === 'folder') {
        const folder = entry
          ? entry.kind === 'directory'
            ? entry.path
            : parent(entry.path)
          : selected;
        if (action === 'note') {
          const destination = await uniquePath(fs, join(folder, 'Untitled.md'));
          let templateId = 'blank';
          const name = await ask(
            'Name your note',
            basename(destination),
            undefined,
            'Create note',
            false,
            {
              label: 'Template',
              options: noteTemplates,
              onChange: (value) => {
                templateId = value;
              },
            },
          );
          if (!name) return;
          const target = join(folder, name.endsWith('.md') ? name : `${name}.md`);
          const template = noteTemplates.find((item) => item.id === templateId)!;
          await fs.createFile(target, template.content);
          setRevision((v) => v + 1);
          await openFile(target);
        } else {
          const name = await ask('New folder', 'Untitled folder');
          if (name) await fs.createDirectory(join(folder, name));
        }
      } else if (entry) {
        await current.controller.flush();
        if (action === 'delete') {
          const confirmed = await ask(
            `Delete “${entry.name}”?`,
            undefined,
            `This permanently removes ${entry.kind === 'directory' ? 'the folder and everything inside it' : 'the file'} ${current.record.kind === 'local' ? 'from your computer' : 'from browser storage'}. Operating-system Trash is not available.`,
            'Delete permanently',
            true,
          );
          if (!confirmed) return;
          await fs.delete(entry.path);
          for (const p of [...latest.current.tabs])
            if (p === entry.path || p.startsWith(`${entry.path}/`)) {
              current.controller.documents.delete(p);
              setTabs((old) => old.filter((value) => value !== p));
              if (latest.current.active === p) {
                setActive('');
                setDoc(null);
              }
            }
          setFavorites((old) =>
            old.filter((p) => p !== entry.path && !p.startsWith(`${entry.path}/`)),
          );
        } else if (action === 'duplicate') {
          const destination = await uniquePath(fs, join(parent(entry.path), entry.name));
          await copyEntry(fs, entry.path, destination);
          await openFile(destination);
        } else {
          const input = await ask(
            action === 'rename' ? 'Rename' : 'Move to workspace-relative path',
            action === 'rename' ? entry.name : entry.path,
            action === 'move'
              ? 'Include the destination filename. Existing files are never overwritten.'
              : undefined,
          );
          if (!input) return;
          const destination = action === 'rename' ? join(parent(entry.path), input) : path(input);
          if (destination === entry.path) return;
          await fs.move(entry.path, destination);
          await updateMoved(entry.path, destination, current);
        }
      }
      await refresh();
    } catch (error) {
      notify(String(error));
      setRevision((v) => v + 1);
    }
  }
  async function updateMoved(from: string, to: string, current: Session) {
    const opened = latest.current.tabs.filter((p) => p === from || p.startsWith(`${from}/`));
    for (const p of opened) {
      await current.controller.close(p);
      setTabs((old) => old.filter((value) => value !== p));
      await openFile(to + p.slice(from.length));
    }
    setFavorites((old) =>
      old.map((p) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)),
    );
  }
  async function moveInto(from: string, folder: string) {
    const current = latest.current.session;
    if (!current) return;
    try {
      await current.controller.flush();
      const destination = join(folder, basename(from));
      await current.fs.move(from, destination);
      await updateMoved(from, destination, current);
      await refresh();
    } catch (error) {
      notify(String(error));
      setRevision((v) => v + 1);
    }
  }
  async function importFiles(files: File[], folder = selected) {
    const current = latest.current.session;
    if (!current) return;
    setBusy(true);
    try {
      const importedRoots = new Map<string, string>();
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip') && !file.webkitRelativePath) {
          const imported = await importZip(current.fs, file);
          notify(`ZIP imported into “${imported}” with original relative paths.`);
        } else {
          let requested: string;
          if (file.webkitRelativePath) {
            const [root, ...parts] = path(file.webkitRelativePath).split('/');
            let destination = importedRoots.get(root);
            if (!destination) {
              destination = await uniquePath(current.fs, join(folder, root));
              await current.fs.createDirectory(destination);
              importedRoots.set(root, destination);
            }
            requested = join(destination, ...parts);
          } else requested = join(folder, path(file.name));
          const target = await uniquePath(current.fs, requested);
          await ensureDirectory(current.fs, parent(target));
          await current.fs.createFile(target, file);
        }
      }
      await refresh();
      notify(`${files.length} file${files.length === 1 ? '' : 's'} imported.`);
    } catch (error) {
      notify(`Import stopped. Previously imported files were retained. ${String(error)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  }
  async function backup() {
    if (!session) return;
    setWorkspaceMenu(false);
    setBusy(true);
    try {
      await session.controller.flush();
      download(await exportZip(session.fs), `${session.record.name}.zip`);
      notify('Workspace backup downloaded.');
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function showRecovery() {
    if (!session) return;
    const entries = await listRecovery(session.record.id);
    setKnowledge({
      title: 'Recovery drafts — select to download',
      items: entries.map((e) => ({
        path: e.path,
        label: `${e.path} · ${new Date(e.updated).toLocaleString()}`,
      })),
    });
  }
  async function showKnowledge(kind: 'Tags' | 'Backlinks') {
    if (!session) return;
    if (doc) session.search.update(doc.path, session.controller.content(doc));
    setKnowledge({ title: kind, items: await session.search.knowledge(kind, active) });
  }
  async function openLink(reference: string, wiki: boolean) {
    if (!session || !active) return;
    try {
      if (!wiki) {
        await openFile(resolveAsset(active, reference));
        return;
      }
      const [target, heading] = reference.split('#');
      const entries = (await walk(session.fs)).filter(
        (e) => e.kind === 'file' && /\.md$/i.test(e.name),
      );
      const matches = entries.filter(
        (e) =>
          e.path.replace(/\.md$/i, '').toLowerCase() === target.toLowerCase() ||
          basename(e.path).replace(/\.md$/i, '').toLowerCase() === target.toLowerCase(),
      );
      if (matches.length > 1) {
        setKnowledge({
          title: `Choose a match for “${target}”`,
          items: matches.map((e) => ({ path: e.path, label: e.path })),
        });
        return;
      }
      if (!matches.length) {
        notify(`No note matches “${target}”.`);
        return;
      }
      let targetLine = 1;
      if (heading) {
        const text = await session.fs.readText(matches[0].path);
        const idx = text
          .split('\n')
          .findIndex((l) => l.replace(/^#+\s*/, '').toLowerCase() === heading.toLowerCase());
        if (idx >= 0) targetLine = idx + 1;
      }
      await openFile(matches[0].path, targetLine);
    } catch (error) {
      notify(String(error));
    }
  }
  const commands: CommandItem[] = [
    {
      name: 'New Note',
      shortcut: '⌘ N',
      run: () => {
        void fileAction('note');
      },
    },
    {
      name: 'New Folder',
      run: () => {
        void fileAction('folder');
      },
    },
    {
      name: 'Open Folder',
      shortcut: '⌘ O',
      run: () => {
        void openFolder();
      },
    },
    { name: 'Switch Workspace', run: () => setDialog('workspace') },
    {
      name: 'Close Workspace',
      run: () => {
        void closeWorkspace();
      },
    },
    {
      name: 'Rename File',
      run: () => {
        if (active)
          void fileAction('rename', { path: active, name: basename(active), kind: 'file' });
      },
    },
    {
      name: 'Delete File',
      run: () => {
        if (active)
          void fileAction('delete', { path: active, name: basename(active), kind: 'file' });
      },
    },
    { name: 'Import Repository', run: () => setDialog('repository') },
    { name: 'Toggle Sidebar', run: () => setSidebar((v) => !v) },
    { name: 'Toggle Outline', run: () => setShowOutline((v) => !v) },
    { name: 'Toggle Preview', run: () => setMode((v) => (v === 'preview' ? 'rich' : 'preview')) },
    {
      name: 'Switch Theme',
      run: () => setPreferences((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' })),
    },
    {
      name: 'Search Workspace',
      shortcut: '⌘ ⇧ F',
      run: () => setTimeout(() => setPalette('search'), 0),
    },
    { name: 'Export PDF', run: () => setExportAction((v) => v + 1) },
    {
      name: 'Copy File Path',
      run: () => {
        if (active) void navigator.clipboard.writeText(active);
      },
    },
    { name: 'Open Settings', shortcut: '⌘ ,', run: () => setDialog('settings') },
    {
      name: 'Export Workspace ZIP',
      run: () => {
        void backup();
      },
    },
    {
      name: 'Reopen Closed Tab',
      run: () => {
        const p = closed.current.pop();
        if (p) void openFile(p);
      },
    },
    { name: 'Focus Mode', run: () => setFocus((v) => !v) },
    {
      name: 'Browse Tags',
      run: () => {
        void showKnowledge('Tags');
      },
    },
    {
      name: 'Show Backlinks',
      run: () => {
        void showKnowledge('Backlinks');
      },
    },
  ];
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceMenu(false);
        return;
      }
      if ((event.target as HTMLElement).closest('dialog') || !(event.metaKey || event.ctrlKey))
        return;
      const k = event.key.toLowerCase();
      if (k === 'n') {
        event.preventDefault();
        if (session) void fileAction('note');
        else setDialog('template');
      } else if (k === 's') {
        event.preventDefault();
        if (doc && session)
          void session.controller.save(doc).catch((error) => notify(String(error)));
      } else if (k === 'o') {
        event.preventDefault();
        setDialog('workspace');
      } else if (k === 'p') {
        event.preventDefault();
        setPalette(event.shiftKey ? 'command' : 'quick');
      } else if (k === 'f' && event.shiftKey) {
        event.preventDefault();
        setPalette('search');
      } else if (k === ',') {
        event.preventDefault();
        setDialog('settings');
      } else if (k === 'enter' && event.shiftKey) {
        event.preventDefault();
        setFocus((v) => !v);
      } else if (k === 'w' && active) {
        event.preventDefault();
        void closeTab(active);
      } else if (k === 'tab' && tabs.length) {
        event.preventDefault();
        void openFile(
          tabs[(tabs.indexOf(active) + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length],
        );
      } else if (k === 't' && event.shiftKey) {
        event.preventDefault();
        const p = closed.current.pop();
        if (p) void openFile(p);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const toggleStar = () =>
    setFavorites((old) =>
      old.includes(active) ? old.filter((p) => p !== active) : [...old, active],
    );
  const resize = (event: PointerEvent) => {
    const start = event.clientX,
      width = preferences.sidebarWidth;
    const move = (e: PointerEvent) =>
      setPreferences((p) => ({
        ...p,
        sidebarWidth: Math.max(200, Math.min(380, width + e.clientX - start)),
      }));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  return {
    importRepository,
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
  };
}
