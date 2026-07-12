import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon, createNavigator, createLevelTracker, surfaceHeightAt } from '../src/cafe/levelNavigation.js';

const SQUARE = [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }];

// A synthetic two-level fixture in the shape of the Garden Terrace plan:
// ground floor, upper deck, one stair link between them, plus an island
// surface no link reaches.
const TWO_LEVEL = {
  walkSurfaces: [
    { id: 'ground', levelId: 'g', y: 0, polygon: SQUARE.map((p) => ({ x: p.x * 5, z: p.z * 5 })) },
    { id: 'deck', levelId: 'up', y: 3.25, polygon: [{ x: 2, z: 2 }, { x: 5, z: 2 }, { x: 5, z: 5 }, { x: 2, z: 5 }] },
    { id: 'island', levelId: 'up', y: 3.25, polygon: [{ x: -5, z: -5 }, { x: -4, z: -5 }, { x: -4, z: -4 }, { x: -5, z: -4 }] },
  ],
  verticalLinks: [{
    id: 'stair',
    kind: 'stair',
    a: { surfaceId: 'ground', portal: { x: 3, z: 0, r: 0.6 } },
    b: { surfaceId: 'deck', portal: { x: 3, z: 2.4, r: 0.6 } },
    path: [{ x: 3, y: 0, z: 0 }, { x: 3, y: 1.625, z: 1.2 }, { x: 3, y: 3.25, z: 2.4 }],
  }],
};

test('pointInPolygon basic containment', () => {
  assert.ok(pointInPolygon(SQUARE, 0, 0));
  assert.ok(pointInPolygon(SQUARE, 0.99, -0.99));
  assert.ok(!pointInPolygon(SQUARE, 1.01, 0));
});

test('resolveHeight returns the surface height on-level and null off-surface', () => {
  const navigator = createNavigator(TWO_LEVEL);
  assert.equal(navigator.resolveHeight('g', 0, 0), 0);
  assert.equal(navigator.resolveHeight('up', 3, 3), 3.25);
  // stepping outside every upper polygon NEVER falls back to ground height
  assert.equal(navigator.resolveHeight('up', 0, 0), null);
  assert.equal(navigator.resolveHeight('g', 40, 0), null);
});

test('portals are the only level transitions and are level-scoped', () => {
  const navigator = createNavigator(TWO_LEVEL);
  const fromGround = navigator.portalAt('g', 3.1, 0.2);
  assert.ok(fromGround);
  assert.equal(fromGround.toLevelId, 'up');
  const fromDeck = navigator.portalAt('up', 3, 2.3);
  assert.ok(fromDeck);
  assert.equal(fromDeck.toLevelId, 'g');
  // the ground portal disc means nothing while standing upstairs
  assert.equal(navigator.portalAt('up', 3, 0), null);
  assert.equal(navigator.portalAt('g', 0, 0), null);
});

test('reachability crosses stair links but not to island surfaces', () => {
  const navigator = createNavigator(TWO_LEVEL);
  const reached = navigator.reachableSurfaceIds('ground');
  assert.ok(reached.has('deck'));
  assert.ok(!reached.has('island'));
});

test('level tracker keeps floor identity until a portal is crossed', () => {
  const navigator = createNavigator(TWO_LEVEL);
  const tracker = createLevelTracker(navigator, 'ground');
  assert.equal(tracker.levelId, 'g');
  // a position under the deck stays on the ground level — height comes from
  // the tracked level, never from what is vertically above or below
  assert.equal(tracker.heightAt(3, 3), 0);
  // off every ground surface: null, the caller must reject the move
  assert.equal(tracker.heightAt(40, 40), null);
  const portal = navigator.portalAt(tracker.levelId, 3, 0);
  assert.ok(tracker.crossPortal(portal));
  assert.equal(tracker.levelId, 'up');
  assert.equal(tracker.heightAt(3, 3), 3.25);
  assert.equal(tracker.heightAt(0, 0), null);
});

test('stair path heights are monotonic in the fixture', () => {
  const ys = TWO_LEVEL.verticalLinks[0].path.map((p) => p.y);
  for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] >= ys[i - 1]);
});

// ---------------------------------------------------------------------------
// Garden Terrace stair resolution (plan §8, Phase 4) — against the REAL
// blueprint, not a fixture: the same spec drives rendering and traversal.

test('terrace stair flights resolve monotonic heights along the climb', async () => {
  const { getBlueprint } = await import('../src/cafe/interiorLayouts.js');
  const blueprint = getBlueprint('terrace');
  const navigator = createNavigator(blueprint);
  // flight A ascends northward from the courtyard to the landing
  let last = -1;
  for (let z = -1.95; z <= 0.8; z += 0.15) {
    const h = navigator.resolveHeight('stairs', -2.82, z);
    assert.ok(h != null, `flight A has height at z=${z.toFixed(2)}`);
    assert.ok(h >= last, 'ascending flight A never dips');
    last = h;
  }
  // landing is flat at half height
  assert.equal(navigator.resolveHeight('stairs', -3.4, 1.4), 1.625);
  // flight B continues to the deck
  last = 1.6;
  for (let z = 0.8; z >= -1.95; z -= 0.15) {
    const h = navigator.resolveHeight('stairs', -4.02, z);
    assert.ok(h != null, `flight B has height at z=${z.toFixed(2)}`);
    assert.ok(h >= last, 'ascending flight B never dips');
    last = h;
  }
  assert.ok(Math.abs(last - 3.25) < 0.1, `flight B tops out at the deck (${last})`);
  // the deck is flat at 3.25 and never falls back to ground height
  assert.equal(navigator.resolveHeight('upper', -7.0, -2.0), 3.25);
  assert.equal(navigator.resolveHeight('upper', 0, 0), null);
  assert.equal(navigator.resolveHeight('stairs', -6.0, 0), null);
});

test('terrace portals connect ground, stairs and deck; lateral fall-off is rejected', async () => {
  const { getBlueprint } = await import('../src/cafe/interiorLayouts.js');
  const blueprint = getBlueprint('terrace');
  const navigator = createNavigator(blueprint);
  const bottom = navigator.portalAt('ground', -2.82, -2.4);
  assert.ok(bottom, 'bottom portal reachable from the courtyard');
  assert.equal(bottom.toLevelId, 'stairs');
  const top = navigator.portalAt('stairs', -4.02, -1.7);
  assert.ok(top, 'top portal reachable from flight B');
  assert.equal(top.toLevelId, 'upper');
  // stepping laterally off flight A: no height, no fallback
  assert.equal(navigator.resolveHeight('stairs', -2.1, 0), null);
  // full route reachability entrance -> deck
  const reached = navigator.reachableSurfaceIds('te-ground-floor');
  assert.ok(reached.has('te-upper-deck'));
});

test('surfaceHeightAt interpolates ramps and clamps at the ends', () => {
  const ramp = { ramp: { axis: 'z', from: 0, to: 2, y0: 0, y1: 1 } };
  assert.equal(surfaceHeightAt(ramp, 0, 0), 0);
  assert.equal(surfaceHeightAt(ramp, 0, 1), 0.5);
  assert.equal(surfaceHeightAt(ramp, 0, 2), 1);
  assert.equal(surfaceHeightAt(ramp, 0, 99), 1);
  assert.equal(surfaceHeightAt({ y: 3.25 }, 5, 5), 3.25);
});
