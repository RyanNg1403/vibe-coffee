// Immutable per-venue interior blueprints (CAFE_INTERIOR_REBUILD_PLAN §3).
//
// This module is the authoritative description of each café's architecture:
// levels, rooms, walk surfaces, vertical links, tables, seats, service zones,
// NPC destinations, forbidden zones, static colliders, and audit views. The
// renderer (src/cafe.js) consumes these blueprints; validation
// (src/cafe/layoutValidation.js) proves them renderer-independently.
//
// Phase 0 contract: the blueprints describe the CURRENT rendered interiors
// one-to-one — same table coordinates, same order (placement order feeds the
// seeded-audit PRNG), same colliders — so introducing the data layer changes
// nothing on screen. Venue-specific rebuilds (plan §5–§8) then edit THIS file
// first, in later phases.
//
// Everything here is plain data: no THREE types, no DOM.

// Shared room shell (walls, floor slab, glazing) — palette and layout differ
// per venue, the structural shell does not (yet; Garden Terrace grows a second
// level in Phase 4).
export const ROOM_SHELL = { W: 17, D: 13.5, H: 3.8 };

const HALF_W = ROOM_SHELL.W / 2;   //  8.5
const HALF_D = ROOM_SHELL.D / 2;   //  6.75
const DOOR_W = 1.1;

// ---------- shared furniture archetypes ----------
// Chair offsets and support shapes mirror addTable()/addSeat() in src/cafe.js.
// `surfaceY` is the registered tabletop height (top face + 0.03 registration
// pad), i.e. the seat.tableTopY the runtime already uses.

const TABLE_ARCHETYPES = {
  round: {
    shape: 'circle', radius: 0.52, surfaceY: 0.81, clampRadius: 0.52,
    seatOffsets: [[0, -0.85], [0, 0.85], [-0.85, 0]],
  },
  square: {
    shape: 'rect', width: 0.95, depth: 0.95, surfaceY: 0.81, clampRadius: 0.475,
    seatOffsets: [[0, -0.85], [0, 0.85], [-0.85, 0], [0.85, 0]],
  },
  long: {
    shape: 'rect', width: 1.1, depth: 2.6, surfaceY: 0.81, clampRadius: 0.55,
    seatOffsets: [[-0.95, -0.7], [-0.95, 0.7], [0.95, -0.7], [0.95, 0.7]],
  },
  lounge: {
    shape: 'circle', radius: 0.46, surfaceY: 0.58, clampRadius: 0.46,
    seatOffsets: [[0, -1.22], [0, 1.22]],
  },
  // Golden Hour salon pieces (plan §5): one oval group table and one quieter
  // writing table. clampRadius is the conservative inscribed disc used by the
  // laptop/prop clamp until Phase 6 lands exact rotated-footprint placement.
  oval: {
    shape: 'ellipse', rx: 0.92, rz: 0.62, surfaceY: 0.81, clampRadius: 0.6,
    seatOffsets: [
      [-1.27, 0], [1.27, 0],
      [-0.45, -0.95], [0.45, -0.95], [-0.45, 0.95], [0.45, 0.95],
    ],
  },
  writing: {
    shape: 'rect', width: 1.15, depth: 0.7, surfaceY: 0.81, clampRadius: 0.34,
    seatOffsets: [[0, 0.85], [0.95, -0.2]],
  },
  // Roastery communal worktable (plan §6): one substantial slab, eight seats.
  communal: {
    shape: 'rect', width: 1.4, depth: 3.6, surfaceY: 0.81, clampRadius: 0.65,
    seatOffsets: [
      [-1.05, -1.35], [-1.05, -0.45], [-1.05, 0.45], [-1.05, 1.35],
      [1.05, -1.35], [1.05, -0.45], [1.05, 0.45], [1.05, 1.35],
    ],
  },
};

// Standing/tasting rail: a bar-height strip with one-sided stools, authored
// per venue (the Roastery cupping rail faces its production partition).
function railTable(id, levelId, { center, length, depth = 0.4, surfaceY = BAR_SURFACE_Y, stools, stoolSide, footRail = true }) {
  const seats = stools.map((z, index) => ({
    id: `${id}-s${index + 1}`, tableId: id, levelId,
    pos: { x: center.x + stoolSide, y: 0.15, z }, isBar: true,
  }));
  return {
    id, levelId, archetype: 'rail', shape: 'rect',
    center, rotation: 0, width: depth, depth: length, surfaceY,
    supportMargin: 0.02, isBar: true, footRail, railAxis: 'z', seats,
  };
}

