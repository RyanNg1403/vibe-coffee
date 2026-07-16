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
    // venues whose rebuild phase has landed drop the legacy table array —
    // the blueprint alone is authoritative for them
    if (!theme.tables) continue;
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

test('Midnight window ledges carry the lounge identity, not the shared bar', () => {
  // audit S14: each venue's window zone needs its own fingerprint — Midnight
  // runs two short walnut listening ledges with three stools each
  const blueprint = getBlueprint('midnight');
  const bars = blueprint.tables.filter((t) => t.isBar);
  assert.equal(bars.length, 2);
  for (const bar of bars) {
    assert.ok(Math.abs(bar.width - 3.4) < 1e-9);
    assert.equal(bar.barStyle, 'lounge');
    assert.equal(bar.seats.length, 3);
    assert.equal(bar.surfaceY, 1.035);
    for (const seat of bar.seats) {
      assert.equal(seat.isBar, true);
      assert.equal(seat.pos.y, 0.15);
      assert.ok(Math.abs(seat.pos.z - (ROOM_SHELL.D / 2 - 1.05)) < 1e-9);
    }
  }
});

// ---------------------------------------------------------------------------
// Golden Hour protected-layout contract (plan §5, Phase 1).

test('Golden Hour keeps two short window counters flanking the door', () => {
  const blueprint = getBlueprint('goldenhour');
  const bars = blueprint.tables.filter((t) => t.isBar);
  assert.equal(bars.length, 2);
  const sides = bars.map((b) => Math.sign(b.center.x)).sort();
  assert.deepEqual(sides, [-1, 1]);
  for (const bar of bars) {
    assert.ok(bar.width >= 1.8 && bar.width <= 2.2, `counter length ${bar.width}`);
    assert.ok(bar.depth >= 0.42 && bar.depth <= 0.48, `counter depth ${bar.depth}`);
    assert.equal(bar.seats.length, 2);
    assert.ok(bar.footRail, 'counters carry a foot rail');
    // clear of the door opening
    assert.ok(Math.abs(bar.center.x) - bar.width / 2 >= 0.55 + 0.2);
  }
});

test('Golden Hour salon has an oval group table and a writing table', () => {
  const blueprint = getBlueprint('goldenhour');
  const archetypes = blueprint.tables.map((t) => t.archetype);
  assert.equal(archetypes.filter((a) => a === 'oval').length, 1);
  assert.equal(archetypes.filter((a) => a === 'writing').length, 1);
  assert.ok(blueprint.tables.some((t) => (t.rotation ?? 0) !== 0),
    'some tables carry authored rotations');
  const oval = blueprint.tables.find((t) => t.archetype === 'oval');
  assert.equal(oval.seats.length, 6);
});

test('Golden Hour contract violations are caught by the validator', () => {
  // a table parked in the arrival lane must fail
  const laneBlocked = mutable('goldenhour');
  laneBlocked.tables.find((t) => !t.isBar).center = { x: 0, z: 2.0 };
  assert.ok(errorsOf(laneBlocked).some((e) => e.includes('arrival lane')));
  // a wall item moved into the library bay must fail
  const badBay = mutable('goldenhour');
  badBay.decor.rightWall.mirror.z = 0.0;
  assert.ok(errorsOf(badBay).some((e) => e.includes('library bay')));
  // shrinking a counter below contract length must fail
  const shortCounter = mutable('goldenhour');
  const bar = shortCounter.tables.find((t) => t.isBar);
  bar.width = 1.2;
  assert.ok(errorsOf(shortCounter).some((e) => e.includes('length')));
});

// ---------------------------------------------------------------------------
// Roastery process-hall contract (plan §6, Phase 2).

