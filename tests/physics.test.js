import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PlayerMotor, criticalSpring } from '../src/physics/playerMotor.js';
import { HingeDoor, attachHingePhysics } from '../src/physics/hingeDoor.js';
import { AirField, Pendulum, SwayRig, SteamDisturbance } from '../src/physics/secondaryMotion.js';
import { timeToCollision, avoidAgent } from '../src/physics/crowdAvoidance.js';
import { centripetalLean, BodyDynamics } from '../src/physics/bodyDynamics.js';
import { createTableScene, kickDisplacement } from '../src/physics/tablePropSim.js';
import { describeProp, TablePropPhysics } from '../src/physics/propPhysics.js';
import { PhysicsBudget, detectPhysicsTier } from '../src/physics/deviceTier.js';
import { collectTables } from '../src/physics/realism.js';
import { impactLoudness } from '../src/physics/impactAudio.js';

const FRAME = 1 / 60;

test('player motor ramps up, caps at walking speed and glides to a stop', () => {
  const motor = new PlayerMotor();
  motor.drive(FRAME, 0, -1);
  assert.ok(motor.speed > 0 && motor.speed < 0.2, 'no instant full speed');
  for (let i = 0; i < 60; i++) motor.drive(FRAME, 0, -1);
  assert.ok(Math.abs(motor.speed - motor.options.maxSpeed) < 1e-6);
  let glide = 0;
  let frames = 0;
  while (motor.speed > 0 && frames < 120) {
    glide += motor.drive(FRAME, 0, 0).z;
    frames += 1;
  }
  // v²/2a ≈ 0.21 m of braking at 9.5 m/s²
  assert.ok(Math.abs(glide) > 0.15 && Math.abs(glide) < 0.3, `glide ${glide}`);
  assert.ok(frames < 20, 'stops within a third of a second');
});

test('player motor slides along obstacles and reports the normal impact speed', () => {
  const motor = new PlayerMotor();
  for (let i = 0; i < 60; i++) motor.drive(FRAME, 1, 0);
  const proposed = motor.drive(FRAME, 1, -1);
  // a wall blocks all +x motion
  const impact = motor.settle(FRAME, 0, proposed.z);
  assert.ok(impact > 1, `impact ${impact}`);
  assert.equal(motor.vx, 0);
  assert.ok(motor.vz < 0, 'keeps sliding along the wall');
  // the next frame pressing into the wall is no longer a fresh impact
  const next = motor.drive(FRAME, 1, -1);
  assert.ok(motor.settle(FRAME, 0, next.z) < 0.3);
});

test('footfalls follow distance travelled and the gait settles without a pop', () => {
  const motor = new PlayerMotor();
  const result = {};
  let steps = 0;
  let travelled = 0;
  for (let i = 0; i < 600; i++) {
    const d = motor.drive(FRAME, 0, -1);
    travelled += Math.abs(d.z);
    motor.gait(FRAME, 0, 1, 0, result);
    if (result.footstep) steps += 1;
  }
  const expected = travelled / motor.options.stepLength;
  assert.ok(Math.abs(steps - expected) <= 2, `${steps} steps for ${expected.toFixed(1)}`);
  let previous = motor.bobY;
  let maxJump = 0;
  for (let i = 0; i < 120; i++) {
    motor.drive(FRAME, 0, 0);
    motor.gait(FRAME, 0, 1, 0, result);
    maxJump = Math.max(maxJump, Math.abs(motor.bobY - previous));
    previous = motor.bobY;
  }
  assert.ok(maxJump < 0.004, `bob moved ${maxJump} m in one frame`);
  assert.ok(Math.abs(motor.bobY) < 1e-3 && !motor.moving);
});

test('eye height follows stairs smoothly and never lags far behind', () => {
  const motor = new PlayerMotor();
  motor.reset(0);
  let ground = 0;
  let maxLag = 0;
  for (let i = 0; i < 90; i++) {
    if (i % 10 === 0) ground += 0.17; // a riser every sixth of a second
    motor.gait(FRAME, ground, 1, 0);
    maxLag = Math.max(maxLag, Math.abs(motor.eyeY - ground));
  }
  assert.ok(maxLag <= motor.options.maxEyeLag + 1e-9);
  for (let i = 0; i < 60; i++) motor.gait(FRAME, ground, 1, 0);
  assert.ok(Math.abs(motor.eyeY - ground) < 1e-3);
  const s = criticalSpring(1, 0, 0, 10, 10);
  assert.ok(Number.isFinite(s.x) && Math.abs(s.x) < 1e-6, 'stable for huge steps');
});

