import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

for (const provider of ['chatgpt', 'claude']) {
  test(`website extension pairs and streams ${provider} tasks as Markdown`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'draft-extension-test-'));
    const extension = resolve('extension/website');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      baseURL: 'http://127.0.0.1:4173',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
      const page = await context.newPage();
      await context.route('https://chatgpt.com/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: fixture('chatgpt') }),
      );
      await context.route('https://claude.ai/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: fixture('claude') }),
      );
      await page.goto('/');
      const id = '11111111-1111-1111-1111-111111111111';
      await page.evaluate((id) => {
        Object.assign(window, { extensionEvents: [] });
        window.addEventListener('message', (event) => {
          if (event.data?.source === 'draft-md-extension')
            (window as unknown as { extensionEvents: unknown[] }).extensionEvents.push(event.data);
        });
        window.postMessage({ source: 'draft-md', id, type: 'ping' }, location.origin);
      }, id);
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.stringify((window as unknown as { extensionEvents: unknown[] }).extensionEvents),
          ),
        )
        .toContain('connect this tab first');
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ origins: ['http://127.0.0.1:4173'] });
      });
      const providerTab = context.waitForEvent('page');
      await page.evaluate(
        ({ id, provider }) => {
          window.postMessage(
            {
              source: 'draft-md',
              id,
              type: 'write',
              provider,
              prompt: 'Write two tasks in Markdown.',
            },
            location.origin,
          );
        },
        { id, provider },
      );
      const website = await providerTab;
      await website.goto(provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/new');
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              JSON.stringify((window as unknown as { extensionEvents: unknown[] }).extensionEvents),
            ),
          { timeout: 20000 },
        )
        .toContain('"type":"done"');
      const events = await page.evaluate(
        () =>
          (window as unknown as { extensionEvents: { type: string; text?: string }[] })
            .extensionEvents,
      );
      expect(
        events.some((event) => event.type === 'snapshot' && event.text?.includes('- [ ] Draft')),
      ).toBe(true);
      expect(events.find((event) => event.type === 'done')?.text).toBe(
        '# Tasks\n\n- [ ] Draft\n- [x] Review',
      );
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
function fixture(provider: string) {
  const editor =
    provider === 'chatgpt'
      ? '<textarea id="prompt-textarea"></textarea>'
      : '<div class="ProseMirror" contenteditable="true" role="textbox"></div>';
  const send = provider === 'chatgpt' ? 'data-testid="send-button"' : 'aria-label="Send message"';
  const stop = provider === 'chatgpt' ? 'data-testid="stop-button"' : 'aria-label="Stop response"';
  const answer =
    provider === 'chatgpt'
      ? '<div data-message-author-role="assistant"><div class="markdown" id="answer"></div></div>'
      : '<div data-testid="assistant-message" id="answer"></div>';
  return `<!doctype html><html><body>${editor}<button id="send" ${send}>Send</button><script>
  document.getElementById('send').onclick=()=> {
    const stop=document.createElement('button');stop.outerHTML;
    document.body.insertAdjacentHTML('beforeend','<button id="stop" ${stop}>Stop</button>${answer}');
    document.getElementById('answer').innerHTML='<h1>Tasks</h1><ul><li><input type="checkbox" disabled>Draft</li></ul>';
    setTimeout(()=> {
      document.getElementById('answer').innerHTML='<h1>Tasks</h1><ul><li><input type="checkbox" disabled>Draft</li><li><input type="checkbox" checked disabled>Review</li></ul>';
      document.getElementById('stop').remove();
    },600);
  };
  </script></body></html>`;
}
