import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveQualityController, buildQualityLadder, nearestStep, trimmedMean,
} from '../src/perf/qualityController.js';

function fakeTarget({ tierCount = 3, tier = 0, scale = 1 } = {}) {
  const calls = [];
  return {
    calls,
    tierCount,
    tier,
    scale,
    getTier() { return this.tier; },
    setTier(next) { this.tier = next; calls.push(['tier', next]); },
    getRenderScale() { return this.scale; },
    setRenderScale(next) { this.scale = next; calls.push(['scale', next]); },
  };
}

function feed(controller, seconds, frameMs, targetFps = 24, workMs = null) {
  let changed = null;
  for (let t = 0; t < seconds; t += frameMs / 1000) {
    changed = controller.update(frameMs / 1000, targetFps, workMs) ?? changed;
  }
  return changed;
}

test('ladder orders steps cheapest first and only lowers resolution at the lowest tier', () => {
  const ladder = buildQualityLadder({ tierCount: 3, scales: [1, 0.85, 0.7, 0.5], tierScales: [1, 0.85] });
  assert.deepEqual(ladder[0], { tier: 0, scale: 0.5 });
  assert.deepEqual(ladder.at(-1), { tier: 2, scale: 1 });
  assert.ok(ladder.filter((step) => step.tier > 0).every((step) => step.scale >= 0.85));
  for (let i = 1; i < ladder.length; i += 1) {
    const [a, b] = [ladder[i - 1], ladder[i]];
    assert.ok(b.tier > a.tier || (b.tier === a.tier && b.scale > a.scale), `step ${i} must be richer`);
  }
  assert.equal(nearestStep(ladder, 2, 1), ladder.length - 1);
  assert.equal(nearestStep(ladder, 0, 0.52), 0);
});

test('trimmed mean keeps fixed-refresh cadence but ignores isolated spikes', () => {
  // 24 fps on a 60 Hz display alternates 50 ms and 33 ms intervals.
  assert.ok(Math.abs(trimmedMean([50, 33.3, 50, 33.3, 50, 33.3, 50, 33.3, 50, 33.3]) - 41.65) < 2);
  assert.ok(trimmedMean([41, 41, 41, 41, 41, 41, 41, 41, 41, 900]) < 42);
});

test('sustained over-budget frames step down, severely slow devices drop several steps at once', () => {
  const target = fakeTarget();
  const ladder = buildQualityLadder({ tierCount: 1, scales: [1, 0.9, 0.8, 0.7, 0.6, 0.5] });
  const controller = new AdaptiveQualityController(target, { ladder });
  assert.equal(controller.current.scale, 1);
  feed(controller, 3, 60); // 144% of a 41.7 ms budget: one step
  assert.equal(target.scale, 0.9);
  feed(controller, 3, 700); // 1680% of budget: three steps
  assert.equal(target.scale, 0.6);
  feed(controller, 30, 700);
  assert.equal(target.scale, 0.5, 'never below the ladder floor');
});

test('upgrades need headroom from work timing and wait out the cooldown', () => {
  const target = fakeTarget({ scale: 0.5 });
  const ladder = buildQualityLadder({ tierCount: 1, scales: [1, 0.75, 0.5] });
  const controller = new AdaptiveQualityController(target, { ladder, upgradeCooldown: 10 });
  // Frame budget met, but the GPU is busy for 90% of it: hold.
  feed(controller, 6, 41.7, 24, 37);
  assert.equal(target.scale, 0.5);
  // Clear headroom: step up once, then respect the cooldown.
  feed(controller, 3, 41.7, 24, 10);
  assert.equal(target.scale, 0.75);
  feed(controller, 5, 41.7, 24, 10);
  assert.equal(target.scale, 0.75);
  feed(controller, 10, 41.7, 24, 10);
  assert.equal(target.scale, 1);
});

test('a step that fails right after an upgrade is not probed again immediately', () => {
  const target = fakeTarget({ scale: 0.5 });
  const ladder = buildQualityLadder({ tierCount: 1, scales: [1, 0.5] });
  const controller = new AdaptiveQualityController(target, { ladder, upgradeCooldown: 3, failurePenalty: 60 });
  feed(controller, 3, 41.7); // no work timing: probe up
  assert.equal(target.scale, 1);
  feed(controller, 3, 80); // the richer step cannot hold the budget
  assert.equal(target.scale, 0.5);
  feed(controller, 30, 41.7);
  assert.equal(target.scale, 0.5, 'failed step stays blocked during its penalty');
  feed(controller, 60, 41.7);
  assert.equal(target.scale, 1, 'and is retried once the penalty expires');
});

test('tier changes are delegated to the target interface and stalls are ignored', () => {
  const target = fakeTarget({ tier: 2, scale: 1 });
  const ladder = buildQualityLadder({ tierCount: 3, scales: [1, 0.5], tierScales: [1] });
  const controller = new AdaptiveQualityController(target, { ladder });
  controller.update(5, 24); // a five-second stall says nothing about cost
  feed(controller, 3, 50);
  assert.deepEqual(target.calls[0], ['tier', 1]);
  assert.equal(controller.snapshot().tier, 1);
});

test('a device slower than the stall threshold on every frame still degrades', () => {
  const target = fakeTarget();
  const ladder = buildQualityLadder({ tierCount: 1, scales: [1, 0.75, 0.5] });
  const controller = new AdaptiveQualityController(target, { ladder });
  feed(controller, 30, 3000);
  assert.equal(target.scale, 0.5);
});

test('alternating long and short frames (GPU pipelining at very low fps) still degrade', () => {
  const target = fakeTarget();
  const ladder = buildQualityLadder({ tierCount: 1, scales: [1, 0.75, 0.5] });
  const controller = new AdaptiveQualityController(target, { ladder });
  for (let i = 0; i < 40; i += 1) controller.update(i % 2 ? 0.04 : 2.6, 24);
  assert.equal(target.scale, 0.5);
});

test('mixed interactive and ambient frame rates are judged against their own budgets', () => {
  const target = fakeTarget();
  const ladder = buildQualityLadder({ tierCount: 1, scales: [1, 0.5] });
  const controller = new AdaptiveQualityController(target, { ladder });
  for (let i = 0; i < 200; i += 1) {
    if (i % 2) controller.update(1 / 45, 45);
    else controller.update(1 / 24, 24);
  }
  assert.equal(target.scale, 1);
});
