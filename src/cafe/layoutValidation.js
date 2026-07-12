// Renderer-independent blueprint validation (CAFE_INTERIOR_REBUILD_PLAN §14
// Phase 0): bounds, overlaps, supports, referential integrity, forbidden-zone
// role rules, guard-collider completeness, archetype distinctness, and
// reachability. Runs in node with no DOM/THREE, so `npm test` and
// `npm run audit:layout` prove a layout before a browser ever renders it.

import {
  tableSupportShape, shapesOverlap, shapeBounds, pointSupported,
  shapeOutline, convexPolygonsOverlap,
} from './tableSupport.js';
import { createNavigator, pointInPolygon } from './levelNavigation.js';

function rectContains(rect, x, z, pad = 0) {
  return x >= rect.x0 - pad && x <= rect.x1 + pad && z >= rect.z0 - pad && z <= rect.z1 + pad;
}

function inAnyRoom(blueprint, levelId, x, z, pad = 0) {
  return blueprint.rooms.some((room) => room.levelId === levelId && rectContains(room.bounds, x, z, pad));
}

function collectIds(blueprint) {
  return [
    ...blueprint.levels.map((l) => l.id),
    ...blueprint.rooms.map((r) => r.id),
    ...blueprint.walkSurfaces.map((s) => s.id),
    ...blueprint.verticalLinks.map((l) => l.id),
    ...blueprint.tables.map((t) => t.id),
    ...blueprint.seats.map((s) => s.id),
    ...blueprint.serviceZones.map((z) => z.id),
    ...blueprint.npcDestinations.map((d) => d.id),
    ...blueprint.npcForbiddenZones.map((z) => z.id),
    ...blueprint.colliders.map((c) => c.id),
    ...(blueprint.auditViews ?? []).map((v) => v.id),
  ];
}

function zoneContains(zone, x, z) {
  if (zone.rect) return rectContains(zone.rect, x, z);
  if (zone.polygon) return pointInPolygon(zone.polygon, x, z);
  return false;
}

function colliderBlocks(collider, x, z, radius = 0) {
  if (collider.rect) return rectContains(collider.rect, x, z, radius);
  if (collider.r != null) {
    const dx = x - collider.x;
    const dz = z - collider.z;
    const rr = collider.r + radius;
    return dx * dx + dz * dz < rr * rr;
  }
  return false;
}

