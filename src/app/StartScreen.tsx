import {
  FileText,
  FolderOpen,
  Plus,
  Clock,
  HardDrive,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-preact';
import { supportsLocalFolders } from '../filesystem/native-filesystem';

import type { useWorkspace } from './useWorkspace';

export function StartScreen({
  openFolder,
  setDialog,
  recent,
  openRecent,
  ready,
}: Pick<
  ReturnType<typeof useWorkspace>,
  'openFolder' | 'setDialog' | 'recent' | 'openRecent' | 'ready'
>) {
  return (
    <main class="start-screen">
      <div class="start-content">
        <div class="start-monogram">
          <FileText size={32} strokeWidth={1.3} />
        </div>
        <h1>
          Draft<span>.md</span>
        </h1>
        <p class="tagline">Your research, in Markdown.</p>
        <div class="start-actions">
          <button
            class="primary"
            onClick={() => {
              void openFolder();
            }}
            disabled={!supportsLocalFolders()}
          >
            <FolderOpen size={17} />
            Open Folder<kbd>⌘ O</kbd>
          </button>
          <button onClick={() => setDialog('template')}>
            <Plus size={17} />
            New Workspace
          </button>
        </div>
        {!supportsLocalFolders() && (
          <p class="compatibility">
            Direct folder access isn’t available in this browser. Use browser-local storage, or open
            Draft.md in Chrome/Edge for direct folder editing.
          </p>
        )}
        <div class="start-recents">
          <div class="section-label">
            RECENT WORKSPACES
            <Clock size={13} />
          </div>
          {recent.map((record) => (
            <button
              class="workspace-row"
              onClick={() => {
                void openRecent(record);
              }}
            >
              <span class="workspace-icon">
                {record.kind === 'local' ? <FolderOpen size={19} /> : <HardDrive size={19} />}
              </span>
              <span>
                <strong>{record.name}</strong>
                <small>{record.kind === 'local' ? 'Local folder' : 'Browser workspace'}</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {ready && !recent.length && (
            <p class="recent-empty">Open a folder to pick up where you left off.</p>
          )}
        </div>
      </div>
      <div class="start-footer">
        <ShieldCheck size={14} />
        <span>Local files. No account. Just your work.</span>
      </div>
      <div class="start-bottom">
        <span>Plain text. Lasting ideas.</span>
        <button onClick={() => setDialog('settings')}>
          Keyboard shortcuts <kbd>⌘ ,</kbd>
        </button>
      </div>
    </main>
  );
}
