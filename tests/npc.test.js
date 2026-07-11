import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachHeldUmbrella } from '../src/npc.js';

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