export function validateBlueprint(blueprint) {
  const errors = [];
  const warnings = [];
  const error = (message) => errors.push(message);

  // -- schema basics ---------------------------------------------------------
  for (const key of ['id', 'style', 'levels', 'rooms', 'walkSurfaces', 'verticalLinks',
    'tables', 'seats', 'serviceZones', 'npcDestinations', 'npcForbiddenZones',
    'colliders', 'decor', 'lighting', 'auditViews']) {
    if (blueprint[key] == null) error(`missing blueprint key: ${key}`);
  }
  if (errors.length) return { id: blueprint.id, errors, warnings };

  const levelIds = new Set(blueprint.levels.map((l) => l.id));
  const requireLevel = (owner, levelId) => {
    if (!levelIds.has(levelId)) error(`${owner}: unknown levelId "${levelId}"`);
  };

  // -- unique, stable ids ----------------------------------------------------
  const seen = new Set();
  for (const id of collectIds(blueprint)) {
    if (typeof id !== 'string' || !id) error(`missing/empty id (near "${[...seen].pop() ?? 'start'}")`);
    else if (seen.has(id)) error(`duplicate id: ${id}`);
    seen.add(id);
  }

  // -- referential integrity -------------------------------------------------
  blueprint.rooms.forEach((room) => requireLevel(`room ${room.id}`, room.levelId));
  blueprint.walkSurfaces.forEach((surface) => {
    requireLevel(`walkSurface ${surface.id}`, surface.levelId);
    if (!Array.isArray(surface.polygon) || surface.polygon.length < 3) {
      error(`walkSurface ${surface.id}: polygon needs at least 3 points`);
    }
    if (typeof surface.y !== 'number') error(`walkSurface ${surface.id}: missing y`);
  });
  const surfaceIds = new Set(blueprint.walkSurfaces.map((s) => s.id));
  blueprint.verticalLinks.forEach((link) => {
    for (const end of [link.a, link.b]) {
      if (!surfaceIds.has(end?.surfaceId)) {
        error(`verticalLink ${link.id}: unknown surface "${end?.surfaceId}"`);
      }
      if (!end?.portal || typeof end.portal.r !== 'number') {
        error(`verticalLink ${link.id}: end missing portal disc`);
      }
    }
  });
  if (!surfaceIds.has(blueprint.entranceSurfaceId)) {
    error(`entranceSurfaceId "${blueprint.entranceSurfaceId}" is not a walk surface`);
  }

  const tablesById = new Map(blueprint.tables.map((t) => [t.id, t]));
  blueprint.seats.forEach((seat) => {
    requireLevel(`seat ${seat.id}`, seat.levelId);
    const table = tablesById.get(seat.tableId);
    if (!table) error(`seat ${seat.id}: unknown tableId "${seat.tableId}"`);
    else if (table.levelId !== seat.levelId) {
      error(`seat ${seat.id}: level "${seat.levelId}" differs from its table "${table.levelId}"`);
    }
    if (typeof seat.isBar !== 'boolean') {
      error(`seat ${seat.id}: isBar must be explicit (no height-threshold inference)`);
    }
  });
  blueprint.tables.forEach((table) => {
    requireLevel(`table ${table.id}`, table.levelId);
    if (typeof table.surfaceY !== 'number') error(`table ${table.id}: missing surfaceY`);
    if (!table.seats?.length) error(`table ${table.id}: no seats`);
  });

  // -- bounds: everything inside a room of its level --------------------------
  blueprint.tables.forEach((table) => {
    const bounds = shapeBounds(tableSupportShape(table));
    const corners = [
      [bounds.x0, bounds.z0], [bounds.x1, bounds.z0],
      [bounds.x0, bounds.z1], [bounds.x1, bounds.z1],
    ];
    if (!corners.every(([x, z]) => inAnyRoom(blueprint, table.levelId, x, z, 0.01))) {
      error(`table ${table.id}: support extends outside every room on its level`);
    }
  });
  blueprint.seats.forEach((seat) => {
    if (!inAnyRoom(blueprint, seat.levelId, seat.pos.x, seat.pos.z, 0.01)) {
      error(`seat ${seat.id}: outside every room on its level`);
    }
  });
  blueprint.npcDestinations.forEach((destination) => {
    requireLevel(`destination ${destination.id}`, destination.levelId);
    if (!inAnyRoom(blueprint, destination.levelId, destination.x, destination.z, 0.01)) {
      error(`destination ${destination.id}: outside every room on its level`);
    }
  });

  // -- overlaps: tables must not intersect each other -------------------------
  for (let i = 0; i < blueprint.tables.length; i += 1) {
    for (let j = i + 1; j < blueprint.tables.length; j += 1) {
      const a = blueprint.tables[i];
      const b = blueprint.tables[j];
      if (a.levelId !== b.levelId) continue;
      if (shapesOverlap(tableSupportShape(a), tableSupportShape(b))) {
        error(`tables overlap: ${a.id} and ${b.id}`);
      }
    }
  }

  // -- seats: adjacent to their table, never inside a tabletop ----------------
  blueprint.seats.forEach((seat) => {
    const table = tablesById.get(seat.tableId);
    if (!table) return;
    const shape = tableSupportShape(table);
    if (pointSupported(shape, seat.pos.x, seat.pos.z, 0.02) && !seat.isBar) {
      error(`seat ${seat.id}: sits inside its table's support shape`);
    }
    // adjacency is measured to the support EDGE (a negative margin expands
    // the shape), so long bar strips keep their end stools valid
    if (!pointSupported(shape, seat.pos.x, seat.pos.z, -1.35)) {
      error(`seat ${seat.id}: too far from table ${table.id} to be usable`);
    }
    for (const other of blueprint.tables) {
      if (other.id === table.id || other.levelId !== seat.levelId) continue;
      if (pointSupported(tableSupportShape(other), seat.pos.x, seat.pos.z, 0.05)) {
        error(`seat ${seat.id}: intersects a different table (${other.id})`);
      }
    }
  });

  // -- forbidden zones: role rules -------------------------------------------
  blueprint.npcForbiddenZones.forEach((zone) => {
    requireLevel(`forbiddenZone ${zone.id}`, zone.levelId);
    if (!zone.rect && !zone.polygon) error(`forbiddenZone ${zone.id}: needs rect or polygon`);
    if (zone.appliesTo == null) error(`forbiddenZone ${zone.id}: missing appliesTo`);
  });
  blueprint.npcDestinations.forEach((destination) => {
    for (const zone of blueprint.npcForbiddenZones) {
      if (zone.levelId !== destination.levelId) continue;
      if (!zoneContains(zone, destination.x, destination.z)) continue;
      const exempt = (zone.exceptRoles ?? []).includes(destination.role)
        || (zone.appliesTo === 'patron' && destination.role !== 'patron' && destination.role !== 'any');
      if (!exempt) {
        error(`destination ${destination.id} (role ${destination.role}) lies in forbidden zone ${zone.id}`);
      }
    }
  });
  blueprint.seats.forEach((seat) => {
    for (const zone of blueprint.npcForbiddenZones) {
      if (zone.levelId !== seat.levelId) continue;
      if (zoneContains(zone, seat.pos.x, seat.pos.z)) {
        error(`seat ${seat.id}: lies in forbidden zone ${zone.id}`);
      }
    }
  });

  // -- colliders --------------------------------------------------------------
  blueprint.colliders.forEach((collider) => {
    requireLevel(`collider ${collider.id}`, collider.levelId);
    if (!collider.rect && collider.r == null) {
      error(`collider ${collider.id}: needs rect or circle radius`);
    }
    if (collider.guard && (typeof collider.minY !== 'number' || typeof collider.maxY !== 'number')) {
      error(`guard collider ${collider.id}: needs explicit minY/maxY`);
    }
  });
  // patron-reachable anchor points must not be walled off
  blueprint.npcDestinations.forEach((destination) => {
    if (destination.role !== 'patron' && destination.role !== 'any') return;
    for (const collider of blueprint.colliders) {
      if (collider.levelId !== destination.levelId) continue;
      if (colliderBlocks(collider, destination.x, destination.z)) {
        error(`destination ${destination.id}: inside collider ${collider.id}`);
      }
    }
  });

  // -- walk surfaces + reachability -------------------------------------------
  const navigator = createNavigator(blueprint);
  const reachable = navigator.reachableSurfaceIds(blueprint.entranceSurfaceId);
  blueprint.walkSurfaces.forEach((surface) => {
    if (!reachable.has(surface.id)) {
      error(`walkSurface ${surface.id}: unreachable from the entrance surface`);
    }
  });
  blueprint.seats.forEach((seat) => {
    if (navigator.resolveHeight(seat.levelId, seat.pos.x, seat.pos.z) == null) {
      error(`seat ${seat.id}: not on any walk surface of level ${seat.levelId}`);
    }
  });
  blueprint.npcDestinations.forEach((destination) => {
    const surface = navigator.surfaceAt(destination.levelId, destination.x, destination.z);
    if (!surface) error(`destination ${destination.id}: not on any walk surface`);
    else if (!reachable.has(surface.id)) {
      error(`destination ${destination.id}: on a surface unreachable from the entrance`);
    }
  });

  // -- venue-specific protected-layout contract -------------------------------
  validateContract(blueprint, error);

  // -- vertical links: real stair geometry, monotonic path --------------------
  blueprint.verticalLinks.forEach((link) => {
    if (!Array.isArray(link.path) || link.path.length < 2) {
      error(`verticalLink ${link.id}: needs a walk path with at least 2 points`);
      return;
    }
    const ys = link.path.map((p) => p.y);
    const ascending = ys[ys.length - 1] >= ys[0];
    for (let i = 1; i < ys.length; i += 1) {
      if (ascending ? ys[i] < ys[i - 1] - 1e-6 : ys[i] > ys[i - 1] + 1e-6) {
        error(`verticalLink ${link.id}: path height is not monotonic`);
        break;
      }
    }
  });

  return { id: blueprint.id, errors, warnings };
}

