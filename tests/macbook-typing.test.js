import test from 'node:test';
import assert from 'node:assert/strict';
import { CafeAudio } from '../src/audio.js';

function fakeAudioContext() {
  const sources = [];
  return {
    sources,
    currentTime: 0,
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        playbackRate: { value: 1 },
        addEventListener() {},
        connect(node) { return node; },
        start() { this.started = true; },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect(node) { return node; },
      };
    },
  };
}

function audioWithBuffers(keys) {
  const audio = new CafeAudio();
  audio.ctx = fakeAudioContext();
  audio.foleyBus = { connect() {} };
  for (const key of keys) audio.buffers.set(key, { buffer: { duration: 12.4 }, gain: 1 });
  return audio;
}

test('player typing prefers the MacBook recording and plays one bounded slice', () => {
  const audio = audioWithBuffers(['typing', 'macbook_typing']);
  audio.playPlayerTyping(null, { intentional: true });
  assert.equal(audio.ctx.sources.length, 1);
  assert.equal(audio.ctx.sources[0].buffer.duration, 12.4);
  assert.equal(audio._playerTypingNodes.length, 1);
  assert.equal(audio.playerTypingBursts, 1);
});

test('a click burst replaces a live scheduled burst instead of stacking', () => {
  const audio = audioWithBuffers(['macbook_typing']);
  audio.playPlayerTyping(null); // scheduled focus burst
  const scheduled = audio.ctx.sources[0];
  audio.playPlayerTyping(null, { intentional: true }); // direct click
  assert.equal(scheduled.stopped, true, 'previous source must be stopped');
  assert.equal(audio.ctx.sources.length, 2);
  assert.equal(audio._playerTypingNodes.length, 1);
  assert.equal(audio._playerTypingNodes[0], audio.ctx.sources[1]);
});

test('stopPlayerTyping silences the active source and clears tracking', () => {
  const audio = audioWithBuffers(['macbook_typing']);
  audio.playPlayerTyping(null, { intentional: true });
  const source = audio.ctx.sources[0];
  audio.stopPlayerTyping();
  assert.equal(source.stopped, true);
  assert.equal(audio._playerTypingNodes.length, 0);
  audio.stopPlayerTyping(); // idempotent
});

test('player typing falls back to the generic laptop recording', () => {
  const audio = audioWithBuffers(['typing']);
  audio.playPlayerTyping(null, { intentional: true });
  assert.equal(audio.ctx.sources.length, 1);
  assert.equal(audio._playerTypingNodes.length, 1);
});

test('missing recordings fall back to the synth without throwing', () => {
  const audio = audioWithBuffers([]);
  audio.ctx.createOscillator = () => ({
    type: '', frequency: { value: 0 },
    connect(node) { return node; }, start() {}, stop() {},
  });
  audio.playPlayerTyping(null, { intentional: true });
  assert.ok(audio._playerTypingNodes.length >= 1);
});
