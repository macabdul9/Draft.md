import { test, expect, type Page } from '@playwright/test';
const shortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
async function workspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await page.getByRole('button', { name: /^Paper/ }).click();
  await page.getByLabel('Workspace name').fill('Agent adapters');
  await page.getByRole('combobox', { name: 'Storage', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Create workspace' }).click();
}
for (const provider of ['codex', 'claudecode']) {
  test(`@${provider} streams through the CLI bridge without a writing panel`, async ({ page }) => {
    const requests: Record<string, unknown>[] = [];
    await page.route('**/_dmd/bridge', (route) =>
      route.fulfill({ json: { version: 1, token: 'test' } }),
    );
    await page.route('**/_dmd/agents/generate-stream', (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/x-ndjson',
        body:
          JSON.stringify({ delta: '- [ ] Local writing' }) +
          '\n' +
          JSON.stringify({ done: true, text: '- [ ] Local writing' }) +
          '\n',
      });
    });
    await workspace(page);
    const editor = page.locator('.cm-content');
    await editor.fill(`@${provider} write one task`);
    await editor.press(shortcut);
    await expect(editor).toContainText('Local writing');
    expect(requests[0]).toMatchObject({ provider, prompt: 'write one task' });
    await expect(page.getByRole('complementary', { name: 'AI Agent' })).toHaveCount(0);
    await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editor).toContainText(`@${provider}`);
  });
}
test('website invocation reports an absent extension and keeps the instruction', async ({
  page,
}) => {
  await page.route('**/_dmd/bridge', (route) =>
    route.fulfill({ json: { version: 1, token: 'test' } }),
  );
  await page.route('**/_dmd/agents/prepare', (route) =>
    route.fulfill({ json: { text: 'Draft.md instructions and context' } }),
  );
  await workspace(page);
  const editor = page.locator('.cm-content');
  await editor.fill('@chatgpt write one task');
  await editor.press(shortcut);
  await expect(
    page.getByText(
      'Connect this Draft.md tab using the Draft.md website extension, then try again.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(editor).toContainText('@chatgpt write one task');
});
test('a CLI can be saved once as the default for @agent', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/_dmd/bridge', (route) =>
    route.fulfill({ json: { version: 1, token: 'test' } }),
  );
  await page.route('**/_dmd/agents', (route) =>
    route.fulfill({ json: { codex: { installed: true }, claudecode: { installed: true } } }),
  );
  await page.route('**/_dmd/agents/generate-stream', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({ delta: 'Default CLI writing' }) +
        '\n' +
        JSON.stringify({ done: true, text: 'Default CLI writing' }) +
        '\n',
    });
  });
  await workspace(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'AI Agent', exact: true }).click();
  await page.getByRole('combobox', { name: 'Default agent' }).selectOption('codex');
  await expect(page.getByRole('status')).toContainText('CLI found');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.cm-content').fill('@agent write here');
  await page.locator('.cm-content').press(shortcut);
  await expect(page.locator('.cm-content')).toContainText('Default CLI writing');
  expect(requests[0].provider).toBe('codex');
});