test('reduced motion removes head bob, sway and roll', () => {
  const motor = new PlayerMotor();
  motor.reducedMotion = true;
  for (let i = 0; i < 120; i++) {
    motor.drive(FRAME, i % 40 < 20 ? 1 : -1, -1);
    motor.gait(FRAME, 0, 1, 0);
    assert.equal(Math.abs(motor.bobY), 0);
    assert.equal(Math.abs(motor.swayX), 0);
    assert.ok(Math.abs(motor.roll) < 1e-12);
  }
});

function runDoor(door, seconds, step = 1 / 30) {
  let t = 0;
  while (t < seconds - 1e-9) { door.step(step); t += step; }
}

test('hinge door opens for the coordinator about as fast as a firm push', () => {
  const door = new HingeDoor();
  door.setTarget(1.24);
  let t = 0;
  while (door.openness < 0.82 && t < 2) { door.step(1 / 30); t += 1 / 30; }
  assert.ok(t > 0.25 && t < 0.65, `reached passage width after ${t.toFixed(2)} s`);
  runDoor(door, 1);
  assert.ok(Math.abs(door.angle - 1.24) < 0.02);
  assert.ok(Math.abs(door.angle) <= door.options.limit);
});

test('hinge door swings shut with a small overshoot and settles', () => {
  const door = new HingeDoor();
  door.setTarget(-1.24);
  runDoor(door, 1);
  door.setTarget(null);
  let t = 0;
  let overshoot = 0;
  while (t < 3) {
    door.step(1 / 30);
    t += 1 / 30;
    if (door.angle > 0) overshoot = Math.max(overshoot, door.angle);
    if (t > 0.9) assert.ok(door.openness < 0.06, `still ${door.openness.toFixed(3)} open at ${t.toFixed(2)} s`);
  }
  assert.ok(overshoot > 0.002 && overshoot < 0.12, `overshoot ${overshoot}`);
  assert.equal(door.angle, 0);
});

test('a slammed door bounces off its stop and reports the impact', () => {
  const door = new HingeDoor();
  door.omega = 8;
  door.angle = 1.45;
  door.step(1 / 30);
  const events = door.drainEvents();
  assert.ok(events.some((e) => e.kind === 'stop' && e.speed > 1));
  assert.ok(door.omega < 0, 'rebounds');
  assert.equal(door.drainEvents().length, 0);
});

test('an actor in the swing arc is pushed aside and bounces the leaf', () => {
  const door = new HingeDoor();
  door.setPivot(0, 0);
  door.angle = 0.6;
  door.omega = -2; // swinging back toward the actor
  // a point 0.6 m along the leaf, 0.2 m to the side it is closing toward
  const c = Math.cos(0.6), s = Math.sin(0.6);
  const actor = { x: c * 0.6 + s * 0.2, z: -s * 0.6 + c * 0.2 };
  const before = { ...actor };
  assert.ok(door.resolveActor(actor, 0.3));
  assert.ok(door.omega > 0, 'leaf bounces back');
  assert.ok(door.angle > 0.6, 'leaf yields');
  const normal = (actor.x - before.x) * s + (actor.z - before.z) * c;
  assert.ok(normal > 0, 'actor pushed away from the leaf');
  assert.ok(door.drainEvents().some((e) => e.kind === 'actor'));
  assert.equal(door.resolveActor({ x: 5, z: 5 }, 0.3), false);
});

