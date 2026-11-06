import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIntent, clampPitch, keysToMove, stickToMove, pointerLook, stickLook, smoothLook,
  PITCH_LIMITS, MOUSE_RADIANS_PER_PIXEL,
} from '../src/controls/intent.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('a fresh intent is idle', () => {
  assert.deepEqual(createIntent(), { move: { x: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, sprint: false, interact: null, active: false });
});

test('keys map to forward/strafe with normalised diagonals', () => {
  assert.deepEqual(keysToMove({ forward: true }), { x: 0, z: 1 });
  assert.deepEqual(keysToMove({ back: true, left: true, right: true }), { x: 0, z: -1 });
  const diagonal = keysToMove({ forward: true, right: true });
  close(Math.hypot(diagonal.x, diagonal.z), 1);
  assert.ok(diagonal.x > 0 && diagonal.z > 0);
});

test('stick movement has a radial dead zone and stays within the unit circle', () => {
  assert.deepEqual(stickToMove(0.1, -0.1), { x: 0, z: 0 });
  const forward = stickToMove(0, -1);
  close(forward.x, 0);
  close(forward.z, 1);
  const corner = stickToMove(1, 1);
  close(Math.hypot(corner.x, corner.z), 1);
  assert.ok(corner.z < 0, 'browser +y is down, so it means backwards');
  const half = stickToMove(0, -0.59);
  assert.ok(half.z > 0.45 && half.z < 0.55, 'analog magnitude is preserved past the dead zone');
});

test('mouse look turns right/down for positive deltas and honours sensitivity and invert', () => {
  const look = pointerLook(100, 50, { sensitivity: 1 });
  close(look.yaw, -100 * MOUSE_RADIANS_PER_PIXEL);
  close(look.pitch, -50 * MOUSE_RADIANS_PER_PIXEL);
  const fast = pointerLook(100, 0, { sensitivity: 2 });
  close(fast.yaw, look.yaw * 2);
  const inverted = pointerLook(0, 50, { sensitivity: 1, invertY: true });
  close(inverted.pitch, -look.pitch);
});

test('stick look is frame-rate independent and ignores the dead zone', () => {
  const a = stickLook(1, 0, 1 / 60);
  const b = stickLook(1, 0, 1 / 30);
  close(b.yaw, a.yaw * 2);
  assert.deepEqual(stickLook(0.1, -0.1, 1 / 60), { yaw: -0, pitch: 0 });
});

test('smoothing preserves the total rotation and passes through when off', () => {
  const raw = { yaw: 0.3, pitch: -0.1 };
  assert.deepEqual(smoothLook({}, raw, 1 / 60, false), raw);
  const state = {};
  let yaw = 0;
  let pitch = 0;
  for (let i = 0; i < 120; i += 1) {
    const out = smoothLook(state, i === 0 ? raw : { yaw: 0, pitch: 0 }, 1 / 60, true);
    if (i === 0) assert.ok(out.yaw < raw.yaw, 'the first frame only applies part of the turn');
    yaw += out.yaw;
    pitch += out.pitch;
  }
  close(yaw, 0.3, 1e-4);
  close(pitch, -0.1, 1e-4);
});

test('pitch is clamped short of straight up or down', () => {
  assert.equal(clampPitch(5), PITCH_LIMITS.max);
  assert.equal(clampPitch(-5), PITCH_LIMITS.min);
  assert.equal(clampPitch(0.3), 0.3);
  assert.ok(PITCH_LIMITS.max < Math.PI / 2);
});
