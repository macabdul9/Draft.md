import type { EditorState } from '@codemirror/state';
import type { WorkspaceFileSystem } from '../filesystem/adapter';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export interface DocumentRecord {
  path: string;
  text: string;
  baseline: string;
  status: SaveStatus;
  error?: string;
  disk?: string;
  editorState?: EditorState;
  scroll: number;
  getText?: () => string;
  timer?: ReturnType<typeof setTimeout>;
  checkpointTimer?: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
  version: number;
}
interface RecoveryStore {
  put(path: string, text: string, baseline: string): Promise<void>;
  clear(path: string): Promise<void>;
}
const noRecovery: RecoveryStore = { put: async () => {}, clear: async () => {} };
/** The editor owns text/undo/selection; this controller snapshots only for save/recovery. */
export class DocumentController {
  documents = new Map<string, DocumentRecord>();
  private listeners = new Set<() => void>();
  private opening = new Map<string, Promise<DocumentRecord>>();
  constructor(
    readonly fs: WorkspaceFileSystem,
    public delay = 700,
    private recovery: RecoveryStore = noRecovery,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  content(doc: DocumentRecord) {
    return doc.getText?.() ?? doc.editorState?.doc.toString() ?? doc.text;
  }
  async open(path: string): Promise<DocumentRecord> {
    const existing = this.documents.get(path);
    if (existing) return existing;
    const pending = this.opening.get(path);
    if (pending) return pending;
    const operation = (async () => {
      const text = await this.fs.readText(path);
      const doc: DocumentRecord = {
        path,
        text,
        baseline: text,
        status: 'saved',
        scroll: 0,
        queue: Promise.resolve(),
        version: 0,
      };
      this.documents.set(path, doc);
      this.emit();
      return doc;
    })();
    this.opening.set(path, operation);
    try {
      return await operation;
    } finally {
      this.opening.delete(path);
    }
  }
  changed(doc: DocumentRecord) {
    doc.version++;
    if (doc.status !== 'conflict') {
      const notify = doc.status !== 'dirty';
      doc.status = 'dirty';
      doc.error = undefined;
      if (notify) this.emit();
      clearTimeout(doc.timer);
      doc.timer = setTimeout(() => {
        void this.save(doc).catch(() => undefined);
      }, this.delay);
    }
    clearTimeout(doc.checkpointTimer);
    doc.checkpointTimer = setTimeout(() => {
      void this.recovery.put(doc.path, this.content(doc), doc.baseline).catch((error) => {
        doc.error = `Recovery unavailable: ${String(error)}`;
        this.emit();
      });
    }, 200);
  }
  restore(doc: DocumentRecord, text: string, baseline: string) {
    doc.text = text;
    doc.baseline = baseline;
    doc.editorState = undefined;
    doc.getText = undefined;
    this.changed(doc);
  }
  save(doc: DocumentRecord): Promise<void> {
    clearTimeout(doc.timer);
    const task = doc.queue
      .catch(() => undefined)
      .then(async () => {
        if (doc.status === 'conflict')
          throw new Error('Resolve the external change before saving.');
        const snapshot = this.content(doc);
        if (snapshot === doc.baseline && doc.status !== 'error') {
          doc.status = 'saved';
          this.emit();
          return;
        }
        try {
          await this.recovery.put(doc.path, snapshot, doc.baseline);
        } catch (error) {
          doc.status = 'error';
          doc.error = 'Recovery checkpoint failed; your draft remains in memory. ' + String(error);
          this.emit();
          throw error;
        }
        let disk: string;
        try {
          disk = await this.fs.readText(doc.path);
        } catch (error) {
          doc.status = 'error';
          doc.error = `Cannot read the original file. Your draft is retained. ${String(error)}`;
          this.emit();
          throw error;
        }
        if (disk !== doc.baseline) {
          doc.disk = disk;
          doc.status = 'conflict';
          this.emit();
          throw new Error('External change detected.');
        }
        doc.status = 'saving';
        this.emit();
        try {
          await this.fs.writeFile(doc.path, snapshot);
          doc.baseline = snapshot;
          doc.text = snapshot;
          // A write can finish after another editor transaction; never call that newer text saved.
          if (this.content(doc) === snapshot) {
            doc.status = 'saved';
            clearTimeout(doc.checkpointTimer);
            await this.recovery.clear(doc.path);
          } else {
            doc.status = 'dirty';
            await this.recovery.put(doc.path, this.content(doc), snapshot);
          }
          doc.error = undefined;
          this.emit();
        } catch (error) {
          doc.status = 'error';
          doc.error = String(error);
          this.emit();
          throw error;
        }
      });
    doc.queue = task;
    return task;
  }
  async checkExternal() {
    for (const doc of this.documents.values()) {
      await doc.queue.catch(() => undefined);
      try {
        const disk = await this.fs.readText(doc.path);
        if (disk === doc.baseline) continue;
        doc.disk = disk;
        doc.status = 'conflict';
        clearTimeout(doc.timer);
        this.emit();
      } catch (error) {
        doc.status = 'error';
        doc.error = `File unavailable or permission expired. Draft retained. ${String(error)}`;
        clearTimeout(doc.timer);
        this.emit();
      }
    }
  }
  async resolve(doc: DocumentRecord, choice: 'reload' | 'keep') {
    await doc.queue.catch(() => undefined);
    // Re-read on the explicit action so a second external edit is not silently ignored.
    const disk = await this.fs.readText(doc.path);
    if (choice === 'reload') {
      doc.text = disk;
      doc.baseline = disk;
      doc.editorState = undefined;
      doc.getText = undefined;
      doc.version++;
      doc.status = 'saved';
      await this.recovery.clear(doc.path);
    } else {
      doc.baseline = disk;
      doc.status = 'dirty';
      await this.save(doc);
    }
    doc.disk = undefined;
    this.emit();
  }
  async flush() {
    await Promise.all([...this.documents.values()].map((doc) => this.save(doc)));
  }
  async close(path: string) {
    const doc = this.documents.get(path);
    if (!doc) return;
    await this.save(doc);
    clearTimeout(doc.timer);
    clearTimeout(doc.checkpointTimer);
    this.documents.delete(path);
    this.emit();
  }
  async checkpointAll() {
    for (const doc of this.documents.values())
      if (doc.status !== 'saved')
        await this.recovery.put(doc.path, this.content(doc), doc.baseline);
  }
  dispose() {
    for (const doc of this.documents.values()) {
      clearTimeout(doc.timer);
      clearTimeout(doc.checkpointTimer);
    }
    this.listeners.clear();
  }
}
