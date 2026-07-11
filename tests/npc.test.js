import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  attachHeldUmbrella,
  pedestrianUsesUmbrella,
  stabilizeUmbrellaArm,
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

test('an imported umbrella holder keeps the holding arm pose fixed', () => {
  const person = new THREE.Group();
  const upper = new THREE.Bone();
  const forearm = new THREE.Bone();
  const hand = new THREE.Bone();
  upper.add(forearm); forearm.add(hand); person.add(upper);
  const avatar = { bones: { RightArm: upper, RightForeArm: forearm, RightHand: hand } };
  const held = attachHeldUmbrella(person, avatar, 0);

  upper.rotation.set(0.2, -0.1, 0.3);
  forearm.rotation.set(-0.4, 0.2, 0.1);
  hand.rotation.set(0.1, 0.1, -0.2);
  stabilizeUmbrellaArm(held, avatar);
  const captured = [upper, forearm, hand].map((bone) => bone.quaternion.clone());

  upper.rotation.set(1, 1, 1);
  forearm.rotation.set(1, 1, 1);
  hand.rotation.set(1, 1, 1);
  stabilizeUmbrellaArm(held, avatar);
  [upper, forearm, hand].forEach((bone, index) => {
    assert.ok(bone.quaternion.angleTo(captured[index]) < 1e-6);
  });
});
