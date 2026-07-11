import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM,
  WALL_ART_DEPTH_GAP,
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

test('indoor wall clock and brass mirror have distinct visual footprints', () => {
  const { clock, mirror } = rightWallDecorLayout();
  const centerDistance = Math.hypot(clock.y - mirror.y, clock.z - mirror.z);
  assert.ok(centerDistance > clock.radius + mirror.radius + 0.2);
});
