import test from 'node:test';
import assert from 'node:assert/strict';
import { venueBlueprints, getBlueprint, ROOM_SHELL } from '../src/cafe/interiorLayouts.js';
import { validateBlueprint, validateBlueprints, layoutFingerprint } from '../src/cafe/layoutValidation.js';
import { THEMES, ROOM } from '../src/cafe.js';

function mutable(blueprintId) {
  return structuredClone(getBlueprint(blueprintId));
}

function errorsOf(blueprint) {
  return validateBlueprint(blueprint).errors;
}

test('all four venue blueprints validate with zero errors', () => {
  const { results, crossErrors, ok } = validateBlueprints(venueBlueprints());
  for (const result of results) {
    assert.deepEqual(result.errors, [], `${result.id} should have no layout errors`);
  }
  assert.deepEqual(crossErrors, []);
  assert.ok(ok);
});

test('venues are architecturally distinct (styles and table plans)', () => {
  const blueprints = venueBlueprints();
  const styles = new Set(blueprints.map((b) => b.style));
  assert.equal(styles.size, blueprints.length);
  const fingerprints = new Set(blueprints.map(layoutFingerprint));
  assert.equal(fingerprints.size, blueprints.length);
});

test('blueprints are frozen', () => {
  const blueprint = getBlueprint('goldenhour');
  assert.ok(Object.isFrozen(blueprint));
  assert.ok(Object.isFrozen(blueprint.tables[0]));
  assert.ok(Object.isFrozen(blueprint.tables[0].center));
  assert.throws(() => { blueprint.tables[0].center.x = 99; });
});

test('every seat has explicit identity: id, tableId, levelId, isBar', () => {
  for (const blueprint of venueBlueprints()) {
    for (const seat of blueprint.seats) {
      assert.ok(seat.id, `${blueprint.id}: seat missing id`);
      assert.ok(seat.tableId, `${blueprint.id}: seat ${seat.id} missing tableId`);
      assert.ok(seat.levelId, `${blueprint.id}: seat ${seat.id} missing levelId`);
      assert.equal(typeof seat.isBar, 'boolean', `${blueprint.id}: seat ${seat.id} missing isBar`);
    }
  }
});

// ---------------------------------------------------------------------------
// Phase 0 preservation contract: blueprints describe the CURRENT rendered
// interiors one-to-one. These pin the blueprint data to the legacy THEMES
// tables until the venue rebuild phases intentionally diverge them.

test('blueprint dining tables mirror the legacy THEMES table lists exactly', () => {
  for (const theme of THEMES) {
    const blueprint = getBlueprint(theme.id);
    const dining = blueprint.tables.filter((t) => !t.isBar);
    assert.equal(dining.length, theme.tables.length, `${theme.id}: table count`);
    theme.tables.forEach((legacy, index) => {
      const table = dining[index];
      assert.equal(table.center.x, legacy.x, `${theme.id} table ${index}: x`);
      assert.equal(table.center.z, legacy.z, `${theme.id} table ${index}: z`);
      assert.equal(table.legacyType, legacy.type, `${theme.id} table ${index}: type`);
      assert.equal(!!table.lounge, !!legacy.lounge, `${theme.id} table ${index}: lounge`);
    });
    const bars = blueprint.tables.filter((t) => t.isBar);
    assert.equal(bars.length, theme.windowBar ? 2 : 0, `${theme.id}: window bars`);
  }
});

test('blueprint room shell matches the legacy ROOM export', () => {
  assert.equal(ROOM, ROOM_SHELL);
  assert.deepEqual({ ...ROOM_SHELL }, { W: 17, D: 13.5, H: 3.8 });
});

test('window-bar geometry matches the legacy builder constants', () => {
  const blueprint = getBlueprint('goldenhour');
  const bars = blueprint.tables.filter((t) => t.isBar);
  const expectedLen = (ROOM_SHELL.W - 1.1) / 2 - 1.3;
  for (const bar of bars) {
    assert.ok(Math.abs(bar.width - expectedLen) < 1e-9);
    assert.equal(bar.seats.length, Math.floor(expectedLen / 1.1));
    assert.equal(bar.surfaceY, 1.035);
    for (const seat of bar.seats) {
      assert.equal(seat.isBar, true);
      assert.equal(seat.pos.y, 0.15);
      assert.ok(Math.abs(seat.pos.z - (ROOM_SHELL.D / 2 - 1.05)) < 1e-9);
    }
  }
});