test('Roastery is organized around communal worktables with a sealed production zone', () => {
  const blueprint = getBlueprint('roastery');
  const communal = blueprint.tables.filter((t) => t.archetype === 'communal');
  assert.ok(communal.length >= 1 && communal.length <= 2);
  assert.equal(communal[0].seats.length, 8);
  const production = blueprint.npcForbiddenZones.find((z) => z.id === 'ro-production-zone');
  assert.ok(production, 'production zone is patron-forbidden');
  assert.deepEqual([...production.exceptRoles].sort(), ['barista', 'roaster', 'waiter']);
  // no seat or patron destination inside the production rect
  const rect = production.rect;
  for (const seat of blueprint.seats) {
    const inside = seat.pos.x >= rect.x0 && seat.pos.x <= rect.x1
      && seat.pos.z >= rect.z0 && seat.pos.z <= rect.z1;
    assert.ok(!inside, `seat ${seat.id} sits inside the production zone`);
  }
  assert.deepEqual(errorsOf(mutable('roastery')), []);
});

test('Roastery has a tasting rail and a modern window rail distinct from Golden Hour', () => {
  const blueprint = getBlueprint('roastery');
  const rail = blueprint.tables.find((t) => t.archetype === 'rail');
  assert.ok(rail, 'cupping rail exists');
  assert.equal(rail.seats.length, 3);
  assert.ok(rail.seats.every((s) => s.isBar === true));
  const bars = blueprint.tables.filter((t) => t.archetype === 'bar');
  assert.ok(bars.every((b) => b.barStyle === 'modern'));
  const golden = getBlueprint('goldenhour').tables.filter((t) => t.archetype === 'bar');
  assert.ok(golden.every((b) => b.barStyle !== 'modern'));
  assert.notEqual(bars[0].width, golden[0].width);
});

test('Roastery contract violations are caught by the validator', () => {
  const unsealed = mutable('roastery');
  unsealed.npcForbiddenZones = unsealed.npcForbiddenZones.filter((z) => z.id !== 'ro-production-zone');
  assert.ok(errorsOf(unsealed).some((e) => e.includes('production zone')));
  const gridded = mutable('roastery');
  gridded.tables = gridded.tables.filter((t) => t.archetype !== 'communal');
  gridded.seats = gridded.seats.filter((s) => !s.tableId.includes('-t0'));
  assert.ok(errorsOf(gridded).some((e) => e.includes('communal')));
  const classic = mutable('roastery');
  classic.tables.find((t) => t.archetype === 'bar').barStyle = 'classic';
  assert.ok(errorsOf(classic).some((e) => e.includes('modern')));
});

// ---------------------------------------------------------------------------
// Midnight performance-lounge contract (plan §7, Phase 3).

test('Midnight has a low corner stage with three anchors, sealed off from patrons', () => {
  const blueprint = getBlueprint('midnight');
  const stage = blueprint.decor.stage;
  assert.ok(stage);
  assert.ok(stage.height >= 0.16 && stage.height <= 0.22);
  const w = stage.rect.x1 - stage.rect.x0;
  const d = stage.rect.z1 - stage.rect.z0;
  assert.ok(w >= 3.0 && w <= 3.7, `stage width ${w}`);
  assert.ok(d >= 2.2 && d <= 2.6, `stage depth ${d}`);
  for (const name of ['piano', 'mic', 'bass']) assert.ok(stage.anchors[name], name);
  const zone = blueprint.npcForbiddenZones.find((z) => z.id === 'mi-stage-zone');
  assert.ok(zone && zone.appliesTo === 'patron');
  assert.deepEqual([...zone.exceptRoles], ['performer']);
  assert.ok(blueprint.colliders.some((c) => c.id === 'mi-stage-col'));
  assert.deepEqual(errorsOf(mutable('midnight')), []);
});

test('Midnight cabaret arcs and booth run satisfy the plan', () => {
  const blueprint = getBlueprint('midnight');
  const cabarets = blueprint.tables.filter((t) => t.archetype === 'cabaret');
  assert.ok(cabarets.length >= 4);
  for (const table of cabarets) assert.equal(table.seats.length, 2);
  const booths = blueprint.tables.filter((t) => t.archetype === 'booth');
  assert.ok(booths.reduce((n, t) => n + t.seats.length, 0) >= 4);
  assert.ok(blueprint.decor.boothRun);
  // performer destinations exist for the stage and the rest spot
  const roles = blueprint.npcDestinations.filter((dst) => dst.role === 'performer');
  assert.equal(roles.length, 2);
});

