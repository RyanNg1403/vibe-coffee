// The session checkpoint: a small, versioned snapshot of where the visitor
// was, so a revisit can pick up exactly there. Everything is sanitized on the
// way in and out; a checkpoint from an unknown future version is ignored
// rather than guessed at.
import { sanitizePreferences } from '../preferences.js';
import { sanitizeUISettings } from '../ui/settings.js';
import { sanitizeStats } from '../ui/focusStats.js';

export const CHECKPOINT_VERSION = 1;

// Each entry upgrades a checkpoint from version `n` to `n + 1`. Add one here
// (and bump CHECKPOINT_VERSION) whenever the shape below changes.
export const MIGRATIONS = Object.freeze({});

// A focus timer that was running keeps running after a quick reload; after a
// longer absence it comes back paused where it was instead of silently
// finishing (or skipping breaks) while nobody was there.
export const FOCUS_RESUME_GRACE_MS = 5 * 60 * 1000;

const MAX_FOCUS_SECONDS = 180 * 60;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/i;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const id = (value) => (typeof value === 'string' && ID.test(value) ? value : null);
const wrapAngle = (angle) => {
  const a = finite(angle);
  return Math.atan2(Math.sin(a), Math.cos(a));
};
const round = (value, digits = 3) => Number(value.toFixed(digits));

function sanitizeSeat(raw) {
  if (!isObject(raw)) return null;
  const index = Math.round(finite(raw.index, -1));
  if (index < 0 || index > 999) return null;
  return {
    index,
    x: round(clamp(raw.x, -100, 100, 0)),
    y: round(clamp(raw.y, -10, 20, 0)),
    z: round(clamp(raw.z, -100, 100, 0)),
  };
}

export function sanitizePlayer(raw) {
  if (!isObject(raw)) return null;
  if (![raw.x, raw.z].every((v) => Number.isFinite(Number(v)))) return null;
  const seat = raw.mode === 'seated' ? sanitizeSeat(raw.seat) : null;
  return {
    mode: seat ? 'seated' : 'walking',
    seat,
    x: round(clamp(raw.x, -100, 100)),
    y: round(clamp(raw.y, -10, 20)),
    z: round(clamp(raw.z, -100, 100)),
    levelId: id(raw.levelId) ?? 'ground',
    yaw: round(wrapAngle(raw.yaw), 4),
    pitch: round(clamp(raw.pitch, -1.5, 1.5), 4),
  };
}

export function sanitizeFocus(raw) {
  const source = isObject(raw) ? raw : {};
  return {
    running: source.running === true,
    onBreak: source.onBreak === true,
    remaining: round(clamp(source.remaining, 0, MAX_FOCUS_SECONDS), 2),
  };
}

// The café radio's recorded track. The station itself is an interface
// setting, and a YouTube choice lives in settings.youtube.
export function sanitizeMusic(raw) {
  if (!isObject(raw) || !id(raw.trackId)) return null;
  return { station: id(raw.station), trackId: raw.trackId, position: round(clamp(raw.position, 0, 3600), 2) };
}

export function sanitizeCheckpoint(raw) {
  if (!isObject(raw)) return null;
  const savedAt = finite(raw.savedAt, NaN);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
  return {
    version: CHECKPOINT_VERSION,
    savedAt,
    cafeId: id(raw.cafeId),
    preferences: sanitizePreferences(raw.preferences),
    settings: sanitizeUISettings(raw.settings ?? {}),
    stats: sanitizeStats(raw.stats),
    player: sanitizePlayer(raw.player),
    focus: sanitizeFocus(raw.focus),
    music: sanitizeMusic(raw.music),
  };
}

// Brings any stored checkpoint up to CHECKPOINT_VERSION, or returns null when
// that is impossible (corrupt, from a newer deploy, or a gap in migrations).
export function migrateCheckpoint(raw, { version = CHECKPOINT_VERSION, migrations = MIGRATIONS } = {}) {
  if (!isObject(raw)) return null;
  let from = Math.floor(finite(raw.version, NaN));
  if (!Number.isFinite(from) || from < 1 || from > version) return null;
  let current = raw;
  while (from < version) {
    const step = migrations[from];
    if (typeof step !== 'function') return null;
    try {
      current = step(current);
    } catch {
      return null;
    }
    if (!isObject(current)) return null;
    from += 1;
  }
  const clean = sanitizeCheckpoint(current);
  return clean && { ...clean, version };
}

export function newestCheckpoint(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.savedAt > best.savedAt)) best = candidate;
  }
  return best;
}

export function resumeFocus(focus, savedAt, now, graceMs = FOCUS_RESUME_GRACE_MS) {
  const saved = sanitizeFocus(focus);
  if (!saved.running) return { ...saved, interrupted: false };
  const away = Math.max(0, now - savedAt);
  if (away <= graceMs && away / 1000 < saved.remaining) {
    return { running: true, onBreak: saved.onBreak, remaining: round(saved.remaining - away / 1000, 2), interrupted: false };
  }
  return { running: false, onBreak: saved.onBreak, remaining: saved.remaining, interrupted: true };
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(finite(seconds)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function formatSavedAgo(savedAt, now) {
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const TIME_NAMES = { morning: 'Morning', noon: 'Noon', sunset: 'Sunset', night: 'Night' };
const SKY_NAMES = { clear: 'Clear', rain: 'Rain' };

// One line naming the place and one describing what was going on, for the
// title screen's Continue button.
export function describeCheckpoint(checkpoint, { cafeName = 'the café', now = Date.now() } = {}) {
  const { preferences, player, focus } = checkpoint;
  const place = [cafeName, TIME_NAMES[preferences.envTime], SKY_NAMES[preferences.envSky]].filter(Boolean).join(' · ');
  const parts = [player?.mode === 'walking' ? 'Walking around' : 'At your table'];
  const full = preferences.focusMinutes * 60;
  if (focus.running || focus.remaining < full - 1) {
    parts.push(`${focus.onBreak ? 'Break' : 'Focus'} ${formatClock(focus.remaining)} left`);
  }
  parts.push(`saved ${formatSavedAgo(checkpoint.savedAt, now)}`);
  return { place, detail: parts.join(' · ') };
}
