// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { writeThroughWebsite } from '../src/agents/website';
afterEach(() => vi.restoreAllMocks());
test('website snapshots stream into the editor and ignore other origins', async () => {
  const updates: string[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    const dispatch = (value: object, origin = location.origin) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'draft-md-extension', id: message.id, ...value },
          origin,
          source: window,
        }),
      );
    if (message.type === 'ping') queueMicrotask(() => dispatch({ type: 'ready' }));
    if (message.type === 'write')
      queueMicrotask(() => {
        dispatch({ type: 'snapshot', text: 'Wrong origin' }, 'https://untrusted.example');
        dispatch({ type: 'snapshot', text: '- [ ] First' });
        dispatch({ type: 'snapshot', text: '- [ ] First\n- [ ] Second' });
        dispatch({ type: 'done', text: '- [ ] First\n- [ ] Second' });
      });
  });
  const result = await writeThroughWebsite(
    'chatgpt',
    'Write tasks',
    new AbortController().signal,
    (text) => updates.push(text),
    () => {},
  );
  expect(updates[0]).toBe('- [ ] First');
  expect(updates).not.toContain('Wrong origin');
  expect(result.text).toBe('- [ ] First\n- [ ] Second');
});
test('Escape cancellation stops the website job without waiting for a response', async () => {
  const messages: { type: string }[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    messages.push(message);
  });
  const abort = new AbortController();
  const result = writeThroughWebsite(
    'claude',
    'Write tasks',
    abort.signal,
    () => {},
    () => {},
  );
  abort.abort();
  await expect(result).rejects.toThrow();
  expect(messages.map((message) => message.type)).toEqual(['ping', 'cancel']);
});
