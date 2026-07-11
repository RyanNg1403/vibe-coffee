import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

test('natural rain master stays within the ambience memory budget', async () => {
  const path = fileURLToPath(new URL('../public/sounds/rain_window.mp3', import.meta.url));
  const [metadata, file] = await Promise.all([parseFile(path), stat(path)]);
  assert.equal(metadata.format.numberOfChannels, 1);
  assert.equal(metadata.format.sampleRate, 24000);
  assert.ok(metadata.format.duration >= 27 && metadata.format.duration <= 29);
  assert.ok(file.size < 230_000, 'compressed rain asset should remain below 230 KB');

  const decodedBytes = metadata.format.duration
    * metadata.format.sampleRate
    * metadata.format.numberOfChannels
    * Float32Array.BYTES_PER_ELEMENT;
  assert.ok(decodedBytes < 2_800_000, 'decoded rain buffer should remain below 2.8 MB');
});
