// Where checkpoints are kept. IndexedDB is the primary store. localStorage is
// the fallback when IndexedDB is unavailable or full, and it also receives a
// synchronous copy when the page is being hidden or unloaded, because an
// IndexedDB transaction started in `pagehide` may never commit. Loading reads
// both and keeps the newest valid checkpoint.
import { STORAGE_KEYS, defaultStorage, isQuotaError, readJSON, writeJSON } from './index.js';
import { openKeyValueStore } from './idb.js';
import { CHECKPOINT_VERSION, migrateCheckpoint, newestCheckpoint } from './checkpoint.js';

const RECORD_KEY = 'checkpoint';

export function createCheckpointStore({
  openDB = () => openKeyValueStore(),
  storage,
  key = STORAGE_KEYS.checkpoint,
  migrate = migrateCheckpoint,
} = {}) {
  const local = () => (storage === undefined ? defaultStorage() : storage);
  let dbPromise = null;
  let backend = 'unknown';

  const connect = () => {
    dbPromise ??= openDB().catch(() => null);
    return dbPromise;
  };

  // Safari can drop an open connection while the tab is in the background;
  // reconnect once before giving up on IndexedDB for this operation.
  async function withDB(operation) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const db = await connect();
      if (!db) return { ok: false, reason: 'unavailable' };
      try {
        return { ok: true, value: await operation(db) };
      } catch (error) {
        if (isQuotaError(error)) return { ok: false, reason: 'quota', error };
        if (error?.name !== 'InvalidStateError' || attempt) return { ok: false, reason: 'error', error };
        try { db.close(); } catch { /* already closed */ }
        dbPromise = null;
      }
    }
    return { ok: false, reason: 'error' };
  }

  function writeLocal(record) {
    const result = writeJSON(key, record, local());
    return result.ok ? { ok: true, backend: 'localStorage' } : { ok: false, backend: 'none', reason: result.reason };
  }

  return {
    get backend() { return backend; },

    async load() {
      const [stored, mirrored] = await Promise.all([
        withDB((db) => db.get(RECORD_KEY)).then((result) => (result.ok ? result.value : null)),
        Promise.resolve(readJSON(key, local())),
      ]);
      return newestCheckpoint([migrate(stored), migrate(mirrored)]);
    },

    // { sync: true } is for page-hide paths: the localStorage copy is written
    // before this returns, and IndexedDB is still attempted afterwards.
    save(checkpoint, { sync = false } = {}) {
      const record = { ...checkpoint, version: CHECKPOINT_VERSION };
      const mirrored = sync ? writeLocal(record) : null;
      return withDB((db) => db.put(RECORD_KEY, record)).then((result) => {
        if (result.ok) {
          backend = 'indexeddb';
          return { ok: true, backend };
        }
        const fallback = mirrored ?? writeLocal(record);
        backend = fallback.backend;
        // A full IndexedDB with a working fallback is still a successful save.
        if (fallback.ok) return fallback;
        return { ok: false, backend: 'none', reason: result.reason === 'quota' ? 'quota' : fallback.reason };
      });
    },
  };
}
