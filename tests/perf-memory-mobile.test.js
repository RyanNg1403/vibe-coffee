import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { classifyDevice, classifyGpu, capQualityTier, TIER_SETTINGS, isMobileDevice } from '../src/perf/deviceProfile.js';
import { ThermalGovernor, frameCaps, THERMAL_STEPS } from '../src/perf/framePacing.js';
import { memoryPressure, MemoryGovernor } from '../src/perf/memoryGovernor.js';
import { levelBytes, storageBytes, trackGpuMemory } from '../src/perf/gpuMemory.js';
import { planCast } from '../src/perf/castPlan.js';
import { capTextureSize, configureModelBudget } from '../src/modelLoader.js';

test('GPU strings classify entry phones, software GL and desktop parts', () => {
  assert.equal(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'software');
  assert.equal(classifyGpu('Mali-G52 MC2'), 'low');
  assert.equal(classifyGpu('Adreno (TM) 506'), 'low');
  assert.equal(classifyGpu('PowerVR Rogue GE8320'), 'low');
  assert.equal(classifyGpu('Adreno (TM) 650'), 'mid');
  assert.equal(classifyGpu('Apple GPU'), 'mid');
  assert.equal(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(classifyGpu(''), 'unknown');
});

test('a 2-3 GB phone always starts in the low class', () => {
  // Chrome reports 3 GB devices as 2.
  assert.equal(classifyDevice({ mobile: true, deviceMemory: 2, cores: 8, renderer: 'Adreno (TM) 650' }).tier, 'low');
  assert.equal(classifyDevice({ mobile: true, deviceMemory: 4, cores: 4, renderer: '' }).tier, 'low');
  assert.equal(classifyDevice({ mobile: true, deviceMemory: 8, cores: 8, renderer: 'Adreno (TM) 740' }).tier, 'mid');
  assert.equal(classifyDevice({ mobile: false, deviceMemory: 8, cores: 12, renderer: 'NVIDIA GeForce RTX 3060' }).tier, 'high');
  assert.equal(classifyDevice({ mobile: false, deviceMemory: 8, cores: 8, renderer: 'NVIDIA', benchmarkMs: 60 }).tier, 'low');
  assert.equal(classifyDevice({ mobile: false, deviceMemory: 8, cores: 8, renderer: 'NVIDIA', benchmarkMs: 20 }).tier, 'mid');
});

test('mobile detection prefers client hints, then UA, then pointer', () => {
  assert.equal(isMobileDevice({ userAgentData: { mobile: true }, userAgent: 'X11' }), true);
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true);
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true);
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, () => ({ matches: false })), false);
});

test('device ceilings shrink every budget from high to low', () => {
  const { low, mid, high } = TIER_SETTINGS;
  for (const key of ['maxPixelRatio', 'shadowMapSize', 'crowdScale', 'streetWalkers', 'modelBudgetMB', 'tabBudgetMB', 'interactiveFps']) {
    assert.ok(low[key] <= mid[key] && mid[key] <= high[key], key);
  }
  // PR #22 quality tiers keep their meaning but respect the device ceiling.
  assert.deepEqual(capQualityTier({ id: 'ultra', effects: 2, pixelRatio: 1.5 }, low), { id: 'ultra', effects: 0, pixelRatio: 1 });
  assert.deepEqual(capQualityTier({ id: 'auto', effects: null, pixelRatio: null }, low), { id: 'auto', effects: null, pixelRatio: null });
});

test('frame caps combine device, thermal, user, battery and focus ceilings', () => {
  const device = TIER_SETTINGS.high;
  assert.deepEqual(frameCaps({ device }), { interactiveFps: 45, ambientFps: 24 });
  assert.deepEqual(frameCaps({ device, userCap: 30 }), { interactiveFps: 30, ambientFps: 24 });
  assert.deepEqual(frameCaps({ device, thermal: THERMAL_STEPS[2] }), { interactiveFps: 24, ambientFps: 15 });
  assert.deepEqual(frameCaps({ device, batterySaver: true }), { interactiveFps: 24, ambientFps: 15 });
  assert.deepEqual(frameCaps({ device, focused: false }), { interactiveFps: 45, ambientFps: 20 });
});

test('the thermal governor steps down on sustained drift and back up after calm', () => {
  const governor = new ThermalGovernor({ warmupSeconds: 10, sustainSeconds: 5, recoverSeconds: 20 });
  const run = (seconds, workMs, budgetMs = 33) => {
    let changed = false;
    for (let t = 0; t < seconds; t += 0.05) changed = governor.update(workMs, 0.05, 'step', budgetMs) || changed;
    return changed;
  };
  run(30, 10); // cool baseline
  assert.equal(governor.level, 0);
  run(4, 22); // brief spike: no change
  assert.equal(governor.level, 0);
  assert.equal(run(20, 24), true, 'throttled work at the same step lowers the rate');
  assert.equal(governor.level, 1);
  assert.equal(run(40, 8, 33), true, 'long headroom restores it');
  assert.equal(governor.level, 0);
});

test('a quality change re-learns the baseline instead of reading as throttling', () => {
  const governor = new ThermalGovernor({ warmupSeconds: 5, sustainSeconds: 5 });
  for (let t = 0; t < 20; t += 0.05) governor.update(10, 0.05, 'a', 33);
  for (let t = 0; t < 20; t += 0.05) governor.update(20, 0.05, 'b', 33);
  assert.equal(governor.level, 0);
});