test('attached hinge keeps the entrance contract used by the door coordinator', () => {
  const root = new THREE.Object3D();
  root.position.set(-0.5, 0, 6.77);
  const entrance = {
    root, angle: 0, targetAngle: 0, openness: 0, direction: null,
    setDirection(direction) {
      this.direction = direction;
      this.targetAngle = direction === 'in' ? 1.24 : direction === 'out' ? -1.24 : 0;
    },
    update() { throw new Error('replaced'); },
  };
  const door = attachHingePhysics(entrance);
  assert.equal(attachHingePhysics(entrance), door);
  entrance.setDirection('in');
  for (let i = 0; i < 30; i++) entrance.update(1 / 30);
  assert.ok(entrance.openness > 0.82 && entrance.angle > 0);
  assert.equal(root.rotation.y, entrance.angle);
  entrance.setDirection(null);
  for (let i = 0; i < 45; i++) entrance.update(1 / 30);
  assert.ok(entrance.openness <= 0.06);
});

test('pendulum swings at its natural period, damps out and leans downwind', () => {
  const p = new Pendulum({ length: 1, damping: 0.02, drag: 0, quadraticDrag: 0 });
  p.ax = 0.05;
  const crossings = [];
  let previous = p.ax;
  for (let i = 0; i < 1200; i++) {
    p.step(1 / 120, 0, 0);
    if (previous > 0 && p.ax <= 0) crossings.push(i / 120);
    previous = p.ax;
  }
  const period = crossings[1] - crossings[0];
  assert.ok(Math.abs(period - 2 * Math.PI * Math.sqrt(1 / 9.81)) < 0.05, `period ${period}`);
  assert.ok(Math.abs(p.ax) < 0.05 * 0.7, 'loses energy');
  const windy = new Pendulum({ length: 1 });
  for (let i = 0; i < 600; i++) windy.step(1 / 60, 0.6, 0);
  assert.ok(windy.ax > 0.01 && Math.abs(windy.az) < 1e-6);
});

test('sway rig pivots a fixture about its anchor and sleeps in still air', () => {
  const root = new THREE.Group();
  const plant = new THREE.Group();
  plant.position.set(2, 2.8, 1);
  plant.userData.secondaryMotion = { kind: 'pendulum', anchor: [2, 3.6, 1], length: 1 };
  root.add(plant);
  const rig = new SwayRig(root);
  assert.equal(rig.size, 1);
  const air = new AirField();
  for (let i = 0; i < 30; i++) {
    air.begin(1 / 30);
    air.addGust(2, 0, 1, 1.5, 0, 2);
    rig.update(1 / 30, air);
  }
  assert.ok(plant.position.x > 2, 'swings downwind');
  // the cord's anchor stays put: the plant stays 0.8 m from it
  const distance = plant.position.distanceTo(new THREE.Vector3(2, 3.6, 1));
  assert.ok(Math.abs(distance - 0.8) < 1e-6);
  for (let i = 0; i < 2000 && rig.awakeCount; i++) {
    air.begin(1 / 30);
    rig.update(1 / 30, air);
  }
  assert.equal(rig.awakeCount, 0);
});

test('people drag a local wake of air; the field is still elsewhere', () => {
  const air = new AirField();
  air.begin(1 / 30);
  air.addMover(0, 0, 0, 1.4, 0);
  const out = { x: 0, z: 0 };
  air.sample(0, 1, 0, out);
  assert.ok(out.x > 0.4 && out.x < 0.6);
  air.sample(6, 1, 0, out);
  assert.equal(out.x, 0);
  air.sample(0, 3.5, 0, out);
  assert.ok(out.x < 0.1, 'little wake above head height');
});

test('steam bends with the air without accumulating drift', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const base = new Float32Array([0, 1, 0, 0, 1.2, 0, 0, 1.4, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(new Float32Array([0.08, 0.16, 0.24]), 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(3), 1));
  root.add(new THREE.Points(geometry, new THREE.PointsMaterial()));
  const steam = new SteamDisturbance(root);
  const air = new AirField();
  const positions = geometry.attributes.position;
  for (let i = 0; i < 90; i++) {
    air.begin(1 / 30);
    air.addGust(0, 0, 0, 1, 0, 2);
    if (i % 2 === 0) { positions.array.set(base); positions.needsUpdate = true; }
    steam.update(1 / 30, air);
  }
  const top = positions.array[6];
  assert.ok(top > 0.1 && top <= 0.22 + 1e-6, `top wisp ${top}`);
  assert.ok(Math.abs(positions.array[0]) < 1e-6, 'the newest wisp stays at the cup');
  for (let i = 0; i < 5; i++) {
    air.begin(1 / 30);
    air.addGust(0, 0, 0, 1, 0, 2);
    steam.update(1 / 30, air);
  }
  assert.ok(Math.abs(positions.array[6] - top) < 0.02, 'no accumulation without fresh writes');
});

