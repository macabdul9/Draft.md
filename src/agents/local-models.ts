export type Engine = 'ollama' | 'llama.cpp' | 'vllm-engine' | 'sglang';
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export interface LocalServer {
  name: string;
  command: string;
  port: number;
  available: boolean;
  state: ServerState;
  owned: boolean;
  baseUrl: string;
  models: string[];
  error: string;
  logs: string[];
  selectedModel?: string;
  modelPath?: string;
  parameters?: number;
}
export interface ServerSnapshot {
  engines: Record<Engine, LocalServer>;
}
export const engineDefaults: Record<Engine, { name: string; port: number }> = {
  ollama: { name: 'Ollama', port: 11434 },
  'llama.cpp': { name: 'llama.cpp', port: 8080 },
  'vllm-engine': { name: 'vLLM', port: 8000 },
  sglang: { name: 'SGLang', port: 30000 },
};

export class LocalModelClient {
  constructor(private readonly token: string) {}

  static async connect(signal?: AbortSignal): Promise<LocalModelClient> {
    const response = await fetch('/_dmd/bridge', {
      headers: { 'X-Draft-Client': '1' },
      cache: 'no-store',
      signal,
    });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('AI Agent requires the installed app. Launch Draft.md using dmd.');
    }
    const data = await response.json();
    if (data.version !== 1 || typeof data.token !== 'string') {
      throw new Error('Update your Draft.md installation to enable AI Agent.');
    }
    return new LocalModelClient(data.token);
  }

  async stream(
    config: object,
    signal: AbortSignal,
    update: (text: string) => void,
    action = 'generate-stream',
    progress?: (event: { progress: string; completed: number; total: number }) => void,
    scope: 'models' | 'agents' = 'models',
  ): Promise<{ text: string }> {
    const response = await fetch(`/_dmd/${scope}/${action}`, {
      method: 'POST',
      headers: { 'X-Draft-Token': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal,
      cache: 'no-store',
    });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('Content-Type')?.includes('application/x-ndjson')
    ) {
      throw new Error('The writing stream is unavailable. Restart Draft.md and try again.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '',
      text = '',
      total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done)
          throw new Error('The writing stream ended early. Your partial draft has been kept.');
        total += chunk.value.byteLength;
        if (total > 2 * 1024 * 1024) throw new Error('The writing stream exceeds the size limit.');
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.error) throw new Error(String(event.error));
          if (typeof event.progress === 'string') {
            progress?.(event);
          } else if (typeof event.delta === 'string') {
            text += event.delta;
            update(text);
          } else if (event.done === true && typeof event.text === 'string') {
            return { text: event.text };
          } else throw new Error('The writing stream returned an invalid event.');
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async agentRequest<T>(
    action?: 'prepare' | 'cancel',
    config?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`/_dmd/agents${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET',
      headers: {
        'X-Draft-Token': this.token,
        ...(action ? { 'Content-Type': 'application/json' } : {}),
      },
      body: action ? JSON.stringify(config) : undefined,
      signal,
      cache: 'no-store',
    });
    if (!response.headers.get('Content-Type')?.includes('application/json'))
      throw new Error('Restart Draft.md to enable the agent bridge.');
    const data = await response.json();
    if (!response.ok || data.error)
      throw new Error(data.error || 'The agent bridge rejected the request.');
    return data as T;
  }

  async request<T = ServerSnapshot>(
    action?: 'start' | 'stop' | 'connect' | 'inspect' | 'browse' | 'select' | 'generate',
    config?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`/_dmd/models${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET',
      headers: {
        'X-Draft-Token': this.token,
        ...(action ? { 'Content-Type': 'application/json' } : {}),
      },
      body: action ? JSON.stringify(config) : undefined,
      cache: 'no-store',
      signal,
    });
    if (!response.headers.get('Content-Type')?.includes('application/json'))
      throw new Error(
        'The local bridge is unavailable. Reopen settings after restarting Draft.md.',
      );
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (!response.ok) throw new Error('The local bridge rejected the request. Reopen settings.');
    return data as T;
  }
}
import catalog from '../../packaging/model_catalog.json' with { type: 'json' };
export const modelCatalog = catalog;
export interface ModelInspection {
  path: string;
  parameters: number;
  label: string;
  cancelled?: boolean;
}
