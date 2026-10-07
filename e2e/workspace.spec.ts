import { test, expect, type Page } from '@playwright/test';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function browserWorkspace(page: Page, template = 'Paper') {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${template}`) }).click();
  await page.getByLabel('Workspace name').fill('Research');
  await page.getByRole('combobox', { name: 'Storage', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
}
async function repositoryFixture(page: Page) {
  const commit = 'b'.repeat(40);
  const tree = 'a'.repeat(40);
  const note = '# Imported research\n\n![Figure](assets/figure.png)\n';
  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    await route.fulfill({
      json: url.includes('/git/trees/')
        ? {
            truncated: false,
            tree: [
              {
                path: 'README.md',
                mode: '100644',
                type: 'blob',
                size: new TextEncoder().encode(note).length,
              },
              { path: 'assets', mode: '040000', type: 'tree' },
              { path: 'assets/figure.png', mode: '100644', type: 'blob', size: 4 },
              { path: 'linked', mode: '120000', type: 'blob', size: 9 },
            ],
          }
        : url.includes('/commits/')
          ? { sha: commit, commit: { tree: { sha: tree } } }
          : { default_branch: 'main' },
    });
  });
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    expect(route.request().url()).toContain(`/${commit}/`);
    await route.fulfill({
      body: route.request().url().endsWith('.png') ? Buffer.from([0, 255, 128, 42]) : note,
    });
  });
  return note;
}
test('to-do template supports quick tasks, checkbox completion, and saved Markdown', async ({
  page,
}) => {
  await browserWorkspace(page, 'To-do List');
  await expect(page.getByText('0 of 1 completed', { exact: true })).toBeVisible();
  await page.getByLabel('New task').fill('Pick up groceries');
  await page.getByLabel('New task').press('Enter');
  await expect(page.getByText('0 of 2 completed', { exact: true })).toBeVisible();
  await page.locator('.cm-draftly-task-checkbox input').last().click();
  await expect(page.getByText('1 of 2 completed', { exact: true })).toBeVisible();
  await expect.poll(() => readBrowserFile(page, 'todo.md')).toContain('- [x] Pick up groceries');
  await page.getByRole('button', { name: 'New note tab' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('weekend.md');
  await page.getByLabel('Template', { exact: true }).selectOption('todo');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'weekend.md' })).toBeVisible();
  expect(await readBrowserFile(page, 'weekend.md')).toContain('- [ ] Add your first task');
  await page.getByRole('button', { name: 'New note tab' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Research Browser workspace/ }).click();
  await page.getByRole('tab', { name: 'todo.md' }).click();
  await expect(page.getByText('1 of 2 completed', { exact: true })).toBeVisible();
});
test('imports a public repository snapshot into browser storage and reopens it offline', async ({
  page,
  context,
}) => {
  const note = await repositoryFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Repository', exact: true }).click();
  await page.getByLabel('Repository URL').fill('https://github.com/research/notes.git');
  await expect(page.getByLabel('Workspace name')).toHaveValue('notes');
  await page.getByRole('button', { name: 'Download repository', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Markdown preview' })).toContainText(
    'Imported research',
  );
  expect(await readBrowserFile(page, 'README.md')).toBe(note);
  expect(
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('draft-md', 1);
        request.onsuccess = () => resolve(request.result);
      });
      const records = await new Promise<{ id: string }[]>((resolve) => {
        const request = db.transaction('workspaces').objectStore('workspaces').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      const root = await navigator.storage.getDirectory();
      const workspace = await root.getDirectoryHandle(`draft-${records[0].id}`);
      const assets = await workspace.getDirectoryHandle('assets');
      return Array.from(
        new Uint8Array(
          await (await (await assets.getFileHandle('figure.png')).getFile()).arrayBuffer(),
        ),
      );
    }),
  ).toEqual([0, 255, 128, 42]);
  await expect(page.getByText(/Skipped 1 symbolic links or submodules/)).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /notes Browser workspace/ }).click();
  await expect(page.locator('.cm-content')).toContainText('Imported research');
});
test('repository errors stay in the dialog and leave the active workspace intact', async ({
  page,
}) => {
  await browserWorkspace(page);
  await page
    .getByRole('button', { name: /Research/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Import Repository', exact: true }).click();
  await page.getByLabel('Repository URL').fill('https://gitlab.com/research/notes');
  await page.getByLabel('Workspace name').fill('notes');
  await page.getByRole('button', { name: 'Download repository', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('github.com');
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ status: 403, json: { message: 'rate limit' } }),
  );
  await page.getByLabel('Repository URL').fill('research/notes');
  await page.getByRole('button', { name: 'Download repository', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('rate limit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.workspace-switch')).toContainText('Research');
});
test('repository local imports create a new collision-safe folder', async ({ page }) => {
  const note = await repositoryFixture(page);
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      const parent = await root.getDirectoryHandle('repository-parent', { create: true });
      const existing = await parent.getDirectoryHandle('notes', { create: true });
      const file = await existing.getFileHandle('README.md', { create: true });
      const writable = await file.createWritable();
      await writable.write('Existing notes must remain unchanged.');
      await writable.close();
      return parent;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Repository', exact: true }).click();
  await page.getByLabel('Repository URL').fill('research/notes');
  await page.getByRole('combobox', { name: 'Storage', exact: true }).selectOption('local');
  await page.getByRole('button', { name: 'Download repository', exact: true }).click();
  await expect(page.locator('.workspace-switch')).toContainText('notes 2');
  await expect(page.locator('.cm-content')).toContainText('Imported research');
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const parent = await root.getDirectoryHandle('repository-parent');
      const original = await parent.getDirectoryHandle('notes');
      const imported = await parent.getDirectoryHandle('notes 2');
      return [
        await (await (await original.getFileHandle('README.md')).getFile()).text(),
        await (await (await imported.getFileHandle('README.md')).getFile()).text(),
      ];
    }),
  ).toEqual(['Existing notes must remain unchanged.', note]);
});
test('cancelling a repository download creates no workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Repository', exact: true }).click();
  await page.route('https://api.github.com/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ json: { default_branch: 'main' } }).catch(() => undefined);
  });
  await page.getByLabel('Repository URL').fill('research/notes');
  await page.getByRole('button', { name: 'Download repository', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Open a folder to pick up where you left off.')).toBeVisible();
});
async function readBrowserFile(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('draft-md', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<{ id: string }[]>((resolve) => {
      const request = database.transaction('workspaces').objectStore('workspaces').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    const root = await navigator.storage.getDirectory();
    const workspace = await root.getDirectoryHandle(`draft-${records[0].id}`);
    let folder = workspace;
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
    return (await (await folder.getFileHandle(parts.at(-1)!)).getFile()).text();
  }, path);
}
test('defaults to rich editor and live preview in split mode', async ({ page }) => {
  await browserWorkspace(page);
  const editor = page.locator('.editor-host');
  const preview = page.getByRole('article', { name: 'Markdown preview' });
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveClass('selected');
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  const left = await editor.boundingBox();
  const right = await preview.boundingBox();
  expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width - 1);
  await page.locator('.cm-content').fill('# Split workspace\n\nLive preview updates.');
  await expect(preview.getByRole('heading', { name: 'Split workspace' })).toBeVisible();
  await expect(preview).toContainText('Live preview updates.');
  await page.getByRole('button', { name: 'Rich Markdown', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(preview).toContainText('Live preview updates.');
  await page.setViewportSize({ width: 600, height: 900 });
  const top = await editor.boundingBox();
  const bottom = await preview.boundingBox();
  expect(bottom!.y).toBeGreaterThanOrEqual(top!.y + top!.height - 1);
});
async function nativeFixture(page: Page) {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      const fixture = await root.getDirectoryHandle('Research', { create: true });
      const papers = await fixture.getDirectoryHandle('papers', { create: true });
      try {
        await papers.getFileHandle('study.md');
      } catch {
        const file = await papers.getFileHandle('study.md', { create: true });
        const stream = await file.createWritable();
        await stream.write('# Study\n\nOriginal disk text.\n');
        await stream.close();
      }
      return fixture;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open Folder/ }).click();
  await expect(page.getByText('On your computer')).toBeVisible();
}
async function fixtureText(page: Page, text?: string) {
  return page.evaluate(async (text) => {
    const root = await navigator.storage.getDirectory();
    const fixture = await root.getDirectoryHandle('Research');
    const papers = await fixture.getDirectoryHandle('papers');
    const handle = await papers.getFileHandle('study.md');
    if (text !== undefined) {
      const stream = await handle.createWritable();
      await stream.write(text);
      await stream.close();
    }
    return (await handle.getFile()).text();
  }, text);
}
test('browser workspace exact persistence, tabs, search, backup and reopening', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await browserWorkspace(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.fill('# Portable research\n\nA distinctive search phrase.\n');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(await readBrowserFile(page, 'paper.md')).toBe(
    '# Portable research\n\nA distinctive search phrase.\n',
  );
  await page.getByRole('button', { name: 'New note tab' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('ideas.md');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'ideas.md' })).toBeVisible();
  await editor.fill('# Ideas\n\nSecond document.');
  await page.getByRole('tab', { name: 'paper.md' }).click();
  await expect(editor).toContainText('Portable research');
  await page.getByRole('tab', { name: 'ideas.md' }).click();
  await expect(editor).toContainText('Second document');
  await page.keyboard.press(`${modifier}+Shift+f`);
  await page.getByRole('combobox').fill('distinctive');
  await expect(page.getByRole('option').first()).toContainText('paper.md');
  await page.getByRole('option').first().click();
  await expect(editor).toContainText('Portable research');
  await page.locator('.sidebar-workspace>button').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP / Back up' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Research.zip');
  await page.reload();
  await page.locator('.start-recents .workspace-row').click();
  await expect(editor).toContainText('Portable research');
  expect(errors).toEqual([]);
});
test('native adapter uses the same granted handle and blocks external overwrites', async ({
  page,
}) => {
  await nativeFixture(page);
  await page.getByRole('button', { name: 'papers', exact: true }).click();
  await page.getByRole('button', { name: 'study.md', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').fill('# Study\n\nMy exact disk edit.\n');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(await fixtureText(page)).toBe('# Study\n\nMy exact disk edit.\n');
  await fixtureText(page, '# Study\n\nAn external edit.\n');
  await page.locator('.cm-content').fill('# Study\n\nMy pending version.\n');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByText('Autosave is paused.', { exact: false })).toBeVisible();
  expect(await fixtureText(page)).toContain('external edit');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('My pending version');
  await page.getByRole('button', { name: 'Close comparison' }).click();
  await page.getByRole('button', { name: 'Keep Draft.md version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(await fixtureText(page)).toContain('My pending version');
});
test('research preview renders math, diagrams and local images without remote requests', async ({
  page,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1') && !request.url().startsWith('blob:'))
      remote.push(request.url());
  });
  await browserWorkspace(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page
    .locator('.cm-content')
    .fill(
      '# Project notes\n\n$E=mc^2$\n\n```mermaid\ngraph LR\n A[Plan] --> B[Write]\n```\n\n> [!HYPOTHESIS]\n> Try a small prototype.\n\n![blocked](https://tracker.invalid/image.png)\n\n<script>window.pwned=true</script>',
    );
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.preview .katex')).toBeVisible();
  await expect(page.locator('.preview .mermaid-block svg')).toBeVisible();
  await expect(page.locator('.preview .callout.hypothesis')).toBeVisible();
  await expect(page.locator('.preview .asset-unavailable')).toContainText(
    'remote resources are blocked',
  );
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
  expect(remote).toEqual([]);
  await page.screenshot({ path: 'docs/workspace-preview.png', fullPage: true });
});
test('unsupported browser explains storage, dialogs manage keyboard and theme works', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open Folder/ })).toBeDisabled();
  await expect(
    page.getByText('Direct folder access isn’t available', { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/start-screen.png', fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
});
test('offline shell reopens browser files and lazily renders math and Mermaid', async ({
  page,
  context,
}) => {
  await browserWorkspace(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page
    .locator('.cm-content')
    .fill('# Offline\n\n$E=mc^2$\n\n```mermaid\ngraph LR\n A --> B\n```');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.start-recents .workspace-row').click();
  await expect(page.locator('.cm-content')).toContainText('Offline');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.preview .katex')).toBeVisible();
  await expect(page.locator('.preview .mermaid-block svg')).toBeVisible();
  await context.setOffline(false);
});

test('file operations preserve notes and pasted assets use document-relative paths', async ({
  page,
}) => {
  await browserWorkspace(page);
  await page.getByRole('button', { name: 'notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note tab' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('experiment.md');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'experiment.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').fill('# Experiment\n\n');
  await page.locator('.cm-content').press(`${modifier}+End`);
  await page.evaluate(() => {
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    document
      .querySelector('.cm-content')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
  await expect(page.locator('.cm-content')).toContainText('../assets/pasted-');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(await readBrowserFile(page, 'notes/experiment.md')).toContain('../assets/pasted-');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.preview img')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.preview img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await page.locator('.preview img').click();
  await expect(page.locator('.asset-viewer>img')).toBeVisible();
  await page.getByRole('tab', { name: 'experiment.md' }).click();
  const note = page.getByRole('tree').getByRole('button', { name: 'experiment.md', exact: true });
  await note.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'experiment 2.md' })).toBeVisible();
  expect(await readBrowserFile(page, 'notes/experiment 2.md')).toBe(
    await readBrowserFile(page, 'notes/experiment.md'),
  );
  await page
    .getByRole('tree')
    .getByRole('button', { name: 'experiment 2.md', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('notes/moved.md');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'moved.md' })).toBeVisible();
  expect(await readBrowserFile(page, 'notes/moved.md')).toContain('# Experiment');
  await page
    .getByRole('tree')
    .getByRole('button', { name: 'moved.md', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('permanently removes');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('tab', { name: 'moved.md' })).not.toBeVisible();
});

test('local PDF viewer and invalid Mermaid show useful results', async ({ page }) => {
  await browserWorkspace(page);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'local.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
      ),
    });
  await page.getByRole('tree').getByRole('button', { name: 'local.pdf', exact: true }).click();
  await expect(page.getByTitle('PDF: local.pdf')).toBeVisible();
  await expect(page.getByTitle('PDF: local.pdf')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('tab', { name: 'paper.md' }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').fill('# Invalid\n\n```mermaid\nthis is not a diagram\n```');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.preview .diagram-error')).toContainText(
    'Diagram could not be rendered',
  );
});

test('undo history and cursor survive switching documents and viewing assets', async ({ page }) => {
  await browserWorkspace(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.fill('# Remember\n\nOriginal text.');
  await editor.press(`${modifier}+End`);
  await page.keyboard.type(' Added text.');
  const position = await editor.evaluate(
    (element) =>
      (
        element as unknown as {
          cmTile: { root: { view: { state: { selection: { main: { head: number } } } } } };
        }
      ).cmTile.root.view.state.selection.main.head,
  );
  await page.getByRole('tree').getByRole('button', { name: 'references.bib', exact: true }).click();
  await page.getByRole('tab', { name: 'paper.md' }).click();
  await expect(editor).toContainText('Added text.');
  expect(
    await editor.evaluate(
      (element) =>
        (
          element as unknown as {
            cmTile: { root: { view: { state: { selection: { main: { head: number } } } } } };
          }
        ).cmTile.root.view.state.selection.main.head,
    ),
  ).toBe(position);
  await editor.focus();
  await page.keyboard.press(`${modifier}+z`);
  await expect(editor).not.toContainText('Added text.');
  await expect(editor).toContainText('Original text.');
});

test('folder import collisions preserve internal links under a new root', async ({ page }) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const temporary = await mkdtemp(join(tmpdir(), 'draft-import-'));
  const directory = join(temporary, 'notes');
  try {
    await mkdir(directory);
    await writeFile(join(directory, 'sample.md'), '# Imported\n\n![Figure](figure.png)');
    await writeFile(
      join(directory, 'figure.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=',
        'base64',
      ),
    );
    await browserWorkspace(page);
    await page.locator('input[type=file]').last().setInputFiles(directory);
    await expect(
      page.getByRole('tree').getByRole('button', { name: 'notes 2', exact: true }),
    ).toBeVisible();
    expect(await readBrowserFile(page, 'notes 2/sample.md')).toContain('](figure.png)');
    await page.getByRole('tree').getByRole('button', { name: 'notes 2', exact: true }).click();
    await page.getByRole('tree').getByRole('button', { name: 'sample.md', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('.preview img')).toBeVisible();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('empty guide, block and reference shortcuts, and default light theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await browserWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.fill('');
  await expect(page.locator('.editor-empty-guide')).toBeVisible();
  await editor.press('\\');
  await page.keyboard.type('Task');
  await expect(page.getByRole('option', { name: 'Task list', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor).toContainText('- [ ]');
  await expect(page.locator('.editor-empty-guide')).toHaveCount(0);
  await editor.fill('');
  await expect(page.locator('.editor-empty-guide')).toBeVisible();
  await page.keyboard.type('@Today');
  await expect(page.getByRole('option', { name: /Today/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(editor).toContainText(/\d{4}-\d{2}-\d{2}/);
  await editor.fill('');
  await page.keyboard.type('@');
  await expect(page.getByRole('option', { name: /references.bib/ })).toBeVisible();
  await page.getByRole('option', { name: /references.bib/ }).click();
  await expect(editor).toContainText('[references.bib](<references.bib>)');
  await editor.fill('| Item | Status |\n| --- | --- |\n| First | \\Add table row');
  await editor.press('End');
  await expect(page.getByRole('option', { name: /Add table row/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor).toContainText('| First |');
  await expect(editor).not.toContainText('\\Add table row');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('latex fences render booktabs tables in preview and rich editor', async ({ page }) => {
  await browserWorkspace(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = String.raw`\begin{table}[]
\centering
\caption{Project overview}
\begin{tabular}{lrr}
\toprule
\textbf{Item} & \textbf{Quantity} & \textbf{Total} \\
\midrule
Notes & 12 & $24$ \\
Tasks & 8 & $16$ \\
\bottomrule
\end{tabular}
\end{table}`;
  await page
    .locator('.cm-content')
    .fill('```latex\n' + source + '\n```\n\nOutside the LaTeX block.');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  const preview = page.locator('.preview');
  await expect(preview.locator('.latex-table caption')).toHaveText('Project overview');
  await expect(preview.locator('.latex-table tr')).toHaveCount(3);
  await expect(preview.locator('.latex-table .katex')).toHaveCount(2);
  await expect(page.locator('.research-widget .latex-table')).toBeVisible();
  await page.screenshot({ path: 'docs/latex-table.png', fullPage: true });
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('\\begin{tabular}{lrr}');
  await page.locator('.cm-content').press(`${modifier}+s`);
  await page.reload();
  await page.getByRole('button', { name: /Research Browser workspace/ }).click();
  await expect(page.locator('.cm-content')).toContainText('\\caption{Project overview}');
});
