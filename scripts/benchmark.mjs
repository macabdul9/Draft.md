import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import { gzipSync } from 'node:zlib';

const baseURL = process.env.DRAFT_URL ?? 'http://127.0.0.1:4174';
const browser = await chromium.launch({ channel: process.env.DRAFT_BROWSER_CHANNEL ?? 'chrome' });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'dark',
});
const report = {
  date: new Date().toISOString(),
  hardware: {
    platform: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0].model,
    logicalCores: os.cpus().length,
    ramGB: Math.round(os.totalmem() / 1024 ** 3),
  },
  browser: await browser.version(),
  method:
    'Production static build on localhost. Performance.now around CodeMirror dispatchTransactions for text-changing transactions; real keyboard typing (20ms between keys). These measure synchronous editing work, excluding layout/paint, asynchronous renderers and OS disk latency.',
  measurements: {},
};
const start = performance.now();
await page.goto(baseURL);
await page.getByRole('button', { name: 'New Workspace', exact: true }).waitFor();
report.measurements.coldShellMs = performance.now() - start;
await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
await page.getByRole('combobox', { name: 'Storage', exact: true }).selectOption('browser');
const first = performance.now();
await page.getByRole('button', { name: 'Create workspace' }).click();
await page.locator('.cm-content').waitFor();
report.measurements.firstEditorMs = performance.now() - first;
const paragraph =
  'Research notes connect observations to testable questions. Keep the source readable and the experiments reproducible. **Important evidence** deserves a careful record.\n\n';
const ordinary =
  '# Research notebook\n\n## Question\n\n' +
  paragraph.repeat(12) +
  '## Setup\n\n- Baseline measurement\n- Repeated trials\n\n| Model | Accuracy |\n| --- | ---: |\n| A | 72.1 |\n\n```python\nprint("results")\n```\n\n## Observations\n\n';
const large = ordinary.repeat(110);
report.workloads = {
  ordinaryCharacters: ordinary.length,
  largeCharacters: large.length,
  tabs: 8,
  workspaceFiles: 5000,
};
async function instrument() {
  await page.evaluate(() => {
    const view = document.querySelector('.cm-content').cmTile.root.view;
    window.draftDurations = [];
    const dispatch = view.draftOriginalDispatch ?? view.dispatchTransactions.bind(view);
    view.draftOriginalDispatch = dispatch;
    view.dispatchTransactions = (transactions) => {
      const start = performance.now();
      dispatch(transactions);
      if (transactions.some((transaction) => transaction.docChanged))
        window.draftDurations.push(performance.now() - start);
    };
  });
}
async function typing(text) {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').fill(text);
  await page.getByRole('button', { name: 'Rich Markdown', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+End');
  await instrument();
  await page.keyboard.type(
    'Careful observations make good research. Repeat the experiment and record each result.',
    { delay: 20 },
  );
  const values = await page.evaluate(() => window.draftDurations);
  values.sort((a, b) => a - b);
  return {
    transactions: values.length,
    p50Ms: values[Math.floor(values.length * 0.5)],
    p95Ms: values[Math.floor(values.length * 0.95)],
    maxMs: values.at(-1),
  };
}
report.measurements.ordinaryRichTyping = await typing(ordinary);
report.measurements.largeRichTyping = await typing(large);
// Seed ordinary files in a separate browser-owned folder; never touch an OS directory.
const generated = await page.evaluate(
  async ({ ordinary, large }) => {
    const root = await navigator.storage.getDirectory();
    const workspace = await root.getDirectoryHandle('draft-benchmark', { create: true });
    for (let i = 0; i < 5000; i++) {
      const handle = await workspace.getFileHandle(`note-${String(i).padStart(4, '0')}.md`, {
        create: true,
      });
      const writer = await handle.createWritable();
      await writer.write(i === 4999 ? large : ordinary);
      await writer.close();
    }
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('draft-md', 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const request = db.transaction('workspaces', 'readwrite').objectStore('workspaces').put({
        id: 'benchmark',
        name: 'Benchmark — 5,000 notes',
        kind: 'browser',
        lastOpened: Date.now(),
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    return true;
  },
  { ordinary, large },
);
report.generated = generated;
await page.reload();
const workspaceStart = performance.now();
await page.getByRole('button', { name: /Benchmark — 5,000 notes/ }).click();
await page.getByRole('button', { name: 'note-0000.md', exact: true }).waitFor();
report.measurements.workspaceTreeMs = performance.now() - workspaceStart;
report.measurements.treeRows = await page.locator('.tree-row').count();
const usable = performance.now();
await page.getByRole('button', { name: 'note-0000.md', exact: true }).click();
await page.locator('.cm-content').waitFor();
report.measurements.editorDuringIndexingMs = performance.now() - usable;
report.measurements.indexStatusWhenUsable = await page.locator('.sidebar-bottom>small').innerText();
await page
  .locator('.sidebar-bottom>small')
  .filter({ hasText: '5000 files indexed locally' })
  .waitFor({ timeout: 180000 });
report.measurements.fullIndexMs = performance.now() - workspaceStart;
for (let i = 1; i < 8; i++) {
  await page
    .getByRole('button', { name: `note-${String(i).padStart(4, '0')}.md`, exact: true })
    .click();
  await page.getByRole('tab', { name: `note-${String(i).padStart(4, '0')}.md` }).waitFor();
}
const activations = [];
for (let i = 0; i < 24; i++) {
  const begin = performance.now();
  await page.getByRole('tab', { name: `note-${String(i % 8).padStart(4, '0')}.md` }).click();
  await page.locator('.cm-content').waitFor();
  activations.push(performance.now() - begin);
}
activations.sort((a, b) => a - b);
report.measurements.warmActivation = {
  p50Ms: activations[12],
  p95Ms: activations[22],
  note: 'Includes Playwright click scheduling and a locator visibility check; not a pure in-app stopwatch.',
};
await page.keyboard.press('Meta+Shift+f');
const queryStart = performance.now();
await page.getByRole('combobox').fill('reproducible');
await page.getByRole('option').first().waitFor();
report.measurements.searchWithDebounceMs = performance.now() - queryStart;
await page.keyboard.press('Escape');
const manifest = JSON.parse(await fs.readFile('dist/.vite/manifest.json', 'utf8'));
const entry = manifest['index.html'];
const initial = new Set();
function collect(key) {
  const chunk = manifest[key];
  if (!chunk || initial.has(chunk.file)) return;
  initial.add(chunk.file);
  for (const dependency of chunk.imports ?? []) collect(dependency);
}
collect('index.html');
let initialGzip = 0;
for (const file of initial) initialGzip += gzipSync(await fs.readFile('dist/' + file)).length;
const assets = await fs.readdir('dist/assets');
let total = 0,
  raw = 0;
for (const file of assets.filter((file) => file.endsWith('.js'))) {
  const bytes = await fs.readFile('dist/assets/' + file);
  total += gzipSync(bytes).length;
  raw += bytes.length;
}
report.bundle = {
  initialFiles: [...initial],
  initialJavaScriptGzipBytes: initialGzip,
  totalJavaScriptGzipBytes: total,
  totalJavaScriptRawBytes: raw,
  editorGzipBytes: gzipSync(
    await fs.readFile(
      'dist/' +
        manifest[
          '_' +
            Object.keys(manifest)
              .find((key) => key.startsWith('_EditorPane'))
              .slice(1)
        ].file,
    ),
  ).length,
  entry: entry.file,
};
await fs.writeFile('docs/performance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: 'docs/benchmark-workspace.png' });
await browser.close();
