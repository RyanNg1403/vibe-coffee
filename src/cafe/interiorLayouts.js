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
    shape: 'circle', radius: 0.52, surfaceY: 0.81,
    seatOffsets: [[0, -0.85], [0, 0.85], [-0.85, 0]],
  },
  square: {
    shape: 'rect', width: 0.95, depth: 0.95, surfaceY: 0.81,
    seatOffsets: [[0, -0.85], [0, 0.85], [-0.85, 0], [0.85, 0]],
  },
  long: {
    shape: 'rect', width: 1.1, depth: 2.6, surfaceY: 0.81,
    seatOffsets: [[-0.95, -0.7], [-0.95, 0.7], [0.95, -0.7], [0.95, 0.7]],
  },
  lounge: {
    shape: 'circle', radius: 0.46, surfaceY: 0.58,
    seatOffsets: [[0, -1.22], [0, 1.22]],
  },
};

// Front window bar (two strips flanking the door). Geometry mirrors the
// windowBar block in src/cafe.js: strip length, centres, stool spacing.
const BAR_LEN = (ROOM_SHELL.W - DOOR_W) / 2 - 1.3;           // 6.65
const BAR_CENTER_X = DOOR_W / 2 + 0.65 + BAR_LEN / 2;        // 4.525
const BAR_Z = HALF_D - 0.45;                                 // 6.30
const STOOL_Z = HALF_D - 1.05;                               // 5.70
const BAR_SURFACE_Y = 1.035;
const STOOLS_PER_SIDE = Math.floor(BAR_LEN / 1.1);           // 6

function windowBarTables(prefix, levelId) {
  const tables = [];
  for (const side of [-1, 1]) {
    const id = `${prefix}-bar-${side < 0 ? 'l' : 'r'}`;
    const cx = side * BAR_CENTER_X;
    const seats = [];
    for (let i = 0; i < STOOLS_PER_SIDE; i += 1) {
      const sx = cx - BAR_LEN / 2 + (i + 0.5) * (BAR_LEN / STOOLS_PER_SIDE);
      seats.push({
        id: `${id}-s${i + 1}`, tableId: id, levelId,
        pos: { x: sx, y: 0.15, z: STOOL_Z }, isBar: true,
      });
    }
    tables.push({
      id, levelId, archetype: 'bar', shape: 'rect',
      center: { x: cx, z: BAR_Z }, rotation: 0,
      width: BAR_LEN, depth: 0.42, surfaceY: BAR_SURFACE_Y,
      supportMargin: 0.02, isBar: true, seats,
    });
  }
  return tables;
}