test('Midnight stage contract violations are caught by the validator', () => {
  const tall = mutable('midnight');
  tall.decor.stage.height = 0.4;
  assert.ok(errorsOf(tall).some((e) => e.includes('stage height')));
  const offPlatform = mutable('midnight');
  offPlatform.decor.stage.anchors.bass = { x: 0, z: 0 };
  assert.ok(errorsOf(offPlatform).some((e) => e.includes('off the platform')));
  const tooClose = mutable('midnight');
  tooClose.tables.find((t) => t.archetype === 'cabaret').center = { x: 5.6, z: -3.4 };
  assert.ok(errorsOf(tooClose).some((e) => e.includes('nearest cabaret')));
  const open = mutable('midnight');
  open.npcForbiddenZones = open.npcForbiddenZones.filter((z) => z.id !== 'mi-stage-zone');
  assert.ok(errorsOf(open).some((e) => e.includes('forbidden zone')));
  const onStage = mutable('midnight');
  onStage.tables.find((t) => t.archetype === 'cabaret').center = { x: 6.5, z: -5.0 };
  assert.ok(errorsOf(onStage).some((e) => e.includes('on the stage platform')));
});

// ---------------------------------------------------------------------------
// Garden Terrace two-level contract (plan §8, Phase 4).

test('Terrace has two usable floors with a contractual switchback stair', () => {
  const blueprint = getBlueprint('terrace');
  assert.equal(blueprint.levels.length, 3); // ground, stairs, upper
  const stair = blueprint.decor.deck.stair;
  assert.ok(Math.abs((stair.envelope.x1 - stair.envelope.x0) - 2.25) < 0.01);
  assert.ok(Math.abs((stair.envelope.z1 - stair.envelope.z0) - 4.0) < 0.01);
  assert.ok(stair.riserHeight >= 0.155 && stair.riserHeight <= 0.17);
  assert.equal(stair.risers, 20);
  assert.ok(stair.landing.z1 - stair.landing.z0 >= 1.1);
  // upper program is a real destination: seats + rail + study desk
  const upperSeats = blueprint.seats.filter((s) => s.levelId === 'upper');
  assert.ok(upperSeats.length >= 8, `upper seats ${upperSeats.length}`);
  assert.ok(blueprint.tables.some((t) => t.levelId === 'upper' && t.archetype === 'rail'));
  assert.ok(blueprint.tables.some((t) => t.levelId === 'upper' && t.archetype === 'writing'));
  assert.deepEqual(errorsOf(mutable('terrace')), []);
});

test('Terrace guards carry level + vertical range and seal the deck edge', () => {
  const blueprint = getBlueprint('terrace');
  const guards = blueprint.colliders.filter((c) => c.guard && c.levelId === 'upper');
  assert.ok(guards.length >= 5);
  for (const guard of guards) {
    assert.equal(typeof guard.minY, 'number');
    assert.equal(typeof guard.maxY, 'number');
    assert.ok(guard.maxY > guard.minY);
  }
  // removing a guard segment must fail the deck-edge contract
  const unguarded = mutable('terrace');
  unguarded.colliders = unguarded.colliders.filter((c) => c.id !== 'te-guard-east-n');
  assert.ok(errorsOf(unguarded).some((e) => e.includes('unguarded')));
  // an unreachable deck must fail
  const cut = mutable('terrace');
  cut.verticalLinks = cut.verticalLinks.filter((l) => l.id !== 'te-stair-top');
  assert.ok(errorsOf(cut).some((e) => e.includes('unreachable')));
  // too few upper seats must fail
  const empty = mutable('terrace');
  empty.tables = empty.tables.filter((t) => t.levelId !== 'upper');
  empty.seats = empty.seats.filter((s) => s.levelId !== 'upper');
  assert.ok(errorsOf(empty).some((e) => e.includes('upper seats')));
});

test('Golden Hour browse destination exists and is reachable', () => {
  const blueprint = getBlueprint('goldenhour');
  const browse = blueprint.npcDestinations.find((d) => d.purpose === 'browse');
  assert.ok(browse);
  assert.equal(browse.role, 'patron');
  assert.deepEqual(errorsOf(mutable('goldenhour')), []);
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
