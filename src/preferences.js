const STORAGE_KEY = 'vibe-coffee.preferences.v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  musicVolume: 0.5,
  ambienceVolume: 0.7,
  voicesVolume: 1,
  petVolume: 0.65,
  musicOn: true,
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

export function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      musicVolume: numberIn(saved.musicVolume, 0, 1, DEFAULT_PREFERENCES.musicVolume),
      ambienceVolume: numberIn(saved.ambienceVolume, 0, 1, DEFAULT_PREFERENCES.ambienceVolume),
      voicesVolume: numberIn(saved.voicesVolume, 0, 1.5, DEFAULT_PREFERENCES.voicesVolume),
      petVolume: numberIn(saved.petVolume, 0, 1, DEFAULT_PREFERENCES.petVolume),
      musicOn: typeof saved.musicOn === 'boolean' ? saved.musicOn : DEFAULT_PREFERENCES.musicOn,
      cafeIndex: Math.round(numberIn(saved.cafeIndex, 0, 3, DEFAULT_PREFERENCES.cafeIndex)),
      envTime: ['auto', 'morning', 'noon', 'sunset', 'night'].includes(saved.envTime)
        ? saved.envTime
        : DEFAULT_PREFERENCES.envTime,
      envSky: ['auto', 'clear', 'rain'].includes(saved.envSky)
        ? saved.envSky
        : DEFAULT_PREFERENCES.envSky,
      qualityMode: ['auto', 'detail', 'smooth'].includes(saved.qualityMode)
        ? saved.qualityMode
        : DEFAULT_PREFERENCES.qualityMode,
      laptopOn: typeof saved.laptopOn === 'boolean' ? saved.laptopOn : DEFAULT_PREFERENCES.laptopOn,
      focusMinutes: Math.round(numberIn(saved.focusMinutes, 1, 180, DEFAULT_PREFERENCES.focusMinutes)),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be disabled or full. Preferences are a convenience, so the
    // café must continue normally when persistence is unavailable.
  }
}
