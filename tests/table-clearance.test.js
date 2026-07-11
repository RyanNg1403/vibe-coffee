import test from 'node:test';
import assert from 'node:assert/strict';
import { laptopCupOffset, laptopPropOffset } from '../src/tableClearance.js';

test('fixed table props never occupy the laptop or player-drink slot', () => {
  for (const elevated of [false, true]) {
    const cup = laptopCupOffset(elevated);
    const fixed = Array.from({ length: 5 }, (_, index) => laptopPropOffset(index, elevated));
    assert.ok(cup.side >= 0.3);
    fixed.forEach((slot) => assert.ok(slot.side <= -0.28));
    assert.ok(Math.hypot(fixed[0].side - cup.side, fixed[0].forward - cup.forward) >= 0.58);
    assert.equal(new Set(fixed.map((slot) => `${slot.side}:${slot.forward}`)).size, fixed.length);
  }
});
