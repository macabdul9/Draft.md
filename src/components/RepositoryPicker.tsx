import { useEffect, useRef, useState } from 'preact/hooks';
import { GitFork } from 'lucide-preact';
import { Dialog } from './Dialog';
import { supportsLocalFolders } from '../filesystem/native-filesystem';
import { parseRepository, type RepositoryProgress } from '../filesystem/repository';

export interface RepositoryRequest {
  url: string;
  reference: string;
  name: string;
  kind: 'local' | 'browser';
}
export function RepositoryPicker({
  onImport,
  onClose,
}: {
  onImport: (
    request: RepositoryRequest,
    signal: AbortSignal,
    progress: (value: RepositoryProgress) => void,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [reference, setReference] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'local' | 'browser'>('browser');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<RepositoryProgress>();
  const cancellation = useRef<AbortController>();
  const nameEdited = useRef(false);
  useEffect(() => () => cancellation.current?.abort(), []);
  const close = () => {
    if (busy) cancellation.current?.abort();
    else onClose();
  };
  return (
    <Dialog title="Import Repository" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const controller = new AbortController();
          cancellation.current = controller;
          setError('');
          setBusy(true);
          void onImport({ url, reference, name, kind }, controller.signal, setProgress)
            .catch((error: unknown) => {
              setError(
                error instanceof DOMException && error.name === 'AbortError'
                  ? 'Import cancelled before any workspace files were written.'
                  : error instanceof Error
                    ? error.message
                    : String(error),
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        <div class="repository-options">
          <p>
            <GitFork size={18} /> Download a public GitHub repository into a new workspace.
          </p>
          <fieldset disabled={busy}>
            <label>
              Repository URL
              <input
                autoFocus
                required
                value={url}
                placeholder="https://github.com/owner/repository"
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setUrl(value);
                  if (!nameEdited.current) {
                    try {
                      setName(parseRepository(value).repo);
                    } catch {
                      /* Wait for a complete URL. */
                    }
                  }
                }}
              />
            </label>
            <label>
              Branch, tag, or commit (optional)
              <input
                value={reference}
                placeholder="Default branch"
                onInput={(event) => setReference(event.currentTarget.value)}
              />
            </label>
            <label>
              Workspace name
              <input
                required
                value={name}
                onInput={(event) => {
                  nameEdited.current = true;
                  setName(event.currentTarget.value);
                }}
              />
            </label>
            <label>
              Storage
              <select
                value={kind}
                onChange={(event) => setKind(event.currentTarget.value as 'local' | 'browser')}
              >
                <option value="browser">Browser Workspace</option>
                <option value="local" disabled={!supportsLocalFolders()}>
                  New Local Folder
                </option>
              </select>
            </label>
          </fieldset>
          <small>
            {kind === 'local'
              ? 'Choose a parent folder. The import creates a new folder without overwriting existing files.'
              : 'Stored in this browser. Use Export ZIP to keep a backup outside the browser.'}
          </small>
          <small>
            This is a file download, with no Git history, pull, or push. Public GitHub repositories
            only. Symbolic links and submodules are skipped; Git LFS files remain pointers. Limits:
            5,000 files, 25 MB per file, 100 MB total.
          </small>
          {busy && progress && (
            <div role="status" aria-live="polite">
              {progress.stage}
              {progress.total > 0 && ` — ${progress.completed} / ${progress.total}`}
              {progress.total > 0 && <progress value={progress.completed} max={progress.total} />}
            </div>
          )}
          {error && (
            <p class="repository-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            {busy ? 'Cancel import' : 'Cancel'}
          </button>
          <button type="submit" class="primary" disabled={busy}>
            {busy ? 'Importing…' : 'Download repository'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
