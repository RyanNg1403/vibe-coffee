// Renderer-independent venue-blueprint audit (CAFE_INTERIOR_REBUILD_PLAN §14
// Phase 0). Validates every venue blueprint — bounds, overlaps, supports,
// referential integrity, forbidden zones, colliders, reachability, and
// cross-venue distinctness — without launching a browser.
//
//   npm run audit:layout
import { venueBlueprints } from '../src/cafe/interiorLayouts.js';
import { validateBlueprints, layoutFingerprint } from '../src/cafe/layoutValidation.js';

const blueprints = venueBlueprints();
const { results, crossErrors, ok } = validateBlueprints(blueprints);

for (const blueprint of blueprints) {
  const result = results.find((r) => r.id === blueprint.id);
  const tables = blueprint.tables.length;
  const seats = blueprint.seats.length;
  const status = result.errors.length ? 'FAIL' : 'ok';
  console.log(`${status.padEnd(4)} ${blueprint.id.padEnd(11)} style=${blueprint.style.padEnd(16)} `
    + `levels=${blueprint.levels.length} tables=${tables} seats=${seats} `
    + `surfaces=${blueprint.walkSurfaces.length} links=${blueprint.verticalLinks.length} `
    + `views=${blueprint.auditViews.length}`);
  for (const error of result.errors) console.log(`     ERROR ${error}`);
  for (const warning of result.warnings) console.log(`     warn  ${warning}`);
}
for (const error of crossErrors) console.log(`CROSS ERROR ${error}`);

const fingerprints = new Set(blueprints.map(layoutFingerprint));
console.log(`\n${blueprints.length} venues, ${fingerprints.size} distinct table plans, `
  + `${results.reduce((n, r) => n + r.errors.length, 0) + crossErrors.length} errors`);

process.exit(ok ? 0 : 1);