test('memory pressure reads heap ratio and the device budget', () => {
  assert.equal(memoryPressure({ heapUsed: 100, heapLimit: 1000, estimateMB: 200, budgetMB: 420 }), 'none');
  assert.equal(memoryPressure({ heapUsed: 750, heapLimit: 1000 }), 'moderate');
  assert.equal(memoryPressure({ estimateMB: 450, budgetMB: 420 }), 'moderate');
  assert.equal(memoryPressure({ estimateMB: 520, budgetMB: 420 }), 'critical');
  assert.equal(memoryPressure({ heapUsed: 900, heapLimit: 1000 }), 'critical');
});

test('the governor trims at once on escalation, then at most every gap', () => {
  let estimateMB = 300;
  let now = 0;
  const trims = [];
  const governor = new MemoryGovernor({
    budgetMB: 420, sample: () => ({ estimateMB }), trim: (reason) => trims.push(reason), minGapMs: 15000, now: () => now,
  });
  governor.tick();
  assert.deepEqual(trims, []);
  estimateMB = 450; now = 1000; governor.tick();
  estimateMB = 460; now = 6000; governor.tick();
  assert.deepEqual(trims, ['moderate']);
  estimateMB = 600; now = 7000; governor.tick();
  assert.deepEqual(trims, ['moderate', 'critical']);
  estimateMB = 600; now = 30000; governor.tick();
  assert.equal(trims.length, 3);
});

test('GPU byte accounting follows formats, mips, cubes and deletes', () => {
  assert.equal(levelBytes(0x8058, 1024, 1024), 4 * 1024 * 1024); // RGBA8
  assert.equal(levelBytes(0x881a, 16, 16), 16 * 16 * 8); // RGBA16F
  assert.equal(levelBytes(0x93b0, 1024, 1024), 1024 * 1024); // ASTC 4x4: 1 B/px
  assert.equal(levelBytes(0x9274, 1024, 1024), 512 * 1024); // ETC2 RGB: 0.5 B/px
  assert.equal(storageBytes(0x8058, 2, 4, 4, 1, { cube: true }), (64 + 16) * 6);

  let nextId = 1;
  const gl = {
    TEXTURE_2D: 0x0de1,
    createTexture: () => ({ id: nextId++ }),
    activeTexture() {}, bindTexture() {}, texStorage2D() {}, texImage2D() {}, deleteTexture() {},
    compressedTexImage2D() {}, framebufferTexture2D() {}, bindBuffer() {}, bufferData() {}, deleteBuffer() {},
    bindRenderbuffer() {}, renderbufferStorage() {}, deleteRenderbuffer() {},
    drawingBufferWidth: 100, drawingBufferHeight: 50, getContextAttributes: () => ({ antialias: false }),
  };
  const tracker = trackGpuMemory(gl);
  gl.activeTexture(0x84c0);
  const texture = gl.createTexture();
  gl.bindTexture(0x0de1, texture);
  gl.texStorage2D(0x0de1, 11, 0x8c43, 1024, 1024);
  assert.ok(Math.abs(tracker.snapshot().textures - 4 * 1024 * 1024 * 4 / 3) < 64);
  gl.framebufferTexture2D(0x8d40, 0x8ce0, 0x0de1, texture, 0);
  assert.equal(tracker.snapshot().textures, 0);
  assert.ok(tracker.snapshot().renderTargets > 0);
  const buffer = {};
  gl.bindBuffer(0x8892, buffer);
  gl.bufferData(0x8892, new Float32Array(256), 0x88e4);
  assert.equal(tracker.snapshot().buffers, 1024);
  gl.deleteBuffer(buffer);
  gl.deleteTexture(texture);
  const after = tracker.snapshot();
  assert.equal(after.buffers + after.textures + after.renderTargets, 0);
  assert.equal(after.drawingBuffer, 100 * 50 * 8);
});

test('a smaller crowd plans fewer character downloads', () => {
  const catalog = Array.from({ length: 18 }, (_, i) => ({ key: `char_atelier_${i + 1}`, loaded: false }))
    .concat([{ key: 'char_atelier_barista', loaded: false }, { key: 'pet_cat', loaded: false }]);
  const patrons = (keys) => keys.filter((key) => /^char_atelier_\d+$/.test(key)).length;
  const full = planCast(catalog, { id: 'goldenhour', crowd: 16 });
  const small = planCast(catalog, { id: 'goldenhour', crowd: 10 }, { headroom: 7 });
  assert.ok(patrons(small) < patrons(full), `${patrons(small)} < ${patrons(full)}`);
});

test('compressed textures over the cap drop their top mip levels before upload', async () => {
  configureModelBudget({ textureMaxSize: 512, anisotropy: 2 });
  try {
    const mip = (size) => ({ width: size, height: size, data: new Uint8Array((size / 4) ** 2 * 16) });
    const texture = new THREE.CompressedTexture([mip(2048), mip(1024), mip(512), mip(256)], 2048, 2048, THREE.RGBA_ASTC_4x4_Format);
    await capTextureSize(texture);
    assert.equal(texture.mipmaps.length, 2);
    assert.equal(texture.image.width, 512);
    // RGBA8 fallback (no supported block format) gets half the edge.
    const fallback = new THREE.CompressedTexture([mip(1024), mip(512), mip(256)], 1024, 1024, THREE.RGBAFormat);
    await capTextureSize(fallback);
    assert.equal(fallback.image.width, 256);
  } finally {
    configureModelBudget();
  }
});
