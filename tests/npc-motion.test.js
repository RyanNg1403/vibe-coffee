import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { angleDelta, turnToward, walkingTimeScale, MotionInterpolator } from '../src/npc/motion.js';

test('turns cross the angle seam by the short route and cap sudden about-faces', () => {
  const start = Math.PI - 0.03;
  const next = turnToward(start, -Math.PI + 0.03, 1 / 30);
  assert.ok(next > start && next < start + 0.06);
  assert.ok(Math.abs(turnToward(0, Math.PI, 1 / 30)) <= 4.2 / 30);
});

test('small facing changes converge equally at 30, 60 and 144 Hz', () => {
  const results = [30, 60, 144].map((hz) => {
    let yaw = 0;
    for (let i = 0; i < hz; i++) yaw = turnToward(yaw, 0.3, 1 / hz);
    return yaw;
  });
  for (const value of results) assert.ok(Math.abs(value - results[0]) < 1e-12);
});

test('walking cadence slows with actual travel and stops at zero velocity', () => {
  assert.equal(walkingTimeScale(0), 0);
  assert.ok(Math.abs(walkingTimeScale(0.08) - 0.1) < 1e-12);
  assert.equal(walkingTimeScale(0.8), 1);
  assert.ok(walkingTimeScale(0.08) < walkingTimeScale(0.4));
});

test('60 Hz rendering produces evenly spaced positions from 30 Hz simulation', () => {
  const motion = new MotionInterpolator();
  const root = new Group();
  const rendered = [];
  for (let tick = 0; tick < 4; tick++) {
    motion.capture(root);
    root.position.x += 1 / 30;
    motion.commit(root);
    for (const alpha of [0, 0.5]) {
      motion.apply(root, alpha);
      rendered.push(root.position.x);
      motion.restore(root);
      assert.ok(Math.abs(root.position.x - (tick + 1) / 30) < 1e-12);
    }
  }
  for (let i = 1; i < rendered.length; i++) {
    assert.ok(Math.abs(rendered[i] - rendered[i - 1] - 1 / 60) < 1e-12);
  }
});

test('rotation interpolation crosses the seam without a full spin and restores simulation state', () => {
  const motion = new MotionInterpolator();
  const root = new Group();
  root.rotation.y = Math.PI - 0.1;
  motion.capture(root);
  root.rotation.y = -Math.PI + 0.1;
  const expected = root.quaternion.clone();
  motion.commit(root);
  motion.apply(root, 0.5);
  // Read yaw from the quaternion; Euler decomposition can choose an X/Z flip.
  const yaw = 2 * Math.atan2(root.quaternion.y, root.quaternion.w);
  assert.ok(Math.abs(angleDelta(yaw, Math.PI)) < 1e-12);
  motion.restore(root);
  assert.ok(root.quaternion.angleTo(expected) < 1e-7);
  assert.equal(root.rotation.y, -Math.PI + 0.1);
  assert.equal(root.rotation.x, 0);
  assert.equal(root.rotation.z, 0);
  assert.equal(root.matrixWorldNeedsUpdate, true);
});

test('spawning, sidewalk wrapping and reparenting never interpolate across the venue', () => {
  const motion = new MotionInterpolator();
  const root = new Group();
  root.position.x = 8;
  motion.commit(root);
  motion.apply(root, 0.5);
  assert.equal(root.position.x, 8);
  motion.capture(root);
  root.position.x = -15;
  motion.commit(root);
  motion.apply(root, 0.5);
  assert.equal(root.position.x, -15);
  motion.capture(root);
  new Group().add(root);
  root.position.x += 0.02;
  motion.commit(root);
  motion.apply(root, 0.5);
  assert.equal(root.position.x, -14.98);
});
