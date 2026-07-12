// Floor-aware navigation over blueprint walk surfaces and stair links
// (CAFE_INTERIOR_REBUILD_PLAN §8, §14 Phase 0).
//
// Core rules encoded here, per the plan's caveats:
//  - Floor identity is persistent state. A walker's level NEVER comes from a
//    height threshold; it only changes by crossing a vertical-link portal.
//  - resolveHeight() returns null outside every walk surface of the queried
//    level. It never falls back to ground height.
//
// Blueprint inputs:
//   walkSurfaces: [{ id, levelId, y, polygon: [{x, z}, ...] }]
//     — a flat surface at height y, OR a stair flight with a linear run:
//   { id, levelId, polygon, ramp: { axis: 'z'|'x', from, to, y0, y1 } }
//     — height interpolates from y0 (where axis === from) to y1 (at to)
//   verticalLinks: [{
//     id, kind: 'stair',
//     a: { surfaceId, portal: {x, z, r} },
//     b: { surfaceId, portal: {x, z, r} },
//     path: [{x, y, z}, ...],   // walk waypoints from a's portal to b's portal
//   }]

export function surfaceHeightAt(surface, x, z) {
  if (!surface.ramp) return surface.y;
  const { axis, from, to, y0, y1 } = surface.ramp;
  const v = axis === 'x' ? x : z;
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return y0 + (y1 - y0) * t;
}

export function pointInPolygon(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.z > z) !== (b.z > z)
      && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function createNavigator(blueprint) {
  const surfaces = new Map();
  const byLevel = new Map();
  for (const surface of blueprint.walkSurfaces ?? []) {
    surfaces.set(surface.id, surface);
    if (!byLevel.has(surface.levelId)) byLevel.set(surface.levelId, []);
    byLevel.get(surface.levelId).push(surface);
  }
  const links = blueprint.verticalLinks ?? [];

  function surfaceAt(levelId, x, z) {
    for (const surface of byLevel.get(levelId) ?? []) {
      if (pointInPolygon(surface.polygon, x, z)) return surface;
    }
    return null;
  }

  // Height of the walk surface under (x, z) on a specific level, or null when
  // the point is off every surface of that level (never a ground fallback).
  // Stair flights (ramp surfaces) interpolate along their run.
  function resolveHeight(levelId, x, z) {
    const surface = surfaceAt(levelId, x, z);
    return surface ? surfaceHeightAt(surface, x, z) : null;
  }

  // The vertical-link end whose portal disc contains (x, z) while standing on
  // `levelId`, or null. Crossing a portal is the only way to change level.
  function portalAt(levelId, x, z) {
    for (const link of links) {
      for (const [end, other] of [[link.a, link.b], [link.b, link.a]]) {
        const surface = surfaces.get(end.surfaceId);
        if (!surface || surface.levelId !== levelId) continue;
        const dx = x - end.portal.x;
        const dz = z - end.portal.z;
        if (dx * dx + dz * dz <= end.portal.r * end.portal.r) {
          return { link, from: end, to: other, toLevelId: surfaces.get(other.surfaceId)?.levelId ?? null };
        }
      }
    }
    return null;
  }

  // Surfaces reachable from `startSurfaceId` via vertical links. Surfaces on
  // the same level are treated as connected only when they share a level AND
  // overlap is not knowable here, so same-level adjacency must be authored as
  // one polygon per contiguous walkable region.
  function reachableSurfaceIds(startSurfaceId) {
    const reached = new Set();
    if (!surfaces.has(startSurfaceId)) return reached;
    const queue = [startSurfaceId];
    reached.add(startSurfaceId);
    while (queue.length) {
      const current = queue.shift();
      for (const link of links) {
        for (const [end, other] of [[link.a, link.b], [link.b, link.a]]) {
          if (end.surfaceId === current && !reached.has(other.surfaceId) && surfaces.has(other.surfaceId)) {
            reached.add(other.surfaceId);
            queue.push(other.surfaceId);
          }
        }
      }
    }
    return reached;
  }

  return {
    surfaces,
    links,
    surfaceAt,
    resolveHeight,
    portalAt,
    reachableSurfaceIds,
  };
}

// A walker's persistent floor identity. The runtime owns one of these per
// player/NPC; movement code asks it for heights and proposes portal crossings.
export function createLevelTracker(navigator, initialSurfaceId) {
  const initial = navigator.surfaces.get(initialSurfaceId);
  if (!initial) throw new Error(`unknown walk surface: ${initialSurfaceId}`);
  let levelId = initial.levelId;

  return {
    get levelId() { return levelId; },
    // Height for a proposed position on the CURRENT level only. Returns null
    // when the position leaves every surface of this level — the caller must
    // reject the move, not drop to another floor.
    heightAt(x, z) {
      return navigator.resolveHeight(levelId, x, z);
    },
    // Cross a vertical link the walker has fully traversed. This is the only
    // operation that changes levelId.
    crossPortal(portal) {
      if (!portal || portal.toLevelId == null) return false;
      levelId = portal.toLevelId;
      return true;
    },
  };
}