test('time-to-collision avoidance steers early and sideways', () => {
  assert.ok(Math.abs(timeToCollision(-4, 0, 2, 0, 0.6) - 1.7) < 1e-9);
  assert.equal(timeToCollision(-4, 2, 2, 0, 0.6), Infinity);
  assert.equal(timeToCollision(4, 0, 2, 0, 0.6), Infinity, 'moving apart');
  const dir = { x: 1, z: 0 };
  const strength = avoidAgent(dir,
    { x: 0, z: 0.1, vx: 1.2, vz: 0, radius: 0.3 },
    { x: 2, z: 0, vx: -1, vz: 0, radius: 0.32 });
  assert.ok(strength > 0 && dir.z > 0, 'sidesteps away from the oncoming path');
  const far = { x: 1, z: 0 };
  assert.equal(avoidAgent(far, { x: 0, z: 0, vx: 1, vz: 0, radius: 0.3 }, { x: 9, z: 0, vx: 0, vz: 0, radius: 0.3 }), 0);
});

test('body dynamics leans into turns only around the render call', () => {
  assert.ok(centripetalLean(1.2, 1.5) > 0.05 && centripetalLean(1.2, 1.5) <= 0.12);
  assert.equal(centripetalLean(0, 3), 0);
  const body = new BodyDynamics();
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const actors = [{ root, target: inner, local: false }];
  const camera = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    root.rotation.y += 1.5 / 30; // turning left while walking
    root.position.x += Math.sin(root.rotation.y) * 1.2 / 30;
    root.position.z += Math.cos(root.rotation.y) * 1.2 / 30;
    body.update(1 / 30, actors, camera);
  }
  body.beforeRender(actors);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inner.quaternion);
  assert.ok(up.x > 0.03, 'leans toward its left (+x) into the turn');
  body.afterRender();
  assert.ok(inner.quaternion.equals(new THREE.Quaternion()), 'pose restored exactly');
});

test('device tier honours overrides and weak hardware', () => {
  const env = (search, cores = 8, deviceMemory = 8) => ({
    navigator: { hardwareConcurrency: cores, deviceMemory },
    location: { search }, Worker: function Worker() {}, WebAssembly: {},
  });
  assert.equal(detectPhysicsTier(env('')).tier, 'full');
  assert.equal(detectPhysicsTier(env('')).worker, true);
  assert.equal(detectPhysicsTier(env('', 2)).tier, 'lite');
  assert.equal(detectPhysicsTier(env('?physics=off')).tier, 'off');
  assert.equal(detectPhysicsTier({ navigator: {} }).worker, false);
  const budget = new PhysicsBudget(2);
  for (let i = 0; i < 100; i++) budget.observe(0.08);
  assert.equal(budget.level, 0);
  for (let i = 0; i < 2000; i++) budget.observe(1 / 60);
  assert.equal(budget.level, 2);
  assert.equal(budget.observe(3), 2, 'tab switches are ignored');
});

test('impact loudness is monotonic and bounded', () => {
  assert.equal(impactLoudness(0), 0);
  assert.ok(impactLoudness(0.5) < impactLoudness(1));
  assert.equal(impactLoudness(50), 1);
});

test('tables are collected once each with their support shape', () => {
  const center = new THREE.Vector3(1, 0, 2);
  const shape = { kind: 'rect', center: { x: 1, z: 2 }, rotation: 0.4, width: 1.2, depth: 0.7 };
  const tables = collectTables({
    seats: [
      { tableCenter: center, supportShape: shape, tableTopY: 0.78 },
      { tableCenter: center.clone(), supportShape: shape, tableTopY: 0.78 },
      { tableCenter: new THREE.Vector3(-2, 0, 0), tableRadius: 0.4, tableTopY: 0.81 },
    ],
  });
  assert.equal(tables.length, 2);
  assert.equal(tables[0].seats.length, 2);
  assert.equal(tables[0].yaw, -0.4);
  assert.equal(tables[0].hx, 0.6);
  assert.equal(tables[1].shape, 'cylinder');
});