// Front window counters flanking the door. The default spec mirrors the
// legacy windowBar block in src/cafe.js (two long strips, 6 stools each);
// venues override it as their rebuild phase lands (Golden Hour: plan §5's
// pair of 2.0 m counters with two stools each and a foot rail).
const BAR_Z = HALF_D - 0.45;                                 // 6.30
const STOOL_Z = HALF_D - 1.05;                               // 5.70
const BAR_SURFACE_Y = 1.035;
const LEGACY_BAR = {
  length: (ROOM_SHELL.W - DOOR_W) / 2 - 1.3,                 // 6.65
  depth: 0.42,
  centerX: DOOR_W / 2 + 0.65 + ((ROOM_SHELL.W - DOOR_W) / 2 - 1.3) / 2, // 4.525
  stools: Math.floor(((ROOM_SHELL.W - DOOR_W) / 2 - 1.3) / 1.1),        // 6
};

function windowBarTables(prefix, levelId, spec = LEGACY_BAR) {
  const tables = [];
  for (const side of [-1, 1]) {
    const id = `${prefix}-bar-${side < 0 ? 'l' : 'r'}`;
    const cx = side * spec.centerX;
    const seats = [];
    for (let i = 0; i < spec.stools; i += 1) {
      const sx = cx - spec.length / 2 + (i + 0.5) * (spec.length / spec.stools);
      seats.push({
        id: `${id}-s${i + 1}`, tableId: id, levelId,
        pos: { x: sx, y: 0.15, z: STOOL_Z }, isBar: true,
      });
    }
    tables.push({
      id, levelId, archetype: 'bar', shape: 'rect',
      center: { x: cx, z: BAR_Z }, rotation: 0,
      width: spec.length, depth: spec.depth, surfaceY: BAR_SURFACE_Y,
      supportMargin: 0.02, isBar: true, footRail: !!spec.footRail,
      barStyle: spec.style ?? 'classic', seats,
    });
  }
  return tables;
}

function rotate(ox, oz, rotation) {
  if (!rotation) return [ox, oz];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [ox * cos + oz * sin, -ox * sin + oz * cos];
}

function diningTables(prefix, levelId, specs) {
  return specs.map((spec, index) => {
    const archetypeName = spec.lounge ? 'lounge' : spec.type;
    const archetype = TABLE_ARCHETYPES[archetypeName];
    const rotation = spec.rot ?? 0;
    const id = `${prefix}-t${String(index + 1).padStart(2, '0')}`;
    const seats = archetype.seatOffsets.map(([ox, oz], seatIndex) => {
      const [wx, wz] = rotate(ox, oz, rotation);
      return {
        id: `${id}-s${seatIndex + 1}`, tableId: id, levelId,
        pos: { x: spec.x + wx, y: 0, z: spec.z + wz }, isBar: false,
      };
    });
    const table = {
      id, levelId, archetype: archetypeName, shape: archetype.shape,
      center: { x: spec.x, z: spec.z }, rotation,
      surfaceY: archetype.surfaceY, supportMargin: 0.02, isBar: false,
      clampRadius: archetype.clampRadius,
      // authored signature prop for this table (e.g. Golden's typewriter)
      vignette: spec.vignette ?? null,
      // legacy builder inputs (src/cafe.js addTable)
      legacyType: spec.type, lounge: !!spec.lounge,
      seats,
    };
    if (archetype.shape === 'circle') table.radius = archetype.radius;
    else if (archetype.shape === 'ellipse') { table.rx = archetype.rx; table.rz = archetype.rz; }
    else { table.width = archetype.width; table.depth = archetype.depth; }
    return table;
  });
}

// ---------- shared ground-floor architecture ----------

function groundWalkSurface(prefix) {
  return {
    id: `${prefix}-ground-floor`, levelId: 'ground', y: 0,
    polygon: [
      { x: -HALF_W, z: -HALF_D }, { x: HALF_W, z: -HALF_D },
      { x: HALF_W, z: HALF_D }, { x: -HALF_W, z: HALF_D },
    ],
  };
}

