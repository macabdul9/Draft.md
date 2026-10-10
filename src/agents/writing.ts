import {
  LocalModelClient,
  engineDefaults,
  modelCatalog,
  type Engine,
  type LocalServer,
} from './local-models';
import { loadPreference } from '../storage/indexed-db';
import { writeThroughWebsite } from './website';
import { isLocalEngine, type AgentProvider } from './providers';
import { agentSettings, rememberAgent } from './preferences';

export interface WritingRequest {
  prompt: string;
  context: string;
  selection: string;
  engine?: AgentProvider;
}
export interface AgentSession {
  client: LocalModelClient;
  engine: Engine;
  model: string;
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancelled = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancelled);
      resolve();
    }, 500);
    signal.addEventListener('abort', cancelled, { once: true });
  });
}

export async function prepareAgent(
  engineOverride: Engine | undefined,
  signal: AbortSignal,
  status: (message: string) => void,
): Promise<AgentSession> {
  const settings = await agentSettings();
  const engine = engineOverride || settings.engine;
  const profile = settings.profiles[engine];
  const client = await LocalModelClient.connect(signal);
  let snapshot = await client.request(undefined, undefined, signal);
  let server: LocalServer = snapshot.engines[engine];
  if (!['running', 'starting'].includes(server.state)) {
    status(`Starting ${engineDefaults[engine].name}…`);
    if (engine === 'ollama') {
      const baseUrl = profile?.baseUrl || `http://127.0.0.1:${profile?.port || 11434}`;
      try {
        snapshot = await client.request('connect', { engine, baseUrl }, signal);
      } catch (failure) {
        signal.throwIfAborted();
        const url = new URL(baseUrl);
        if (
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          (!server.available && !profile?.executable)
        )
          throw failure;
        snapshot = await client.request(
          'start',
          {
            engine,
            port: Number(url.port) || profile?.port || 11434,
            executable: profile?.executable || '',
          },
          signal,
        );
      }
    } else if (profile?.mode === 'existing') {
      snapshot = await client.request('connect', { engine, baseUrl: profile.baseUrl }, signal);
    } else {
      if (!profile?.modelPath)
        throw new Error(
          'Choose your model once in AI Agent settings. Its path will be remembered.',
        );
      snapshot = await client.request(
        'start',
        { engine, ...profile, model: profile.modelPath },
        signal,
      );
    }
    server = snapshot.engines[engine];
  }
  const deadline = Date.now() + 300_000;
  while (server.state === 'starting' && Date.now() < deadline) {
    await pause(signal);
    server = (await client.request(undefined, undefined, signal)).engines[engine];
  }
  if (server.state !== 'running')
    throw new Error(server.error || 'The agent did not become ready. Check AI Agent settings.');
  const preferred = modelCatalog.models.find((item) => item.id === modelCatalog.default)?.ollama;
  let model =
    engine === 'ollama'
      ? profile?.modelChosen && profile.model
        ? profile.model
        : preferred!
      : profile?.model || server.selectedModel || server.models[0];
  if (
    engine === 'ollama' &&
    !server.models.some((id) => id.toLowerCase() === model.toLowerCase())
  ) {
    status(`Downloading ${model}…`);
    await client.stream(
      { engine, model },
      signal,
      () => {},
      'pull-stream',
      (event) => {
        const percent =
          event.total > 0
            ? ` · ${Math.min(100, Math.floor((event.completed / event.total) * 100))}%`
            : '';
        status(`Downloading ${model}${percent} · ${event.progress}`);
      },
    );
    server = (await client.request(undefined, undefined, signal)).engines[engine];
  } else if (
    !model ||
    !server.models.some((id) =>
      engine === 'ollama' ? id.toLowerCase() === model.toLowerCase() : id === model,
    )
  ) {
    throw new Error(
      'Your saved model is unavailable. Choose an installed model in AI Agent settings.',
    );
  }
  if (engine === 'ollama') {
    model = server.models.find((id) => id.toLowerCase() === model.toLowerCase()) || model;
  }
  await rememberAgent(
    engine,
    {
      model,
      ...(profile
        ? {}
        : {
            mode: server.owned ? 'local' : 'existing',
            baseUrl: server.baseUrl,
            port: server.port,
            modelPath: server.modelPath,
          }),
    },
    !engineOverride,
  );
  return { client, engine, model };
}

export async function writeWithAgent(
  request: WritingRequest,
  signal: AbortSignal,
  status: (message: string) => void,
  ready: (session: AgentSession) => void,
  update: (text: string) => void,
) {
  const provider = request.engine || (await loadPreference<AgentProvider>('ai-writing-provider'));
  if (provider && !isLocalEngine(provider)) {
    const client = await LocalModelClient.connect(signal);
    const config = {
      prompt: request.prompt.slice(0, 2000),
      context: request.context.slice(0, 6000),
      selection: request.selection.slice(0, 2000),
    };
    if (provider === 'chatgpt' || provider === 'claude') {
      const prepared = await client.agentRequest<{ text: string }>('prepare', config, signal);
      return writeThroughWebsite(provider, prepared.text, signal, update, status);
    }
    const requestId = crypto.randomUUID();
    status(`Starting ${provider === 'codex' ? 'Codex' : 'Claude Code'}…`);
    const cancel = () => {
      void client.agentRequest('cancel', { requestId }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await client.stream(
        { provider, requestId, ...config },
        signal,
        update,
        'generate-stream',
        (event) => status(event.progress),
        'agents',
      );
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  const session = await prepareAgent(provider, signal, status);
  signal.throwIfAborted();
  ready(session);
  status('Writing…');
  return session.client.stream(
    {
      engine: session.engine,
      model: session.model,
      prompt: request.prompt.slice(0, 2000),
      context: request.context.slice(0, 6000),
      selection: request.selection.slice(0, 2000),
    },
    signal,
    update,
  );
}
