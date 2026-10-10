import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

test('a new build activates with an old tab open and preserves browser storage', async ({
  page,
}) => {
  let upgraded = false;
  const oldWorker = `
    self.addEventListener('install',event=>event.waitUntil(caches.open('old-shell').then(cache=>cache.put('/',new Response('<h1>Old agent panel build</h1>',{headers:{'Content-Type':'text/html'}})))));
    self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(caches.open('old-shell').then(cache=>cache.match('/')))});
  `;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/sw.js' && !upgraded) {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(oldWorker);
      return;
    }
    if (path === '/' && !upgraded) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<h1>Old agent panel build</h1>');
      return;
    }
    const target = resolve('dist', path === '/' ? 'index.html' : '.' + path);
    if (!target.startsWith(resolve('dist') + '/')) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.setHeader(
        'Content-Type',
        (
          {
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.html': 'text/html',
            '.json': 'application/json',
            '.woff2': 'font/woff2',
          } as Record<string, string>
        )[extname(target)] || 'application/octet-stream',
      );
      response.end(await readFile(target));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      localStorage.setItem('saved-note-test', 'Keep my writing');
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    upgraded = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('Missing registration');
      await registration.update();
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return !!registration?.active && !registration.waiting && !registration.installing;
        }),
      )
      .toBe(true);
    await expect(page.getByRole('heading', { name: 'Old agent panel build' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'New Workspace', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('saved-note-test'))).toBe(
      'Keep my writing',
    );
    await expect(page.getByRole('button', { name: 'AI Agent', exact: true })).toHaveCount(0);
  } finally {
    await page.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