const COUNTER_RECT = { x0: -5.2, x1: 4.0, z0: -HALF_D, z1: -HALF_D + 1.8 };

function serviceCounterZone(prefix) {
  // anchors mirror decor/serviceCounter.js serviceAnchorsFor(D)
  const staffZ = -HALF_D + 0.6;      // -6.15
  const customerZ = -HALF_D + 2.2;   // -4.55
  return {
    id: `${prefix}-counter`, levelId: 'ground', kind: 'serviceCounter',
    rect: COUNTER_RECT,
    anchors: {
      register: { x: 2.2, z: staffZ },
      espresso: { x: -2.2, z: staffZ },
      pastryCase: { x: -3.9, z: staffZ },
      restock: { x: 0.4, z: staffZ },
      queue: { x: 2.2, z: customerZ },
      pickup: { x: -0.7, z: customerZ },
      dirtyDish: { x: 4.0, z: -HALF_D + 2.6 },
      waiterStandby: { x: -4.6, z: -HALF_D + 2.5 },
    },
  };
}

function commonDestinations(prefix) {
  const staffZ = -HALF_D + 0.6;
  return [
    { id: `${prefix}-door`, levelId: 'ground', x: 0, z: HALF_D - 0.4, role: 'any', purpose: 'entrance' },
    { id: `${prefix}-queue`, levelId: 'ground', x: 2.2, z: -HALF_D + 2.2, role: 'patron', purpose: 'order' },
    { id: `${prefix}-pickup`, levelId: 'ground', x: -0.7, z: -HALF_D + 2.2, role: 'patron', purpose: 'pickup' },
    { id: `${prefix}-barista-home`, levelId: 'ground', x: -1.0, z: staffZ, role: 'barista', purpose: 'staff' },
    { id: `${prefix}-barista-register`, levelId: 'ground', x: 2.2, z: staffZ, role: 'barista', purpose: 'staff' },
    { id: `${prefix}-barista-machine`, levelId: 'ground', x: -2.2, z: staffZ, role: 'barista', purpose: 'staff' },
    { id: `${prefix}-dirty-dish`, levelId: 'ground', x: 4.0, z: -HALF_D + 2.6, role: 'waiter', purpose: 'staff' },
    { id: `${prefix}-waiter-standby`, levelId: 'ground', x: -4.6, z: -HALF_D + 2.5, role: 'waiter', purpose: 'staff' },
  ];
}

function staffOnlyZone(prefix) {
  // Ordinary patrons never walk behind the counter; baristas and waiters may.
  return {
    id: `${prefix}-staff-counter`, levelId: 'ground',
    rect: COUNTER_RECT, appliesTo: 'patron', exceptRoles: ['barista', 'waiter'],
  };
}

const TABLE_COLLIDER_R = { long: 1.5, oval: 1.6, writing: 1.0, communal: 2.0 };

function tableColliders(tables) {
  return tables.filter((t) => !t.isBar).map((t) => ({
    id: `${t.id}-col`, levelId: t.levelId,
    x: t.center.x, z: t.center.z, r: TABLE_COLLIDER_R[t.archetype] ?? 1.05,
  }));
}

// One blocking rect per window counter, hugging the strip itself. The legacy
// venues keep their original full-width front-wall strips; a venue whose bars
// are shorter (Golden Hour) gets exact per-counter rects.
function windowBarColliders(prefix, barTables, legacy) {
  if (legacy) {
    return [
      {
        id: `${prefix}-bar-l-col`, levelId: 'ground',
        rect: { x0: -HALF_W, x1: -DOOR_W / 2 - 0.3, z0: HALF_D - 0.9, z1: HALF_D },
      },
      {
        id: `${prefix}-bar-r-col`, levelId: 'ground',
        rect: { x0: DOOR_W / 2 + 0.3, x1: HALF_W, z0: HALF_D - 0.9, z1: HALF_D },
      },
    ];
  }
  return barTables.map((bar) => ({
    id: `${bar.id}-col`, levelId: bar.levelId,
    rect: {
      x0: bar.center.x - bar.width / 2 - 0.1, x1: bar.center.x + bar.width / 2 + 0.1,
      z0: bar.center.z - bar.depth / 2 - 0.35, z1: HALF_D,
    },
  }));
}

