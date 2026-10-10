(() => {
  let port;
  const pending = new Set();
  function connect() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'draft-editor' });
    port.onMessage.addListener((message) => {
      if (!pending.has(message.id)) return;
      window.postMessage({ source: 'draft-md-extension', ...message }, location.origin);
      if (message.type === 'done' || message.error) pending.delete(message.id);
    });
    port.onDisconnect.addListener(() => {
      for (const id of pending)
        window.postMessage(
          {
            source: 'draft-md-extension',
            id,
            error: 'The website extension disconnected. Reconnect it and try again.',
          },
          location.origin,
        );
      pending.clear();
      port = undefined;
    });
    return port;
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !data ||
      data.source !== 'draft-md'
    )
      return;
    if (
      !['ping', 'write', 'cancel'].includes(data.type) ||
      typeof data.id !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(data.id)
    )
      return;
    if (
      data.type === 'write' &&
      (!['chatgpt', 'claude'].includes(data.provider) ||
        typeof data.prompt !== 'string' ||
        data.prompt.length > 20000)
    )
      return;
    if (data.type !== 'cancel') pending.add(data.id);
    connect().postMessage({
      type: data.type,
      id: data.id,
      provider: data.provider,
      prompt: data.prompt,
    });
    if (data.type === 'cancel') pending.delete(data.id);
  });
})();
