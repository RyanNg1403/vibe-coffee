import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEYS, defaultStorage, isQuotaError, readJSON, writeJSON,
  requestPersistentStorage, resetPersistRequestForTests,
} from '../src/storage/index.js';
import { openKeyValueStore } from '../src/storage/idb.js';
import {
  CHECKPOINT_VERSION, describeCheckpoint, formatClock, formatSavedAgo, migrateCheckpoint,
  newestCheckpoint, resumeFocus, sanitizeCheckpoint, sanitizePlayer,
} from '../src/storage/checkpoint.js';
import { createCheckpointStore } from '../src/storage/checkpointStore.js';
import { createAutosave } from '../src/storage/autosave.js';
import { DEFAULT_PREFERENCES, loadPreferences } from '../src/preferences.js';
import { loadUISettings } from '../src/ui/settings.js';
import { loadFocusStats, mergeFocusStats } from '../src/ui/focusStats.js';

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function quotaError() {
  const error = new Error('quota');
  error.name = 'QuotaExceededError';
  return error;
}

// Just enough of IndexedDB for src/storage/idb.js: one database, one store.
function fakeIndexedDB({ failOpen = false, hang = false, putError = null } = {}) {
  const data = new Map();
  let created = false;
  const later = (fn) => setTimeout(fn, 0);
  const factory = {
    data,
    opened: 0,
    putError,
    open() {
      factory.opened += 1;
      const request = {};
      later(() => {
        if (hang) return;
        if (failOpen) { request.error = new Error('denied'); request.onerror?.(); return; }
        request.result = {
          objectStoreNames: { contains: () => created },
          createObjectStore: () => { created = true; },
          close() {},
          transaction() {
            const tx = {};
            const op = (work) => {
              const req = {};
              later(() => {
                try {
                  req.result = work();
                  tx.oncomplete?.();
                } catch (error) {
                  tx.error = error;
                  tx.onabort?.();
                }
              });
              return req;
            };
            tx.objectStore = () => ({
              get: (key) => op(() => structuredClone(data.get(key))),
              put: (value, key) => op(() => {
                if (factory.putError) throw factory.putError;
                data.set(key, structuredClone(value));
                return key;
              }),
              delete: (key) => op(() => data.delete(key)),
            });
            return tx;
          },
        };
        if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return factory;
}

const sampleCheckpoint = (overrides = {}) => ({
  savedAt: 1_800_000_000_000,
  cafeId: 'midnight',
  preferences: { ...DEFAULT_PREFERENCES, cafeIndex: 2, envTime: 'night', envSky: 'rain', ambienceVolume: 0.37 },
  settings: { textScale: 1.12 },
  stats: { days: { '2026-11-05': { sessions: 3, minutes: 75 } } },
  player: { mode: 'walking', x: 1.25, y: 0, z: -2.5, levelId: 'ground', yaw: 0.9, pitch: -0.18 },
  focus: { running: true, onBreak: false, remaining: 1234.5 },
  music: { station: 'cafe', trackId: 'lobby-time', position: 31.2 },
  ...overrides,
});

test('legacy storage keys are unchanged so earlier saves keep loading', () => {
  assert.equal(STORAGE_KEYS.preferences, 'vibe-coffee.preferences.v1');
  assert.equal(STORAGE_KEYS.ui, 'vibe-coffee.ui.v1');
  assert.equal(STORAGE_KEYS.focusStats, 'vibe-coffee.focus-stats.v1');
  const storage = memoryStorage({
    'vibe-coffee.preferences.v1': JSON.stringify({ musicVolume: 0.23, cafeIndex: 2, envSky: 'rain' }),
    'vibe-coffee.ui.v1': JSON.stringify({ textScale: 1.25, invertY: true }),
    'vibe-coffee.focus-stats.v1': JSON.stringify({ days: { '2026-11-01': { sessions: 2, minutes: 50 } } }),
  });
  const preferences = loadPreferences(storage);
  assert.equal(preferences.musicVolume, 0.23);
  assert.equal(preferences.cafeIndex, 2);
  assert.equal(preferences.envSky, 'rain');
  assert.equal(loadUISettings(storage).textScale, 1.25);
  assert.equal(loadUISettings(storage).invertY, true);
  assert.deepEqual(loadFocusStats(storage).days['2026-11-01'], { sessions: 2, minutes: 50 });
});

test('JSON helpers survive blocked, corrupt and full storage', () => {
  assert.equal(readJSON('k', null), null);
  assert.equal(readJSON('k', { getItem: () => '{not json' }), null);
  assert.equal(readJSON('k', { getItem() { throw new Error('SecurityError'); } }), null);
  assert.deepEqual(writeJSON('k', 1, null), { ok: false, reason: 'unavailable' });
  const full = writeJSON('k', 1, { setItem() { throw quotaError(); } });
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'quota');
  assert.equal(writeJSON('k', 1, { setItem() { throw new Error('nope'); } }).reason, 'error');
  assert.ok(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }));
  assert.ok(isQuotaError({ code: 22 }));
  assert.ok(!isQuotaError(new Error('other')));

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.equal(defaultStorage(), null);
    assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('checkpoints are sanitized field by field', () => {
  assert.equal(sanitizeCheckpoint(null), null);
  assert.equal(sanitizeCheckpoint({ savedAt: 'yesterday' }), null);
  const clean = sanitizeCheckpoint(sampleCheckpoint({
    cafeId: '<script>',
    focus: { running: 'yes', remaining: 1e9 },
    music: { station: 'cafe', trackId: '../../etc', position: 5 },
    preferences: { musicVolume: 9 },
  }));
  assert.equal(clean.version, CHECKPOINT_VERSION);
  assert.equal(clean.cafeId, null);
  assert.equal(clean.focus.running, false);
  assert.equal(clean.focus.remaining, 180 * 60);
  assert.equal(clean.music, null);
  assert.equal(clean.preferences.musicVolume, 1);
  assert.equal(clean.settings.textScale, 1.12);
  assert.equal(clean.stats.days['2026-11-05'].sessions, 3);

  assert.equal(sanitizePlayer({ mode: 'walking', x: 'a', z: 1 }), null);
  const seated = sanitizePlayer({ mode: 'seated', seat: { index: 4, x: 1, y: 0, z: 2 }, x: 1, y: 1.2, z: 2, yaw: 7, pitch: 3 });
  assert.equal(seated.mode, 'seated');
  assert.equal(seated.seat.index, 4);
  assert.ok(Math.abs(seated.yaw - (7 - 2 * Math.PI)) < 1e-3);
  assert.equal(seated.pitch, 1.5);
  assert.equal(sanitizePlayer({ mode: 'seated', seat: { index: -1 }, x: 0, z: 0 }).mode, 'walking');
});

test('schema migration upgrades old versions and refuses unknown ones', () => {
  const current = sampleCheckpoint({ version: CHECKPOINT_VERSION });
  assert.equal(migrateCheckpoint(current).player.x, 1.25);
  assert.equal(migrateCheckpoint({ ...current, version: CHECKPOINT_VERSION + 1 }), null, 'from a newer deploy');
  assert.equal(migrateCheckpoint({ ...current, version: undefined }), null);
  assert.equal(migrateCheckpoint('garbage'), null);

  // a hypothetical v2 that renamed `player` to `avatar` and stored minutes
  const migrations = {
    1: (old) => ({ ...old, avatar: old.player, focus: { ...old.focus, remainingMinutes: old.focus.remaining / 60 } }),
  };
  const upgraded = migrateCheckpoint({ ...current, version: 1 }, { version: 2, migrations });
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.player.x, 1.25);
  assert.equal(migrateCheckpoint({ ...current, version: 1 }, { version: 3, migrations }), null, 'gap in migrations');
  assert.equal(migrateCheckpoint({ ...current, version: 1 }, { version: 2, migrations: { 1: () => { throw new Error(); } } }), null);

  const older = migrateCheckpoint({ ...current, savedAt: 5 });
  assert.equal(newestCheckpoint([older, null, migrateCheckpoint(current)]).savedAt, current.savedAt);
  assert.equal(newestCheckpoint([null, null]), null);
});

test('a running focus timer resumes after a reload and pauses after a long absence', () => {
  const focus = { running: true, onBreak: false, remaining: 600 };
  const savedAt = 1_000_000;
  assert.deepEqual(resumeFocus(focus, savedAt, savedAt + 30_000),
    { running: true, onBreak: false, remaining: 570, interrupted: false });
  assert.deepEqual(resumeFocus(focus, savedAt, savedAt + 6 * 60_000),
    { running: false, onBreak: false, remaining: 600, interrupted: true });
  assert.equal(resumeFocus({ ...focus, remaining: 20 }, savedAt, savedAt + 25_000).interrupted, true, 'would have finished while away');
  assert.deepEqual(resumeFocus({ running: false, onBreak: true, remaining: 120 }, savedAt, savedAt + 9e9),
    { running: false, onBreak: true, remaining: 120, interrupted: false });
  assert.equal(resumeFocus(focus, savedAt, savedAt - 5000).remaining, 600, 'clock moved backwards');
});

test('title copy describes the saved session', () => {
  assert.equal(formatClock(754.9), '12:34');
  assert.equal(formatClock(-3), '00:00');
  const now = 10_000_000_000;
  assert.equal(formatSavedAgo(now - 20_000, now), 'just now');
  assert.equal(formatSavedAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(formatSavedAgo(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(formatSavedAgo(now - 30 * 3_600_000, now), 'yesterday');
  assert.equal(formatSavedAgo(now - 72 * 3_600_000, now), '3 days ago');
  const checkpoint = sanitizeCheckpoint(sampleCheckpoint({ savedAt: now - 120_000 }));
  assert.deepEqual(describeCheckpoint(checkpoint, { cafeName: 'Midnight Jazz Corner', now }), {
    place: 'Midnight Jazz Corner · Night · Rain',
    detail: 'Walking around · Focus 20:34 left · saved 2 min ago',
  });
  const idle = sanitizeCheckpoint(sampleCheckpoint({
    savedAt: now, focus: { running: false, remaining: 25 * 60 },
    player: { mode: 'seated', seat: { index: 1, x: 0, y: 0, z: 0 }, x: 0, z: 0 },
    preferences: DEFAULT_PREFERENCES,
  }));
  assert.deepEqual(describeCheckpoint(idle, { cafeName: 'Golden Hour Café', now }),
    { place: 'Golden Hour Café', detail: 'At your table · saved just now' });
});

test('focus stats from a checkpoint merge without losing local history', () => {
  const local = { days: { '2026-11-04': { sessions: 1, minutes: 25 }, '2026-11-05': { sessions: 4, minutes: 100 } } };
  const saved = { days: { '2026-11-03': { sessions: 2, minutes: 50 }, '2026-11-05': { sessions: 3, minutes: 75 } } };
  assert.deepEqual(mergeFocusStats(local, saved).days, {
    '2026-11-03': { sessions: 2, minutes: 50 },
    '2026-11-04': { sessions: 1, minutes: 25 },
    '2026-11-05': { sessions: 4, minutes: 100 },
  });
  assert.deepEqual(mergeFocusStats(null, 'bad'), { days: {} });
});

test('the IndexedDB wrapper round-trips values and fails fast', async () => {
  const factory = fakeIndexedDB();
  const db = await openKeyValueStore({ factory });
  await db.put('checkpoint', { a: 1 });
  assert.deepEqual(await db.get('checkpoint'), { a: 1 });
  await db.delete('checkpoint');
  assert.equal(await db.get('checkpoint'), undefined);

  await assert.rejects(openKeyValueStore({ factory: undefined }), /unavailable/);
  await assert.rejects(openKeyValueStore({ factory: fakeIndexedDB({ failOpen: true }) }), /denied/);
  await assert.rejects(openKeyValueStore({ factory: fakeIndexedDB({ hang: true }), timeoutMs: 20 }), /timed out/);
  await assert.rejects(openKeyValueStore({ factory: { open() { throw new Error('InvalidStateError'); } } }), /InvalidStateError/);
  const failing = await openKeyValueStore({ factory: fakeIndexedDB({ putError: quotaError() }) });
  await assert.rejects(failing.put('k', 1), (error) => isQuotaError(error));
});

test('checkpoint store prefers IndexedDB and loads the newest copy', async () => {
  const factory = fakeIndexedDB();
  const storage = memoryStorage();
  const store = createCheckpointStore({ openDB: () => openKeyValueStore({ factory }), storage });
  assert.equal(await store.load(), null);
  const result = await store.save(sampleCheckpoint());
  assert.deepEqual(result, { ok: true, backend: 'indexeddb' });
  assert.equal(store.backend, 'indexeddb');
  assert.equal(storage.data.size, 0, 'no localStorage copy on ordinary saves');
  assert.equal(factory.data.get('checkpoint').version, CHECKPOINT_VERSION);
  assert.equal((await store.load()).player.z, -2.5);

  // a page-hide save lands in localStorage before save() even resolves
  const pending = store.save(sampleCheckpoint({ savedAt: 1_900_000_000_000 }), { sync: true });
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEYS.checkpoint)).savedAt, 1_900_000_000_000);
  await pending;

  // the IndexedDB write of a later save never committed; the mirror wins
  storage.setItem(STORAGE_KEYS.checkpoint, JSON.stringify({ ...sampleCheckpoint({ savedAt: 2_000_000_000_000 }), version: 1 }));
  assert.equal((await store.load()).savedAt, 2_000_000_000_000);
  // ...and a mirror from a newer deploy's schema is ignored
  storage.setItem(STORAGE_KEYS.checkpoint, JSON.stringify({ ...sampleCheckpoint({ savedAt: 3e12 }), version: 99 }));
  assert.equal((await store.load()).savedAt, 1_900_000_000_000);
});

test('checkpoint store falls back to localStorage and reports quota errors', async () => {
  const storage = memoryStorage();
  const privateMode = createCheckpointStore({ openDB: () => Promise.reject(new Error('no IndexedDB')), storage });
  assert.deepEqual(await privateMode.save(sampleCheckpoint()), { ok: true, backend: 'localStorage' });
  assert.equal(privateMode.backend, 'localStorage');
  assert.equal((await privateMode.load()).cafeId, 'midnight');

  const factory = fakeIndexedDB({ putError: quotaError() });
  const fullDB = createCheckpointStore({ openDB: () => openKeyValueStore({ factory }), storage: memoryStorage() });
  assert.deepEqual(await fullDB.save(sampleCheckpoint()), { ok: true, backend: 'localStorage' });

  const everythingFull = createCheckpointStore({
    openDB: () => openKeyValueStore({ factory }),
    storage: { getItem: () => null, setItem() { throw quotaError(); } },
  });
  assert.deepEqual(await everythingFull.save(sampleCheckpoint()), { ok: false, backend: 'none', reason: 'quota' });

  const nothing = createCheckpointStore({ openDB: () => Promise.reject(new Error('no')), storage: null });
  assert.deepEqual(await nothing.save(sampleCheckpoint()), { ok: false, backend: 'none', reason: 'unavailable' });
  assert.equal(await nothing.load(), null);
});

test('checkpoint store reconnects once when a connection was dropped', async () => {
  let opens = 0;
  let healthy = false;
  const stale = new Error('The database connection is closing.');
  stale.name = 'InvalidStateError';
  const store = createCheckpointStore({
    storage: memoryStorage(),
    openDB: async () => {
      opens += 1;
      const db = await openKeyValueStore({ factory: fakeIndexedDB() });
      if (!healthy) {
        healthy = true;
        return { ...db, put: () => Promise.reject(stale) };
      }
      return db;
    },
  });
  assert.deepEqual(await store.save(sampleCheckpoint()), { ok: true, backend: 'indexeddb' });
  assert.equal(opens, 2);
});

test('autosave writes only once enabled: on an interval, after key events and when hidden', async () => {
  const listeners = { doc: {}, win: {} };
  const target = (bucket) => ({
    addEventListener: (type, fn) => { bucket[type] = fn; },
    removeEventListener: (type) => { delete bucket[type]; },
  });
  const doc = { ...target(listeners.doc), visibilityState: 'visible' };
  const win = target(listeners.win);
  const saves = [];
  let counter = 0;
  const autosave = createAutosave({
    capture: (reason) => ({ n: ++counter, reason }),
    store: { save: (snapshot, options) => { saves.push({ ...snapshot, sync: Boolean(options?.sync) }); return Promise.resolve({ ok: true }); } },
    intervalMs: 30,
    debounceMs: 10,
    doc,
    win,
  });

  autosave.touch('seat');
  listeners.win.pagehide();
  await delay(50);
  assert.equal(saves.length, 0, 'nothing is written from the title screen');

  autosave.enable();
  autosave.touch('seat');
  autosave.touch('stand');
  await delay(20);
  assert.deepEqual(saves.map((s) => s.reason), ['stand'], 'key events are debounced into one write');

  await delay(40);
  assert.ok(saves.some((s) => s.reason === 'interval'));

  doc.visibilityState = 'hidden';
  listeners.doc.visibilitychange();
  listeners.win.pagehide();
  listeners.doc.freeze();
  assert.deepEqual(saves.slice(-3).map((s) => [s.reason, s.sync]), [['hidden', true], ['pagehide', true], ['freeze', true]]);
  const count = saves.length;
  await delay(45);
  assert.equal(saves.length, count, 'no interval writes while hidden');

  autosave.dispose();
  assert.equal(listeners.win.pagehide, undefined);
});

test('autosave skips empty captures and survives failing stores', async () => {
  const results = [];
  const quiet = createAutosave({ capture: () => null, store: { save: () => assert.fail('no save') }, doc: null, win: null });
  quiet.enable();
  assert.equal(await quiet.saveNow(), null);
  quiet.dispose();

  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = createAutosave({
      capture: () => ({}),
      store: { save: () => Promise.reject(new Error('disk')) },
      onResult: (result) => results.push(result),
      doc: null,
      win: null,
    });
    broken.enable();
    assert.equal(await broken.saveNow(), null);
    broken.dispose();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(results, []);
});

test('persistent storage is requested once and reports the outcome', async () => {
  resetPersistRequestForTests();
  let asked = 0;
  const nav = { storage: { persisted: async () => false, persist: async () => { asked += 1; return true; } } };
  assert.equal(await requestPersistentStorage(nav), 'granted');
  assert.equal(await requestPersistentStorage(nav), 'granted');
  assert.equal(asked, 1);
  resetPersistRequestForTests();
  assert.equal(await requestPersistentStorage({ storage: { persisted: async () => true, persist: async () => true } }), 'persisted');
  resetPersistRequestForTests();
  assert.equal(await requestPersistentStorage({ storage: { persist: async () => false } }), 'denied');
  resetPersistRequestForTests();
  assert.equal(await requestPersistentStorage({}), 'unsupported');
  resetPersistRequestForTests();
});
