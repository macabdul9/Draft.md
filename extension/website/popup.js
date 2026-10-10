const status = document.getElementById('status');
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let origin;
try {
  const url = new URL(tab?.url || '');
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
    origin = url.origin;
} catch {
  /* Only loopback Draft.md installations can be paired. */
}
document.getElementById('origin').textContent = origin || 'Open your Draft.md tab first.';
for (const [id, connect] of [
  ['connect', true],
  ['disconnect', false],
]) {
  const button = document.getElementById(id);
  button.disabled = !origin;
  button.onclick = async () => {
    const saved = await chrome.storage.local.get('origins');
    const origins = new Set(saved.origins || []);
    if (connect) origins.add(origin);
    else origins.delete(origin);
    await chrome.storage.local.set({ origins: [...origins] });
    status.textContent = connect
      ? 'Connected. Use @chatgpt or @claude in your note.'
      : 'Disconnected.';
  };
}
