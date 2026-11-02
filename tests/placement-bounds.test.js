import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import {
  capturePlacementBounds, groundingAuditObjects, recordBatchedPlacement,
} from '../src/rendering/placementBounds.js';

function cube(y, height = 1) {
  const mesh = new Mesh(new BoxGeometry(0.4, height, 0.4), new MeshStandardMaterial());
  mesh.position.y = y;
  return mesh;
}

function capture(group, animated = []) {
  group.userData.placedUnits = capturePlacementBounds(group, animated);
  return new Map(group.userData.placedUnits.map(unit => [unit.uuid, unit]));
}

function removeToBatch(group, parts, placements) {
  for (const part of parts) {
    recordBatchedPlacement(group, part, placements);
    part.removeFromParent();
  }
  const batch = cube(2);
  batch.userData.decorBatch = true;
  group.add(batch);
}

function bounds(object) {
  if (object.bounds) return object.bounds;
  object.updateWorldMatrix(true, true);
  return new Box3().setFromObject(object);
}

test('a grounded compound retains its legs when materials become separate batches', () => {
  const world = new Group();
  const chair = new Group();
  const legs = cube(0.5);
  const back = cube(1.5);
  chair.add(legs, back);
  world.add(chair);
  const placements = capture(world);
  // Ordinary uncompressed geometry must retain the same assembly semantics
  // as imported library geometry; no normalized-attribute marker is required.
  removeToBatch(world, [back, legs], placements);
  const objects = groundingAuditObjects(world);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].uuid, chair.uuid);
  assert.equal(bounds(objects[0]).min.y, 0);
  assert.equal(bounds(objects[0]).max.y, 2);
});

test('batching a real floating original with grounded geometry does not hide it', () => {
  const world = new Group();
  const grounded = cube(0.5);
  const floating = cube(2.5);
  world.add(grounded, floating);
  const placements = capture(world);
  removeToBatch(world, [grounded, floating], placements);
  const objects = groundingAuditObjects(world);
  assert.equal(objects.length, 2, 'each original is audited, not the combined batch bounds');
  assert.equal(bounds(objects.find(object => object.uuid === grounded.uuid)).min.y, 0);
  assert.equal(bounds(objects.find(object => object.uuid === floating.uuid)).min.y, 2);
});

test('animated roots use their current bounds after moving from their initial pose', () => {
  const world = new Group();
  const actor = cube(0.5);
  world.add(actor);
  capture(world, [actor]);
  actor.position.y = 2.5;
  const objects = groundingAuditObjects(world);
  assert.equal(objects[0], actor);
  assert.equal(bounds(objects[0]).min.y, 2);
});

test('a partially batched assembly combines fixed support with live animated descendants', () => {
  const world = new Group();
  const assembly = new Group();
  const base = cube(0.5);
  const moving = cube(1.5);
  assembly.add(base, moving);
  world.add(assembly);
  const placements = capture(world, [moving]);
  removeToBatch(world, [base], placements);
  moving.position.y = -0.5;
  const [object] = groundingAuditObjects(world);
  assert.equal(bounds(object).min.y, -1, 'a newly sunken animated part remains detectable');
  assert.equal(bounds(object).max.y, 1, 'the old animated position is absent from the snapshot');
});

test('unmerged movable props and props added after batching remain live audit objects', () => {
  const world = new Group();
  const prop = cube(0.5);
  world.add(prop);
  capture(world);
  prop.position.y = 3;
  const added = cube(4);
  world.add(added);
  const objects = groundingAuditObjects(world);
  assert.ok(objects.includes(prop));
  assert.ok(objects.includes(added));
  assert.equal(bounds(prop).min.y, 2.5);
  assert.equal(bounds(added).min.y, 3.5);
});

test('only the explicitly supplied interaction overlay is excluded', () => {
  const world = new Group();
  const physicalProp = cube(3);
  world.add(physicalProp);
  capture(world);
  const ring = cube(0.72, 0.05);
  world.add(ring);
  const objects = groundingAuditObjects(world, [ring]);
  assert.deepEqual(objects, [physicalProp]);
  assert.equal(bounds(objects[0]).min.y, 2.5, 'a real floating prop is still checked');
});