function counterCollider(prefix) {
  return { id: `${prefix}-counter-col`, levelId: 'ground', rect: COUNTER_RECT };
}

// Plant spots shared by the current builder (src/cafe.js plantSpots).
const PLANT_SPOTS = [
  [-HALF_W + 0.7, -HALF_D + 0.7], [HALF_W - 0.7, HALF_D - 1.3], [HALF_W - 0.6, -HALF_D + 3.0],
  [-HALF_W + 0.6, 3.6], [-HALF_W + 0.6, -2.0], [HALF_W - 0.6, 0.4],
  [3.8, -5.0], [-3.6, -5.0], [-0.9, 5.6],
];

// ---------- venue blueprints ----------

function makeVenue({
  prefix, id, style, tables: tableSpecs, windowBar, barSpec = null,
  auditViews, decor = {}, lighting = {}, extraDestinations = [], contract = null,
  extraTables = [], extraColliders = [], extraForbiddenZones = [],
}) {
  const levels = [{ id: 'ground', y: 0 }];
  const rooms = [{
    id: `${prefix}-main`, levelId: 'ground',
    bounds: { x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D },
  }];
  const barTables = windowBar ? windowBarTables(prefix, 'ground', barSpec ?? LEGACY_BAR) : [];
  const tables = [
    ...diningTables(prefix, 'ground', tableSpecs),
    ...extraTables,
    ...barTables,
  ];
  const seats = tables.flatMap((t) => t.seats);
  return {
    id, style, prefix,
    levels, rooms,
    walkSurfaces: [groundWalkSurface(prefix)],
    verticalLinks: [],
    entranceSurfaceId: `${prefix}-ground-floor`,
    tables, seats,
    serviceZones: [serviceCounterZone(prefix)],
    npcDestinations: [...commonDestinations(prefix), ...extraDestinations],
    npcForbiddenZones: [staffOnlyZone(prefix), ...extraForbiddenZones],
    colliders: [
      ...tableColliders(tables),
      counterCollider(prefix),
      ...(windowBar ? windowBarColliders(prefix, barTables, !barSpec) : []),
      ...extraColliders,
    ],
    decor: { plantSpots: PLANT_SPOTS, ...decor },
    lighting,
    auditViews,
    // venue-specific protected-layout contract, checked by layoutValidation
    contract,
  };
}

