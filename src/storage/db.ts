import type { DesignFile } from '../model/design';

const DB_NAME = 'open-concept-designs';
const DB_VERSION = 1;
const DESIGNS = 'designs';

export interface DesignRecord {
  id: string;
  name: string;
  updatedAt: number;
  data: DesignFile;
}

export interface DesignSummary {
  id: string;
  name: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DESIGNS)) db.createObjectStore(DESIGNS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      dbPromise = null; // allow a retry later
      throw err;
    });
  }
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(DESIGNS, mode);
    const req = fn(tx.objectStore(DESIGNS));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export async function saveDesign(data: DesignFile): Promise<void> {
  const rec: DesignRecord = { id: data.id, name: data.name, updatedAt: Date.now(), data };
  await run('readwrite', (s) => s.put(rec));
}

export async function loadDesign(id: string): Promise<DesignFile | undefined> {
  const rec = (await run('readonly', (s) => s.get(id))) as DesignRecord | undefined;
  return rec?.data;
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const recs = (await run('readonly', (s) => s.getAll())) as DesignRecord[];
  return recs
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDesign(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
