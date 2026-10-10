import { useEffect, useState } from 'preact/hooks';
import { LocalModels } from './LocalModels';
import { LocalModelClient } from '../agents/local-models';
import { agentSettings, rememberAgent } from '../agents/preferences';
import { isLocalEngine, providers, type AgentProvider } from '../agents/providers';
import { loadPreference, storePreference } from '../storage/indexed-db';

export function AgentSettings() {
  const [provider, setProvider] = useState<AgentProvider>('ollama');
  const [localSettingsKey, setLocalSettingsKey] = useState(0);
  const [installed, setInstalled] = useState<Record<string, { installed: boolean }>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadPreference<AgentProvider>('ai-writing-provider'), agentSettings()]).then(
      ([saved, local]) => {
        if (!cancelled) {
          setProvider(saved && saved in providers ? saved : local.engine);
          setLocalSettingsKey((key) => key + 1);
        }
      },
    );
    void LocalModelClient.connect()
      .then((client) => client.agentRequest<Record<string, { installed: boolean }>>())
      .then((result) => {
        if (!cancelled) setInstalled(result);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <label>
        Default for @agent
        <select
          aria-label="Default agent"
          value={provider}
          onChange={(event) => {
            const next = event.currentTarget.value as AgentProvider;
            setProvider(next);
            setLocalSettingsKey((key) => key + 1);
            void storePreference('ai-writing-provider', next);
            if (isLocalEngine(next)) void rememberAgent(next, {});
          }}
        >
          {Object.entries(providers).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {isLocalEngine(provider) ? (
        <LocalModels
          key={localSettingsKey}
          initialEngine={provider}
          onEngineChange={(next) => {
            setProvider(next);
            void storePreference('ai-writing-provider', next);
            void rememberAgent(next, {});
          }}
        />
      ) : provider === 'codex' || provider === 'claudecode' ? (
        <>
          <p>
            Uses your installed {provider === 'codex' ? 'Codex' : 'Claude Code'} CLI and its
            existing login. Writing streams directly into your note.
          </p>
          <p role="status">
            {error ||
              (installed[provider]
                ? installed[provider].installed
                  ? 'CLI found.'
                  : 'CLI not found on the launcher’s PATH.'
                : 'Checking installation…')}
          </p>
          <p>
            Sign in once in a terminal:{' '}
            <code>{provider === 'codex' ? 'codex login' : 'claude auth login'}</code>. Then use{' '}
            <code>@{provider} your instruction</code> and press ⌘/Ctrl+Enter.
          </p>
        </>
      ) : (
        <>
          <p>
            Uses your signed-in {provider === 'chatgpt' ? 'ChatGPT' : 'Claude'} website through the
            Draft.md website extension.
          </p>
          <ol>
            <li>
              <a href="/website-extension.zip" download>
                Download the extension
              </a>{' '}
              and unzip it.
            </li>
            <li>
              Open <code>chrome://extensions</code>, enable Developer mode, choose Load unpacked,
              and select the unzipped folder.
            </li>
            <li>Return here, click the extension icon, and choose Connect this tab.</li>
            <li>
              Sign in on the provider website if needed. Invoke{' '}
              <code>@{provider} your instruction</code> with ⌘/Ctrl+Enter.
            </li>
          </ol>
          <p>
            The extension uses a dedicated website tab. Your instruction and the current note
            context are submitted to that website. The selected website model handles the request;
            login cookies stay there.
          </p>
        </>
      )}
    </>
  );
}