// Golden Hour salon (plan §5): varied round bistro tables, one oval group
// table, one quieter writing table, subtle rotations, a clear 1.4 m+ arrival
// lane on x∈[-0.7, 0.7], and two protected 2.0 m window counters flanking the
// door. The right wall is partitioned into reserved bays (see decor.rightWall).
const goldenhour = makeVenue({
  prefix: 'gh', id: 'goldenhour', style: 'classic-salon',
  windowBar: true,
  barSpec: { length: 2.0, depth: 0.45, centerX: 2.2, stools: 2, footRail: true },
  tables: [
    { x: -5.0, z: 2.6, type: 'round', lounge: true },
    { x: -4.6, z: -0.9, type: 'oval', rot: 0.35 },
    { x: -6.6, z: -3.6, type: 'writing', rot: -0.15, vignette: 'typewriter' },
    { x: -2.3, z: 1.2, type: 'round' },
    { x: -2.5, z: -2.3, type: 'round' },
    { x: -2.0, z: 4.15, type: 'round' },
    { x: 2.3, z: 3.0, type: 'round' },
    { x: 2.1, z: -0.3, type: 'round' },
    { x: 2.5, z: -3.1, type: 'round' },
    { x: 5.0, z: 1.4, type: 'square', rot: 0.28 },
    { x: 5.3, z: -1.8, type: 'round' },
    { x: 5.6, z: 3.6, type: 'round' },
  ],
  lighting: { pendant: 'cone', lampY: 2.3 },
  decor: {
    // Right-wall bay partition (x = +8.5 wall). The fitted library owns
    // z∈[library.z0, library.z1]; mirror, clock, artwork and coat rack each
    // get their own bay and must never intersect the library span.
    rightWall: {
      library: { z0: -2.8, z1: 1.3, bays: 5, height: 2.16 },
      art: [{ z: -4.6, y: 2.0 }, { z: 4.0, y: 1.9 }],
      clock: { z: 2.1, y: 2.55 },
      mirror: { z: 3.1, y: 2.6 },
      pegboard: { z: 4.9 },
      sconces: [-5.2, 5.4],
    },
    // the lounge side table moved out of the oval group table's footprint
    sideTable: { x: -6.25, z: 3.2 },
    // A-frame menu board stands past the right window counter, off the
    // arrival lane and clear of both counters' stool circulation
    chalkboard: { x: 4.15, z: 5.5, rot: -0.85 },
    // floor plants keep the shared ring EXCEPT: no plant in front of the
    // fitted library (old spot 5) and none crowding the door (old spot 8)
    plantSpots: [
      [-HALF_W + 0.7, -HALF_D + 0.7], [HALF_W - 0.7, HALF_D - 1.3], [HALF_W - 0.6, -HALF_D + 3.0],
      [-HALF_W + 0.6, 3.6], [-HALF_W + 0.6, -2.0], [HALF_W - 0.6, 2.62],
      [3.8, -5.0], [-3.6, -5.0], [-4.2, 5.75],
    ],
  },
  extraDestinations: [
    // browsing spot facing the library shelves; departing patrons may pause
    // here (bounded, anchored, timed) before heading to the door
    {
      id: 'gh-library-browse', levelId: 'ground', x: 7.1, z: -0.75,
      role: 'patron', purpose: 'browse', faceYaw: Math.PI / 2, // face the +x wall
    },
  ],
  contract: {
    windowCounters: {
      count: 2, minLength: 1.8, maxLength: 2.2, minDepth: 0.42, maxDepth: 0.48,
      minSeats: 2, doorClearance: DOOR_W / 2 + 0.2, stoolCirculation: 0.9,
    },
    arrivalLane: { rect: { x0: -0.7, x1: 0.7, z0: -4.5, z1: HALF_D } },
    rightWallBays: true,
  },
  auditViews: [
    { id: 'gh-salon-from-entrance', pos: [0, 1.7, 5.9], lookAt: [0, 1.0, -2.5] },
    { id: 'gh-window-counters-wide', pos: [0, 1.6, 2.5], lookAt: [0, 1.1, 6.4] },
    { id: 'gh-window-counter-left', pos: [-2.2, 1.5, 4.0], lookAt: [-2.2, 1.05, 6.3] },
    { id: 'gh-window-counter-right', pos: [2.2, 1.5, 4.0], lookAt: [2.2, 1.05, 6.3] },
    { id: 'gh-library-straight', pos: [5.8, 1.4, -0.75], lookAt: [8.3, 1.2, -0.75] },
    { id: 'gh-library-oblique', pos: [6.3, 1.6, 1.8], lookAt: [8.3, 1.1, -1.2] },
    { id: 'gh-library-top-shelf', pos: [7.0, 1.9, -0.75], lookAt: [8.3, 1.85, -0.75] },
    { id: 'gh-library-lower-shelf', pos: [7.1, 0.7, -0.75], lookAt: [8.3, 0.5, -0.75] },
    { id: 'gh-wall-decor-boundary', pos: [5.6, 1.9, 3.4], lookAt: [8.4, 2.3, 2.4] },
    { id: 'gh-salon-oval', pos: [-2.6, 1.5, -0.9], lookAt: [-4.6, 0.9, -0.9] },
    { id: 'gh-writing-desk', pos: [-5.0, 1.4, -2.6], lookAt: [-6.6, 0.9, -3.6] },
    { id: 'gh-service-queue', pos: [2.2, 1.7, -1.6], lookAt: [1.2, 1.0, -5.4] },
  ],
});

// Downtown Roastery process hall (plan §6): the room is organized around two
// communal worktables; roasting happens in a glazed production corner
// (left/back) that is visible but sealed off from patrons; a cupping rail
// faces the partition; the window zone is a modern steel rail, deliberately
// unlike Golden Hour's classic twin counters.
const RO_PRODUCTION = { x0: -HALF_W, x1: -5.2, z0: -HALF_D, z1: -1.0 };

