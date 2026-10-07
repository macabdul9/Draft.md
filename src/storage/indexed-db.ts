import { openDB } from 'idb';
export interface WorkspaceRecord {
  id: string;
  name: string;
  kind: 'local' | 'browser';
  handle?: FileSystemDirectoryHandle;
  lastOpened: number;
  tabs?: string[];
  active?: string;
  favorites?: string[];
  recent?: string[];
}
export interface Recovery {
  workspace: string;
  path: string;
  content: string;
  baseline: string;
  updated: number;
}
const openDatabase = () =>
  openDB('draft-md', 1, {
    upgrade(db) {
      db.createObjectStore('workspaces', { keyPath: 'id' });
      db.createObjectStore('preferences');
      db.createObjectStore('recovery', { keyPath: ['workspace', 'path'] });
      db.createObjectStore('files', { keyPath: ['workspace', 'path'] });
    },
  });
let pendingDatabase: ReturnType<typeof openDatabase> | undefined;
const database = () => {
  pendingDatabase ??= openDatabase().catch((error) => {
    pendingDatabase = undefined;
    throw error;
  });
  return pendingDatabase;
};
export async function recentWorkspaces(): Promise<WorkspaceRecord[]> {
  return (await (await database()).getAll('workspaces')).sort(
    (a, b) => b.lastOpened - a.lastOpened,
  );
}
export async function remember(record: WorkspaceRecord) {
  await (await database()).put('workspaces', record);
}
export async function putRecovery(recovery: Recovery) {
  await (await database()).put('recovery', recovery);
}
export async function clearRecovery(workspace: string, path: string) {
  await (await database()).delete('recovery', [workspace, path]);
}
export async function getRecovery(workspace: string, path: string): Promise<Recovery | undefined> {
  return (await database()).get('recovery', [workspace, path]);
}
export async function listRecovery(workspace: string): Promise<Recovery[]> {
  return (await (await database()).getAll('recovery')).filter((r) => r.workspace === workspace);
}
export async function loadPreference<T>(key: string): Promise<T | undefined> {
  return (await database()).get('preferences', key);
}
export async function storePreference(key: string, value: unknown) {
  await (await database()).put('preferences', value, key);
}
export { database };
