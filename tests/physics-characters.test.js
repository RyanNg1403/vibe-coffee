import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIntent, intentFromKeys, readIntent, intentToWorld } from '../src/physics/movementIntent.js';
import { PlayerController } from '../src/physics/playerController.js';
import { PlayerMotor } from '../src/physics/playerMotor.js';
import { ChairRig } from '../src/physics/chairs.js';
import { solveTwoBone, treadHeightAt, CharacterIK } from '../src/physics/characterIK.js';
import { SoftSway } from '../src/physics/softSway.js';
import { timeToCollision } from '../src/physics/crowdAvoidance.js';

const FRAME = 1 / 60;

test('intent adapter reads the UI controls or the legacy key set into one shape', () => {
  const shape = createIntent();
  assert.deepEqual(Object.keys(shape).sort(), ['active', 'interact', 'look', 'move', 'sprint']);
  const keys = new Set(['KeyW', 'KeyD', 'ShiftLeft']);
  const intent = intentFromKeys(keys);
  assert.ok(Math.abs(Math.hypot(intent.move.x, intent.move.z) - 1) < 1e-9, 'diagonals normalised');
  assert.ok(intent.move.x > 0 && intent.move.z > 0 && intent.sprint && intent.active);
  const fromControls = { move: { x: 0.3, z: 0 }, look: { yaw: 0.01, pitch: 0 }, sprint: false, interact: null, active: true };
  assert.equal(readIntent(FRAME, { frame: () => fromControls }), fromControls);
  assert.equal(readIntent(FRAME, null).active, false);
});

test('view-space intent maps to world space with the camera yaw', () => {
  const forward = intentToWorld({ move: { x: 0, z: 1 } }, 0);
  assert.ok(Math.abs(forward.x) < 1e-9 && forward.z === -1, 'forward is -z at yaw 0');
  const right = intentToWorld({ move: { x: 1, z: 0 } }, 0);
  assert.ok(right.x === 1 && Math.abs(right.z) < 1e-9);
  const turnedLeft = intentToWorld({ move: { x: 0, z: 1 } }, Math.PI / 2);
  assert.ok(Math.abs(turnedLeft.x + 1) < 1e-9, '+yaw turns left: forward becomes -x');
});

function fakeWorld(position = new THREE.Vector3()) {
  const steps = [];
  return {
    position,
    groundY: () => 0,
    levelId: () => 'ground',
    resolveStatic: (p) => { if (p.z < -2) p.z = -2; },
    resolveCrowd: () => {},
    commit: (p) => { position.x = p.x; position.z = p.z; },
    onFootstep: (_p, weight) => steps.push(weight),
    steps,
  };
}

function fakeRealism() {
  return {
    motor: new PlayerMotor(),
    beginPlayerMove() {}, notePlayerFurniture() {}, resolvePlayer: () => false, updatePlayer() {},
  };
}

test('character controller walks, sprints faster, collides and keeps footfalls', () => {
  const realism = fakeRealism();
  const world = fakeWorld();
  const controller = new PlayerController(realism, world);
  const intent = createIntent();
  intent.move.z = 1;
  let pose;
  for (let i = 0; i < 120; i++) pose = controller.step(FRAME, intent, 0);
  assert.ok(world.position.z < -1 && world.position.z >= -2, 'walked forward into the wall');
  assert.equal(world.position.z, -2);
  assert.ok(pose.moved && world.steps.length > 0);
  assert.ok(Math.abs(pose.y - (realism.motor.eyeY + 1.55 + realism.motor.bobY)) < 1e-9);
  const runner = new PlayerController(fakeRealism(), fakeWorld());
  const walker = new PlayerController(fakeRealism(), fakeWorld());
  const sprint = createIntent();
  sprint.move.x = 1;
  sprint.sprint = true;
  const stroll = createIntent();
  stroll.move.x = 1;
  for (let i = 0; i < 90; i++) {
    runner.step(FRAME, sprint, 0);
    walker.step(FRAME, stroll, 0);
  }
  assert.ok(runner.world.position.x > walker.world.position.x * 1.3, 'sprint covers more ground');
  const half = new PlayerController(fakeRealism(), fakeWorld());
  const analog = createIntent();
  analog.move.z = 0.5;
  for (let i = 0; i < 90; i++) half.step(FRAME, analog, 0);
  assert.ok(Math.abs(half.realism.motor.speed - 1) < 1e-6, 'half stick, half pace');
});

