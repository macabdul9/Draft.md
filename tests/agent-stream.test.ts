import { afterEach, expect, test, vi } from 'vitest';
import { LocalModelClient } from '../src/agents/local-models';
afterEach(() => vi.unstubAllGlobals());
function response(parts: string[]) {
  const bytes = new TextEncoder().encode(parts.join(''));
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
}
test('decodes fragmented Unicode chunks and emits output before done', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response([
          JSON.stringify({ delta: 'Café ' }) + '\n',
          JSON.stringify({ delta: '你好' }) + '\n',
          JSON.stringify({ done: true, text: 'Café 你好' }) + '\n',
        ]),
      ),
  );
  const chunks: string[] = [];
  const result = await new LocalModelClient('test').stream(
    {},
    new AbortController().signal,
    (text) => chunks.push(text),
  );
  expect(chunks).toEqual(['Café ', 'Café 你好']);
  expect(result.text).toBe('Café 你好');
});
test('rejects a truncated stream while delivering partial writing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response([JSON.stringify({ delta: 'Partial' }) + '\n'])),
  );
  const update = vi.fn();
  await expect(
    new LocalModelClient('test').stream({}, new AbortController().signal, update),
  ).rejects.toThrow('ended early');
  expect(update).toHaveBeenCalledWith('Partial');
});
test('reports inference errors after partial writing', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response([
          JSON.stringify({ delta: 'Partial' }) + '\n',
          JSON.stringify({ error: 'Model failed' }) + '\n',
        ]),
      ),
  );
  await expect(
    new LocalModelClient('test').stream({}, new AbortController().signal, () => {}),
  ).rejects.toThrow('Model failed');
});
