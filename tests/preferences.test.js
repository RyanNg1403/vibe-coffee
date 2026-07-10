import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from '../src/preferences.js';

test('uses defaults when storage is unavailable', () => {
  delete globalThis.localStorage;
  assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
  assert.doesNotThrow(() => savePreferences(DEFAULT_PREFERENCES));
});

test('round-trips every preference', () => {
  let value = null;
  globalThis.localStorage = {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
  };
  const preferences = {
    musicVolume: 0.23,
    ambienceVolume: 0.64,
    voicesVolume: 1.2,
    musicOn: false,
    cafeIndex: 3,
    variantOn: true,
    qualityMode: 'smooth',
    laptopOn: true,
  };
  savePreferences(preferences);
  assert.deepEqual(loadPreferences(), preferences);
});

test('sanitizes corrupt and out-of-range values', () => {
  globalThis.localStorage = {
    getItem: () => JSON.stringify({
      musicVolume: 5,
      ambienceVolume: -2,
      voicesVolume: 'bad',
      cafeIndex: 99,
      qualityMode: 'cinematic',
    }),
    setItem: () => {},
  };
  assert.deepEqual(loadPreferences(), {
    ...DEFAULT_PREFERENCES,
    musicVolume: 1,
    ambienceVolume: 0,
    cafeIndex: 3,
  });
});
