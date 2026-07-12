import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_MANIFEST } from '../src/modelManifest.js';

test('incompatible armed and disproportionate characters are absent from the runtime cast', () => {
  assert.equal(MODEL_MANIFEST.char_matt, undefined);
  assert.equal(MODEL_MANIFEST.char_wcasual, undefined);
});

