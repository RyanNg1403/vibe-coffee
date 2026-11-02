import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EquirectangularReflectionMapping, HalfFloatType, LinearSRGBColorSpace } from 'three';
import { loadDaylightEnvironment } from '../src/rendering/daylightEnvironment.js';

test('portable HDR lighting decodes without fetching a CSP-blocked data URL', async () => {
  const bytes = await readFile(new URL('../assets/blender/realism/courtyard-compact.hdr', import.meta.url));
  const texture = await loadDaylightEnvironment(`data:application/octet-stream;base64,${bytes.toString('base64')}`);
  try {
    assert.equal(texture.image.width, 512);
    assert.equal(texture.image.height, 256);
    assert.equal(texture.image.data.length, 512 * 256 * 4);
    assert.equal(texture.type, HalfFloatType);
    assert.equal(texture.colorSpace, LinearSRGBColorSpace);
    assert.equal(texture.mapping, EquirectangularReflectionMapping);
    // The photograph must retain radiance above 1.0, not become an LDR image.
    assert.ok(texture.image.data.some((half, i) => i % 4 !== 3 && half > 0x3c00 && half < 0x7c00));
    assert.equal(texture.userData.vibeShared, true);
  } finally { texture.dispose(); }
});
