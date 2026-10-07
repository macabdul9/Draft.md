import { describe, it, expect, vi } from 'vitest';
import { MemoryFileSystemAdapter } from '../src/filesystem/memory-filesystem';
import { DocumentController } from '../src/state/documents';
async function setup() {
  const fs = new MemoryFileSystemAdapter();
  await fs.createFile('a.md', 'original');
  await fs.createFile('b.md', 'other');
  const controller = new DocumentController(fs, 60000);
  return { fs, controller, doc: await controller.open('a.md') };
}
describe('data preservation', () => {
  it('autosaves after debounce and immediate save cancels pending debounce', async () => {
    vi.useFakeTimers();
    const { fs, controller, doc } = await setup();
    controller.delay = 700;
    let text = 'new text';
    doc.getText = () => text;
    controller.changed(doc);
    await vi.advanceTimersByTimeAsync(699);
    expect(await fs.readText('a.md')).toBe('original');
    await vi.advanceTimersByTimeAsync(1);
    expect(await fs.readText('a.md')).toBe('new text');
    text = 'immediate';
    controller.changed(doc);
    await controller.save(doc);
    expect(await fs.readText('a.md')).toBe('immediate');
    expect(doc.status).toBe('saved');
    controller.dispose();
    vi.useRealTimers();
  });
  it('does not lose edits arriving during a write and serializes writes', async () => {
    const { fs, controller, doc } = await setup();
    let text = 'first';
    doc.getText = () => text;
    controller.changed(doc);
    let complete!: () => void;
    const write = fs.writeFile.bind(fs);
    fs.writeFile = async (p, data) => {
      await new Promise<void>((resolve) => (complete = resolve));
      await write(p, data);
    };
    const save = controller.save(doc);
    await vi.waitFor(() => expect(doc.status).toBe('saving'));
    text = 'second';
    controller.changed(doc);
    complete();
    await save;
    expect(doc.status).toBe('dirty');
    expect(await fs.readText('a.md')).toBe('first');
    fs.writeFile = write;
    await controller.save(doc);
    expect(await fs.readText('a.md')).toBe('second');
    expect(doc.status).toBe('saved');
    controller.dispose();
  });
  it('switches documents and closes without losing pending text', async () => {
    const { fs, controller, doc } = await setup();
    doc.getText = () => 'edited';
    controller.changed(doc);
    await controller.open('b.md');
    await controller.close('a.md');
    expect(await fs.readText('a.md')).toBe('edited');
    controller.dispose();
  });
  it('retains failed saves and refuses closing them', async () => {
    const { fs, controller, doc } = await setup();
    doc.getText = () => 'important draft';
    controller.changed(doc);
    fs.writeFile = async () => {
      throw new Error('quota full');
    };
    await expect(controller.close('a.md')).rejects.toThrow('quota full');
    expect(controller.content(doc)).toBe('important draft');
    expect(doc.status).toBe('error');
    expect(controller.documents.has('a.md')).toBe(true);
    controller.dispose();
  });
  it('pauses autosave on external changes and requires explicit overwrite', async () => {
    const { fs, controller, doc } = await setup();
    doc.getText = () => 'my version';
    controller.changed(doc);
    await fs.writeFile('a.md', 'external version');
    await expect(controller.save(doc)).rejects.toThrow('External change');
    expect(await fs.readText('a.md')).toBe('external version');
    expect(doc.disk).toBe('external version');
    await controller.resolve(doc, 'keep');
    expect(await fs.readText('a.md')).toBe('my version');
    controller.dispose();
  });
  it('reloads disk version only on explicit choice', async () => {
    const { fs, controller, doc } = await setup();
    doc.text = 'draft';
    controller.changed(doc);
    await fs.writeFile('a.md', 'external');
    await controller.checkExternal();
    expect(doc.status).toBe('conflict');
    await controller.resolve(doc, 'reload');
    expect(controller.content(doc)).toBe('external');
    expect(doc.status).toBe('saved');
    controller.dispose();
  });
  it('keeps drafts recoverable when original is removed externally', async () => {
    const { fs, controller, doc } = await setup();
    doc.getText = () => 'recover me';
    controller.changed(doc);
    await fs.delete('a.md');
    await expect(controller.save(doc)).rejects.toThrow();
    expect(doc.status).toBe('error');
    expect(controller.content(doc)).toBe('recover me');
    expect(await fs.exists('a.md')).toBe(false);
    controller.dispose();
  });
  it('deduplicates concurrent opens so stale reads cannot replace a newer document', async () => {
    const { controller } = await setup();
    const [first, second] = await Promise.all([controller.open('b.md'), controller.open('b.md')]);
    expect(first).toBe(second);
    controller.dispose();
  });
});
it('reports failed recovery checkpoints without discarding text or claiming a save', async () => {
  const fs = new MemoryFileSystemAdapter();
  await fs.createFile('a.md', 'disk');
  const controller = new DocumentController(fs, 60000, {
    put: async () => {
      throw new Error('IndexedDB quota');
    },
    clear: async () => {},
  });
  const doc = await controller.open('a.md');
  doc.getText = () => 'pending';
  controller.changed(doc);
  await expect(controller.save(doc)).rejects.toThrow('quota');
  expect(doc.status).toBe('error');
  expect(controller.content(doc)).toBe('pending');
  expect(await fs.readText('a.md')).toBe('disk');
  controller.dispose();
});
