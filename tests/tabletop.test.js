import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TABLE_CLUSTER_BUILDERS, TABLETOP_CLUSTERS, CLUSTER_NAMES, buildTableCluster, buildVase,
} from '../src/decor/tabletopFactory.js';
import { clearanceSlots, laptopCupOffset } from '../src/tableClearance.js';

function clusterContext(seed = 0) {
  const standard = new THREE.MeshStandardMaterial();
  return {
    table: { x: 1.5, z: -2 },
    topY: 0.81,
    seed,
    mats: {
      ceramicMat: standard, paperMat: standard, cushionMat: standard,
      metalMat: standard, woodDarkMat: standard, glassMat: standard,
    },
  };
}

test('every cluster builder returns placed objects with usable footprints', () => {
  for (const name of CLUSTER_NAMES) {
    const items = TABLE_CLUSTER_BUILDERS[name](clusterContext(2));
    assert.ok(items.length >= 1, `${name} places something`);
    for (const item of items) {
      assert.ok(item.object.isObject3D, `${name} object is an Object3D`);
      assert.ok(item.footprint >= 0.04 && item.footprint <= 0.2, `${name} footprint ${item.footprint}`);
      const distance = Math.hypot(item.object.position.x - 1.5, item.object.position.z - -2);
      assert.ok(distance < 0.45, `${name} stays on the tabletop (${distance.toFixed(2)} m off centre)`);
    }
  }
});

test('cluster items never spawn inside one another', () => {
  for (const name of CLUSTER_NAMES) {
    const items = TABLE_CLUSTER_BUILDERS[name](clusterContext(1));
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const d = Math.hypot(
          items[a].object.position.x - items[b].object.position.x,
          items[a].object.position.z - items[b].object.position.z,
        );
        assert.ok(
          d >= (items[a].footprint + items[b].footprint) * 0.6,
          `${name}: items ${a},${b} overlap (${d.toFixed(3)} m apart)`,
        );
      }
    }
  }
});

test('per-cafe rotations only reference real clusters and rotate deterministically', () => {
  for (const [themeId, rotation] of Object.entries(TABLETOP_CLUSTERS)) {
    assert.ok(rotation.length >= 3, `${themeId} has variety`);
    for (const name of rotation) assert.ok(TABLE_CLUSTER_BUILDERS[name], `${themeId} -> ${name}`);
  }
  const first = buildTableCluster('goldenhour', 0, clusterContext(0));
  const again = buildTableCluster('goldenhour', 0, clusterContext(0));
  assert.equal(first.name, again.name, 'same table, same cluster');
  assert.equal(buildTableCluster('nonsense', 1, clusterContext(1)).name,
    TABLETOP_CLUSTERS.goldenhour[1], 'unknown theme falls back');
});

test('the vase is a vessel, not a bare cylinder', () => {
  const vase = buildVase();
  const lathe = vase.children.find((c) => c.geometry?.type === 'LatheGeometry');
  assert.ok(lathe, 'lathe profile body');
  lathe.geometry.computeBoundingBox();
  const bb = lathe.geometry.boundingBox;
  assert.ok(bb.max.y >= 0.17, 'tall enough to read as a vase');
});

test('clearance slots respect footprints and never overlap or reach the cup', () => {
  for (const elevated of [false, true]) {
    const footprints = [0.12, 0.11, 0.08, 0.06, 0.05, 0.05];
    const slots = clearanceSlots(footprints, elevated);
    assert.equal(slots.length, footprints.length);
    const cup = laptopCupOffset(elevated);
    slots.forEach((slot, i) => {
      assert.ok(slot.side <= -0.28, `slot ${i} stays on the far edge`);
      const cupDistance = Math.hypot(slot.side - cup.side, slot.forward - cup.forward);
      assert.ok(cupDistance >= footprints[i] + 0.06, `slot ${i} clear of the player's drink`);
      for (let j = i + 1; j < slots.length; j++) {
        const d = Math.hypot(slot.side - slots[j].side, slot.forward - slots[j].forward);
        assert.ok(d >= (footprints[i] + footprints[j]) * 0.8,
          `slots ${i},${j} at ${d.toFixed(3)} m for footprints ${footprints[i]}/${footprints[j]}`);
      }
    });
  }
});
