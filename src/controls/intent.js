// Movement intent: the one interface between input devices and whatever
// moves the player (today the camera code in main.js; next, the character
// controller). Each rendered frame the consumer calls `controls.frame(dt)`
// and receives one intent:
//
//   intent.move     { x, z }   desired planar direction in view space,
//                              x = strafe right (+) / left (-),
//                              z = forward (+) / back (-);
//                              analog, |move| <= 1 (keys give 0 or 1).
//   intent.look     { yaw, pitch }  radians to ADD this frame, already scaled
//                              by sensitivity, invert-Y and optional
//                              smoothing. +yaw turns left (Three.js Y-up),
//                              +pitch looks up. Clamp with clampPitch().
//   intent.sprint   boolean    sprint requested (Shift, LT/L3, full stick).
//   intent.interact null | { x, y }  set on the single frame an interact was
//                              requested; x/y in normalised device
//                              coordinates (0,0 = crosshair, touch taps
//                              carry their own point).
//   intent.active   boolean    any input this frame (frame-rate hint).
//
// The intent says what the player wants; speed, acceleration, collision and
// stepping belong to the consumer.

export const PITCH_LIMITS = Object.freeze({ min: -1.4, max: 1.4 });

// Radians per pixel of raw mouse movement at sensitivity 1.
export const MOUSE_RADIANS_PER_PIXEL = 0.0022;
// Radians per pixel of touch drag at sensitivity 1 (matches the original
// drag-to-look feel on phones).
export const TOUCH_RADIANS_PER_PIXEL = { yaw: 0.0032, pitch: 0.0028 };
// Radians per second at full right-stick deflection, sensitivity 1.
export const STICK_RADIANS_PER_SECOND = { yaw: 2.6, pitch: 1.9 };

export function createIntent() {
  return { move: { x: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, sprint: false, interact: null, active: false };
}

export function clampPitch(pitch) {
  return Math.min(PITCH_LIMITS.max, Math.max(PITCH_LIMITS.min, pitch));
}

// Digital keys -> unit-or-zero planar vector (diagonals normalised).
export function keysToMove({ forward, back, left, right }) {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const z = (forward ? 1 : 0) - (back ? 1 : 0);
  const length = Math.hypot(x, z);
  return length > 1 ? { x: x / length, z: z / length } : { x, z };
}

// Analog stick (browser axes: +y is down) -> planar vector with a radial
// dead zone rescaled so motion starts smoothly at its edge. `curve` > 1
// gives finer control near the centre (slow, precise steps).
export function stickToMove(ax, ay, deadZone = 0.18, curve = 1) {
  const length = Math.hypot(ax, ay);
  if (length <= deadZone) return { x: 0, z: 0 };
  const scaled = Math.min(1, (length - deadZone) / (1 - deadZone)) ** curve;
  return { x: (ax / length) * scaled, z: (-ay / length) * scaled };
}

// Touch thumb-stick tuning: a small dead zone absorbs thumb wobble, the
// curve keeps half-deflection walking slow, full deflection sprints.
export const TOUCH_STICK = Object.freeze({ deadZone: 0.14, curve: 1.35, sprintAt: 0.94, travel: 44 });

// Swipe-to-look acceleration: slow drags stay 1:1 for precise aim, fast
// flicks turn further (up to 2.2x) so a full turn needs no repeated swipes.
export const TOUCH_LOOK_ACCEL = Object.freeze({ slow: 0.25, fast: 1.6, maxGain: 2.2 });
export function touchLookGain(pxPerMs) {
  const { slow, fast, maxGain } = TOUCH_LOOK_ACCEL;
  const t = Math.min(1, Math.max(0, (pxPerMs - slow) / (fast - slow)));
  const eased = t * t * (3 - 2 * t);
  return 1 + (maxGain - 1) * eased;
}

// Raw pointer delta (pixels, +x right, +y down) -> look radians.
export function pointerLook(dx, dy, { sensitivity = 1, invertY = false } = {}, perPixel = { yaw: MOUSE_RADIANS_PER_PIXEL, pitch: MOUSE_RADIANS_PER_PIXEL }) {
  return {
    yaw: -dx * perPixel.yaw * sensitivity,
    pitch: -dy * perPixel.pitch * sensitivity * (invertY ? -1 : 1),
  };
}

// Right stick -> look radians for this frame (squared response curve keeps
// small corrections precise).
export function stickLook(ax, ay, dt, { sensitivity = 1, invertY = false } = {}, deadZone = 0.14) {
  const shape = (v) => {
    const magnitude = Math.max(0, (Math.abs(v) - deadZone) / (1 - deadZone));
    return Math.sign(v) * magnitude * magnitude;
  };
  return {
    yaw: -shape(ax) * STICK_RADIANS_PER_SECOND.yaw * sensitivity * dt,
    pitch: -shape(ay) * STICK_RADIANS_PER_SECOND.pitch * sensitivity * dt * (invertY ? -1 : 1),
  };
}

// Optional look smoothing: each frame releases a fixed fraction of the
// not-yet-applied rotation, so the total turn is preserved and only spread
// over a few frames (about 45 ms).
export const SMOOTHING_TIME = 0.045;
export function smoothLook(state, look, dt, enabled) {
  if (!enabled || dt <= 0) {
    state.pendingYaw = 0;
    state.pendingPitch = 0;
    return look;
  }
  state.pendingYaw = (state.pendingYaw ?? 0) + look.yaw;
  state.pendingPitch = (state.pendingPitch ?? 0) + look.pitch;
  const k = 1 - Math.exp(-dt / SMOOTHING_TIME);
  const out = { yaw: state.pendingYaw * k, pitch: state.pendingPitch * k };
  state.pendingYaw -= out.yaw;
  state.pendingPitch -= out.pitch;
  if (Math.abs(state.pendingYaw) < 1e-5) state.pendingYaw = 0;
  if (Math.abs(state.pendingPitch) < 1e-5) state.pendingPitch = 0;
  return out;
}