// Protected-layout contracts (plan §5–§8): venue-specific rules the blueprint
// promises to keep — e.g. Golden Hour's two window counters flanking the door,
// a clear arrival lane, and reserved right-wall decor bays.
function validateContract(blueprint, error) {
  const contract = blueprint.contract;
  if (!contract) return;

  if (contract.windowCounters) {
    const c = contract.windowCounters;
    const bars = blueprint.tables.filter((t) => t.isBar);
    if (bars.length !== c.count) {
      error(`contract: expected ${c.count} window counters, found ${bars.length}`);
    }
    if (!bars.some((b) => b.center.x < 0) || !bars.some((b) => b.center.x > 0)) {
      error('contract: window counters must flank the entrance (one per side)');
    }
    for (const bar of bars) {
      if (bar.width < c.minLength || bar.width > c.maxLength) {
        error(`contract: counter ${bar.id} length ${bar.width} outside [${c.minLength}, ${c.maxLength}]`);
      }
      if (bar.depth < c.minDepth || bar.depth > c.maxDepth) {
        error(`contract: counter ${bar.id} depth ${bar.depth} outside [${c.minDepth}, ${c.maxDepth}]`);
      }
      if (bar.seats.length < c.minSeats) {
        error(`contract: counter ${bar.id} has ${bar.seats.length} seats, needs ${c.minSeats}`);
      }
      const innerEdge = Math.abs(bar.center.x) - bar.width / 2;
      if (innerEdge < c.doorClearance) {
        error(`contract: counter ${bar.id} encroaches on the door (inner edge ${innerEdge.toFixed(2)} < ${c.doorClearance})`);
      }
      if (c.stoolCirculation) {
        for (const seat of bar.seats) {
          for (const table of blueprint.tables) {
            if (table.isBar) continue;
            if (pointSupported(tableSupportShape(table), seat.pos.x, seat.pos.z, -c.stoolCirculation)) {
              error(`contract: table ${table.id} is within ${c.stoolCirculation} m of stool ${seat.id}`);
            }
          }
        }
      }
    }
  }

  if (contract.arrivalLane) {
    const r = contract.arrivalLane.rect;
    const lane = [
      { x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 },
      { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 },
    ];
    for (const table of blueprint.tables) {
      if (convexPolygonsOverlap(shapeOutline(tableSupportShape(table)), lane)) {
        error(`contract: table ${table.id} blocks the arrival lane`);
      }
    }
  }

  if (contract.productionZone) {
    const zone = contract.productionZone;
    const covered = blueprint.npcForbiddenZones.some((forbidden) => forbidden.rect
      && forbidden.rect.x0 <= zone.rect.x0 && forbidden.rect.x1 >= zone.rect.x1
      && forbidden.rect.z0 <= zone.rect.z0 && forbidden.rect.z1 >= zone.rect.z1
      && forbidden.appliesTo === 'patron');
    if (!covered) error('contract: production zone has no covering patron-forbidden zone');
    const sealing = blueprint.colliders.filter((collider) => collider.rect
      && collider.rect.x1 >= zone.rect.x0 - 0.2 && collider.rect.x0 <= zone.rect.x1 + 0.2
      && collider.rect.z1 >= zone.rect.z0 - 0.2 && collider.rect.z0 <= zone.rect.z1 + 0.2);
    if (sealing.length < (zone.minBoundaryColliders ?? 2)) {
      error(`contract: production zone sealed by ${sealing.length} colliders, needs ${zone.minBoundaryColliders ?? 2}`);
    }
  }

  if (contract.communalTables) {
    const communal = blueprint.tables.filter((t) => t.archetype === 'communal').length;
    if (communal < contract.communalTables.min || communal > contract.communalTables.max) {
      error(`contract: ${communal} communal tables outside [${contract.communalTables.min}, ${contract.communalTables.max}]`);
    }
  }

  if (contract.windowBarStyle) {
    for (const bar of blueprint.tables.filter((t) => t.archetype === 'bar')) {
      if (bar.barStyle !== contract.windowBarStyle) {
        error(`contract: window counter ${bar.id} style "${bar.barStyle}" is not "${contract.windowBarStyle}"`);
      }
    }
  }

  if (contract.rightWallBays) {
    const rightWall = blueprint.decor?.rightWall;
    if (!rightWall?.library) {
      error('contract: rightWallBays requires decor.rightWall.library');
    } else {
      const { library } = rightWall;
      const clearance = 0.5; // half a frame width plus breathing room
      const items = [
        ...(rightWall.art ?? []).map((a, i) => ({ id: `art[${i}]`, z: a.z })),
        rightWall.clock && { id: 'clock', z: rightWall.clock.z },
        rightWall.mirror && { id: 'mirror', z: rightWall.mirror.z },
        rightWall.pegboard && { id: 'pegboard', z: rightWall.pegboard.z },
      ].filter(Boolean);
      for (const item of items) {
        if (item.z > library.z0 - clearance && item.z < library.z1 + clearance) {
          error(`contract: right-wall ${item.id} at z=${item.z} intersects the library bay [${library.z0}, ${library.z1}]`);
        }
      }
    }
  }
}

// Fingerprint of a venue's furniture plan, used to prove venues are not
// copies of each other (plan §15: no copied table grid across cafés).
export function layoutFingerprint(blueprint) {
  return blueprint.tables
    .map((t) => `${t.archetype}@${t.center.x.toFixed(1)},${t.center.z.toFixed(1)}`)
    .sort()
    .join('|');
}

export function validateBlueprints(blueprints) {
  const results = blueprints.map(validateBlueprint);
  const crossErrors = [];
  const styles = new Map();
  const fingerprints = new Map();
  for (const blueprint of blueprints) {
    if (styles.has(blueprint.style)) {
      crossErrors.push(`venues ${styles.get(blueprint.style)} and ${blueprint.id} share style "${blueprint.style}"`);
    }
    styles.set(blueprint.style, blueprint.id);
    const fingerprint = layoutFingerprint(blueprint);
    if (fingerprints.has(fingerprint)) {
      crossErrors.push(`venues ${fingerprints.get(fingerprint)} and ${blueprint.id} share an identical table plan`);
    }
    fingerprints.set(fingerprint, blueprint.id);
  }
  return { results, crossErrors, ok: crossErrors.length === 0 && results.every((r) => r.errors.length === 0) };
}
