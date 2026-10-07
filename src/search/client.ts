import type { WorkspaceFileSystem } from '../filesystem/adapter';
import { isText } from '../filesystem/adapter';
import type { SearchResult } from './index';
export class SearchClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private id = 0;
  private pending = new Map<number, (result: SearchResult[]) => void>();
  private knowledgePending = new Map<number, (items: { path: string; label: string }[]) => void>();
  private abort = new AbortController();
  onError?: (message: string) => void;
  onProgress?: (count: number, done: boolean) => void;
  constructor() {
    this.worker.onmessage = (event) => {
      const m = event.data;
      if (m.type === 'results') {
        this.pending.get(m.id)?.(m.results);
        this.pending.delete(m.id);
      }
      if (m.type === 'knowledge-results') {
        this.knowledgePending.get(m.id)?.(m.items);
        this.knowledgePending.delete(m.id);
      }
      if (m.type === 'error') this.onError?.(m.error);
      if (m.type === 'progress' || m.type === 'done') this.onProgress?.(m.count, m.type === 'done');
    };
  }
  async index(fs: WorkspaceFileSystem, handle?: FileSystemDirectoryHandle) {
    this.abort.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    if (handle) {
      this.worker.postMessage({ type: 'scan', handle });
      return;
    }
    this.worker.postMessage({ type: 'reset' });
    let count = 0;
    const scan = async (folder: string) => {
      for (const entry of await fs.listDirectory(folder)) {
        if (signal.aborted) return;
        if (entry.name.startsWith('.')) continue;
        if (entry.kind === 'directory') await scan(entry.path);
        else if (isText(entry.name)) {
          try {
            const text = await fs.readText(entry.path);
            if (signal.aborted) return;
            this.update(entry.path, text);
            count++;
            if (count % 50 === 0) this.onProgress?.(count, false);
          } catch {
            /* Continue indexing readable files. */
          }
        }
      }
    };
    await scan('');
    if (!signal.aborted) this.onProgress?.(count, true);
  }
  update(path: string, text: string) {
    this.worker.postMessage({ type: 'update', path, text });
  }
  query(query: string, quick = false): Promise<SearchResult[]> {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'query', id, query, quick });
    });
  }
  knowledge(kind: 'Tags' | 'Backlinks', path: string): Promise<{ path: string; label: string }[]> {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.knowledgePending.set(id, resolve);
      this.worker.postMessage({ type: 'knowledge', id, kind, path });
    });
  }
  dispose() {
    this.abort.abort();
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve([]);
    this.pending.clear();
    for (const resolve of this.knowledgePending.values()) resolve([]);
    this.knowledgePending.clear();
  }
}
