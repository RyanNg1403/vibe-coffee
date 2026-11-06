// Completed focus blocks per local calendar day, kept on this device only.

const STORAGE_KEY = 'vibe-coffee.focus-stats.v1';
const KEEP_DAYS = 60;

export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function previousDay(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() - 1);
  return copy;
}

export function sanitizeStats(raw) {
  const days = {};
  const source = raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
    const sessions = Math.max(0, Math.floor(Number(value.sessions) || 0));
    const minutes = Math.max(0, Math.round(Number(value.minutes) || 0));
    if (sessions > 0) days[key] = { sessions, minutes };
  }
  return { days };
}

export function recordFocusBlock(stats, minutes, now = new Date()) {
  const next = sanitizeStats(stats);
  const key = dayKey(now);
  const today = next.days[key] ?? { sessions: 0, minutes: 0 };
  next.days[key] = { sessions: today.sessions + 1, minutes: today.minutes + Math.max(0, Math.round(minutes)) };
  const keys = Object.keys(next.days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete next.days[old];
  return next;
}

// A streak counts consecutive days with at least one block, ending today (or
// yesterday, so an unfinished morning does not read as a broken streak).
export function focusSummary(stats, now = new Date()) {
  const { days } = sanitizeStats(stats);
  const today = days[dayKey(now)] ?? { sessions: 0, minutes: 0 };
  let cursor = days[dayKey(now)] ? now : previousDay(now);
  let streak = 0;
  while (days[dayKey(cursor)]) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  const week = [];
  let day = now;
  for (let i = 0; i < 7; i += 1) {
    week.unshift({ key: dayKey(day), sessions: days[dayKey(day)]?.sessions ?? 0 });
    day = previousDay(day);
  }
  return { sessionsToday: today.sessions, minutesToday: today.minutes, streak, week };
}

export function loadFocusStats(storage = globalThis.localStorage) {
  try {
    return sanitizeStats(JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { days: {} };
  }
}

export function saveFocusStats(stats, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(sanitizeStats(stats)));
  } catch {
    // Stats are a nicety; a full or disabled storage must not interrupt focus.
  }
}
