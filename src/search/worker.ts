import { knowledge } from './knowledge';
import { searchDocuments, type SearchDocument } from './index';
import { NativeFileSystemAdapter } from '../filesystem/native-filesystem';
import { isText } from '../filesystem/adapter';
const documents = new Map<string, SearchDocument>();
let generation = 0;
const updatedPaths = new Set<string>();
self.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'reset') {
    generation++;
    documents.clear();
    updatedPaths.clear();
  }
  if (message.type === 'update') {
    updatedPaths.add(message.path);
    documents.set(message.path, { path: message.path, text: message.text });
  }
  if (message.type === 'scan') {
    const current = ++generation;
    documents.clear();
    const fs = new NativeFileSystemAdapter(message.handle);
    let count = 0;
    async function scan(folder: string) {
      for (const entry of await fs.listDirectory(folder)) {
        if (current !== generation) return;
        if (entry.name.startsWith('.')) continue;
        if (entry.kind === 'directory') await scan(entry.path);
        else if (isText(entry.name)) {
          try {
            const text = await fs.readText(entry.path);
            if (current !== generation) return;
            if (!updatedPaths.has(entry.path))
              documents.set(entry.path, { path: entry.path, text });
            count++;
            if (count % 50 === 0) self.postMessage({ type: 'progress', count });
          } catch {
            /* Unreadable files do not block other notes. */
          }
        }
      }
    }
    try {
      await scan('');
      if (current === generation) self.postMessage({ type: 'done', count });
    } catch (error) {
      if (current === generation) self.postMessage({ type: 'error', error: String(error) });
    }
  }
  if (message.type === 'knowledge') {
    const items: { path: string; label: string }[] = [];
    const target = String(message.path ?? '')
      .replace(/\.md$/i, '')
      .toLocaleLowerCase();
    for (const document of documents.values()) {
      const parsed = knowledge(document.text);
      if (message.kind === 'Tags')
        for (const tag of parsed.tags)
          items.push({ path: document.path, label: '#' + tag + ' · ' + document.path });
      else if (
        document.path !== message.path &&
        parsed.links.some((link) => link === target || link === target.split('/').at(-1))
      )
        items.push({ path: document.path, label: document.path });
    }
    self.postMessage({ type: 'knowledge-results', id: message.id, items });
  }
  if (message.type === 'query')
    self.postMessage({
      type: 'results',
      id: message.id,
      results: searchDocuments(documents.values(), message.query, message.quick),
    });
};
