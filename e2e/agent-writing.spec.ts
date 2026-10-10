import { test, expect, type Page } from '@playwright/test';
import { engineDefaults, type ServerSnapshot, type Engine } from '../src/agents/local-models';
const shortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

async function workspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await page.getByRole('button', { name: /^Paper/ }).click();
  await page.getByLabel('Workspace name').fill('Writing');
  await page.getByRole('combobox', { name: 'Storage', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
}
async function bridge(page: Page) {
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
  Object.assign(snapshot.engines.ollama, {
    state: 'running',
    baseUrl: 'http://127.0.0.1:11434',
    models: ['LiquidAI/lfm2.5-2.6b:q4_k_m', 'other:2b'],
    selectedModel: 'LiquidAI/lfm2.5-2.6b:q4_k_m',
  });
  const actions: { action: string; config: Record<string, unknown> }[] = [];
  let complete: (() => void) | undefined;
  let delayed = false;
  await page.route('**/_dmd/bridge', (route) =>
    route.fulfill({ json: { token: 'test', version: 1 } }),
  );
  await page.route('**/_dmd/models**', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/')[3];
    if (action) {
      const config = route.request().postDataJSON() as Record<string, unknown>;
      actions.push({ action, config });
      const server = snapshot.engines[config.engine as Engine];
      if (action === 'pull-stream') {
        server.models.push(String(config.model));
        await route.fulfill({
          contentType: 'application/x-ndjson',
          body:
            JSON.stringify({ progress: 'pulling model', completed: 50, total: 100 }) +
            '\n' +
            JSON.stringify({ done: true, text: '' }) +
            '\n',
        });
        return;
      }
      if (action === 'generate-stream') {
        if (delayed)
          await new Promise<void>((resolve) => {
            complete = resolve;
          });
        await route.fulfill({
          contentType: 'application/x-ndjson',
          body:
            JSON.stringify({ delta: 'A generated paragraph.' }) +
            '\n' +
            JSON.stringify({ done: true, text: 'A generated paragraph.' }) +
            '\n',
        });
        return;
      }
      if (action === 'inspect') {
        await route.fulfill({
          json: { path: config.model, parameters: 2697198592, label: 'My model' },
        });
        return;
      }
      if (action === 'select') server.selectedModel = String(config.model);
      if (action === 'start' || action === 'connect')
        Object.assign(server, {
          state: 'running',
          owned: action === 'start',
          baseUrl: 'http://127.0.0.1:11434',
          modelPath: config.model,
          models:
            config.engine === 'ollama' ? ['other:2b', 'LiquidAI/lfm2.5-2.6b:q4_k_m'] : ['my-model'],
          selectedModel: config.engine === 'ollama' ? 'other:2b' : 'my-model',
        });
    }
    await route.fulfill({ json: snapshot });
  });
  return {
    snapshot,
    actions,
    delay: () => {
      delayed = true;
    },
    finish: () => complete?.(),
  };
}

test('mention writes directly, is undoable, and reuses the saved model after reload', async ({
  page,
}) => {
  const fixture = await bridge(page);
  await workspace(page);
  const editor = page.locator('.cm-content');
  await editor.fill('# My note\n\n@ollama write something here');
  await editor.press(shortcut);
  await expect(editor).toContainText('A generated paragraph.');
  await expect(editor).not.toContainText('@ollama');
  await expect(page.getByRole('complementary', { name: 'AI Agent' })).not.toBeVisible();
  expect(fixture.actions.find((item) => item.action === 'generate-stream')?.config).toMatchObject({
    engine: 'ollama',
    model: 'LiquidAI/lfm2.5-2.6b:q4_k_m',
    prompt: 'write something here',
    context: '# My note\n\n',
    selection: '',
  });
  await editor.press(undo);
  await expect(editor).toContainText('@ollama write something here');
  fixture.snapshot.engines.ollama.state = 'stopped';
  fixture.snapshot.engines.ollama.models = [];
  await page.reload();
  await page.getByRole('button', { name: 'Writing Browser workspace', exact: true }).click();
  await expect(editor).toBeVisible();
  await editor.fill('@agent write again');
  await editor.press(shortcut);
  await expect(editor).toContainText('A generated paragraph.');
  const generations = fixture.actions.filter((item) => item.action === 'generate-stream');
  expect(generations).toHaveLength(2);
  expect(generations[1].config.model).toBe('LiquidAI/lfm2.5-2.6b:q4_k_m');
  expect(fixture.actions.some((item) => item.action === 'connect')).toBe(true);
});