function chairCafe() {
  const group = new THREE.Group();
  const seatBatch = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), new THREE.MeshBasicMaterial(), 4);
  const cushionBatch = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.04, 0.38), new THREE.MeshBasicMaterial(), 4);
  group.add(seatBatch, cushionBatch);
  const matrix = new THREE.Matrix4();
  const seats = [];
  [[0, 0.7], [0, -0.7]].forEach(([x, z], i) => {
    matrix.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    seatBatch.setMatrixAt(i, matrix);
    cushionBatch.setMatrixAt(i, matrix);
    seats.push({
      pos: new THREE.Vector3(x, 0, z), tableCenter: new THREE.Vector3(0, 0, 0),
      chair: { isInstancedSeat: true, batch: seatBatch, instanceId: i },
    });
  });
  seatBatch.count = cushionBatch.count = 2;
  return { group, seats, seatBatch, cushionBatch };
}

function instanceX(batch, index) {
  const m = new THREE.Matrix4();
  batch.getMatrixAt(index, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

test('patrons scoot their chair out and back in as they sit', () => {
  const cafe = chairCafe();
  const rig = new ChairRig(cafe);
  assert.equal(rig.size, 2);
  const npc = { seatIndex: 0, state: 'aligningSeat', stateT: 0 };
  let peak = 0;
  let scrapes = 0;
  for (let i = 0; i < 27; i++) {
    npc.stateT = i / 30;
    rig.update(1 / 30, { npcs: [npc] }, -1, () => { scrapes += 1; });
    peak = Math.max(peak, rig.offsetOf(0));
  }
  npc.state = 'sitting';
  for (let i = 0; i < 60; i++) rig.update(1 / 30, { npcs: [npc] });
  assert.ok(peak > 0.06 && peak <= 0.13, `pulled out ${peak}`);
  assert.ok(rig.offsetOf(0) < 0.005, 'and scooted back in');
  assert.equal(scrapes, 1);
  // both batches of the chair moved together and returned to their place
  assert.ok(instanceX(cafe.seatBatch, 0).distanceTo(new THREE.Vector3(0, 0, 0.7)) < 0.006);
  assert.ok(instanceX(cafe.cushionBatch, 0).distanceTo(instanceX(cafe.seatBatch, 0)) < 1e-6);
});

test('a walking player shoves a loose chair aside but not an occupied one', () => {
  const cafe = chairCafe();
  const rig = new ChairRig(cafe);
  const motor = { vx: 1.5, vz: 0 };
  const player = new THREE.Vector3(-0.35, 0, 0.7);
  assert.ok(rig.resolvePlayer(player, 'ground', 0.3, motor));
  const moved = instanceX(cafe.seatBatch, 0);
  assert.ok(moved.x > 0.05, 'chair slid away from the player');
  assert.ok(Math.hypot(moved.x, moved.z - 0.7) <= 0.32 + 1e-6);
  // never shoved into the table
  const intoTable = new THREE.Vector3(0, 0, 1.2);
  for (let i = 0; i < 20; i++) rig.resolvePlayer(intoTable.set(0.3, 0, 1.15 - i * 0.01), 'ground', 0.3, { vx: 0, vz: -1.5 });
  assert.ok(instanceX(cafe.seatBatch, 0).z > 0.7 - 0.05 - 1e-6);
  // held by a sitter: the player is pushed back instead
  const npc = { seatIndex: 1, state: 'sitting', stateT: 5 };
  rig.update(1 / 30, { npcs: [npc] });
  const before = instanceX(cafe.seatBatch, 1);
  const p = new THREE.Vector3(0, 0, -0.35);
  rig.resolvePlayer(p, 'ground', 0.3, { vx: 0, vz: -1.5 });
  assert.ok(instanceX(cafe.seatBatch, 1).distanceTo(before) < 1e-9);
  assert.ok(p.z > -0.35 + 0.1, 'player stopped by the occupied chair');
});

function leg() {
  const hip = new THREE.Bone();
  const knee = new THREE.Bone();
  const ankle = new THREE.Bone();
  hip.position.set(0, 1, 0);
  knee.position.set(0, -0.45, 0.02);
  ankle.position.set(0, -0.45, -0.02);
  hip.add(knee);
  knee.add(ankle);
  const root = new THREE.Group();
  root.add(hip);
  root.updateMatrixWorld(true);
  return { root, hip, knee, ankle };
}

test('two-bone IK lifts a foot onto a target and keeps its orientation', () => {
  const { hip, knee, ankle } = leg();
  const before = ankle.getWorldQuaternion(new THREE.Quaternion());
  const target = new THREE.Vector3(0.05, 0.25, 0.05);
  const miss = solveTwoBone(hip, knee, ankle, target);
  assert.ok(miss < 1e-3, `reached within ${miss}`);
  assert.ok(ankle.getWorldQuaternion(new THREE.Quaternion()).angleTo(before) < 1e-4);
  const unreachable = solveTwoBone(hip, knee, ankle, new THREE.Vector3(0, -2, 0));
  assert.ok(Number.isFinite(unreachable), 'stretches straight toward an unreachable target');
});

test('tread heights follow the drawn steps, not the ramp', () => {
  const flights = [{ x0: -1, x1: 0, z0: 0, z1: 2, y0: 0, y1: 1.6 }];
  assert.equal(treadHeightAt(flights, -0.5, 0.05), 0.16);
  assert.ok(Math.abs(treadHeightAt(flights, -0.5, 1.99) - 1.6) < 1e-9);
  assert.equal(treadHeightAt(flights, 2, 1), null);
});

test('look-at IK turns the face toward its target and fully restores the pose', () => {
  const root = new THREE.Group();
  const neck = new THREE.Bone(); neck.name = 'neck';
  const head = new THREE.Bone(); head.name = 'Head';
  const face = new THREE.Bone(); face.name = 'headfront';
  neck.position.set(0, 1.5, 0);
  head.position.set(0, 0.1, 0);
  face.position.set(0, 0, 0.1);
  root.add(neck); neck.add(head); head.add(face);
  const mesh = new THREE.Group();
  mesh.add(root);
  new THREE.Scene().add(mesh);
  const npc = { avatar: { inner: root, root: mesh, bones: { Head: head, Neck: neck } }, mesh, gazeT: 2, gazeWorld: new THREE.Vector3(0.8, 2.2, 1.5) };
  const ik = new CharacterIK();
  for (let i = 0; i < 60; i++) ik.update(1 / 30, [npc]);
  const restQ = head.quaternion.clone();
  ik.beforeRender([npc], new THREE.Vector3());
  const h = head.getWorldPosition(new THREE.Vector3());
  const f = face.getWorldPosition(new THREE.Vector3()).sub(h).normalize();
  const want = npc.gazeWorld.clone().sub(h).normalize();
  const restDir = new THREE.Vector3(0, 0, 1);
  assert.ok(f.angleTo(want) < restDir.angleTo(want) - 0.3, 'face turned toward the target');
  assert.ok(f.y > 0.1, 'and looks up at it');
  ik.afterRender();
  assert.ok(head.quaternion.angleTo(restQ) < 1e-9);
});

test('soft sway patches hair once and swings it against head acceleration', () => {
  const head = new THREE.Bone();
  head.position.set(0, 1.6, 0);
  const hair = new THREE.MeshStandardMaterial({ name: 'Portrait 1 / hair strands' });
  const shirt = new THREE.MeshStandardMaterial({ name: 'Portrait 1 / woven shirt' });
  const geometry = new THREE.BoxGeometry(0.3, 1.8, 0.3);
  geometry.addGroup(0, 18, 0);
  geometry.addGroup(18, 18, 1);
  const skinned = new THREE.SkinnedMesh(geometry, [hair, shirt]);
  const root = new THREE.Group();
  root.add(skinned, head);
  new THREE.Scene().add(root);
  const avatar = { inner: root, root, bones: { Head: head } };
  const soft = new SoftSway();
  const entry = soft.install(avatar);
  assert.equal(soft.patched, 1);
  assert.equal(hair.userData.vibeSoft, 'hair');
  assert.equal(shirt.userData.vibeSoft, undefined);
  assert.equal(soft.install(avatar), entry, 'installs once');
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <skinning_vertex>' };
  hair.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('uSoftOffset') && shader.uniforms.uSoftOffset);
  assert.ok(hair.customProgramCacheKey().includes('vibe-soft-hair'));
  // walk forward then stop sharply: the hair swings forward past the head
  for (let i = 0; i < 30; i++) { root.position.z += 1.4 / 60; soft.update(1 / 60, [avatar], null, null); }
  let maxForward = 0;
  for (let i = 0; i < 30; i++) {
    soft.update(1 / 60, [avatar], null, null);
    maxForward = Math.max(maxForward, entry.regions[0].offset.z);
  }
  assert.ok(maxForward > 0.005 && maxForward <= 0.05, `hair swung ${maxForward}`);
});

test('walker anticipation sees a crossing collision ahead of time', () => {
  // two walkers on crossing paths meet in ~1.4 s
  const tau = timeToCollision(-1.4, -1.4, 1, 1, 0.6);
  assert.ok(tau > 0.8 && tau < 1.4);
});
