import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';
import { SOUND_MANIFEST } from '../src/soundManifest.js';

// The rain bed decodes at 24 kHz mono (see soundLoader decodeRate); only the
// selected intensity is resident because the manifest marks the levels lazy.
const RAIN_DECODE_RATE = 24000;
const RAIN_LEVELS = ['rain_light', 'rain_steady', 'rain_heavy'];

for (const key of RAIN_LEVELS) {
  test(`${key} master stays within the ambience budgets`, async () => {
    const path = fileURLToPath(new URL(`../public/sounds/${key}.mp3`, import.meta.url));
    const [metadata, file] = await Promise.all([parseFile(path), stat(path)]);
    assert.equal(metadata.format.numberOfChannels, 1);
    assert.ok(metadata.format.duration >= 34 && metadata.format.duration <= 38);
    assert.ok(file.size < 460_000, 'compressed rain level should remain below 460 KB');

    const decodedBytes = metadata.format.duration
      * RAIN_DECODE_RATE
      * Float32Array.BYTES_PER_ELEMENT;
    assert.ok(decodedBytes < 3_600_000, 'decoded rain level should remain below 3.6 MB');
  });
}

test('rain levels are lazy so at most one occupies decoded memory', () => {
  for (const key of RAIN_LEVELS) {
    assert.equal(SOUND_MANIFEST[key]?.lazy, true, `${key} must be lazy`);
    assert.equal(SOUND_MANIFEST[key]?.loop, true, `${key} must loop`);
  }
  assert.equal(SOUND_MANIFEST.rain_window, undefined, 'the old plastic-sounding master is gone');
  const eager = Object.entries(SOUND_MANIFEST).filter(([, def]) => !def.lazy);
  assert.ok(eager.length > 0, 'the rest of the library still loads eagerly');
});
