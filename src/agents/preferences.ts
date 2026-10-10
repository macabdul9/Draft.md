import { loadPreference, storePreference } from '../storage/indexed-db';
import type { Engine } from './local-models';

export interface AgentProfile {
  mode?: 'local' | 'existing';
  model?: string;
  modelChosen?: boolean;
  modelPath?: string;
  baseUrl?: string;
  port?: number;
  executable?: string;
  contextLength?: number;
  timeout?: number;
}
export interface AgentSettings {
  engine: Engine;
  profiles: Partial<Record<Engine, AgentProfile>>;
}
export async function agentSettings(): Promise<AgentSettings> {
  return (await loadPreference<AgentSettings>('ai-agent')) || { engine: 'ollama', profiles: {} };
}
export async function rememberAgent(engine: Engine, profile: AgentProfile, makeDefault = true) {
  const saved = await agentSettings();
  // Only these fields are persisted. Credentials remain in the bridge session.
  const { mode, model, modelChosen, modelPath, baseUrl, port, executable, contextLength, timeout } =
    profile;
  if (makeDefault) saved.engine = engine;
  saved.profiles[engine] = {
    ...saved.profiles[engine],
    ...Object.fromEntries(
      Object.entries({
        mode,
        model,
        modelChosen,
        modelPath,
        baseUrl,
        port,
        executable,
        contextLength,
        timeout,
      }).filter(([, value]) => value !== undefined),
    ),
  };
  await storePreference('ai-agent', saved);
}
