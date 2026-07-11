import test from 'node:test';
import assert from 'node:assert/strict';
import { CafeAudio } from '../src/audio.js';

function fakeAudioContext() {
  const created = { sources: [], oscillators: [], panners: 0 };
  return {
    created,
    currentTime: 0,
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        stopped: false,
        playbackRate: { value: 1 },
        listeners: [],
        addEventListener(name, handler) { this.listeners.push({ name, handler }); },
        connect(node) { return node; },
        start() {},
        stop() { this.stopped = true; },
      };
      created.sources.push(source);
      return source;
    },
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
          setTargetAtTime() {},
        },
        connect(node) { return node; },
      };
    },
    createOscillator() {
      const oscillator = {
        type: '',
        frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(node) { return node; },
        start() {}, stop() {},
      };
      created.oscillators.push(oscillator);
      return oscillator;
    },
    createPanner() {
      created.panners += 1;
      return {
        panningModel: '', distanceModel: '', refDistance: 0, maxDistance: 0, rolloffFactor: 0,
        positionX: { setValueAtTime() {} },
        positionY: { setValueAtTime() {} },
        positionZ: { setValueAtTime() {} },
        connect(node) { return node; },
        disconnect() {},
      };
    },
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, connect(node) { return node; } };
    },
  };
}

function petAudio(buffers = ['cat_meow', 'cat_purr', 'dog_sniff', 'dog_whine', 'dog_bark']) {
  const audio = new CafeAudio();
  audio.ctx = fakeAudioContext();
  audio.started = true;
  audio.petBus = { connect() {} };
  audio.ambienceBus = { connect() {} };
  audio._brownBuf = { duration: 4 };
  for (const key of buffers) audio.buffers.set(key, { buffer: { duration: 9 }, gain: 1 });
  // listener at the origin
  audio._listenerPos.x = 0; audio._listenerPos.y = 1.5; audio._listenerPos.z = 0;
  return audio;
}

test('spontaneous pet voices are silent beyond 3 m and allocate no nodes', () => {
  const audio = petAudio();
  const played = audio.playPetVoice('cat', 'chirp', { x: 3.6, z: 0 });
  assert.equal(played, false);
  assert.equal(audio.ctx.created.sources.length, 0);
  assert.equal(audio.ctx.created.panners, 0);
});

test('spontaneous pet voices play inside 3 m through a fresh panner', () => {
  const audio = petAudio();
  const played = audio.playPetVoice('cat', 'chirp', { x: 2.0, z: 1.0 });
  assert.equal(played, true);
  assert.equal(audio.ctx.created.sources.length, 1);
  assert.equal(audio.ctx.created.panners, 1);
  assert.equal(audio.activePetVoices, 1);
});

test('a deliberate click is heard further away but never beyond spatial range', () => {
  const audio = petAudio();
  assert.equal(audio.playPetVoice('dog', 'bark', { x: 6, z: 0 }, { intentional: true }), true);
  assert.equal(audio.playPetVoice('dog', 'bark', { x: 12, z: 0 }, { intentional: true }), false);
});

test('only one spontaneous pet voice can sound at a time', () => {
  const audio = petAudio();
  assert.equal(audio.playPetVoice('cat', 'meow', { x: 1, z: 0 }), true);
  assert.equal(audio.playPetVoice('dog', 'whine', { x: 1, z: 0.5 }), false, 'second spontaneous rejected');
  assert.equal(audio.playPetVoice('cat', 'purr', { x: 1, z: 0 }, { intentional: true }), true, 'clicks still respond');
  // both sources end -> counter returns to zero and spontaneous voices resume
  for (const source of audio.ctx.created.sources) {
    for (const { handler } of source.listeners) handler();
  }
  assert.equal(audio.activePetVoices, 0);
  assert.equal(audio.playPetVoice('dog', 'whine', { x: 1, z: 0.5 }), true);
});

test('missing recordings fall back to a soft synth chirp/huff, or silence', () => {
  const audio = petAudio([]);
  assert.equal(audio.playPetVoice('cat', 'chirp', { x: 1, z: 0 }), true, 'chirp has a synth stand-in');
  assert.equal(audio.ctx.created.oscillators.length, 1);
  assert.equal(audio.playPetVoice('dog', 'huff', { x: 1, z: 0 }, { intentional: true }), true, 'huff has a synth stand-in');
  assert.equal(audio.playPetVoice('cat', 'purr', { x: 1, z: 0 }, { intentional: true }), false, 'no credible purr synth: silence');
  assert.equal(audio.playPetVoice('dog', 'bark', { x: 1, z: 0 }, { intentional: true }), false, 'no credible bark synth: silence');
});

test('unknown kinds and events are rejected before any allocation', () => {
  const audio = petAudio();
  assert.equal(audio.playPetVoice('parrot', 'squawk', { x: 1, z: 0 }), false);
  assert.equal(audio.playPetVoice('cat', 'bark', { x: 1, z: 0 }), false);
  assert.equal(audio.ctx.created.panners, 0);
});

test('setPetVolume stores the slider before the audio graph exists', () => {
  const audio = new CafeAudio();
  audio.setPetVolume(0.4);
  assert.equal(audio.petVolume, 0.4);
});