// ---------------------------------------------------------------------------
// Failure detection: the validator must actually catch broken layouts.

test('overlapping tables are rejected', () => {
  const broken = mutable('goldenhour');
  broken.tables[1].center = { ...broken.tables[0].center };
  const errors = errorsOf(broken);
  assert.ok(errors.some((e) => e.includes('tables overlap')), errors.join('\n'));
});

test('a seat referencing a missing table is rejected', () => {
  const broken = mutable('midnight');
  broken.seats[0].tableId = 'mi-t99';
  assert.ok(errorsOf(broken).some((e) => e.includes('unknown tableId')));
});

test('a table outside every room is rejected', () => {
  const broken = mutable('terrace');
  broken.tables[0].center = { x: 40, z: 0 };
  // keep its seats near the moved table so only the bounds rule fires clearly
  const errors = errorsOf(broken);
  assert.ok(errors.some((e) => e.includes('outside every room')));
});

test('a patron destination inside a staff-only zone is rejected', () => {
  const broken = mutable('roastery');
  broken.npcDestinations.push({
    id: 'ro-bad-dest', levelId: 'ground', x: 0, z: -6.4, role: 'patron', purpose: 'order',
  });
  assert.ok(errorsOf(broken).some((e) => e.includes('forbidden zone')));
});

test('a barista destination behind the counter is allowed', () => {
  const blueprint = getBlueprint('roastery');
  const staff = blueprint.npcDestinations.filter((d) => d.role === 'barista');
  assert.ok(staff.length >= 3);
  assert.deepEqual(errorsOf(mutable('roastery')), []);
});

test('an unreachable walk surface is rejected', () => {
  const broken = mutable('goldenhour');
  broken.walkSurfaces.push({
    id: 'gh-floating-balcony', levelId: 'ground', y: 3,
    polygon: [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }],
  });
  assert.ok(errorsOf(broken).some((e) => e.includes('unreachable')));
});

test('a guard collider without explicit height range is rejected', () => {
  const broken = mutable('terrace');
  broken.colliders.push({
    id: 'te-bad-guard', levelId: 'ground', guard: true,
    rect: { x0: 0, x1: 1, z0: 0, z1: 0.1 },
  });
  assert.ok(errorsOf(broken).some((e) => e.includes('minY/maxY')));
});

test('duplicate ids are rejected', () => {
  const broken = mutable('midnight');
  broken.tables[1] = { ...broken.tables[1], id: broken.tables[0].id };
  assert.ok(errorsOf(broken).some((e) => e.includes('duplicate id')));
});

test('a seat missing explicit isBar is rejected', () => {
  const broken = mutable('goldenhour');
  delete broken.seats[0].isBar;
  assert.ok(errorsOf(broken).some((e) => e.includes('isBar')));
});

test('a non-monotonic stair path is rejected', () => {
  const broken = mutable('terrace');
  broken.walkSurfaces.push({
    id: 'te-deck', levelId: 'ground', y: 3.25,
    polygon: [{ x: 2, z: 2 }, { x: 5, z: 2 }, { x: 5, z: 5 }, { x: 2, z: 5 }],
  });
  broken.verticalLinks.push({
    id: 'te-bad-stair', kind: 'stair',
    a: { surfaceId: 'te-ground-floor', portal: { x: 3, z: 0, r: 0.5 } },
    b: { surfaceId: 'te-deck', portal: { x: 3, z: 2.5, r: 0.5 } },
    path: [{ x: 3, y: 0, z: 0 }, { x: 3, y: 2.0, z: 1 }, { x: 3, y: 1.2, z: 1.8 }, { x: 3, y: 3.25, z: 2.5 }],
  });
  assert.ok(errorsOf(broken).some((e) => e.includes('not monotonic')));
});

test('two venues sharing an identical table plan are rejected cross-venue', () => {
  const a = mutable('goldenhour');
  const b = mutable('roastery');
  b.tables = structuredClone(a.tables);
  b.seats = structuredClone(a.seats);
  const { crossErrors } = validateBlueprints([a, b]);
  assert.ok(crossErrors.some((e) => e.includes('identical table plan')));
});
