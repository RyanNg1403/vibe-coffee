// Bridge to the movement-intent contract owned by the UI workstream
// (src/controls/intent.js on PR #22). The player controller only ever sees
// that shape:
//
//   { move: { x, z }, look: { yaw, pitch }, sprint, interact, active }
//   move: view space, x = strafe right, z = forward, |move| <= 1 (analog)
//
// `readIntent(dt, source)` accepts either the UI's controls object (anything
// with `frame(dt)`) or, until that module merges, the legacy Set of held key
// codes main.js already keeps. Switching over is one argument: pass
// `controls` instead of `keys`.

export function createIntent() {
  return { move: { x: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, sprint: false, interact: null, active: false };
}

const legacy = createIntent();

function held(keys, ...codes) {
  for (const code of codes) if (keys.has(code)) return true;
  return false;
}

export function intentFromKeys(keys, out = legacy) {
  const x = (held(keys, 'KeyD', 'ArrowRight') ? 1 : 0) - (held(keys, 'KeyA', 'ArrowLeft') ? 1 : 0);
  const z = (held(keys, 'KeyW', 'ArrowUp') ? 1 : 0) - (held(keys, 'KeyS', 'ArrowDown') ? 1 : 0);
  const length = Math.hypot(x, z);
  out.move.x = length > 1 ? x / length : x;
  out.move.z = length > 1 ? z / length : z;
  out.look.yaw = 0;
  out.look.pitch = 0;
  out.sprint = held(keys, 'ShiftLeft', 'ShiftRight');
  out.interact = null;
  out.active = length > 0;
  return out;
}

export function readIntent(dt, source) {
  if (source && typeof source.frame === 'function') return source.frame(dt);
  if (source && typeof source.has === 'function') return intentFromKeys(source);
  return intentFromKeys(EMPTY_KEYS);
}

const EMPTY_KEYS = new Set();

// Convert a view-space intent into a world-space planar vector for a camera
// with the given yaw (+yaw turns left, the camera looks down -z at yaw 0).
export function intentToWorld(intent, yaw, out = { x: 0, z: 0 }) {
  const mx = intent?.move?.x ?? 0;
  const mz = intent?.move?.z ?? 0;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  out.x = -sin * mz + cos * mx;
  out.z = -cos * mz - sin * mx;
  return out;
}
