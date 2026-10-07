import { useState } from 'preact/hooks';
import { Dialog } from './Dialog';
import type { Preferences } from '../storage/preferences';
const shortcuts = [
  ['\\', 'Insert blocks, lists, tasks, and table actions'],
  ['@', 'Link a workspace note or insert a date'],
  ['↑ / ↓ · Enter / Tab · Esc', 'Navigate, accept, or dismiss editor suggestions'],
  ['⌘ / Ctrl N', 'New note'],
  ['⌘ / Ctrl S', 'Save immediately'],
  ['⌘ / Ctrl O', 'Open workspace'],
  ['⌘ / Ctrl P', 'Quick Open'],
  ['⌘ / Ctrl ⇧ P', 'Command Palette'],
  ['⌘ / Ctrl ⇧ F', 'Search workspace'],
  ['⌘ / Ctrl B / I / K', 'Bold / italic / link'],
  ['⌘ / Ctrl ,', 'Settings'],
  ['⌘ / Ctrl ⇧ Enter', 'Focus mode'],
  ['⌘ / Ctrl W / Tab / ⇧ T', 'Close / next / reopen tab (browser permitting)'],
];
export function Settings({
  value,
  onChange,
  onClose,
}: {
  value: Preferences;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState('Appearance');
  const set = <K extends keyof Preferences>(key: K, next: Preferences[K]) =>
    onChange({ ...value, [key]: next });
  const toggle = (
    key: 'wrap' | 'spellcheck' | 'hidden' | 'math' | 'mermaid' | 'wiki' | 'callouts' | 'typewriter',
    label: string,
  ) => (
    <label class="setting-toggle">
      {label}
      <input
        type="checkbox"
        checked={value[key]}
        onChange={(event) => set(key, event.currentTarget.checked)}
      />
    </label>
  );
  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div class="picker-layout settings-layout">
        <nav>
          {['Appearance', 'Editor', 'Files', 'Markdown', 'Keyboard', 'Advanced'].map((s) => (
            <button class={s === section ? 'selected' : ''} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </nav>
        <div class="picker-main">
          <h3>{section}</h3>
          {section === 'Appearance' && (
            <>
              <label>
                Theme
                <select
                  value={value.theme}
                  onChange={(e) => set('theme', e.currentTarget.value as Preferences['theme'])}
                >
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label>
                Density
                <select
                  value={value.density}
                  onChange={(e) => set('density', e.currentTarget.value as Preferences['density'])}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              <label>
                Sidebar width
                <input
                  type="range"
                  min="200"
                  max="380"
                  value={value.sidebarWidth}
                  onInput={(e) => set('sidebarWidth', Number(e.currentTarget.value))}
                />
              </label>
            </>
          )}
          {section === 'Editor' && (
            <>
              <label>
                Writing font
                <select
                  value={value.font}
                  onChange={(e) => set('font', e.currentTarget.value as Preferences['font'])}
                >
                  <option value="sans">System sans</option>
                  <option value="serif">Georgia / serif</option>
                  <option value="mono">System monospace</option>
                </select>
              </label>
              <label>
                Font size
                <input
                  type="number"
                  min="12"
                  max="32"
                  value={value.fontSize}
                  onChange={(e) =>
                    set('fontSize', Math.max(12, Math.min(32, Number(e.currentTarget.value))))
                  }
                />
              </label>
              <label>
                Line height
                <input
                  type="number"
                  min="1.2"
                  max="2.5"
                  step="0.1"
                  value={value.lineHeight}
                  onChange={(e) => set('lineHeight', Number(e.currentTarget.value))}
                />
              </label>
              <label>
                Tab width
                <input
                  type="number"
                  min="2"
                  max="8"
                  value={value.tabWidth}
                  onChange={(e) => set('tabWidth', Number(e.currentTarget.value))}
                />
              </label>
              {toggle('wrap', 'Wrap long lines')}
              {toggle('spellcheck', 'Browser spellcheck')}
              {toggle('typewriter', 'Typewriter scrolling')}
            </>
          )}
          {section === 'Files' && (
            <>
              <label>
                Autosave delay (ms)
                <input
                  type="number"
                  min="300"
                  max="5000"
                  value={value.autosave}
                  onChange={(e) => set('autosave', Math.max(300, Number(e.currentTarget.value)))}
                />
              </label>
              <label>
                Assets folder (workspace-relative)
                <input
                  value={value.assets}
                  onChange={(e) => set('assets', e.currentTarget.value)}
                />
              </label>
              {toggle('hidden', 'Show hidden files')}
              <p>
                Deletion always asks for confirmation. Files are permanently removed;
                operating-system Trash is unavailable.
              </p>
            </>
          )}
          {section === 'Markdown' && (
            <>
              {toggle('math', 'LaTeX math')}
              {toggle('mermaid', 'Mermaid diagrams')}
              {toggle('wiki', 'Wiki links')}
              {toggle('callouts', 'Callouts')}
              <p>Code is never executed. Remote images and embedded content are blocked.</p>
            </>
          )}
          {section === 'Keyboard' && (
            <>
              <div class="shortcut-list">
                {shortcuts.map(([key, label]) => (
                  <div>
                    <span>{label}</span>
                    <kbd>{key}</kbd>
                  </div>
                ))}
              </div>
              <p>
                Some shortcuts are reserved by browsers. Every action also has a visible control or
                palette command.
              </p>
            </>
          )}
          {section === 'Advanced' && (
            <>
              <p>
                Your files stay on your device. Workspace handles, preferences, and temporary
                recovery drafts are stored in IndexedDB.
              </p>
              <button
                onClick={() => {
                  void navigator.storage
                    ?.persist?.()
                    .then((granted) =>
                      alert(
                        granted
                          ? 'Persistent browser storage granted. Continue to back up regularly.'
                          : 'The browser did not grant persistent storage. Export ZIP regularly.',
                      ),
                    );
                }}
              >
                Request persistent browser storage
              </button>
              <p>
                For permission errors, reopen the workspace and choose Grant Access. To back up a
                browser workspace, use Export ZIP in the workspace menu.
              </p>
            </>
          )}
        </div>
      </div>
      <footer>
        <button class="primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
