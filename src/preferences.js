import { isQualityTier } from './qualityTier.js';
import { STORAGE_KEYS, readJSON, writeJSON } from './storage/index.js';

export const DEFAULT_PREFERENCES = Object.freeze({
  musicVolume: 0.5,
  ambienceVolume: 0.7,
  voicesVolume: 1,
  petVolume: 0.65,
  rainIntensity: 2,
  musicOn: true,
  muted: false,
  cafeIndex: 0,
  envTime: 'auto',
  envSky: 'auto',
  qualityMode: 'auto',
  laptopOn: false,
  focusMinutes: 25,
});

const numberIn = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function sanitizePreferences(raw) {
  const saved = raw && typeof raw === 'object' ? raw : {};
  return {
    musicVolume: numberIn(saved.musicVolume, 0, 1, DEFAULT_PREFERENCES.musicVolume),
    ambienceVolume: numberIn(saved.ambienceVolume, 0, 1, DEFAULT_PREFERENCES.ambienceVolume),
    voicesVolume: numberIn(saved.voicesVolume, 0, 1.5, DEFAULT_PREFERENCES.voicesVolume),
    petVolume: numberIn(saved.petVolume, 0, 1, DEFAULT_PREFERENCES.petVolume),
    rainIntensity: Math.round(numberIn(saved.rainIntensity, 0, 3, DEFAULT_PREFERENCES.rainIntensity)),
    musicOn: typeof saved.musicOn === 'boolean' ? saved.musicOn : DEFAULT_PREFERENCES.musicOn,
    muted: typeof saved.muted === 'boolean' ? saved.muted : DEFAULT_PREFERENCES.muted,
    cafeIndex: Math.round(numberIn(saved.cafeIndex, 0, 3, DEFAULT_PREFERENCES.cafeIndex)),
    envTime: ['auto', 'morning', 'noon', 'sunset', 'night'].includes(saved.envTime)
      ? saved.envTime
      : DEFAULT_PREFERENCES.envTime,
    envSky: ['auto', 'clear', 'rain'].includes(saved.envSky)
      ? saved.envSky
      : DEFAULT_PREFERENCES.envSky,
    qualityMode: isQualityTier(saved.qualityMode)
      ? saved.qualityMode
      : DEFAULT_PREFERENCES.qualityMode,
    laptopOn: typeof saved.laptopOn === 'boolean' ? saved.laptopOn : DEFAULT_PREFERENCES.laptopOn,
    focusMinutes: Math.round(numberIn(saved.focusMinutes, 1, 180, DEFAULT_PREFERENCES.focusMinutes)),
  };
}

export function loadPreferences(storage) {
  return sanitizePreferences(readJSON(STORAGE_KEYS.preferences, storage));
}

// Storage can be disabled or full. Preferences are a convenience, so the café
// continues normally when persistence is unavailable.
export function savePreferences(preferences, storage) {
  return writeJSON(STORAGE_KEYS.preferences, preferences, storage);
}
