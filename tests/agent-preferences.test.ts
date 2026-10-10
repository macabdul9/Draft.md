import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { agentSettings, rememberAgent, type AgentProfile } from '../src/agents/preferences';

it('remembers launch paths and default choices, while excluding credentials', async () => {
  await rememberAgent('llama.cpp', {
    mode: 'local',
    modelPath: '/models/small.gguf',
    port: 8081,
    executable: '/opt/llama-server',
  });
  await rememberAgent('llama.cpp', {
    model: 'my-small-model',
    apiKey: 'never-save',
  } as AgentProfile);
  const saved = await agentSettings();
  expect(saved.engine).toBe('llama.cpp');
  expect(saved.profiles['llama.cpp']).toMatchObject({
    model: 'my-small-model',
    modelPath: '/models/small.gguf',
    port: 8081,
  });
  expect(JSON.stringify(saved)).not.toContain('never-save');
  await rememberAgent('ollama', { model: 'LiquidAI/lfm2.5-2.6b:q4_k_m' });
  expect((await agentSettings()).profiles['llama.cpp']?.modelPath).toBe('/models/small.gguf');
  await rememberAgent('sglang', { model: 'another-small-model' }, false);
  expect((await agentSettings()).engine).toBe('ollama');
});
