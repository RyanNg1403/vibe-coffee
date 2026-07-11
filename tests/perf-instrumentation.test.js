import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcStat } from '../tools/perf-baseline.mjs';
import { CafeAudio } from '../src/audio.js';

test('parseProcStat survives parentheses and spaces in the command name', () => {
  // pid=1234, comm="a) evil (name", state=S, ppid=77, utime=1500, stime=250
  const stat = '1234 (a) evil (name) S 77 1 1 0 -1 4194560 100 0 0 0 1500 250 0 0 20 0 1 0 100 1000000 200';
  const parsed = parseProcStat(stat);
  assert.equal(parsed.ppid, 77);
  assert.equal(parsed.utime, 1500);
  assert.equal(parsed.stime, 250);
});

function fakeAudioContext() {
  const listeners = [];
  return {
    listeners,
    currentTime: 0,
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        addEventListener(name, handler) { listeners.push({ name, handler }); },
        connect(node) { return node; },
        start() {},
      };
      return source;
    },
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect(node) { return node; },
      };
    },
  };
}

test('one-shot recorded sources are counted while live and released on ended', () => {
  const audio = new CafeAudio();
  audio.ctx = fakeAudioContext();
  audio.ambienceBus = { connect() {} };
  audio.buffers.set('clink', { buffer: { duration: 2 }, gain: 1 });

  assert.equal(audio.activeOneShotSources, 0);
  audio._playBuf('clink', { vol: 0.5 });
  audio._playBuf('clink', { vol: 0.5, dur: 0.4 });
  assert.equal(audio.activeOneShotSources, 2);

  for (const { name, handler } of audio.ctx.listeners) {
    assert.equal(name, 'ended');
    handler();
  }
  assert.equal(audio.activeOneShotSources, 0);
});

test('looping beds are not counted as one-shot sources', () => {
  const audio = new CafeAudio();
  audio.ctx = fakeAudioContext();
  audio.ambienceBus = { connect() {} };
  audio.buffers.set('chatter', { buffer: { duration: 30 }, gain: 1 });

  audio._playBuf('chatter', { loop: true });
  assert.equal(audio.activeOneShotSources, 0);
  assert.equal(audio.ctx.listeners.length, 0);
});

test('high-frequency recorded effects are rejected before exceeding their group cap', () => {
  const audio = new CafeAudio();
  audio.ctx = fakeAudioContext();
  audio.ambienceBus = { connect() {} };
  audio.buffers.set('step', { buffer: { duration: 2 }, gain: 1 });

  assert.ok(audio._playBuf('step', { group: 'footsteps', maxConcurrent: 2 }));
  assert.ok(audio._playBuf('step', { group: 'footsteps', maxConcurrent: 2 }));
  assert.equal(audio._playBuf('step', { group: 'footsteps', maxConcurrent: 2 }), null);
  assert.equal(audio.activeOneShotSources, 2);

  audio.ctx.listeners[0].handler();
  assert.ok(audio._playBuf('step', { group: 'footsteps', maxConcurrent: 2 }));
  assert.equal(audio.activeOneShotSources, 2);
});
