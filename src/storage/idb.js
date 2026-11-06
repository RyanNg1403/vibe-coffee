// Minimal promise wrapper around one IndexedDB object store of key → value.
// Opening can fail outright (no IndexedDB, some private modes) or hang
// (a blocked upgrade, older Safari), so it rejects after a timeout and the
// caller falls back to localStorage.

export const DB_NAME = 'vibe-coffee';
export const DB_VERSION = 1;
export const DB_STORE = 'kv';

export function openKeyValueStore({
  factory = globalThis.indexedDB,
  name = DB_NAME,
  storeName = DB_STORE,
  timeoutMs = 2500,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!factory?.open) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('IndexedDB open timed out')), timeoutMs);
    let request;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (error) {
      finish(reject, error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      // Let a future deploy that bumps DB_VERSION upgrade without waiting on
      // this tab.
      db.onversionchange = () => db.close();
      finish(resolve, wrap(db, storeName));
    };
    request.onerror = () => finish(reject, request.error ?? new Error('IndexedDB open failed'));
  });
}

function wrap(db, storeName) {
  const run = (mode, operation) => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode, { durability: 'relaxed' });
    } catch (error) {
      reject(error);
      return;
    }
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error('IndexedDB transaction aborted'));
  });
  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    put: (key, value) => run('readwrite', (store) => store.put(value, key)),
    delete: (key) => run('readwrite', (store) => store.delete(key)),
    close: () => db.close(),
  };
}
