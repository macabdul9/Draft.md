import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: process.env.DRAFT_BROWSER_CHANNEL ?? 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    colorScheme: 'light',
  });
  await page.goto(process.env.DRAFT_URL ?? 'http://127.0.0.1:4174');
  await page.getByRole('button', { name: 'New Workspace', exact: true }).waitFor();
  await page.screenshot({ path: 'docs/start-initial.png' });
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await page.getByRole('button', { name: /^Project Notes/ }).click();
  await page.getByLabel('Workspace name').fill('Project notes');
  await page.getByRole('combobox', { name: 'Storage', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page
    .locator('.cm-content')
    .fill(
      '# Project notes\n\nA place for plans, ideas, and everyday work.\n\n## This week\n\n- [x] Gather ideas and references\n- [x] Write the first outline\n- [ ] Share the draft with the team\n\n## Project plan\n\nKeep the **next step** small and clear. Use [the project plan](notes/plan.md) to track milestones.\n\n| Milestone | Status |\n| --- | --- |\n| Outline | Complete |\n| First draft | In progress |\n| Review | Next week |\n\n## Decisions\n\n> [!NOTE]\n> Keep notes close to the work. Everything here is an ordinary Markdown file.\n\n## Next steps\n\nAdd a few examples, review the open questions, and make room for new ideas.\n',
    );
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page
    .getByRole('article', { name: 'Markdown preview' })
    .getByRole('heading', { name: 'Project notes', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/editor-initial.png' });
  console.log('Captured the light-theme start screen and default split editor.');
} finally {
  await browser.close();
}