test('plain instructions write inline without an agent panel or toolbar button', async ({
  page,
}) => {
  const fixture = await bridge(page);
  await workspace(page);
  const editor = page.locator('.cm-content');
  await expect(page.getByRole('button', { name: 'AI Agent', exact: true })).toHaveCount(0);
  await editor.fill('Write a short story about a river');
  await editor.press(shortcut);
  await expect(editor).toHaveText('A generated paragraph.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.agent-composer')).toHaveCount(0);
  expect(fixture.actions.find((item) => item.action === 'generate-stream')?.config.prompt).toBe(
    'Write a short story about a river',
  );
});

test('default writing revises selected text and includes it as bounded context', async ({
  page,
}) => {
  const fixture = await bridge(page);
  await workspace(page);
  const editor = page.locator('.cm-content');
  await editor.fill('Old wording');
  await editor.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await editor.press(shortcut);
  await expect(editor).toHaveText('A generated paragraph.');
  expect(fixture.actions.find((item) => item.action === 'generate-stream')?.config).toMatchObject({
    selection: 'Old wording',
    prompt: 'Improve this selection. Keep its meaning.',
  });
});

test('blank-line continuation also works in focus mode', async ({ page }) => {
  const fixture = await bridge(page);
  await workspace(page);
  const editor = page.locator('.cm-content');
  await editor.fill('# Note\n\n');
  await editor.press(process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter');
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  expect(fixture.actions.some((item) => item.action === 'generate-stream')).toBe(false);
  await editor.press(shortcut);
  await expect(editor).toContainText('A generated paragraph.');
  expect(fixture.actions.find((item) => item.action === 'generate-stream')?.config.prompt).toBe(
    'Continue this note with a short useful paragraph.',
  );
});

test('local model path is selected once and automatically launched on future writing', async ({
  page,
}) => {
  const fixture = await bridge(page);
  await workspace(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'AI Agent', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('llama.cpp');
  await page.getByLabel('Local model path').fill('/models/my-small.gguf');
  await page.getByRole('button', { name: 'Check model', exact: true }).click();
  await expect(page.getByText(/saved as your default/)).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Writing Browser workspace', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.fill('@agent Write a paragraph');
  await editor.press(shortcut);
  await expect(editor).toContainText('A generated paragraph.');
  expect(fixture.actions.find((item) => item.action === 'start')?.config).toMatchObject({
    engine: 'llama.cpp',
    model: '/models/my-small.gguf',
    contextLength: 4096,
  });
});

test('edits made during generation survive and the draft can be recovered', async ({ page }) => {
  const fixture = await bridge(page);
  fixture.delay();
  await workspace(page);
  const editor = page.locator('.cm-content');
  await editor.fill('@ollama Write a paragraph');
  await editor.press(shortcut);
  await expect
    .poll(() => fixture.actions.some((item) => item.action === 'generate-stream'))
    .toBe(true);
  await editor.fill('My newer changes');
  fixture.finish();
  await page.getByText('Review draft', { exact: true }).click();
  await expect(page.getByLabel('Recovered draft')).toHaveValue('A generated paragraph.');
  await expect(editor).toHaveText('My newer changes');
  await page.getByRole('button', { name: 'Insert at cursor' }).click();
  await expect(editor).toContainText('My newer changes');
  await expect(editor).toContainText('A generated paragraph.');
});

for (const stopEarly of [false, true]) {
  test(`streams inline and undoes the passage (stop early: ${stopEarly})`, async ({ page }) => {
    await bridge(page);
    await workspace(page);
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (String(input).endsWith('/generate-stream')) {
          const encoder = new TextEncoder();
          return new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
                controller.enqueue(encoder.encode(JSON.stringify({ delta: 'First words' }) + '\n'));
                Object.assign(window, {
                  finishWriting: () => {
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({ delta: ' arrive live.' }) +
                          '\n' +
                          JSON.stringify({ done: true, text: 'First words arrive live.' }) +
                          '\n',
                      ),
                    );
                    controller.close();
                  },
                });
              },
            }),
            { headers: { 'Content-Type': 'application/x-ndjson' } },
          );
        }
        return original(input, init);
      };
    });
    const editor = page.locator('.cm-content');
    await editor.fill('@agent write a paragraph');
    await editor.press(shortcut);
    await expect(editor).toContainText('First words');
    await expect(page.getByRole('button', { name: 'Stop · Esc' })).toBeVisible();
    await page.waitForTimeout(650);
    if (stopEarly) {
      await editor.press('Escape');
      await expect(editor).toContainText('First words');
      await expect(editor).not.toContainText('arrive live.');
    } else {
      await page.evaluate(() =>
        (window as unknown as { finishWriting: () => void }).finishWriting(),
      );
      await expect(editor).toContainText('First words arrive live.');
    }
    await expect(page.getByRole('button', { name: 'Stop · Esc' })).not.toBeVisible();
    await editor.press(undo);
    await expect(editor).toContainText('@agent write a paragraph');
    await expect(editor).not.toContainText('First words');
  });
}