function diningTables(prefix, levelId, specs) {
  return specs.map((spec, index) => {
    const archetypeName = spec.lounge ? 'lounge' : spec.type;
    const archetype = TABLE_ARCHETYPES[archetypeName];
    const id = `${prefix}-t${String(index + 1).padStart(2, '0')}`;
    const seats = archetype.seatOffsets.map(([ox, oz], seatIndex) => ({
      id: `${id}-s${seatIndex + 1}`, tableId: id, levelId,
      pos: { x: spec.x + ox, y: 0, z: spec.z + oz }, isBar: false,
    }));
    const table = {
      id, levelId, archetype: archetypeName, shape: archetype.shape,
      center: { x: spec.x, z: spec.z }, rotation: 0,
      surfaceY: archetype.surfaceY, supportMargin: 0.02, isBar: false,
      // legacy builder inputs (src/cafe.js addTable) — kept until the shared
      // furniture loop is replaced per venue in Phases 1–4
      legacyType: spec.type, lounge: !!spec.lounge,
      seats,
    };
    if (archetype.shape === 'circle') table.radius = archetype.radius;
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

function tableColliders(tables) {
  return tables.filter((t) => !t.isBar).map((t) => ({
    id: `${t.id}-col`, levelId: t.levelId,
    x: t.center.x, z: t.center.z, r: t.archetype === 'long' ? 1.5 : 1.05,
  }));
}

function windowBarColliders(prefix) {
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

function makeVenue({ prefix, id, style, tables: tableSpecs, windowBar, auditViews, decor = {}, lighting = {} }) {
  const levels = [{ id: 'ground', y: 0 }];
  const rooms = [{
    id: `${prefix}-main`, levelId: 'ground',
    bounds: { x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D },
  }];
  const tables = [
    ...diningTables(prefix, 'ground', tableSpecs),
    ...(windowBar ? windowBarTables(prefix, 'ground') : []),
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
    npcDestinations: commonDestinations(prefix),
    npcForbiddenZones: [staffOnlyZone(prefix)],
    colliders: [
      ...tableColliders(tables),
      counterCollider(prefix),
      ...(windowBar ? windowBarColliders(prefix) : []),
    ],
    decor: { plantSpots: PLANT_SPOTS, ...decor },
    lighting,
    auditViews,
  };
}

const goldenhour = makeVenue({
  prefix: 'gh', id: 'goldenhour', style: 'classic-salon',
  windowBar: true,
  // order matches THEMES[0].tables — placement order feeds the seeded PRNG
  tables: [
    { x: -4.9, z: 2.6, type: 'round', lounge: true }, { x: -5.1, z: -0.5, type: 'round' },
    { x: -4.7, z: -3.4, type: 'round' }, { x: -2.4, z: 1.1, type: 'square' },
    { x: -2.6, z: -2.0, type: 'round' }, { x: -2.1, z: 4.3, type: 'round' },
    { x: 2.2, z: 2.9, type: 'round' }, { x: 2.0, z: -0.2, type: 'square' },
    { x: 2.4, z: -3.2, type: 'round' }, { x: 5.0, z: 1.3, type: 'round' },
    { x: 5.2, z: -1.9, type: 'square' },
  ],
  lighting: { pendant: 'cone', lampY: 2.3 },
  auditViews: [
    { id: 'gh-salon-from-entrance', pos: [0, 1.7, 5.9], lookAt: [0, 1.0, -2.5] },
    { id: 'gh-window-counters-wide', pos: [0, 1.8, 1.2], lookAt: [0, 1.0, 6.3] },
    { id: 'gh-window-counter-left', pos: [-4.5, 1.6, 4.2], lookAt: [-4.5, 1.0, 6.3] },
    { id: 'gh-window-counter-right', pos: [4.5, 1.6, 4.2], lookAt: [4.5, 1.0, 6.3] },
    { id: 'gh-service-queue', pos: [2.2, 1.7, -1.6], lookAt: [1.2, 1.0, -5.4] },
    { id: 'gh-library-wall', pos: [5.6, 1.5, 1.4], lookAt: [8.3, 1.3, 1.6] },
  ],
});

const roastery = makeVenue({
  prefix: 'ro', id: 'roastery', style: 'modern-roastery',
  windowBar: true,
  tables: [
    { x: -4.6, z: 0.9, type: 'long' }, { x: 4.7, z: -0.9, type: 'long' },
    { x: -4.8, z: -3.4, type: 'square' }, { x: -2.2, z: 3.4, type: 'round' },
    { x: 2.2, z: 3.6, type: 'round' }, { x: -2.3, z: -2.0, type: 'square' },
    { x: 2.4, z: 0.4, type: 'square' }, { x: 2.3, z: -3.4, type: 'round' },
    { x: 5.2, z: 2.9, type: 'round', lounge: true },
  ],
  lighting: { pendant: 'bulb', lampY: 2.4 },
  auditViews: [
    { id: 'ro-hall-from-entrance', pos: [0, 1.7, 5.9], lookAt: [0, 1.0, -2.5] },
    { id: 'ro-roaster-zone', pos: [-4.2, 1.6, -1.2], lookAt: [-6.8, 1.2, -4.8] },
    { id: 'ro-communal-left', pos: [-4.6, 1.6, 3.6], lookAt: [-4.6, 0.9, -0.4] },
    { id: 'ro-communal-right', pos: [4.7, 1.6, -3.6], lookAt: [4.7, 0.9, 0.4] },
    { id: 'ro-service-queue', pos: [2.2, 1.7, -1.6], lookAt: [1.2, 1.0, -5.4] },
    { id: 'ro-window-rail', pos: [0, 1.8, 1.2], lookAt: [0, 1.0, 6.3] },
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
