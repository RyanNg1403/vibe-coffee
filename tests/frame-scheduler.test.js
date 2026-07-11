import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveFrameScheduler } from '../src/frameScheduler.js';

test('ambient rendering is capped while direct interaction remains responsive', () => {
  const scheduler = new AdaptiveFrameScheduler({ interactionHoldMs: 1000 });
  assert.equal(scheduler.shouldRender(0, { visible: true }), true);
  assert.equal(scheduler.targetFps, 24);
  assert.equal(scheduler.shouldRender(16.7, { visible: true }), false);
  assert.equal(scheduler.shouldRender(42, { visible: true }), true);

  scheduler.markInteraction(45);
  assert.equal(scheduler.shouldRender(64.5, { visible: true }), true);
  assert.equal(scheduler.targetFps, 45);
  assert.equal(scheduler.chooseFps(1200, { visible: true }), 24);
});

test('moving and hidden scenes select their dedicated frame budgets', () => {
  const scheduler = new AdaptiveFrameScheduler();
  assert.equal(scheduler.chooseFps(0, { moving: true, visible: true }), 45);
  assert.equal(scheduler.chooseFps(0, { moving: true, visible: false }), 2);
});
