import type { Engine } from './local-models';
export type AgentProvider = Engine | 'codex' | 'claudecode' | 'chatgpt' | 'claude';
export const providers: Record<AgentProvider, string> = {
  ollama: 'Ollama',
  'llama.cpp': 'llama.cpp',
  'vllm-engine': 'vLLM',
  sglang: 'SGLang',
  codex: 'Codex · installed CLI',
  claudecode: 'Claude Code · installed CLI',
  chatgpt: 'ChatGPT · website',
  claude: 'Claude · website',
};
export function isLocalEngine(provider: AgentProvider): provider is Engine {
  return ['ollama', 'llama.cpp', 'vllm-engine', 'sglang'].includes(provider);
}
