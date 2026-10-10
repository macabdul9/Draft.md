export function writeThroughWebsite(
  provider: 'chatgpt' | 'claude',
  prompt: string,
  signal: AbortSignal,
  update: (text: string) => void,
  status: (text: string) => void,
): Promise<{ text: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let ready = false;
    let text = '';
    const send = (type: string, extra = {}) =>
      window.postMessage({ source: 'draft-md', type, id, ...extra }, location.origin);
    const timer = window.setTimeout(() => {
      send('cancel');
      finish(
        new Error(
          'The website took too long. Partial writing is kept. Check its tab and try again.',
        ),
      );
    }, 300_000);
    const handshake = window.setTimeout(() => {
      if (!ready)
        finish(
          new Error(
            'Connect this Draft.md tab using the Draft.md website extension, then try again.',
          ),
        );
    }, 2000);
    function finish(error?: Error) {
      clearTimeout(timer);
      clearTimeout(handshake);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ text });
    }
    function abort() {
      send('cancel');
      finish(
        signal.reason instanceof Error ? signal.reason : new DOMException('Stopped', 'AbortError'),
      );
    }
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data;
      if (!message || message.source !== 'draft-md-extension' || message.id !== id) return;
      if (message.error) {
        finish(new Error(String(message.error)));
        return;
      }
      if (message.type === 'ready' && !ready) {
        ready = true;
        clearTimeout(handshake);
        status(`Opening ${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'}…`);
        send('write', { provider, prompt });
      } else if (message.type === 'snapshot' && typeof message.text === 'string') {
        if (message.text.length > 65536) {
          send('cancel');
          finish(new Error('The draft exceeds the 64 KB writing limit.'));
          return;
        }
        text = message.text;
        update(text);
        status('Writing…');
      } else if (message.type === 'progress' && typeof message.text === 'string')
        status(message.text);
      else if (message.type === 'done') {
        if (typeof message.text === 'string') {
          text = message.text;
          update(text);
        }
        if (!text.trim()) finish(new Error('The website returned no writing. Check its tab.'));
        else finish();
      }
    }
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    send('ping');
  });
}
