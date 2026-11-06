import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stickToMove, touchLookGain, TOUCH_STICK, TOUCH_LOOK_ACCEL } from '../src/controls/intent.js';

test('touch stick: dead zone, finer control near centre, full speed at the rim', () => {
  const { deadZone, curve } = TOUCH_STICK;
  assert.deepEqual(stickToMove(0, -deadZone * 0.9, deadZone, curve), { x: 0, z: 0 });
  const half = stickToMove(0, -0.57, deadZone, curve).z;
  const linearHalf = stickToMove(0, -0.57, deadZone, 1).z;
  assert.ok(half < linearHalf, 'the curve slows half-deflection walking');
  assert.ok(Math.abs(stickToMove(0, -1, deadZone, curve).z - 1) < 1e-9);
  assert.ok(TOUCH_STICK.sprintAt > 0.9 && TOUCH_STICK.sprintAt < 1);
});

test('swipe-to-look acceleration: 1:1 when slow, smooth ramp, capped when fast', () => {
  assert.equal(touchLookGain(0), 1);
  assert.equal(touchLookGain(TOUCH_LOOK_ACCEL.slow), 1);
  assert.equal(touchLookGain(10), TOUCH_LOOK_ACCEL.maxGain);
  let previous = 1;
  for (let v = 0; v <= 2; v += 0.05) {
    const gain = touchLookGain(v);
    assert.ok(gain >= previous - 1e-12, 'monotonic');
    previous = gain;
  }
});

test('web manifest is installable and subpath-safe', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(['fullscreen', 'standalone'].includes(manifest.display));
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/') && !/^https?:/.test(icon.src), `${icon.src} is relative`);
    assert.ok(existsSync(new URL(`../public/${icon.src}`, import.meta.url)), `${icon.src} exists`);
  }
  assert.ok(existsSync(new URL('../public/icons/apple-touch-icon.png', import.meta.url)));
});

test('index.html references install assets through the Vite base', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const href of ['%BASE_URL%manifest.webmanifest', '%BASE_URL%icons/apple-touch-icon.png', '%BASE_URL%icons/icon.svg']) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.match(html, /viewport-fit=cover/);
});
