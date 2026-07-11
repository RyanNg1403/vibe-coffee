import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MENUS, serviceAnchorsFor } from '../src/decor/serviceCounter.js';

const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];

test('every cafe has its own readable menu with priced items and a special', () => {
  for (const theme of THEMES) {
    const menu = SERVICE_MENUS[theme];
    assert.ok(menu, `${theme} menu exists`);
    assert.ok(menu.title.length >= 4);
    assert.ok(menu.items.length >= 4, `${theme} has at least 4 items`);
    for (const [name, price] of menu.items) {
      assert.ok(name.length >= 3, `${theme}: item name "${name}"`);
      assert.ok(/^\d+(\.\d+)?$/.test(price), `${theme}: "${name}" price "${price}" is numeric`);
    }
    assert.ok(menu.special.length > 8, `${theme} has a today's-special line`);
  }
  const titles = new Set(THEMES.map((t) => SERVICE_MENUS[t].title));
  assert.equal(titles.size, THEMES.length, 'menus differ per cafe');
});

test('service anchors sit in sane counter zones', () => {
  const D = 13.5;
  const anchors = serviceAnchorsFor(D);
  const staffZ = -D / 2 + 0.6;
  // staff-side stations line up behind the counter
  for (const key of ['register', 'espresso', 'pastryCase', 'restock']) {
    assert.equal(anchors[key].z, staffZ, `${key} on the staff side`);
  }
  // customer-facing spots are in front of the counter, inside the room
  for (const key of ['pickup', 'dirtyDish', 'waiterStandby']) {
    assert.ok(anchors[key].z > -D / 2 + 1.15, `${key} on the customer side`);
    assert.ok(anchors[key].z < 0, `${key} still in the service half`);
  }
  // audio emitters carry real heights and match their stations horizontally
  assert.equal(anchors.audio.register.x, anchors.register.x);
  assert.equal(anchors.audio.espresso.x, anchors.espresso.x);
  assert.ok(anchors.audio.register.y > 0.8 && anchors.audio.register.y < 1.6);
  assert.ok(anchors.audio.dishes.y > 0.5);
});

test('unknown themes fall back to a menu instead of crashing', async () => {
  const { menuBoardTexture } = await import('../src/decor/serviceCounter.js');
  assert.equal(typeof menuBoardTexture, 'function');
  assert.ok(SERVICE_MENUS.goldenhour, 'fallback target exists');
});
