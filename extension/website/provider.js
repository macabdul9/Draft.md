(() => {
  let current;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (selector) =>
    [...document.querySelectorAll(selector)].find(
      (node) => node.getClientRects().length && !node.closest('[aria-hidden="true"]'),
    );
  async function event(job, type, text) {
    const response = await chrome.runtime.sendMessage({
      type: 'draft.event',
      id: job.id,
      event: { type, text },
    });
    if (!response?.active) job.stopped = true;
  }
  async function write(job) {
    try {
      const { siteSelectors, toMarkdown } = await import(chrome.runtime.getURL('dom.js'));
      const selectors = siteSelectors[job.provider];
      let editor;
      for (let i = 0; i < 40 && !job.stopped; i++) {
        editor = visible(selectors.editor);
        if (editor) break;
        await pause(250);
      }
      if (job.stopped) return;
      if (!editor)
        throw new Error(
          'Sign in on the provider tab. Its writing field is unavailable or the website layout changed.',
        );
      if (visible(selectors.stop))
        throw new Error('The website is already generating. Wait for it to finish.');
      if ((editor.value ?? editor.textContent).trim())
        throw new Error(
          'The website has an unsent draft. Clear it in the provider tab, then try again.',
        );
      const existing = new Set(document.querySelectorAll(selectors.answer));
      editor.focus();
      if (editor.tagName === 'TEXTAREA') {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          editor,
          job.prompt,
        );
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (!document.execCommand('insertText', false, job.prompt))
          throw new Error('Could not fill the website composer. Its layout may have changed.');
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: job.prompt }),
        );
      }
      let send;
      for (let i = 0; i < 40 && !job.stopped; i++) {
        send = visible(selectors.send);
        if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') break;
        await pause(100);
      }
      if (job.stopped) return;
      if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true')
        throw new Error(
          'The website cannot send yet. Check login, account limits, or its changed interface.',
        );
      send.click();
      await event(job, 'progress', 'Waiting for the website to write…');
      let text = '',
        changed = Date.now(),
        heartbeat = Date.now();
      const deadline = Date.now() + 300000;
      while (!job.stopped && Date.now() < deadline) {
        const answers = [...document.querySelectorAll(selectors.answer)].filter(
          (node) => !existing.has(node),
        );
        const answer = answers.at(-1);
        const next = answer ? toMarkdown(answer) : '';
        if (next && next !== text) {
          text = next;
          changed = Date.now();
          await event(job, 'snapshot', text);
        }
        if (text && !visible(selectors.stop) && Date.now() - changed > 1800) {
          await event(job, 'done', text);
          return;
        }
        if (Date.now() - heartbeat > 15000) {
          await event(job, 'heartbeat');
          heartbeat = Date.now();
        }
        await pause(150);
      }
      if (!job.stopped)
        throw new Error(
          'The website timed out. Check its tab for login, limits, or a changed layout.',
        );
    } catch (error) {
      if (!job.stopped)
        await event(job, 'error', error instanceof Error ? error.message : String(error)).catch(
          () => {},
        );
    } finally {
      if (current === job) current = undefined;
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'draft.stop' && current?.id === message.id) {
      current.stopped = true;
      const selector =
        current.provider === 'chatgpt'
          ? 'button[data-testid="stop-button"],button[aria-label="Stop streaming"]'
          : 'button[aria-label="Stop response"],button[aria-label="Stop Response"]';
      visible(selector)?.click();
      respond({ stopped: true });
      return;
    }
    if (
      message?.type !== 'draft.write' ||
      current ||
      !['chatgpt', 'claude'].includes(message.provider) ||
      typeof message.prompt !== 'string' ||
      message.prompt.length > 20000
    )
      return;
    const expected = message.provider === 'chatgpt' ? 'chatgpt.com' : 'claude.ai';
    if (location.hostname !== expected) return;
    current = { ...message, stopped: false };
    respond({ accepted: true });
    void write(current);
  });
})();
