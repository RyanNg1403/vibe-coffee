import test from 'node:test';
import assert from 'node:assert/strict';
import { CafeAudio } from '../src/audio.js';

test('master mute silences WebAudio and recorded music without losing user levels', () => {
  const targets = [];
  const audio = new CafeAudio();
  audio.ctx = { currentTime: 3 };
  audio.master = { gain: {
    cancelScheduledValues() {},
    setTargetAtTime(value) { targets.push(value); },
  } };
  audio._musicDecks = [{ mix: 1, el: { volume: 1 } }];
  audio.recordedVolume = 0.6;
  audio.recordedDuck = 1;
  audio.musicOn = true;

  audio.setMuted(true);
  assert.equal(targets.at(-1), 0);
  assert.equal(audio._musicDecks[0].el.volume, 0);
  assert.equal(audio.recordedVolume, 0.6);

  audio.setMuted(false);
  assert.equal(targets.at(-1), 0.9);
  assert.equal(audio._musicDecks[0].el.volume, 0.6);
});

