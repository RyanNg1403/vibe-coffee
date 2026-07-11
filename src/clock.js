// Pure local-time-to-hand-angle conversion for the café wall clock. Kept free
// of Three.js so the mapping is unit-testable and cannot drift from wall time:
// callers pass a real `Date` (browser/OS timezone) — never simulation time,
// environment time-of-day, or accumulated dt.
const TAU = Math.PI * 2;

// Returns clockwise radians from 12 o'clock for each hand. The second hand
// sweeps smoothly (milliseconds included); a mechanical stepped hand can
// floor the date's milliseconds before calling.
export function clockAngles(date) {
  const seconds = date.getSeconds() + date.getMilliseconds() / 1000;
  const minutes = date.getMinutes() + seconds / 60;
  const hours = (date.getHours() % 12) + minutes / 60;
  return {
    hour: (hours / 12) * TAU,
    minute: (minutes / 60) * TAU,
    second: (seconds / 60) * TAU,
  };
}
