import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM,
  COUNTER_SURFACE_Y,
  MIDNIGHT_BOOKSHELF_PLAN,
  PASTRY_TRAY_CLEARANCE,
  PASTRY_TRAY_THICKNESS,
  WALL_ART_DEPTH_GAP,
  pastryTrayY,
  midnightWallLayout,
  rightWallDecorLayout,
  wallArtDepths,
} from '../src/cafe.js';

test('wall artwork sits in front of its frame instead of sharing a depth plane', () => {
  const depth = wallArtDepths(ROOM.W);
  assert.ok(WALL_ART_DEPTH_GAP >= 0.015, 'gap must exceed normal depth precision jitter');
  assert.ok(depth.artX < depth.frameInteriorFaceX, 'art must sit toward the room');
  assert.equal(
    Number((depth.frameInteriorFaceX - depth.artX).toFixed(3)),
    Number(WALL_ART_DEPTH_GAP.toFixed(3)),
  );
});

test('midnight neon stays on the wall and clears its acoustic panels', () => {
  const layout = midnightWallLayout();
  const neonLeft = layout.neonCenter - layout.neonWidth / 2;
  const rightPanelEdge = Math.max(...layout.panelCenters) + layout.panelWidth / 2;
  assert.ok(neonLeft > rightPanelEdge + 0.1, 'neon needs a visible gap from acoustic treatment');
  assert.ok(layout.neonCenter + layout.neonWidth / 2 < ROOM.W / 2 - 0.1, 'neon must remain inside the wall');
});

test('every midnight bookshelf bay has dense books and a curated object', () => {
  assert.equal(MIDNIGHT_BOOKSHELF_PLAN.length, 4);
  for (const shelf of MIDNIGHT_BOOKSHELF_PLAN) {
    assert.ok(shelf.left + shelf.right >= 30, 'each shelf needs enough books to read as occupied');
    assert.ok(shelf.decor, 'each shelf needs a visual anchor between book clusters');
  }
  assert.equal(new Set(MIDNIGHT_BOOKSHELF_PLAN.map((shelf) => shelf.decor)).size, 4);
});

test('pastry trays clear the counter instead of sharing its depth plane', () => {
  const lowerTrayBottom = pastryTrayY(0) - PASTRY_TRAY_THICKNESS / 2;
  assert.ok(PASTRY_TRAY_CLEARANCE >= 0.006, 'clearance must survive depth precision jitter');
  assert.ok(lowerTrayBottom > COUNTER_SURFACE_Y);
  assert.equal(
    Number((lowerTrayBottom - COUNTER_SURFACE_Y).toFixed(3)),
    Number(PASTRY_TRAY_CLEARANCE.toFixed(3)),
  );
});

test('indoor wall clock and brass mirror have distinct visual footprints', () => {
  const { clock, mirror } = rightWallDecorLayout();
  const centerDistance = Math.hypot(clock.y - mirror.y, clock.z - mirror.z);
  assert.ok(centerDistance > clock.radius + mirror.radius + 0.2);
});
