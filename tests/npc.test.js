import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  attachHeldUmbrella,
  pedestrianUsesUmbrella,
  poseUmbrellaArm,
  UMBRELLA_GRIP_TARGET,
} from '../src/npc.js';

test('rain umbrellas attach to a real hand and reuse shared geometry', () => {
  const makeRig = () => {
    const person = new THREE.Group();
    const hand = new THREE.Group();
    person.userData.parts = { handR: hand };
    person.add(hand);
    return { person, hand };
  };
  const firstRig = makeRig();
  const secondRig = makeRig();
  const first = attachHeldUmbrella(firstRig.person, null, 0);
  const second = attachHeldUmbrella(secondRig.person, null, 1);

  assert.equal(first.root.parent, firstRig.hand);
  assert.equal(second.root.parent, secondRig.hand);
  assert.equal(first.root.userData.heldUmbrella, true);
  assert.equal(first.root.children[0].geometry, second.root.children[0].geometry);
  assert.equal(attachHeldUmbrella(new THREE.Group()), null);
});

test('rainy crowds always include umbrella users and non-users', () => {
  const choices = Array.from({ length: 8 }, (_, index) => pedestrianUsesUmbrella(index));
  assert.equal(choices.filter(Boolean).length, 6);
  assert.equal(choices.filter((choice) => !choice).length, 2);
});

test('an imported umbrella holder bends its arm to a chest-height grip', () => {
  const person = new THREE.Group();
  const upper = new THREE.Bone();
  const forearm = new THREE.Bone();
  const hand = new THREE.Bone();
  upper.position.set(-0.2, 1.35, 0);
  forearm.position.set(0, -0.3, 0);
  hand.position.set(0, -0.3, 0);
  upper.add(forearm); forearm.add(hand); person.add(upper);
  const avatar = { bones: { RightArm: upper, RightForeArm: forearm, RightHand: hand } };
  const held = attachHeldUmbrella(person, avatar, 0);

  assert.equal(poseUmbrellaArm(held, avatar, person), true);
  const actual = hand.getWorldPosition(new THREE.Vector3());
  const target = new THREE.Vector3(
    UMBRELLA_GRIP_TARGET.x,
    UMBRELLA_GRIP_TARGET.y,
    UMBRELLA_GRIP_TARGET.z,
  );
  assert.ok(actual.distanceTo(target) < 1e-5);
  assert.ok(actual.y > 1);
  assert.ok(actual.z > 0.2);
  assert.ok(held.gripError < 1e-5);
});
