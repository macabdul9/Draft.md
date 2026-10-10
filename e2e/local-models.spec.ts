import { test, expect, type Page } from '@playwright/test';
import { engineDefaults, type Engine, type ServerSnapshot } from '../src/agents/local-models';

async function openModels(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'AI Agent', exact: true }).click();
}

async function bridgeFixture(page: Page) {
  const snapshot: ServerSnapshot = {
    engines: Object.fromEntries(
      Object.entries(engineDefaults).map(([engine, preset]) => [
        engine,
        {
          ...preset,
          command: engine,
          available: true,
          state: 'stopped',
          owned: false,
          baseUrl: '',
          models: [],
          error: '',
          logs: [],
        },
      ]),
    ) as ServerSnapshot['engines'],
  };
  const actions: { action: string; config: Record<string, unknown> }[] = [];
  await page.route('**/_dmd/bridge', async (route) => {
    expect(route.request().headers()['x-draft-client']).toBe('1');
    await route.fulfill({ json: { token: 'test-token', version: 1 } });
  });
  await page.route('**/_dmd/models**', async (route) => {
    expect(route.request().headers()['x-draft-token']).toBe('test-token');
    const action = new URL(route.request().url()).pathname.split('/')[3];
    if (action) {
      const config = route.request().postDataJSON() as Record<string, unknown>;
      actions.push({ action, config });
      if (action === 'inspect' || action === 'browse') {
        if (String(config.model).includes('large')) {
          await route.fulfill({
            status: 400,
            json: { error: 'This model has 7.00B parameters. Local models must be 4B or smaller.' },
          });
        } else {
          await route.fulfill({
            json: {
              path: config.model || '/models/picked.gguf',
              parameters: 2697198592,
              label: 'Local model',
            },
          });
        }
        return;
      }
      const server = snapshot.engines[config.engine as Engine];
      if (action === 'select') server.selectedModel = String(config.model);
      else if (action === 'stop') Object.assign(server, { state: 'stopped', models: [] });
      else
        Object.assign(server, {
          state: action === 'start' ? 'starting' : 'running',
          owned: action === 'start',
          baseUrl: action === 'start' ? `http://127.0.0.1:${config.port}/v1` : config.baseUrl,
          models: action === 'start' ? [] : ['my-local-model'],
        });
    }
    await route.fulfill({ json: snapshot });
  });
  return { snapshot, actions };
}

test('minimal server controls cover engine selection, startup cancellation, and errors', async ({
  page,
}) => {
  const { snapshot, actions } = await bridgeFixture(page);
  await openModels(page);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeEnabled();
  for (const engine of ['ollama', 'llama.cpp', 'vllm-engine', 'sglang']) {
    await page.getByRole('combobox', { name: 'Engine', exact: true }).selectOption(engine);
    if (engine !== 'ollama') {
      await page
        .getByLabel('Local model path')
        .fill(engine === 'llama.cpp' ? '/models/local.gguf' : '/models/local');
      await page.getByRole('button', { name: 'Check model', exact: true }).click();
      await expect(page.getByText(/Verified 2.70B/)).toBeVisible();
    }
    await expect(page.getByLabel('Port', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel startup' })).toBeVisible();
    expect(actions.at(-1)?.config.engine).toBe(engine);
    expect(actions.at(-1)?.action).toBe('start');
    await page.getByRole('button', { name: 'Cancel startup' }).click();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  }
  snapshot.engines.sglang.state = 'error';
  snapshot.engines.sglang.error = 'Server exited (code 7). Open Logs for details.';
  snapshot.engines.sglang.logs = ['Missing GPU backend'];
  await expect(page.getByRole('alert')).toContainText('Server exited');
  await page.getByText('Logs', { exact: true }).click();
  await expect(page.locator('.server-logs')).toContainText('Missing GPU backend');
});

test('existing servers connect and disconnect without offering Stop', async ({ page }) => {
  const { snapshot, actions } = await bridgeFixture(page);
  await openModels(page);
  await page.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('sglang');
  await page.getByRole('combobox', { name: 'Connection', exact: true }).selectOption('existing');
  await page.getByLabel('API base URL').fill('https://inference.example/v1');
  await page.getByLabel('API key (optional)').fill('memory-only');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Connected · externally managed', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Default model' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(actions.at(-1)?.config.apiKey).toBe('memory-only');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByLabel('API key (optional)')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  snapshot.engines.ollama.state = 'running';
  snapshot.engines.ollama.owned = true;
  await page.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('ollama');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Connection', exact: true })).toHaveValue(
    'local',
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(actions.filter((action) => action.action === 'stop')).toHaveLength(2);
});

test('default small-model catalog, native browse, size cap, and remembered paths', async ({
  page,
}) => {
  const { actions } = await bridgeFixture(page);
  await openModels(page);
  await page.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('llama.cpp');
  const chooser = page.getByRole('combobox', { name: 'Model', exact: true });
  await expect(chooser).toHaveValue('LiquidAI/LFM2.5-2.6B');
  await expect(chooser.locator('option')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Browse…', exact: true }).click();
  await expect(page.getByLabel('Local model path')).toHaveValue('/models/picked.gguf');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await chooser.selectOption('Qwen/Qwen3.5-2B');
  await expect(page.getByLabel('Local model path')).toHaveValue('');
  await page.getByLabel('Local model path').fill('/models/large.gguf');
  await page.getByRole('button', { name: 'Check model', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('4B or smaller');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  expect(actions.filter(({ action }) => action === 'start')).toHaveLength(0);
  await chooser.selectOption('LiquidAI/LFM2.5-2.6B');
  await expect(page.getByLabel('Local model path')).toHaveValue('/models/picked.gguf');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'AI Agent', exact: true }).click();
  await expect(page.getByLabel('Local model path')).toHaveValue('/models/picked.gguf');
});

test('installed Ollama model can be selected explicitly', async ({ page }) => {
  const { snapshot, actions } = await bridgeFixture(page);
  snapshot.engines.ollama = {
    ...snapshot.engines.ollama,
    state: 'running',
    owned: false,
    models: ['LiquidAI/lfm2.5-2.6b:q4_k_m', 'qwen2.5-coder:0.5b'],
  };
  await openModels(page);
  await page.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('ollama');
  await page
    .getByRole('combobox', { name: 'Default model', exact: true })
    .selectOption('LiquidAI/lfm2.5-2.6b:q4_k_m');
  await expect(page.getByRole('combobox', { name: 'Default model', exact: true })).toHaveValue(
    'LiquidAI/lfm2.5-2.6b:q4_k_m',
  );
  expect(actions.at(-1)?.action).toBe('select');
});

test('browser-only builds explain the installed-app requirement', async ({ page }) => {
  await openModels(page);
  await expect(page.getByRole('status')).toContainText('AI Agent requires the installed app');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Workspace', exact: true })).toBeVisible();
});
