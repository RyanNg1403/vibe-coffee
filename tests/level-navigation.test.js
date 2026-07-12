import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon, createNavigator, createLevelTracker } from '../src/cafe/levelNavigation.js';

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
