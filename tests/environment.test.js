import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, resolveEnvironment, shouldRenderSunShafts } from '../src/cafe.js';

test('night environments never inherit a café daylight shaft effect', () => {
  const goldenNight = resolveEnvironment(THEMES[0], 'night', 'clear');
  assert.equal(goldenNight.timeOfDay, 'night');
  assert.equal(shouldRenderSunShafts(goldenNight), false);
});

test('rain and time of day remain independent environment controls', () => {
  const rainyNoon = resolveEnvironment(THEMES[0], 'noon', 'rain');
  assert.equal(rainyNoon.timeOfDay, 'noon');
  assert.equal(rainyNoon.rain, true);
  assert.equal(shouldRenderSunShafts(rainyNoon), false);

  const clearNight = resolveEnvironment(THEMES[2], 'night', 'clear');
  assert.equal(clearNight.timeOfDay, 'night');
  assert.equal(clearNight.rain, false);
});