function mug(x, z, topY) {
  const object = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 12));
  body.position.y = 0.05;
  object.add(body);
  object.position.set(x, topY, z);
  return object;
}

test('props are described as bodies resting exactly on the tabletop', () => {
  const group = new THREE.Group();
  const cup = mug(0.1, 0, 0.8);
  group.add(cup);
  const description = describeProp(cup, 3, 0.8);
  assert.equal(description.id, 3);
  assert.equal(description.shape, 'cylinder');
  assert.ok(Math.abs(description.oy - description.hy) < 1e-6);
  assert.ok(description.mass > 0.05 && description.mass < 1);
  assert.equal(describeProp(mug(0, 0, 1.4), 0, 0.8), null, 'not on this table');
});

test('a bumped Rapier table rattles its props, keeps them on top and sleeps', async () => {
  await RAPIER.init();
  const topY = 0.8;
  const group = new THREE.Group();
  const cups = [mug(0.12, 0.05, topY), mug(-0.15, -0.1, topY), mug(0.0, 0.18, topY)];
  cups.forEach((cup) => group.add(cup));
  const props = cups.map((cup, i) => describeProp(cup, i, topY));
  const scene = createTableScene(RAPIER, {
    top: { x: 0, y: topY, z: 0, yaw: 0.3, shape: 'box', hx: 0.4, hz: 0.4, radius: 0.4 },
    props,
    kick: { dx: 1, dz: 0, speed: 1.6 },
  });
  let result;
  let moved = 0;
  let frames = 0;
  do {
    result = scene.step(1 / 60);
    frames += 1;
    for (let o = 0; o < result.transforms.length; o += 8) {
      const start = props[result.transforms[o]];
      moved = Math.max(moved, Math.hypot(result.transforms[o + 1] - start.x, result.transforms[o + 3] - start.z));
    }
  } while (!result.done && frames < 400);
  assert.ok(result.done, 'scene ends by itself');
  assert.ok(result.t < 3.01);
  assert.ok(moved > 0.0005, `props responded (${moved} m)`);
  assert.ok(moved < 0.05, 'a bump nudges, it does not fling');
  for (let o = 0; o < result.transforms.length; o += 8) {
    const y = result.transforms[o + 2];
    assert.ok(Math.abs(y - topY) < 0.01, `prop still on the table (y=${y})`);
    const q = new THREE.Quaternion(result.transforms[o + 4], result.transforms[o + 5], result.transforms[o + 6], result.transforms[o + 7]);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    assert.ok(up.y > 0.99, 'mugs remain upright');
  }
  scene.dispose();
  const k = kickDisplacement({ dx: 1, dz: 0, speed: 1 }, 2);
  assert.ok(Math.abs(k.x) < 1e-8, 'the table rings out');
});

test('without a worker, bumps fall back to analytic rocking that restores the pose', () => {
  const impacts = [];
  const physics = new TablePropPhysics({ useWorker: false, onImpact: (m) => impacts.push(m) });
  const group = new THREE.Group();
  const cup = mug(0, 0, 0.8);
  group.add(cup);
  const start = cup.quaternion.clone();
  assert.equal(physics.bump({ key: 't', x: 0, y: 0.8, z: 0, shape: 'cylinder', radius: 0.4 }, [cup], 1, 0, 1.4), 1);
  let tilted = 0;
  for (let i = 0; i < 120; i++) {
    physics.update(1 / 60);
    tilted = Math.max(tilted, cup.quaternion.angleTo(start));
  }
  assert.ok(tilted > 0.005, 'it rocked');
  assert.ok(cup.quaternion.angleTo(start) < 1e-6, 'and came to rest upright');
  assert.ok(cup.position.x > 0 && cup.position.x < 0.02, 'with a small slide');
  assert.ok(impacts.length >= 1);
  assert.equal(physics.awakeProps, 0);
});
