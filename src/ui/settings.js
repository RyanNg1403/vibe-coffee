// Interface, accessibility and control settings. Kept apart from the café
// preferences (src/preferences.js) so either can evolve without migrating
// the other; both are conveniences that fall back to defaults silently.

import { isMusicStation, DEFAULT_MUSIC_STATION } from '../musicStations.js';
import { sanitizeYouTubeRef } from './youtube.js';

const STORAGE_KEY = 'vibe-coffee.ui.v1';

export const TEXT_SCALES = Object.freeze([1, 1.12, 1.25, 1.4]);
export const BREAK_MINUTES = Object.freeze([5, 10, 15]);

export const DEFAULT_UI_SETTINGS = Object.freeze({
  reducedMotion: 'system', // 'system' | 'reduce' | 'full'
  textScale: 1,
  highContrast: false,
  hudAutoHide: true,
  showHints: true,
  lookSensitivity: 1,
  invertY: false,
  lookSmoothing: false,
  breakMinutes: 5,
  focusHideHud: true,
  musicSource: 'radio', // 'radio' | 'youtube'
  musicStation: DEFAULT_MUSIC_STATION,
  youtube: null, // last chosen YouTube video or playlist
});

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const nearest = (value, options, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return options.reduce((best, option) => (Math.abs(option - number) < Math.abs(best - number) ? option : best));
};

export function sanitizeUISettings(raw = {}) {
  const d = DEFAULT_UI_SETTINGS;
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    reducedMotion: ['system', 'reduce', 'full'].includes(source.reducedMotion) ? source.reducedMotion : d.reducedMotion,
    textScale: nearest(source.textScale, TEXT_SCALES, d.textScale),
    highContrast: bool(source.highContrast, d.highContrast),
    hudAutoHide: bool(source.hudAutoHide, d.hudAutoHide),
    showHints: bool(source.showHints, d.showHints),
    lookSensitivity: Math.round(clamp(source.lookSensitivity, 0.25, 2.5, d.lookSensitivity) * 100) / 100,
    invertY: bool(source.invertY, d.invertY),
    lookSmoothing: bool(source.lookSmoothing, d.lookSmoothing),
    breakMinutes: nearest(source.breakMinutes, BREAK_MINUTES, d.breakMinutes),
    focusHideHud: bool(source.focusHideHud, d.focusHideHud),
    musicSource: ['radio', 'youtube'].includes(source.musicSource) ? source.musicSource : d.musicSource,
    musicStation: isMusicStation(source.musicStation) ? source.musicStation : d.musicStation,
    youtube: sanitizeYouTubeRef(source.youtube),
  };
}

export function loadUISettings(storage = globalThis.localStorage) {
  try {
    return sanitizeUISettings(JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

export function saveUISettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(sanitizeUISettings(settings)));
  } catch {
    // Storage may be unavailable (private mode, quota). Settings still apply
    // for this visit.
  }
}

let current = loadUISettings();
const listeners = new Set();

export function getUISettings() {
  return current;
}

export function updateUISettings(patch) {
  const next = sanitizeUISettings({ ...current, ...patch });
  const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
  if (!changed.length) return current;
  current = next;
  saveUISettings(current);
  for (const listener of listeners) listener(current, changed);
  return current;
}

export function resetUISettings() {
  return updateUISettings({ ...DEFAULT_UI_SETTINGS });
}

export function onUISettingsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const systemReducedMotion = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function motionReduced(settings = current) {
  if (settings.reducedMotion === 'reduce') return true;
  if (settings.reducedMotion === 'full') return false;
  return systemReducedMotion();
}

export function lookSettings() {
  return { sensitivity: current.lookSensitivity, invertY: current.invertY, smoothing: current.lookSmoothing };
}

export function breakMinutes() {
  return current.breakMinutes;
}
