import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { placeVenueCollection, auditVenueCollections } from '../src/decor/venueCollection.js';
import { getBlueprint } from '../src/cafe/interiorLayouts.js';
import { validateBlueprint } from '../src/cafe/layoutValidation.js';
import { shapeBounds, shapesOverlap, tableSupportShape } from '../src/cafe/tableSupport.js';

function template(width = 1.75, bottom = 0) {
  const root = new Group();
  const body = new Mesh(new BoxGeometry(width, .65, .35), new MeshStandardMaterial());
  body.position.y = bottom + .325; root.add(body);
  return root;
}

test('the Midnight collection scales onto its rotated cabinet without changing the shared asset', () => {
  const source = template(), group = new Group(), cabinet = new Group();
  cabinet.position.set(8.18, 0, 5.65); cabinet.rotation.y = -Math.PI / 2; group.add(cabinet);
  const models = new Map([['atelier_decor_midnight', { template: source }]]);
  const object = placeVenueCollection({ group, parent: cabinet, models, id: 'midnight', scale: .8,
    surface: { y: .75, width: 1.5, depth: .5 } });
  const record = group.userData.venueCollections[0];
  assert.ok(object && record.bounds.min.y > .749 && record.bounds.min.y < .751);
  assert.ok(Math.abs(record.bounds.min.x - (8.18 - .14)) < 1e-6);
  assert.ok(Math.abs(record.bounds.max.z - (5.65 + .7)) < 1e-6);
  assert.deepEqual(auditVenueCollections(group), []);
  assert.equal(source.scale.x, 1); assert.equal(source.position.y, 0);
  assert.equal(object.children[0].geometry, source.children[0].geometry, 'library geometry remains shared');
});

test('support auditing retains real overhang and floating errors after static batching removes source meshes', () => {
  const group = new Group(), cabinet = new Group(); group.add(cabinet);
  const models = new Map([['atelier_decor_goldenhour', { template: template(2.5, .15) }]]);
  const object = placeVenueCollection({ group, parent: cabinet, models, id: 'goldenhour',
    surface: { y: .8175, width: 2.15, depth: .54 } });
  object.clear(); // simulate source meshes being consumed by material batching
  const violations = auditVenueCollections(group);
  assert.ok(violations.some(v => v.kind === 'collection-off-surface'));
  assert.ok(violations.some(v => v.kind === 'collection-overhang'));
});

test('missing collections leave the existing procedural station available as fallback', () => {
  const group = new Group(), cabinet = new Group(); group.add(cabinet);
  const result = placeVenueCollection({ group, parent: cabinet, models: new Map(), id: 'terrace',
    surface: { y: .87, width: 2.25, depth: .62 } });
  assert.equal(result, null);
  assert.equal(cabinet.children.length, 0);
  assert.deepEqual(auditVenueCollections(group), []);
});

test('Midnight record cabinet clears fixed furniture and seated guests while every destination stays reachable', () => {
  const blueprint = getBlueprint('midnight');
  const cabinet = blueprint.decor.recordCabinet;
  const footprint = { kind: 'rect', center: { x: cabinet.x, z: cabinet.z },
    rotation: cabinet.rotation, width: cabinet.width, depth: cabinet.depth };
  const bounds = shapeBounds(footprint);
  const rectShape = (rect) => ({ kind: 'rect',
    center: { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 },
    width: rect.x1 - rect.x0, depth: rect.z1 - rect.z0 });
  const booth = blueprint.colliders.find(c => c.id === 'mi-booth-bench-col').rect;
  // Includes the bookcase's projecting .05 m side panels, not just its nominal 3 m span.
  const bookcase = { x0: 7.99, x1: 8.31, z0: 1.675, z1: 4.725 };
  for (const [name, obstacle] of [['booth', rectShape(booth)], ['bookcase', rectShape(bookcase)],
    ...blueprint.tables.map(table => [table.id, tableSupportShape(table)])]) {
    assert.equal(shapesOverlap(footprint, obstacle), false, `record cabinet overlaps ${name}`);
  }
  for (const seat of blueprint.seats) {
    assert.equal(shapesOverlap(footprint, { kind: 'circle', center: { x: seat.x, z: seat.z }, radius: .4 }),
      false, `record cabinet enters guest/chair envelope at ${seat.id}`);
  }
  assert.ok(bounds.z0 - bookcase.z1 >= .15, 'leave a visible gap beyond the bookcase');
  assert.ok(bounds.x1 <= 8.45 && bounds.z1 <= 6.7, 'cabinet stays inside the walls');
  const collider = blueprint.colliders.find(c => c.id === 'mi-record-cabinet-col');
  assert.ok(collider.rect.x0 < bounds.x0 && collider.rect.x1 > bounds.x1
    && collider.rect.z0 < bounds.z0 && collider.rect.z1 > bounds.z1, 'navigation protects the whole cabinet');

  // The displaced front-right pothos now occupies the spare left-wall bay.
  // These extents include the full normalized leaves at the allowed 1.08 scale.
  const [plantX, plantZ] = blueprint.decor.plantSpots[1];
  const plant = { kind: 'rect', center: { x: plantX, z: plantZ }, width: .734, depth: .671 };
  assert.equal(shapesOverlap(footprint, plant), false);
  for (const table of blueprint.tables) {
    assert.equal(shapesOverlap(plant, tableSupportShape(table)), false, `relocated plant overlaps ${table.id}`);
  }
  for (const seat of blueprint.seats) {
    assert.equal(shapesOverlap(plant, { kind: 'circle', center: { x: seat.x, z: seat.z }, radius: .4 }),
      false, `relocated plant enters guest/chair envelope at ${seat.id}`);
  }
  const plantCollider = blueprint.colliders.find(c => c.id === 'mi-record-plant-col');
  assert.equal(plantCollider.x, plantX); assert.equal(plantCollider.z, plantZ);
  assert.deepEqual(validateBlueprint(blueprint).errors, [], 'all seats, service points and performer routes remain reachable');
});
