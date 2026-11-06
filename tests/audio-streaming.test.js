import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamedLoop, StreamSource } from '../src/audioStream.js';
import { loadSoundAsset, loadStreamedSoundAsset } from '../src/soundLoader.js';

function fakeParam(value = 0) {
  return {
    value,
    curves: [],
    setValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
    setValueCurveAtTime(curve, t, duration) { this.curves.push({ curve, t, duration }); this.value = curve.at(-1); },
  };
}

function fakeCtx() {
  const ctx = {
    currentTime: 0,
    sources: [],
    createGain: () => ({ gain: fakeParam(1), connect(next) { return next; }, disconnect() {} }),
    createBufferSource: () => {
      const src = {
        playbackRate: fakeParam(1),
        buffer: null,
        connect() {},
        disconnect() {},
        start(when, offset) { src.started = { when, offset }; },
        stop() { src.stopped = true; },
      };
      ctx.sources.push(src);
      return src;
    },
  };
  return ctx;
}

function fakePool({ refuse = false } = {}) {
  const pool = {
    acquired: [],
    released: 0,
    acquire() {
      const listeners = new Map();
      const el = {
        currentTime: 0,
        paused: true,
        playbackRate: 1,
        plays: 0,
        play() {
          el.plays += 1;
          if (refuse) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
          el.paused = false;
          return Promise.resolve();
        },
        pause() { el.paused = true; },
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type) { listeners.delete(type); },
        fire(type) { listeners.get(type)?.(); },
      };
      const item = { el, node: { connect(next) { return next; }, disconnect() {} } };
      pool.acquired.push(item);
      return item;
    },
    release() { pool.released += 1; },
  };
  return pool;
}

const source = () => ({ url: 'blob:bed', duration: 30, retain() { this.users = (this.users ?? 0) + 1; }, unretain() { this.users -= 1; } });

test('a streamed loop skips the file edges like the buffer path and crossfades before the end', async () => {
  const ctx = fakeCtx();
  const pool = fakePool();
  const loop = new StreamedLoop(ctx, pool, source(), { out: {} });
  assert.equal(loop.loopStart, 0.4);
  assert.equal(loop.loopEnd, 29.6);
  assert.equal(await loop.ready, true);
  const [first, second] = pool.acquired.map((item) => item.el);
  assert.equal(first.currentTime, 0.4);
  assert.equal(first.paused, false);
  assert.equal(second.paused, true, 'the second element waits for the crossfade');

  first.currentTime = 10;
  first.fire('timeupdate');
  assert.equal(second.plays, 0, 'no crossfade mid-loop');

  first.currentTime = loop.loopEnd - loop.crossfade;
  first.fire('timeupdate');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(second.plays, 1);
  assert.equal(second.currentTime, 0.4);
  assert.equal(loop.active, 1);
  const [inDeck, outDeck] = [loop.decks[1], loop.decks[0]];
  assert.equal(inDeck.xf.gain.curves.length, 1);
  assert.equal(outDeck.xf.gain.curves.length, 1);
  // equal power: the two gains' squares sum to one throughout
  const fadeIn = inDeck.xf.gain.curves[0].curve;
  const fadeOut = outDeck.xf.gain.curves[0].curve;
  for (let i = 0; i < fadeIn.length; i += 1) assert.ok(Math.abs(fadeIn[i] ** 2 + fadeOut[i] ** 2 - 1) < 1e-5);
  loop.dispose();
  assert.equal(pool.released, 2);
});

test('playback rate reaches both elements (pitch follows rate, as with buffers)', async () => {
  const loop = new StreamedLoop(fakeCtx(), fakePool(), source(), { out: {} });
  await loop.ready;
  loop.src.playbackRate.setTargetAtTime(0.97, 0, 1.5);
  assert.deepEqual(loop.decks.map((deck) => deck.item.el.playbackRate), [0.97, 0.97]);
});

test('a refused element falls back to a decoded buffer loop into the same gain', async () => {
  const ctx = fakeCtx();
  const buffer = { duration: 30 };
  const loop = new StreamedLoop(ctx, fakePool({ refuse: true }), source(), {
    out: {}, loopStart: 0.25, loopEnd: 10.65, offset: 0.25, fallback: async () => buffer,
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loop.ready, true);
  } finally {
    console.warn = warn;
  }
  assert.equal(loop.mode, 'buffer');
  const [src] = ctx.sources;
  assert.equal(src.buffer, buffer);
  assert.equal(src.loop, true);
  assert.equal(src.loopStart, 0.25);
  assert.equal(src.loopEnd, 10.65);
});

test('dispose of a fallback loop stops the source and clears its buffer', async () => {
  const ctx = fakeCtx();
  const buffer = { duration: 30 };
  const loop = new StreamedLoop(ctx, fakePool({ refuse: true }), source(), {
    out: {}, fallback: async () => buffer,
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loop.ready, true);
  } finally {
    console.warn = warn;
  }
  const [src] = ctx.sources;
  assert.equal(src.buffer, buffer);
  loop.dispose();
  assert.equal(src.stopped, true);
  assert.equal(src.buffer, null);
  assert.equal(loop.bufferSource, null);
});

test('a stream source is revoked only once released and unused', () => {
  const revoked = [];
  const original = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const stream = new StreamSource(new Uint8Array(8).buffer);
    stream.retain();
    stream.release();
    assert.equal(revoked.length, 0, 'a playing loop keeps its bytes');
    stream.unretain();
    assert.equal(revoked.length, 1);
    assert.equal(stream.url, null);
  } finally {
    URL.revokeObjectURL = original;
  }
});

test('streamed entries keep the decoded path loudness gain but no PCM', async () => {
  globalThis.window = {};
  const ctx = {
    sampleRate: 48000,
    decodeAudioData: async () => {
      const data = new Float32Array(2400).map((_, i) => Math.sin(i / 7) * 0.2);
      return { length: data.length, duration: 0.1, numberOfChannels: 1, getChannelData: () => data };
    },
  };
  const def = { url: `data:audio/mpeg;base64,${Buffer.from(new Uint8Array(32)).toString('base64')}`, loop: true };
  try {
    const decoded = await loadSoundAsset(ctx, 'chatter', def);
    const streamed = await loadStreamedSoundAsset(ctx, 'chatter', def);
    assert.equal(streamed.buffer, undefined);
    assert.ok(Math.abs(streamed.gain - decoded.gain) < 1e-12);
    assert.equal(streamed.stream.duration, 0.1);
    assert.equal(streamed.stream.bytes, 32);
    streamed.stream.release();
  } finally {
    delete globalThis.window;
  }
});
