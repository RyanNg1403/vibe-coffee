import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_TIERS, TIER_NAMES, createQualityState, resolveTierName, detectAutoTier, qualityOverrideFromUrl, tierConfig, tierIndex,
} from '../src/rendering/qualityTiers.js';
import {
  LUT_SIZE, NEUTRAL_GRADE, buildLutData, gradeColor, gradeForTheme,
} from '../src/rendering/colorGrade.js';

test('tiers are ordered from cheapest to richest', () => {
  assert.deepEqual(TIER_NAMES, ['low', 'medium', 'high', 'ultra']);
  const cost = (tier) => [
    tier.post, tier.ao, tier.bloom, tier.godRays, tier.dof, tier.msaa > 0, tier.antialias !== 'none',
  ].filter(Boolean).length + tier.shadows.mapSize / 1024 + (tier.ao?.samples ?? 0) / 4;
  for (let i = 1; i < TIER_NAMES.length; i += 1) {
    const lower = QUALITY_TIERS[TIER_NAMES[i - 1]];
    const higher = QUALITY_TIERS[TIER_NAMES[i]];
    assert.ok(cost(higher) > cost(lower), `${higher.name} must cost more than ${lower.name}`);
    assert.ok(higher.maxPixelRatio >= lower.maxPixelRatio);
    assert.ok(higher.shadows.updateHz >= lower.shadows.updateHz);
    assert.ok(higher.effectLevel >= lower.effectLevel);
  }
});

test('low tier draws the scene once with no post-processing', () => {
  const low = tierConfig('low');
  assert.equal(low.post, false);
  assert.equal(low.ao, null);
  assert.equal(low.probe, null);
  assert.equal(low.effectLevel, 0);
});

test('medium tier stays within the ambient perf budget: no scene re-renders', () => {
  const medium = tierConfig('medium');
  // AO must come from the main pass's depth, never a normal pre-pass, and the
  // expensive full-screen effects stay off.
  assert.ok(medium.ao.scale <= 0.5);
  assert.equal(medium.msaa, 0);
  assert.equal(medium.godRays, null);
  assert.equal(medium.dof, null);
  assert.equal(medium.shadows.filter, 'pcf');
  assert.equal(medium.effectLevel, 0);
});

test('tier configs are immutable so readers cannot change the shared budget', () => {
  assert.throws(() => { 'use strict'; QUALITY_TIERS.high.post = false; });
});

test('persisted settings ids resolve to rendering tiers', () => {
  assert.equal(resolveTierName('smooth'), 'low');
  assert.equal(resolveTierName('balanced'), 'medium');
  assert.equal(resolveTierName('detail'), 'high');
  assert.equal(resolveTierName('ultra'), 'ultra');
  assert.equal(resolveTierName('auto'), null);
  assert.equal(tierConfig('detail').name, 'high');
});

test('unknown tier names fall back to medium', () => {
  assert.equal(tierConfig('cinematic').name, 'medium');
  assert.equal(tierIndex('cinematic'), 1);
});

test('auto detection is conservative on software and mobile GPUs', () => {
  assert.equal(detectAutoTier({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' }), 'low');
  assert.equal(detectAutoTier({ gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' }), 'low');
  assert.equal(detectAutoTier({ gpu: 'Adreno (TM) 640', mobile: true, deviceMemory: 4, cores: 8 }), 'low');
  assert.equal(detectAutoTier({ gpu: 'Apple GPU', mobile: true, deviceMemory: 8, cores: 8 }), 'medium');
  assert.equal(detectAutoTier({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' }), 'medium');
  assert.equal(detectAutoTier({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' }), 'high');
  assert.equal(detectAutoTier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11)' }), 'high');
  // ultra is opt-in only: Auto never picks it, even on flagship GPUs
  assert.equal(detectAutoTier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11)' }), 'high');
  assert.equal(detectAutoTier({ gpu: 'NVIDIA GeForce GTX 1060', screenPixels: 3840 * 2160 }), 'medium');
  assert.equal(detectAutoTier({ gpu: 'NVIDIA GeForce RTX 3080', screenPixels: 3840 * 2160 }), 'high');
  assert.equal(detectAutoTier({ gpu: 'NVIDIA GeForce RTX 3080', deviceMemory: 2 }), 'low');
});

test('?quality= pins a known tier only', () => {
  assert.equal(qualityOverrideFromUrl('?visual-audit=1&quality=ultra'), 'ultra');
  assert.equal(qualityOverrideFromUrl('?quality=balanced'), 'medium');
  assert.equal(qualityOverrideFromUrl('?quality=cinematic'), null);
  assert.equal(qualityOverrideFromUrl(''), null);
});

test('quality state notifies subscribers once per real change', () => {
  const state = createQualityState('medium');
  const seen = [];
  const unsubscribe = state.subscribe((config) => seen.push(config.name));
  assert.equal(state.setTier('medium'), false);
  assert.equal(state.setTier('ultra'), true);
  state.setTier('bogus');
  unsubscribe();
  state.setTier('low');
  assert.deepEqual(seen, ['ultra', 'medium']);
  assert.equal(state.config.name, 'low');
});

test('the neutral grade is an identity LUT', () => {
  for (const rgb of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.43, 0.43, 0.43]]) {
    gradeColor(rgb, NEUTRAL_GRADE).forEach((value, index) => assert.ok(Math.abs(value - rgb[index]) < 1e-9));
  }
  const data = buildLutData(NEUTRAL_GRADE);
  assert.equal(data.length, LUT_SIZE ** 3 * 4);
  const texel = (r, g, b) => ((b * LUT_SIZE + g) * LUT_SIZE + r) * 4;
  assert.deepEqual([...data.slice(texel(LUT_SIZE - 1, 0, 0), texel(LUT_SIZE - 1, 0, 0) + 4)], [255, 0, 0, 255]);
  assert.deepEqual([...data.slice(texel(0, LUT_SIZE - 1, 0), texel(0, LUT_SIZE - 1, 0) + 4)], [0, 255, 0, 255]);
});

test('time-of-day grades follow the light: warm sunsets, cool nights, flatter rain', () => {
  const warmth = (grade) => {
    const [r, , b] = gradeColor([0.75, 0.75, 0.75], grade);
    return r - b;
  };
  const sunset = gradeForTheme({ timeOfDay: 'sunset' });
  const night = gradeForTheme({ timeOfDay: 'night' });
  assert.ok(warmth(sunset) > warmth(gradeForTheme({ timeOfDay: 'noon' })));
  const [sr, , sb] = gradeColor([0.08, 0.08, 0.08], night);
  assert.ok(sb > sr, 'night shadows lean blue');
  assert.ok(gradeColor([0.02, 0.02, 0.02], night).every((v) => v > 0.005), 'night keeps detail out of pure black');
  const rain = gradeForTheme({ timeOfDay: 'noon', rain: true });
  assert.ok(rain.saturation < gradeForTheme({ timeOfDay: 'noon' }).saturation);
  for (const grade of [sunset, night, rain]) {
    for (const v of gradeColor([1, 0.2, 0], grade)) assert.ok(v >= 0 && v <= 1);
  }
});