test('first invocation downloads Liquid instead of silently selecting an installed coder model', async ({
  page,
}) => {
  const fixture = await bridge(page);
  fixture.snapshot.engines.ollama.models = ['qwen2.5-coder:0.5b'];
  fixture.snapshot.engines.ollama.selectedModel = 'qwen2.5-coder:0.5b';
  await workspace(page);
  const editor = page.locator('.cm-content');
  await editor.fill('@ollama write a paragraph');
  await editor.press(shortcut);
  await expect(editor).toContainText('A generated paragraph.');
  expect(fixture.actions.find((item) => item.action === 'pull-stream')?.config.model).toBe(
    'LiquidAI/lfm2.5-2.6b:q4_k_m',
  );
  expect(fixture.actions.find((item) => item.action === 'generate-stream')?.config.model).toBe(
    'LiquidAI/lfm2.5-2.6b:q4_k_m',
  );
  await editor.fill('@ollama write again');
  await editor.press(shortcut);
  await expect(editor).toContainText('A generated paragraph.');
  expect(fixture.actions.filter((item) => item.action === 'pull-stream')).toHaveLength(1);
});

test('first-use download shows a spinner and percentage before writing', async ({ page }) => {
  const fixture = await bridge(page);
  fixture.snapshot.engines.ollama.models = ['qwen2.5-coder:0.5b'];
  await workspace(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('draft-md');
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('preferences', 'readwrite');
        transaction
          .objectStore('preferences')
          .put(
            { engine: 'ollama', profiles: { ollama: { model: 'qwen2.5-coder:0.5b' } } },
            'ai-agent',
          );
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).endsWith('/pull-stream')) {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ progress: 'pulling model', completed: 50, total: 100 }) + '\n',
                ),
              );
              Object.assign(window, {
                finishDownload: () => {
                  controller.enqueue(
                    encoder.encode(JSON.stringify({ done: true, text: '' }) + '\n'),
                  );
                  controller.close();
                },
              });
            },
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return original(input, init);
    };
  });
  const editor = page.locator('.cm-content');
  await editor.fill('@ollama write a paragraph');
  await editor.press(shortcut);
  await expect(page.locator('.agent-inline-status')).toContainText(
    'Downloading LiquidAI/lfm2.5-2.6b:q4_k_m · 50%',
  );
  await expect(page.locator('.agent-progress-spinner')).toBeVisible();
  await expect(editor).toContainText('@ollama');
  expect(fixture.actions.some((item) => item.action === 'generate-stream')).toBe(false);
  fixture.snapshot.engines.ollama.models.push('LiquidAI/lfm2.5-2.6b:q4_k_m');
  await page.evaluate(() => (window as unknown as { finishDownload: () => void }).finishDownload());
  await expect(editor).toContainText('A generated paragraph.');
  expect(fixture.actions.find((item) => item.action === 'generate-stream')?.config.model).toBe(
    'LiquidAI/lfm2.5-2.6b:q4_k_m',
  );
});
