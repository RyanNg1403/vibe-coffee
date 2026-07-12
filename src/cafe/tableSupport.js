// Rotated tabletop footprint and placement math (CAFE_INTERIOR_REBUILD_PLAN §9).
//
// Everything in this module is renderer-independent: plain {x, z} numbers, no
// THREE types, so the same functions run in node unit tests, the layout
// validator, and the browser placement code.
//
// A support shape describes the usable top of one table/counter:
//   { kind: 'rect',    center: {x, z}, rotation, width, depth }
//   { kind: 'circle',  center: {x, z}, radius }
//   { kind: 'ellipse', center: {x, z}, rotation, rx, rz }
// `rotation` is the yaw of the shape's local +z axis in radians (0 = axis
// aligned). A footprint is the rotated rectangle an object occupies on the
// surface: { x, z, yaw, width, depth }.

export function toShapeLocal(shape, x, z) {
  const dx = x - shape.center.x;
  const dz = z - shape.center.z;
  const rot = shape.rotation ?? 0;
  if (!rot) return { x: dx, z: dz };
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

// Is a single point on the support surface, `margin` metres inside the edge?
export function pointSupported(shape, x, z, margin = 0) {
  const local = toShapeLocal(shape, x, z);
  if (shape.kind === 'rect') {
    return Math.abs(local.x) <= shape.width / 2 - margin
      && Math.abs(local.z) <= shape.depth / 2 - margin;
  }
  if (shape.kind === 'circle') {
    const r = shape.radius - margin;
    return r > 0 && local.x * local.x + local.z * local.z <= r * r;
  }
  if (shape.kind === 'ellipse') {
    const rx = shape.rx - margin;
    const rz = shape.rz - margin;
    if (rx <= 0 || rz <= 0) return false;
    const nx = local.x / rx;
    const nz = local.z / rz;
    return nx * nx + nz * nz <= 1;
  }
  throw new Error(`unknown support shape kind: ${shape.kind}`);
}

// World-space corners of a rotated rectangular footprint.
export function footprintCorners({ x, z, yaw = 0, width, depth }) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const hw = width / 2;
  const hd = depth / 2;
  return [
    [+hw, +hd], [+hw, -hd], [-hw, -hd], [-hw, +hd],
  ].map(([lx, lz]) => ({
    x: x + lx * cos + lz * sin,
    z: z - lx * sin + lz * cos,
  }));
}

// The laptop-containment rule from the plan: an object is supported only when
// all four base corners (and the centre) sit on the surface, `margin` metres
// inside the edge. The laptop is never treated as a point.
export function footprintSupported(shape, footprint, margin = 0) {
  if (!pointSupported(shape, footprint.x, footprint.z, margin)) return false;
  return footprintCorners(footprint)
    .every((corner) => pointSupported(shape, corner.x, corner.z, margin));
}

// Convex polygon outline of any support shape (world space), used by the
// generic overlap tests in the layout validator.
export function shapeOutline(shape, segments = 24) {
  if (shape.kind === 'rect') {
    return footprintCorners({
      x: shape.center.x, z: shape.center.z,
      yaw: shape.rotation ?? 0, width: shape.width, depth: shape.depth,
    });
  }
  const rx = shape.kind === 'circle' ? shape.radius : shape.rx;
  const rz = shape.kind === 'circle' ? shape.radius : shape.rz;
  const rot = shape.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const lx = Math.cos(a) * rx;
    const lz = Math.sin(a) * rz;
    points.push({
      x: shape.center.x + lx * cos + lz * sin,
      z: shape.center.z - lx * sin + lz * cos,
    });
  }
  return points;
}

// Separating-axis test for two convex polygons ({x, z} vertex lists).
export function convexPolygonsOverlap(a, b) {
  for (const [p, q] of [[a, b], [b, a]]) {
    for (let i = 0; i < p.length; i += 1) {
      const p1 = p[i];
      const p2 = p[(i + 1) % p.length];
      const axisX = -(p2.z - p1.z);
      const axisZ = p2.x - p1.x;
      let minP = Infinity; let maxP = -Infinity;
      for (const v of p) {
        const d = v.x * axisX + v.z * axisZ;
        if (d < minP) minP = d;
        if (d > maxP) maxP = d;
      }
      let minQ = Infinity; let maxQ = -Infinity;
      for (const v of q) {
        const d = v.x * axisX + v.z * axisZ;
        if (d < minQ) minQ = d;
        if (d > maxQ) maxQ = d;
      }
      if (maxP < minQ || maxQ < minP) return false;
    }
  }
  return true;
}