const roastery = makeVenue({
  prefix: 'ro', id: 'roastery', style: 'modern-roastery',
  windowBar: true,
  barSpec: { length: 4.5, depth: 0.38, centerX: 2.95, stools: 3, style: 'modern' },
  tables: [
    { x: -1.9, z: 1.0, type: 'communal' },
    { x: 2.7, z: -0.7, type: 'communal', rot: 0.1 },
    { x: 5.9, z: 1.4, type: 'round', lounge: true },
    { x: 5.6, z: 4.3, type: 'writing', rot: -0.2 },
    { x: -6.2, z: 3.4, type: 'round' },
  ],
  extraTables: [
    railTable('ro-tasting-rail', 'ground', {
      center: { x: -4.6, z: -2.6 }, length: 2.6,
      stools: [-3.4, -2.6, -1.8], stoolSide: 0.55,
    }),
  ],
  extraColliders: [
    { id: 'ro-partition-col', levelId: 'ground', rect: { x0: -5.32, x1: -5.12, z0: -HALF_D, z1: -1.0 } },
    { id: 'ro-partition-return-col', levelId: 'ground', rect: { x0: -HALF_W, x1: -5.12, z0: -1.1, z1: -0.9 } },
    { id: 'ro-tasting-rail-col', levelId: 'ground', rect: { x0: -4.85, x1: -4.35, z0: -3.95, z1: -1.25 } },
  ],
  extraForbiddenZones: [
    {
      id: 'ro-production-zone', levelId: 'ground', rect: RO_PRODUCTION,
      appliesTo: 'patron', exceptRoles: ['barista', 'waiter', 'roaster'],
    },
  ],
  lighting: { pendant: 'bulb', lampY: 2.4 },
  decor: {
    production: {
      rect: RO_PRODUCTION,
      partitionX: -5.2, returnZ: -1.0,
      roaster: { x: -6.9, z: -3.3 },
      coolingTray: { x: -6.5, z: -1.9 },
      bench: { x: -8.05, z: -4.2, length: 2.0 },
      sacks: [{ x: -5.9, z: -5.3 }, { x: -6.35, z: -5.55 }, { x: -6.05, z: -4.9 }],
    },
    // the right-wall unit displays beans and brewing kit, not borrowed books
    rightWallShelf: 'process',
    // bay partition keeps wall art, clock and mirror clear of the shelf unit
    // (which owns z∈[-1.25, 0.55]) and of each other
    rightWall: {
      art: [{ z: -3.6, y: 1.85 }, { z: 2.35, y: 1.85 }],
      clock: { z: 3.5, y: 2.55 },
      mirror: { z: -4.7, y: 2.6 },
    },
    // menu board stands past the right window rail, clear of its stools
    chalkboard: { x: 5.9, z: 5.6, rot: -0.9 },
    plantSpots: [
      [-HALF_W + 0.7, -HALF_D + 0.7], [HALF_W - 0.7, HALF_D - 1.3], [HALF_W - 0.6, -HALF_D + 3.0],
      [-HALF_W + 0.6, 3.6], [-6.9, -0.2], [HALF_W - 0.6, 2.0],
      [3.8, -5.0], [-3.6, -5.0], [-0.9, 5.6],
    ],
  },
  contract: {
    productionZone: { rect: RO_PRODUCTION, minBoundaryColliders: 2 },
    communalTables: { min: 1, max: 2 },
    windowBarStyle: 'modern',
  },
  auditViews: [
    { id: 'ro-hall-from-entrance', pos: [0, 1.7, 5.9], lookAt: [0, 1.0, -2.5] },
    { id: 'ro-process-wall', pos: [-3.1, 1.5, -2.4], lookAt: [-7.6, 1.2, -3.6] },
    { id: 'ro-partition-mullions', pos: [-3.9, 1.6, 0.8], lookAt: [-6.6, 1.3, -2.0] },
    { id: 'ro-roaster-closeup', pos: [-4.4, 1.5, -3.0], lookAt: [-7.0, 1.1, -3.35] },
    { id: 'ro-communal-a', pos: [-1.9, 1.6, 3.8], lookAt: [-1.9, 0.85, -0.8] },
    { id: 'ro-communal-b', pos: [2.5, 1.6, -3.5], lookAt: [2.85, 0.85, 1.1] },
    { id: 'ro-tasting-rail-view', pos: [-2.9, 1.5, -1.9], lookAt: [-4.75, 1.05, -2.7] },
    { id: 'ro-project-table', pos: [4.1, 1.5, 3.5], lookAt: [5.7, 0.85, 4.4] },
    { id: 'ro-process-shelf', pos: [6.0, 1.5, -0.3], lookAt: [8.2, 1.2, -0.35] },
    { id: 'ro-service-queue', pos: [2.2, 1.7, -1.6], lookAt: [1.2, 1.0, -5.4] },
    { id: 'ro-window-rail', pos: [0, 1.6, 2.5], lookAt: [0, 1.05, 6.35] },
    { id: 'ro-ceiling-services', pos: [0.5, 1.2, 0.5], lookAt: [-2.0, 3.5, -2.0] },
  ],
});

