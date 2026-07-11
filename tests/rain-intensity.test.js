import test from 'node:test';
import assert from 'node:assert/strict';
import { CafeAudio } from '../src/audio.js';
import { loadSoundLibrary, loadSoundAsset } from '../src/soundLoader.js';

test('setRainIntensity clamps and rounds to the discrete stops', () => {
  const audio = new CafeAudio();
  audio.setRainIntensity(7);
  assert.equal(audio.rainIntensity, 3);
  audio.setRainIntensity(-2);
  assert.equal(audio.rainIntensity, 0);
  audio.setRainIntensity('1.6');
  assert.equal(audio.rainIntensity, 2);
  audio.setRainIntensity('garbage');
  assert.equal(audio.rainIntensity, 0);
});

function fakeDecodeContext() {
  return {
    sampleRate: 48000,
    decodeAudioData: async (arrayBuffer) => ({
      length: 240,
      duration: 0.01,
      numberOfChannels: 1,
      sampleRate: 24000,
      byteLength: arrayBuffer.byteLength,
      getChannelData: () => new Float32Array(240),
    }),
  };
}

// a 16-byte silent payload is enough for the fake decoder
const DATA_URI = `data:audio/mpeg;base64,${Buffer.from(new Uint8Array(16)).toString('base64')}`;

test('the startup library load skips lazy entries entirely', async () => {
  globalThis.window = {}; // no OfflineAudioContext: decode falls back to ctx
  const buffers = await loadSoundLibrary(fakeDecodeContext(), {
    eager_bed: { url: DATA_URI, loop: true },
    rain_steady: { url: DATA_URI, loop: true, lazy: true },
  });
  assert.equal(buffers.has('eager_bed'), true);
  assert.equal(buffers.has('rain_steady'), false, 'lazy entries must not decode at startup');
  delete globalThis.window;
});

test('loadSoundAsset decodes a single lazy entry on demand', async () => {
  globalThis.window = {};
  const entry = await loadSoundAsset(fakeDecodeContext(), 'rain_steady', {
    url: DATA_URI, loop: true, lazy: true,
  });
  assert.ok(entry.buffer);
  assert.equal(entry.loop, true);
  assert.ok(entry.gain > 0);
  delete globalThis.window;
});