// Do two support shapes overlap in plan view? Curved shapes are compared via
// their polygon outlines, which is exact enough for furniture separation.
export function shapesOverlap(a, b, segments = 24) {
  return convexPolygonsOverlap(shapeOutline(a, segments), shapeOutline(b, segments));
}

// Axis-aligned bounds of a support shape (world space), for room-bounds checks.
export function shapeBounds(shape) {
  const outline = shapeOutline(shape);
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const p of outline) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  return { x0, x1, z0, z1 };
}

// Walk a rotated footprint from `from` toward `to` in 0.02 m steps and stop
// at the first spot where all four corners (and the centre) are supported.
// Returns { x, z, dist } (dist = distance travelled from `from`) or null if
// no point on the segment fits.
export function supportedAlong(shape, from, to, footprint, margin = 0.01) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dz);
  const steps = Math.ceil(span / 0.02);
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    if (footprintSupported(shape, {
      x, z, yaw: footprint.yaw ?? 0, width: footprint.width, depth: footprint.depth,
    }, margin)) {
      return { x, z, dist: span * t };
    }
  }
  return null;
}

// Walk inward from `startDist` along a ray from the shape centre until the
// rotated footprint's four corners (and centre) are all supported. This is
// the laptop-placement solver: prefer sitting near the guest's edge, pull
// toward the centre only as far as the true support shape requires.
export function supportedOffsetToward(shape, dirX, dirZ, startDist, footprint, margin = 0.01) {
  for (let dist = Math.max(0, startDist); dist >= 0; dist -= 0.02) {
    const x = shape.center.x + dirX * dist;
    const z = shape.center.z + dirZ * dist;
    if (footprintSupported(shape, {
      x, z, yaw: footprint.yaw ?? 0, width: footprint.width, depth: footprint.depth,
    }, margin)) {
      return { x, z, dist };
    }
  }
  return null;
}

// The laptop-placement rule shared by the player and NPCs (plan §9/§10):
// aim for a spot roughly arm's reach in front of the guest, then pull it
// toward the seat's table anchor (the projected point on a bar strip, the
// centre of a freestanding table) until the whole base is supported. If even
// the anchor line fails (an end stool on a counter), slide toward the
// shape's true centre instead. Anchoring at the seat — not the table centre
// — keeps two neighbours' laptops in front of their own chairs on long
// communal tables instead of converging in the middle.
export function placeFootprintForSeat(shape, seatPos, anchor, footprint, margin = 0.01) {
  const dx = anchor.x - seatPos.x;
  const dz = anchor.z - seatPos.z;
  const d = Math.hypot(dx, dz) || 1;
  const reach = Math.min(0.55, Math.max(0.35, d - 0.34));
  const desired = {
    x: seatPos.x + (dx / d) * reach,
    z: seatPos.z + (dz / d) * reach,
  };
  return supportedAlong(shape, desired, anchor, footprint, margin)
    ?? supportedAlong(shape, desired, shape.center, footprint, margin);
}

// Project a point (with a circular pad) back inside a support shape by
// pulling it straight toward the shape centre. Used by the prop clamp.
export function pullInsideShape(shape, x, z, pad) {
  if (pointSupported(shape, x, z, pad)) return { x, z };
  const dx = x - shape.center.x;
  const dz = z - shape.center.z;
  const dist = Math.hypot(dx, dz) || 1;
  for (let t = dist; t >= 0; t -= 0.02) {
    const px = shape.center.x + (dx / dist) * t;
    const pz = shape.center.z + (dz / dist) * t;
    if (pointSupported(shape, px, pz, pad)) return { x: px, z: pz };
  }
  return { x: shape.center.x, z: shape.center.z };
}

// The support shape of a table blueprint entry (tables carry their shape
// fields inline; this normalizes them for the geometry helpers above).
export function tableSupportShape(table) {
  if (table.shape === 'circle') {
    return { kind: 'circle', center: table.center, radius: table.radius };
  }
  if (table.shape === 'ellipse') {
    return {
      kind: 'ellipse', center: table.center, rotation: table.rotation ?? 0,
      rx: table.rx, rz: table.rz,
    };
  }
  return {
    kind: 'rect', center: table.center, rotation: table.rotation ?? 0,
    width: table.width, depth: table.depth,
  };
}
