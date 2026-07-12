import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pointSupported, footprintCorners, footprintSupported,
  shapesOverlap, shapeBounds, tableSupportShape, convexPolygonsOverlap,
  supportedOffsetToward, pullInsideShape, supportedAlong, placeFootprintForSeat,
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

test('supportedOffsetToward keeps the preferred spot when it already fits', () => {
  const bar = { kind: 'rect', center: { x: 3, z: 6 }, rotation: 0, width: 2.0, depth: 0.45 };
  // a stool partway down the counter: 0.6 m along the strip is fully inside
  const solved = supportedOffsetToward(bar, 1, 0, 0.6, { yaw: 0, width: 0.32, depth: 0.23 }, 0.01);
  assert.ok(solved);
  assert.equal(solved.dist, 0.6);
  assert.ok(Math.abs(solved.x - 3.6) < 1e-9);
  // but from the counter's end the laptop is walked back inside
  const nearEnd = supportedOffsetToward(bar, 1, 0, 0.95, { yaw: 0, width: 0.32, depth: 0.23 }, 0.01);
  assert.ok(nearEnd.dist < 0.95);
  assert.ok(footprintSupported(bar, { x: nearEnd.x, z: nearEnd.z, yaw: 0, width: 0.32, depth: 0.23 }, 0.01));
});

test('supportedOffsetToward pulls a laptop inward on a small round top', () => {
  const cabaret = { kind: 'circle', center: { x: -1, z: 2 }, radius: 0.4 };
  const solved = supportedOffsetToward(cabaret, 1, 0, 0.34, { yaw: 0, width: 0.32, depth: 0.23 }, 0.01);
  assert.ok(solved, 'a 0.32 x 0.23 base fits a 0.4 radius top');
  assert.ok(solved.dist < 0.34, 'the preferred offset had to shrink');
  assert.ok(footprintSupported(cabaret, {
    x: solved.x, z: solved.z, yaw: 0, width: 0.32, depth: 0.23,
  }, 0.01));
});

test('supportedOffsetToward honours footprint rotation on rotated rects', () => {
  // writing desk turned 90°: its 0.7 m depth now runs along x
  const desk = { kind: 'rect', center: { x: 0, z: 0 }, rotation: Math.PI / 2, width: 1.15, depth: 0.7 };
  const yawAligned = supportedOffsetToward(desk, 0, 1, 0.5, { yaw: Math.PI / 2, width: 0.32, depth: 0.23 }, 0.01);
  assert.ok(yawAligned);
  assert.ok(footprintSupported(desk, {
    x: yawAligned.x, z: yawAligned.z, yaw: Math.PI / 2, width: 0.32, depth: 0.23,
  }, 0.01));
  // along the desk's long axis there is more travel than across it
  const across = supportedOffsetToward(desk, 1, 0, 0.5, { yaw: Math.PI / 2, width: 0.32, depth: 0.23 }, 0.01);
  assert.ok(across.dist < yawAligned.dist);
});

test('supportedOffsetToward returns null only when nothing fits', () => {
  const saucer = { kind: 'circle', center: { x: 0, z: 0 }, radius: 0.1 };
  assert.equal(supportedOffsetToward(saucer, 1, 0, 0.3, { yaw: 0, width: 0.32, depth: 0.23 }, 0.01), null);
});

test('pullInsideShape leaves supported points alone and pulls edge cases in', () => {
  const oval = { kind: 'ellipse', center: { x: 2, z: -3 }, rotation: 0, rx: 0.92, rz: 0.62 };
  const inside = pullInsideShape(oval, 2.2, -3.1, 0.07);
  assert.deepEqual(inside, { x: 2.2, z: -3.1 });
  const pulled = pullInsideShape(oval, 3.2, -3, 0.07);
  assert.ok(pointSupported(oval, pulled.x, pulled.z, 0.07));
  assert.ok(pulled.x < 3.2 && pulled.x > 2, 'pulled toward the centre along the ray');
  assert.ok(Math.abs(pulled.z + 3) < 1e-9);
});

test('pullInsideShape clamps a prop onto the window-bar strip', () => {
  const bar = { kind: 'rect', center: { x: 3, z: 6.1 }, rotation: 0, width: 2.0, depth: 0.42 };
  const pulled = pullInsideShape(bar, 3.4, 6.5, 0.07);
  assert.ok(pointSupported(bar, pulled.x, pulled.z, 0.07));
});

test('supportedAlong finds the first supported spot on the segment', () => {
  const table = { kind: 'rect', center: { x: 0, z: 0 }, rotation: 0, width: 1.4, depth: 3.6 };
  // start outside the west edge, walk east toward the centre
  const hit = supportedAlong(table, { x: -1.0, z: 0.4 }, { x: 0, z: 0.4 }, { yaw: 0, width: 0.32, depth: 0.23 }, 0.01);
  assert.ok(hit);
  // usable half-width = 0.7 - 0.16 - 0.01 = 0.53
  assert.ok(hit.x >= -0.53 - 1e-9);
  assert.ok(hit.x < -0.4, 'stops at the first supported spot, not the centre');
  assert.equal(supportedAlong(table, { x: -3, z: 5 }, { x: -3, z: 4 }, { yaw: 0, width: 0.32, depth: 0.23 }, 0.01), null);
});

test('two neighbours on a communal slab keep their laptops apart', () => {
  // the Roastery worktable that used to funnel every laptop to its centre
  const slab = { kind: 'rect', center: { x: -1.9, z: 1 }, rotation: 0, width: 1.4, depth: 3.6 };
  const anchor = { x: -1.9, z: 1 };
  const fp = { width: 0.31, depth: 0.22 };
  const seats = [{ x: -2.95, z: -0.35 }, { x: -2.95, z: 0.55 }];
  const placed = seats.map((seat) => {
    const yaw = Math.atan2(anchor.x - seat.x, anchor.z - seat.z) + Math.PI;
    const spot = placeFootprintForSeat(slab, seat, anchor, { yaw, ...fp });
    assert.ok(spot, 'placement always resolves on the slab');
    return { ...spot, yaw };
  });
  const [a, b] = placed.map((spot) => footprintCorners({ ...spot, ...fp }));
  assert.ok(!convexPolygonsOverlap(a, b), 'adjacent laptops must not collide');
  // each laptop stays on its guest's half of the table
  assert.ok(placed[0].z < placed[1].z);
});

test('placeFootprintForSeat slides an end stool laptop along the counter', () => {
  const counter = { kind: 'rect', center: { x: 0, z: 6.1 }, rotation: 0, width: 4.5, depth: 0.38 };
  // stool at the very end of the strip; anchor is the projected point
  const seat = { x: 2.2, z: 5.45 };
  const spot = placeFootprintForSeat(counter, seat, { x: 2.2, z: 6.1 }, { yaw: Math.PI, width: 0.32, depth: 0.23 });
  assert.ok(spot);
  assert.ok(footprintSupported(counter, { x: spot.x, z: spot.z, yaw: Math.PI, width: 0.32, depth: 0.23 }, 0.01));
  assert.ok(spot.x < 2.2, 'slid toward the middle of the counter to fit');
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
