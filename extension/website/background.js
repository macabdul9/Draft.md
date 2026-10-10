const jobs = new Map();
const providerTabs = new Map();
const sites = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new' };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function editorOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
function emit(job, message) {
  try {
    job.port.postMessage({ id: job.id, ...message });
  } catch {
    void cancel(job);
  }
}
async function cancel(job) {
  jobs.delete(job.id);
  if (job.tabId) {
    try {
      await chrome.tabs.sendMessage(job.tabId, { type: 'draft.stop', id: job.id });
    } catch {
      /* The provider tab may have closed. */
    }
  }
}
async function run(job, prompt) {
  try {
    if ([...jobs.values()].some((other) => other !== job && other.provider === job.provider))
      throw new Error('This website is already writing. Stop or finish that request first.');
    const previous = providerTabs.get(job.provider);
    let tab;
    if (previous) {
      try {
        tab = await chrome.tabs.update(previous, { url: sites[job.provider] });
      } catch {
        providerTabs.delete(job.provider);
      }
    }
    if (!tab) tab = await chrome.tabs.create({ url: sites[job.provider], active: false });
    if (!jobs.has(job.id)) return;
    job.tabId = tab.id;
    providerTabs.set(job.provider, tab.id);
    emit(job, { type: 'progress', text: 'Waiting for the signed-in website…' });
    let delivered = false;
    for (let attempt = 0; attempt < 60 && jobs.has(job.id); attempt++) {
      const state = await chrome.tabs.get(tab.id);
      if (state.status === 'complete') {
        try {
          const answer = await chrome.tabs.sendMessage(tab.id, {
            type: 'draft.write',
            id: job.id,
            provider: job.provider,
            prompt,
          });
          if (answer?.accepted) {
            delivered = true;
            break;
          }
        } catch {
          /* Content scripts can take a moment to attach after navigation. */
        }
      }
      await pause(500);
    }
    if (!delivered && jobs.has(job.id))
      throw new Error(
        'Open the provider tab, sign in, and try again. The website bridge could not start.',
      );
  } catch (error) {
    emit(job, { error: error instanceof Error ? error.message : String(error) });
    await cancel(job);
  }
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'draft-editor') return;
  const origin = editorOrigin(port.sender?.url || '');
  if (!origin || port.sender?.frameId !== 0) {
    port.disconnect();
    return;
  }
  const cancelled = new Set();
  port.onMessage.addListener(async (message) => {
    if (!message || typeof message.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(message.id))
      return;
    if (message.type === 'cancel') cancelled.add(message.id);
    const paired = await chrome.storage.local.get('origins');
    if (!paired.origins?.includes(origin)) {
      port.postMessage({
        id: message.id,
        error: 'Click the Draft.md extension and connect this tab first.',
      });
      return;
    }
    if (message.type === 'ping') {
      port.postMessage({ id: message.id, type: 'ready' });
      return;
    }
    if (message.type === 'cancel') {
      const job = jobs.get(message.id);
      if (job?.port === port) await cancel(job);
      return;
    }
    if (
      message.type !== 'write' ||
      !Object.hasOwn(sites, message.provider) ||
      typeof message.prompt !== 'string' ||
      message.prompt.length > 20000 ||
      jobs.has(message.id) ||
      cancelled.has(message.id)
    )
      return;
    const job = { id: message.id, provider: message.provider, port };
    jobs.set(job.id, job);
    void run(job, message.prompt);
  });
  port.onDisconnect.addListener(() => {
    for (const job of jobs.values()) if (job.port === port) void cancel(job);
  });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'draft.event') return;
  const job = jobs.get(message.id);
  if (
    !job ||
    sender.tab?.id !== job.tabId ||
    sender.frameId !== 0 ||
    new URL(sender.url || 'https://invalid').origin !== new URL(sites[job.provider]).origin
  ) {
    respond({ active: false });
    return;
  }
  const event = message.event;
  if (!event || !['snapshot', 'done', 'progress', 'error', 'heartbeat'].includes(event.type)) {
    respond({ active: false });
    return;
  }
  if (event.type !== 'heartbeat') {
    if (event.text && (typeof event.text !== 'string' || event.text.length > 65536)) {
      emit(job, { error: 'The draft exceeds the writing size limit.' });
      void cancel(job);
      respond({ active: false });
      return;
    }
    emit(job, event.type === 'error' ? { error: event.text } : event);
  }
  if (['done', 'error'].includes(event.type)) jobs.delete(job.id);
  respond({ active: true });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const job of jobs.values())
    if (job.tabId === tabId) {
      emit(job, { error: 'The website tab was closed. Partial writing was kept.' });
      jobs.delete(job.id);
    }
  for (const [provider, id] of providerTabs) if (id === tabId) providerTabs.delete(provider);
});
