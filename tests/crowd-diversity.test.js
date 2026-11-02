import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CrowdSim } from '../src/npc.js';

// These lifecycle tests instantiate real actors without rasterizing their
// cosmetic canvas textures. Geometry, selection and disposal are unchanged.
const context = new Proxy({}, {
  get(_target, key) {
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
});
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };

function venue() {
  return {
    group: new THREE.Group(), theme: { crowd: 18, rain: false }, seats: [],
    nav: {
      baristaHome: new THREE.Vector3(), baristaRegister: new THREE.Vector3(1, 0, 0),
      baristaMachine: new THREE.Vector3(-1, 0, 0),
    },
    serviceAnchors: { waiterStandby: new THREE.Vector3(2, 0, 0) },
    blueprint: { decor: { stage: {
      anchors: { mic: { x: 3, z: 3 } }, height: 0.2,
      rect: { x0: 2, z1: 4 }, restSpot: { x: 2, z: 5 },
    } } },
  };
}

function library(keys) {
  return new Map(keys.map(key => [key, {
    character: true, hasSit: false, animations: [], template: new THREE.Group(),
  }]));
}

test('complete model failure starts with at most two fallback actors and disposes cleanly', () => {
  const crowd = new CrowdSim(venue(), null, new Map());
  assert.ok(crowd.barista);
  assert.ok(crowd.waiter);
  assert.equal(crowd.performer, null);
  assert.equal(crowd.outside.walkers.length, 0);
  assert.deepEqual(crowd.characterDiversityReport().counts, { procedural_person: 2 });
  assert.equal(crowd.characterDiversityReport().allocationsMatch, true);
  crowd.dispose();
  assert.deepEqual(crowd.characters.snapshot(), {});
});

test('one surviving patron model serves two roles without spawning fallback duplicates', () => {
  const crowd = new CrowdSim(venue(), null, library(['char_atelier_1']));
  assert.equal(crowd.barista.avatar.key, 'char_atelier_1');
  assert.equal(crowd.waiter.avatar.key, 'char_atelier_1');
  assert.equal(crowd.performer, null);
  assert.equal(crowd.outside.walkers.length, 0);
  assert.deepEqual(crowd.characterDiversityReport().counts, { char_atelier_1: 2 });
  assert.equal(crowd.characterDiversityReport().allocationsMatch, true);
  crowd.dispose();
  assert.deepEqual(crowd.characters.snapshot(), {});
});

test('the expanded library shares one budget across both staff, performer and street', () => {
  const keys = Array.from({ length: 18 }, (_, index) => `char_atelier_${index + 1}`);
  const crowd = new CrowdSim(venue(), null, library([...keys, 'char_atelier_barista', 'char_atelier_server']));
  const report = crowd.characterDiversityReport();
  assert.equal(crowd.barista.avatar.key, 'char_atelier_barista');
  assert.equal(crowd.waiter.avatar.key, 'char_atelier_server');
  assert.equal(crowd.outside.walkers.length, 8);
  assert.equal(report.actorCount, 11);
  assert.equal(report.uniqueAssets, 11);
  assert.equal(report.maxCopies, 1);
  assert.equal(report.allocationsMatch, true);
  crowd.dispose();
  assert.deepEqual(crowd.characters.snapshot(), {});
});
