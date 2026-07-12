// Venue-specific architecture builders (CAFE_INTERIOR_REBUILD_PLAN §3).
//
// Phases 1–4 register one builder per venue here (Golden Hour salon+library,
// Roastery process hall, Midnight stage lounge, Terrace two-level courtyard).
// A builder receives the venue blueprint plus the shared construction kit
// from buildCafe and REPLACES the shared furniture/zone dressing inside the
// zones it authors — it never layers a room around the shared table grid.
//
// In Phase 0 no venue has a bespoke builder yet: buildCafe drives the shared
// furniture loop from blueprint.tables so the blueprint is already the single
// source of truth for furniture placement, colliders, and seat identity.

import { getBlueprint } from './interiorLayouts.js';

const BUILDERS = new Map();

// registerArchitecture('goldenhour', ({ blueprint, kit }) => {...})
export function registerArchitecture(venueId, builder) {
  BUILDERS.set(venueId, builder);
}

export function architectureFor(venueId) {
  return {
    blueprint: getBlueprint(venueId),
    builder: BUILDERS.get(venueId) ?? null,
  };
}
