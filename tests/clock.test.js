import test from 'node:test';
import assert from 'node:assert/strict';
import { clockAngles } from '../src/clock.js';

const toDegrees = (radians) => (radians * 180) / Math.PI;

// The acceptance fixtures from the implementation plan: hand angles correct
// within one visual degree at these local times.
const FIXTURES = [
  { time: [0, 0, 0], hour: 0, minute: 0, second: 0 },
  { time: [3, 15, 30], hour: 97.75, minute: 93, second: 180 },
  { time: [12, 30, 45], hour: 15.375, minute: 184.5, second: 270 },
  { time: [23, 59, 59], hour: 359.99583, minute: 359.9, second: 354 },
];

for (const { time, hour, minute, second } of FIXTURES) {
  const label = time.map((v) => String(v).padStart(2, '0')).join(':');
  test(`clockAngles is correct within one degree at ${label}`, () => {
    const [h, m, s] = time;
    const angles = clockAngles(new Date(2026, 6, 11, h, m, s, 0));
    assert.ok(Math.abs(toDegrees(angles.hour) - hour) < 1, `hour ${toDegrees(angles.hour)}`);
    assert.ok(Math.abs(toDegrees(angles.minute) - minute) < 1, `minute ${toDegrees(angles.minute)}`);
    assert.ok(Math.abs(toDegrees(angles.second) - second) < 1, `second ${toDegrees(angles.second)}`);
  });
}

test('the second hand sweeps smoothly through milliseconds', () => {
  const atSecond = clockAngles(new Date(2026, 6, 11, 10, 0, 30, 0));
  const midSecond = clockAngles(new Date(2026, 6, 11, 10, 0, 30, 500));
  assert.ok(midSecond.second > atSecond.second);
  assert.ok(Math.abs(toDegrees(midSecond.second) - 183) < 0.01);
});

test('hands derive from one date: hour advances with minutes and seconds', () => {
  const angles = clockAngles(new Date(2026, 6, 11, 6, 30, 0, 0));
  assert.ok(Math.abs(toDegrees(angles.hour) - 195) < 0.01, 'half past six sits between 6 and 7');
});

test('afternoon times wrap the 12-hour dial', () => {
  const morning = clockAngles(new Date(2026, 6, 11, 2, 10, 0, 0));
  const afternoon = clockAngles(new Date(2026, 6, 11, 14, 10, 0, 0));
  assert.equal(morning.hour, afternoon.hour);
});
