import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pointSupported, footprintCorners, footprintSupported,
  shapesOverlap, shapeBounds, tableSupportShape, convexPolygonsOverlap,
} from '../src/cafe/tableSupport.js';

const LAPTOP = { width: 0.32, depth: 0.22 };

test('rect containment respects rotation', () => {
  const shape = { kind: 'rect', center: { x: 2, z: 1 }, rotation: Math.PI / 2, width: 2.0, depth: 0.5 };
  // rotated 90°: the long axis now runs along z
  assert.ok(pointSupported(shape, 2, 1.9));
  assert.ok(!pointSupported(shape, 2.9, 1));
  assert.ok(pointSupported(shape, 2.2, 1));
});

test('margins shrink the usable surface', () => {
  const shape = { kind: 'rect', center: { x: 0, z: 0 }, rotation: 0, width: 1.0, depth: 1.0 };
  assert.ok(pointSupported(shape, 0.49, 0));
  assert.ok(!pointSupported(shape, 0.49, 0, 0.02));
});

test('circle and ellipse containment are analytic', () => {
  const circle = { kind: 'circle', center: { x: 0, z: 0 }, radius: 0.52 };
  assert.ok(pointSupported(circle, 0.5, 0));
  assert.ok(!pointSupported(circle, 0.4, 0.4));
  const ellipse = { kind: 'ellipse', center: { x: 0, z: 0 }, rotation: 0, rx: 1.0, rz: 0.5 };
  assert.ok(pointSupported(ellipse, 0.9, 0));
  assert.ok(!pointSupported(ellipse, 0, 0.6));
  // rotate the ellipse 90° and the wide axis flips to z
  const rotated = { ...ellipse, rotation: Math.PI / 2 };
  assert.ok(pointSupported(rotated, 0, 0.9));
  assert.ok(!pointSupported(rotated, 0.9, 0));
});

test('footprint corners rotate with yaw', () => {
  const corners = footprintCorners({ x: 0, z: 0, yaw: Math.PI / 2, width: 2, depth: 1 });
  // yaw 90°: width axis maps onto -z, depth axis onto +x
  for (const corner of corners) {
    assert.ok(Math.abs(Math.abs(corner.x) - 0.5) < 1e-9);
    assert.ok(Math.abs(Math.abs(corner.z) - 1.0) < 1e-9);
  }
});

test('laptop is contained only when all four corners are supported', () => {
  const round = { kind: 'circle', center: { x: 0, z: 0 }, radius: 0.52 };
  assert.ok(footprintSupported(round, { x: 0, z: 0, yaw: 0, ...LAPTOP }, 0.02));
  // centre stays on the table but a corner hangs off — must fail
  const nearEdge = { x: 0.34, z: 0.2, yaw: 0, ...LAPTOP };
  assert.ok(pointSupported(round, nearEdge.x, nearEdge.z, 0.02));
  assert.ok(!footprintSupported(round, nearEdge, 0.02));
});

test('rotated laptop can fit where the axis-aligned one cannot', () => {
  const bar = { kind: 'rect', center: { x: 0, z: 0 }, rotation: 0, width: 6.65, depth: 0.42 };
  const square = { x: 0, z: 0, yaw: 0, width: 0.32, depth: 0.4 };
  assert.ok(!footprintSupported(bar, square, 0.02));
  const flat = { x: 0, z: 0, yaw: 0, width: 0.32, depth: 0.22 };
  assert.ok(footprintSupported(bar, flat, 0.02));
});

test('shape overlap separates disjoint tables and flags colliding ones', () => {
  const a = { kind: 'circle', center: { x: 0, z: 0 }, radius: 0.52 };
  const b = { kind: 'circle', center: { x: 1.2, z: 0 }, radius: 0.52 };
  const c = { kind: 'rect', center: { x: 0.7, z: 0 }, rotation: 0, width: 0.95, depth: 0.95 };
  assert.ok(!shapesOverlap(a, b));
  assert.ok(shapesOverlap(a, c));
});

test('convex polygon SAT handles touching-but-separate rectangles', () => {
  const left = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }];
  const right = [{ x: 1.01, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }, { x: 1.01, z: 1 }];
  assert.ok(!convexPolygonsOverlap(left, right));
});

test('shapeBounds boxes a rotated rect', () => {
  const bounds = shapeBounds({ kind: 'rect', center: { x: 0, z: 0 }, rotation: Math.PI / 4, width: 2, depth: 2 });
  const half = Math.SQRT2;
  assert.ok(Math.abs(bounds.x1 - half) < 1e-9);
  assert.ok(Math.abs(bounds.z0 + half) < 1e-9);
});

test('tableSupportShape normalizes blueprint tables', () => {
  const circle = tableSupportShape({ shape: 'circle', center: { x: 1, z: 2 }, radius: 0.52 });
  assert.equal(circle.kind, 'circle');
  const rect = tableSupportShape({ shape: 'rect', center: { x: 0, z: 0 }, rotation: 0.3, width: 1.1, depth: 2.6 });
  assert.equal(rect.kind, 'rect');
  assert.equal(rect.rotation, 0.3);
  const ellipse = tableSupportShape({ shape: 'ellipse', center: { x: 0, z: 0 }, rx: 1, rz: 0.6 });
  assert.equal(ellipse.kind, 'ellipse');
});
