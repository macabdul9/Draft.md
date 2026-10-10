import { useEffect, useRef, useState } from 'preact/hooks';
import {
  engineDefaults,
  LocalModelClient,
  modelCatalog,
  type ModelInspection,
  type Engine,
  type ServerSnapshot,
} from '../agents/local-models';
import { loadPreference, storePreference } from '../storage/indexed-db';
import { agentSettings, rememberAgent, type AgentProfile } from '../agents/preferences';

export function LocalModels({
  initialEngine,
  onEngineChange,
}: {
  initialEngine?: Engine;
  onEngineChange?: (engine: Engine) => void;
}) {
  const firstEngine = initialEngine || 'ollama';
  const [engine, setEngine] = useState<Engine>(firstEngine);
  const [mode, setMode] = useState<'local' | 'existing'>('local');
  const [model, setModel] = useState('');
  const [candidate, setCandidate] = useState(modelCatalog.default);
  const [inspection, setInspection] = useState<ModelInspection>();
  const [checking, setChecking] = useState(false);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [pathsReady, setPathsReady] = useState(false);
  const [baseUrl, setBaseUrl] = useState(
    `http://127.0.0.1:${engineDefaults[firstEngine].port}${firstEngine === 'ollama' ? '' : '/v1'}`,
  );
  const [apiKey, setApiKey] = useState('');
  const [port, setPort] = useState(engineDefaults[firstEngine].port);
  const [profiles, setProfiles] = useState<Partial<Record<Engine, AgentProfile>>>({});
  const [executable, setExecutable] = useState('');
  const [contextLength, setContextLength] = useState('4096');
  const [startupTimeout, setStartupTimeout] = useState(300);
  const [snapshot, setSnapshot] = useState<ServerSnapshot>();
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useRef<LocalModelClient>();
  const mounted = useRef(false);
  const inspectionVersion = useRef(0);
  const server = snapshot?.engines[engine];
  const active = server && ['starting', 'running', 'stopping'].includes(server.state);
  const displayedMode = active ? (server.owned ? 'local' : 'existing') : mode;
  const preset = modelCatalog.models.find((item) => item.id === candidate);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([agentSettings(), loadPreference<Record<string, string>>('local-model-paths')])
      .then(([saved, checkedPaths]) => {
        if (cancelled) return;
        setProfiles(saved.profiles);
        const next = initialEngine || saved.engine;
        const profile = saved.profiles[next];
        setEngine(next);
        setCandidate(
          modelCatalog.models.find(
            (item) =>
              item.ollama.toLowerCase() === profile?.model?.toLowerCase() && profile.modelChosen,
          )?.id || modelCatalog.default,
        );
        setMode(profile?.mode || 'local');
        setPort(profile?.port || engineDefaults[next].port);
        setBaseUrl(
          profile?.baseUrl ||
            `http://127.0.0.1:${engineDefaults[next].port}${next === 'ollama' ? '' : '/v1'}`,
        );
        const valid = Object.fromEntries(
          Object.entries(checkedPaths || {}).filter(([, value]) => typeof value === 'string'),
        );
        setPaths(valid);
        setModel(profile?.modelPath || valid[`${next}:${modelCatalog.default}`] || '');
        setExecutable(profile?.executable || '');
        setContextLength(String(profile?.contextLength || 4096));
        setStartupTimeout(profile?.timeout || 300);
        setPathsReady(true);
      })
      .catch(() => {
        if (!cancelled) setPathsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updatePath(value: string) {
    inspectionVersion.current++;
    setModel(value);
    setInspection(undefined);
    setError('');
  }

  async function inspect(browse = false) {
    if (!client.current) return;
    const version = ++inspectionVersion.current;
    setChecking(true);
    setError('');
    try {
      const result = await client.current.request<ModelInspection>(browse ? 'browse' : 'inspect', {
        engine,
        model,
      });
      if (!mounted.current || version !== inspectionVersion.current || result.cancelled) return;
      setModel(result.path);
      setInspection(result);
      const saved = { ...paths, [`${engine}:${candidate}`]: result.path };
      setPaths(saved);
      await storePreference('local-model-paths', saved);
      const profile: AgentProfile = {
        mode: 'local',
        modelPath: result.path,
        model: '',
        port,
        executable,
        contextLength: Number(contextLength) || 4096,
        timeout: startupTimeout,
      };
      await rememberAgent(engine, profile);
      setProfiles((previous) => ({ ...previous, [engine]: profile }));
    } catch (failure) {
      if (mounted.current && version === inspectionVersion.current) {
        setInspection(undefined);
        setError(failure instanceof Error ? failure.message : 'Could not inspect this model.');
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  async function selectModel(id: string) {
    if (!client.current) return;
    setBusy(true);
    setError('');
    try {
      setSnapshot(await client.current.request('select', { engine, model: id }));
      await rememberAgent(engine, { model: id, modelChosen: true });
      setProfiles((previous) => ({
        ...previous,
        [engine]: { ...previous[engine], model: id, modelChosen: true },
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not select this model.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await client.current!.request(undefined, undefined, controller.signal);
        if (mounted.current) setSnapshot(result);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Connection lost.');
      }
      if (!controller.signal.aborted) timer = globalThis.setTimeout(() => void refresh(), 1500);
    }
    void LocalModelClient.connect(controller.signal)
      .then((connected) => {
        client.current = connected;
        if (!controller.signal.aborted) void refresh();
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setUnavailable(failure instanceof Error ? failure.message : 'Local bridge unavailable.');
      });
    return () => {
      mounted.current = false;
      controller.abort();
      globalThis.clearTimeout(timer);
    };
  }, []);

  function chooseEngine(next: Engine) {
    onEngineChange?.(next);
    const saved = profiles[next];
    setEngine(next);
    setPort(saved?.port || engineDefaults[next].port);
    setMode(saved?.mode || 'local');
    setBaseUrl(
      snapshot?.engines[next].baseUrl ||
        saved?.baseUrl ||
        `http://127.0.0.1:${engineDefaults[next].port}${next === 'ollama' ? '' : '/v1'}`,
    );
    updatePath(saved?.modelPath || paths[`${next}:${candidate}`] || '');
    setApiKey('');
    setExecutable(saved?.executable || '');
    setContextLength(String(saved?.contextLength || 4096));
    setStartupTimeout(saved?.timeout || 300);
    setError('');
  }

  async function act() {
    if (!client.current) return;
    if (active) setMode(server.owned ? 'local' : 'existing');
    setBusy(true);
    setError('');
    try {
      const result = await client.current.request(
        active ? 'stop' : mode === 'local' ? 'start' : 'connect',
        {
          engine,
          model,
          baseUrl,
          apiKey,
          port,
          executable,
          timeout: startupTimeout,
          ...(contextLength ? { contextLength: Number(contextLength) } : {}),
        },
      );
      if (!active) {
        const profile: AgentProfile = {
          mode,
          ...(engine !== 'ollama' ? { model: '' } : {}),
          modelPath: model,
          baseUrl,
          port,
          executable,
          timeout: startupTimeout,
          contextLength: Number(contextLength) || 4096,
        };
        await rememberAgent(engine, profile);
        setProfiles((previous) => ({ ...previous, [engine]: { ...previous[engine], ...profile } }));
      }
      if (mounted.current) {
        setSnapshot(result);
        setApiKey('');
      }
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : 'Could not update the server.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (unavailable)
    return (
      <div class="local-models">
        <p role="status">{unavailable}</p>
        <p>
          Build and install this version to use server controls. Regular editing works without a
          local bridge.
        </p>
      </div>
    );

  return (
    <div class="local-models">
      <p>
        Choose your agent once. Its model and path are remembered, and writing starts it when
        needed.
      </p>
      <p>Start an installed engine or connect to a server you already run.</p>
      <label>
        Engine
        <select
          value={engine}
          disabled={busy || checking || !pathsReady}
          onChange={(event) => chooseEngine(event.currentTarget.value as Engine)}
        >
          {Object.entries(engineDefaults).map(([id, preset]) => (
            <option key={id} value={id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Connection
        <select
          value={displayedMode}
          disabled={busy || !!active}
          onChange={(event) => setMode(event.currentTarget.value as 'local' | 'existing')}
        >
          <option value="local">Start locally</option>
          <option value="existing">Connect to existing</option>
        </select>
      </label>
      <label>
        Model
        <select
          aria-label="Model"
          value={candidate}
          disabled={busy || checking || (engine !== 'ollama' && !!active) || !pathsReady}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCandidate(next);
            updatePath(paths[`${engine}:${next}`] || '');
            const chosen = modelCatalog.models.find((item) => item.id === next);
            if (engine === 'ollama' && chosen) {
              const profile = { ...profiles[engine], model: chosen.ollama, modelChosen: true };
              setProfiles((previous) => ({ ...previous, [engine]: profile }));
              void rememberAgent(engine, profile);
            }
          }}
        >
          {modelCatalog.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {(item.parameters / 1e9).toFixed(2)}B
              {item.id === modelCatalog.default ? ' · Default' : ''}
            </option>
          ))}
          <option value="custom">Custom local model · up to 4B</option>
        </select>
        <small>4B parameter limit. Default context: 4,096 tokens.</small>
      </label>
      {preset && !active && (
        <div class="model-source-links">
          <a
            href={engine === 'llama.cpp' ? preset.gguf : preset.source}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get model files ↗
          </a>
          <span>
            {engine === 'llama.cpp'
              ? 'Choose Q4 GGUF for lower memory use.'
              : engine === 'ollama'
                ? 'Install a model in Ollama, then select it below.'
                : 'Use the original Safetensors model directory.'}
          </span>
        </div>
      )}
      {displayedMode === 'local' && engine !== 'ollama' && !active && (
        <>
          <label>
            Local model path
            <input
              value={model}
              disabled={!!active || busy || checking || !pathsReady}
              placeholder={
                engine === 'llama.cpp' ? '/path/to/model.gguf' : '/path/to/model-directory'
              }
              onInput={(event) => updatePath(event.currentTarget.value)}
            />
          </label>
          <div class="model-path-actions">
            <button disabled={!snapshot || busy || checking} onClick={() => void inspect(true)}>
              Browse…
            </button>
            <button
              disabled={!snapshot || !model.trim() || busy || checking}
              onClick={() => void inspect()}
            >
              Check model
            </button>
          </div>
          {checking && <small role="status">Checking model metadata…</small>}
          {inspection && (
            <p class="model-verified" role="status">
              Verified {(inspection.parameters / 1e9).toFixed(2)}B parameters · saved as your
              default
            </p>
          )}
        </>
      )}
      {active && server.modelPath && (
        <small class="server-address">Model: {server.modelPath}</small>
      )}
      {engine === 'ollama' && !active && (
        <p>
          Start or connect to Ollama, then choose an installed model below. For a local GGUF path,
          choose llama.cpp.
        </p>
      )}
      {displayedMode === 'existing' && (
        <>
          <label>
            API base URL
            <input
              type="url"
              value={active ? server.baseUrl : baseUrl}
              disabled={!!active || busy}
              onInput={(event) => setBaseUrl(event.currentTarget.value)}
            />
          </label>
          {!active && (
            <label>
              API key (optional)
              <input
                type="password"
                value={apiKey}
                autoComplete="off"
                onInput={(event) => setApiKey(event.currentTarget.value)}
              />
              <small>Kept in memory for this connection only.</small>
            </label>
          )}
        </>
      )}
      <div class="local-model-status" role="status">
        <span class={`server-dot ${server?.state || 'stopped'}`} />
        {!snapshot
          ? 'Connecting to Draft.md…'
          : server?.state === 'running'
            ? server.owned
              ? 'Running · started by Draft.md'
              : 'Connected · externally managed'
            : server?.state === 'starting'
              ? 'Starting…'
              : server?.state === 'stopping'
                ? 'Stopping…'
                : server?.state === 'error'
                  ? 'Error'
                  : 'Stopped'}
      </div>
      {active && <small class="server-address">{server?.baseUrl}</small>}
      {(error || server?.error) && (
        <p role="alert" class="local-model-error">
          {error || server?.error}
        </p>
      )}
      <button
        class="primary"
        disabled={
          !snapshot ||
          busy ||
          checking ||
          server?.state === 'stopping' ||
          (!active && mode === 'local' && engine !== 'ollama' && !inspection)
        }
        onClick={() => void act()}
      >
        {busy
          ? 'Working…'
          : active
            ? server?.owned
              ? server.state === 'starting'
                ? 'Cancel startup'
                : 'Stop'
              : 'Disconnect'
            : mode === 'local'
              ? 'Start'
              : 'Connect'}
      </button>
      {server?.state === 'running' && (
        <div class="server-models">
          <strong>
            {server.owned || engine === 'ollama'
              ? 'Available models · up to 4B'
              : 'Server-reported models'}
          </strong>
          {server.models.length ? (
            <label>
              Default model
              <select
                aria-label="Default model"
                value={profiles[engine]?.modelChosen ? profiles[engine]?.model || '' : ''}
                disabled={busy || (!server.owned && engine !== 'ollama')}
                onChange={(event) => void selectModel(event.currentTarget.value)}
              >
                <option value="">Choose a model…</option>
                {server.models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No verified models at or below 4B found.</p>
          )}
          {engine === 'ollama' &&
            preset &&
            !server.models.some((id) => id.toLowerCase() === preset.ollama.toLowerCase()) && (
              <p>
                Downloaded automatically the first time you invoke @ollama. Progress appears in the
                editor footer.
              </p>
            )}
          {!server.owned && engine !== 'ollama' && (
            <p>
              External endpoints do not report verified parameter counts. Use a local model path to
              enforce the 4B limit.
            </p>
          )}
        </div>
      )}
      {displayedMode === 'local' && (
        <details>
          <summary>Advanced</summary>
          <label>
            Executable path (optional)
            <input
              value={executable}
              disabled={!!active || busy}
              placeholder={server?.command}
              onInput={(event) => setExecutable(event.currentTarget.value)}
            />
          </label>
          <label>
            Port
            <input
              type="number"
              min="1024"
              max="65535"
              value={port}
              disabled={!!active || busy}
              onInput={(event) => setPort(Number(event.currentTarget.value))}
            />
          </label>
          {engine !== 'ollama' && (
            <label>
              Context length (optional)
              <input
                type="number"
                min="128"
                max="1048576"
                value={contextLength}
                disabled={!!active || busy}
                onInput={(event) => setContextLength(event.currentTarget.value)}
              />
            </label>
          )}
          <label>
            Startup timeout (seconds)
            <input
              type="number"
              min="10"
              max="1800"
              value={startupTimeout}
              disabled={!!active || busy}
              onInput={(event) => setStartupTimeout(Number(event.currentTarget.value))}
            />
          </label>
        </details>
      )}
      {!!server?.logs.length && (
        <details>
          <summary>Logs</summary>
          <pre class="server-logs">{server.logs.join('\n')}</pre>
        </details>
      )}
      {displayedMode === 'local' && (
        <p>
          Ollama downloads your chosen small model on first use. Other engines use existing model
          files and require an installed backend. Already running Ollama? Choose Connect to
          existing.
        </p>
      )}
      <p>
        Use AI Agent in the editor to write with your saved model. Closing this panel leaves servers
        running; <code>dmd stop</code> stops servers started by Draft.md.
      </p>
    </div>
  );
}