const midnight = makeVenue({
  prefix: 'mi', id: 'midnight', style: 'jazz-lounge',
  windowBar: true,
  tables: [
    { x: -5.0, z: 2.4, type: 'round', lounge: true }, { x: -5.2, z: -0.7, type: 'round' },
    { x: -4.8, z: -3.5, type: 'round' }, { x: -2.4, z: 0.9, type: 'round' },
    { x: -2.6, z: -2.2, type: 'square' }, { x: -2.0, z: 4.2, type: 'round' },
    { x: 2.2, z: 2.5, type: 'round' }, { x: 2.0, z: -0.5, type: 'round' },
    { x: 2.4, z: -3.3, type: 'square' }, { x: 5.0, z: 1.5, type: 'round' },
  ],
  lighting: { pendant: 'drum', lampY: 2.25 },
  auditViews: [
    { id: 'mi-room-from-entrance', pos: [0, 1.7, 5.9], lookAt: [0, 1.0, -2.5] },
    { id: 'mi-bookshelf-wall', pos: [5.4, 1.5, 3.0], lookAt: [8.2, 1.2, 3.2] },
    { id: 'mi-neon-wall', pos: [4.4, 1.7, -2.4], lookAt: [6.0, 2.3, -6.6] },
    { id: 'mi-service-queue', pos: [2.2, 1.7, -1.6], lookAt: [1.2, 1.0, -5.4] },
    { id: 'mi-window-bar-night', pos: [0, 1.8, 1.2], lookAt: [0, 1.0, 6.3] },
  ],
});

const terrace = makeVenue({
  prefix: 'te', id: 'terrace', style: 'garden-terrace',
  windowBar: false,
  tables: [
    { x: -4.9, z: 2.4, type: 'round', lounge: true }, { x: -5.0, z: -0.8, type: 'round' },
    { x: -4.6, z: -3.5, type: 'round' }, { x: -2.2, z: 1.0, type: 'round' },
    { x: -2.5, z: -2.2, type: 'square' }, { x: -1.9, z: 4.0, type: 'round' },
    { x: 2.2, z: 2.7, type: 'round' }, { x: 2.1, z: -0.4, type: 'round' },
    { x: 2.4, z: -3.3, type: 'square' }, { x: 5.1, z: 1.2, type: 'round' },
    { x: 5.2, z: -2.1, type: 'round' },
  ],
  lighting: { pendant: 'cone', lampY: 2.45 },
  auditViews: [
    { id: 'te-terrace-from-entrance', pos: [0, 1.7, 5.9], lookAt: [0, 1.0, -2.5] },
    { id: 'te-pergola-wide', pos: [-5.8, 1.8, 4.8], lookAt: [2.0, 1.2, -3.0] },
    { id: 'te-service-queue', pos: [2.2, 1.7, -1.6], lookAt: [1.2, 1.0, -5.4] },
    { id: 'te-garden-edge', pos: [5.6, 1.6, 4.4], lookAt: [0, 1.0, -1.0] },
  ],
});

const VENUES = [goldenhour, roastery, midnight, terrace];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
VENUES.forEach(deepFreeze);

const BY_ID = new Map(VENUES.map((venue) => [venue.id, venue]));

export function venueBlueprints() {
  return VENUES;
}

export function getBlueprint(venueId) {
  const blueprint = BY_ID.get(venueId);
  if (!blueprint) throw new Error(`no interior blueprint for venue: ${venueId}`);
  return blueprint;
}
