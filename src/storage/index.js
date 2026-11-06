// The one place vibe coffee touches on-device storage. Small synchronous
// records (preferences, interface settings, focus stats) live in
// localStorage under their original keys, so values saved before this module
// existed keep loading unchanged. The session checkpoint lives in IndexedDB
// with a localStorage fallback (./checkpointStore.js).
//
// GitHub Pages serves every project site of an account from one origin, so
// storage is shared with sibling sites: every key and database is namespaced.

export const STORAGE_KEYS = Object.freeze({
  preferences: 'vibe-coffee.preferences.v1',
  ui: 'vibe-coffee.ui.v1',
  focusStats: 'vibe-coffee.focus-stats.v1',
  checkpoint: 'vibe-coffee.checkpoint',
});

// Reading `localStorage` itself throws when storage is blocked (sandboxed
// frames, disabled cookies), so the default is resolved per call.
export function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isQuotaError(error) {
  if (!error) return false;
  return error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014;
}

export function readJSON(key, storage = defaultStorage()) {
  try {
    const text = storage?.getItem(key);
    return text == null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

// Returns { ok } or { ok: false, reason: 'unavailable' | 'quota' | 'error' }.
// Callers treat persistence as a convenience: the café keeps running either way.
export function writeJSON(key, value, storage = defaultStorage()) {
  if (!storage?.setItem) return { ok: false, reason: 'unavailable' };
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? 'quota' : 'error', error };
  }
}

export function removeKey(key, storage = defaultStorage()) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // nothing to free
  }
}

// Asks the browser not to evict this origin's storage under pressure.
// Chromium decides silently from engagement; Firefox shows a prompt, so this
// runs only after a clear signal that the visitor values their saved place
// (choosing Continue, or finishing a focus block), and at most once a visit.
let persistRequest = null;
export function requestPersistentStorage(nav = globalThis.navigator) {
  if (persistRequest) return persistRequest;
  persistRequest = (async () => {
    const storage = nav?.storage;
    if (!storage?.persist) return 'unsupported';
    try {
      if (await storage.persisted?.()) return 'persisted';
      return (await storage.persist()) ? 'granted' : 'denied';
    } catch {
      return 'unsupported';
    }
  })();
  return persistRequest;
}

export function resetPersistRequestForTests() {
  persistRequest = null;
}
