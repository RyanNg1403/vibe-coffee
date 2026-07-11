import test from 'node:test';
import assert from 'node:assert/strict';
import { GREENERY } from '../src/decor/decorManifest.js';

const LEGACY_PLANTS = new Set(['plant', 'plant_small', 'plant_snake', 'cactus_pot']);

test('curated greenery never falls back to the first-generation plant models', () => {
  for (const [theme, greenery] of Object.entries(GREENERY)) {
    for (const spec of greenery.floor) {
      assert.equal(LEGACY_PLANTS.has(spec.kind), false, `${theme} floor plant ${spec.kind}`);
    }
    for (const kind of greenery.sill) {
      assert.equal(LEGACY_PLANTS.has(kind), false, `${theme} sill plant ${kind}`);
    }
  }
});
