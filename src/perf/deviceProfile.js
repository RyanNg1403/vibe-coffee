// Device class detection and the conservative budgets each class starts with.
//
// Signals: mobile (UA client hints, coarse pointer, touch-only UA),
// navigator.deviceMemory (Chrome buckets: 0.25-8 GB; 3 GB phones report 2),
// hardwareConcurrency, the unmasked GPU renderer string, and a ~100 ms GPU
// micro-benchmark (cached per renderer). The class only lowers ceilings: the
// adaptive controller still trims resolution from measured frame time, and
// the user's quality tier (src/qualityTier.js, PR #22) is applied within
// these caps (see capQualityTier).
//
// URL override for testing: ?tier=low|mid|high.

export const DEVICE_TIERS = ['low', 'mid', 'high'];

// Per class: render resolution caps (device-pixel multipliers of CSS px),
// shadow map, effects ceiling for Auto, scene population, texture/memory
// budgets and frame pacing.
export const TIER_SETTINGS = Object.freeze({
  low: Object.freeze({
    maxPixelRatio: 1,
    autoStartPixelRatio: 0.75,
    autoMaxPixelRatio: 0.85,
    minPixelRatio: 0.5,
    shadowMapSize: 1024,
    softShadows: false,
    maxEffectLevel: 0,
    maxManualEffectLevel: 0,
    maxPointLights: 4,
    actorShadowRange: 7,
    crowdScale: 0.6,
    streetWalkers: 5,
    smallShadowCasterRadius: 0.16,
    textureMaxSize: 1024,
    anisotropy: 2,
    modelBudgetMB: 0,
    backgroundPrefetch: false,
    tabBudgetMB: 420,
    interactiveFps: 30,
    ambientFps: 20,
  }),
  mid: Object.freeze({
    maxPixelRatio: 1.25,
    autoStartPixelRatio: 0.9,
    autoMaxPixelRatio: 1,
    minPixelRatio: 0.5,
    shadowMapSize: 1536,
    softShadows: true,
    maxEffectLevel: 0,
    maxManualEffectLevel: 1,
    maxPointLights: 6,
    actorShadowRange: 12,
    crowdScale: 0.8,
    streetWalkers: 6,
    smallShadowCasterRadius: 0.08,
    textureMaxSize: 2048,
    anisotropy: 4,
    modelBudgetMB: 96,
    backgroundPrefetch: false,
    tabBudgetMB: 800,
    interactiveFps: 40,
    ambientFps: 24,
  }),
  high: Object.freeze({
    maxPixelRatio: 1.25,
    autoStartPixelRatio: 1,
    autoMaxPixelRatio: 1,
    minPixelRatio: 0.5,
    shadowMapSize: 2048,
    softShadows: true,
    maxEffectLevel: 0,
    maxManualEffectLevel: 2,
    maxPointLights: Infinity,
    actorShadowRange: Infinity,
    crowdScale: 1,
    streetWalkers: 8,
    smallShadowCasterRadius: 0,
    textureMaxSize: Infinity,
    anisotropy: 8,
    modelBudgetMB: 320,
    backgroundPrefetch: true,
    tabBudgetMB: 1600,
    interactiveFps: 45,
    ambientFps: 24,
  }),
});

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
// Entry-level mobile GPUs and old integrated graphics.
const LOW_GPU = /mali-(?:4\d\d|t\d+|g(?:31|51|52|57|68))\b|adreno\D*(?:[2-5]\d\d|6[01]\d)\b|powervr|ge8\d{3}|gt7\d{3}|intel.*hd graphics (?:[2-5]\d{2,3}|\d{3})\b|videocore/i;
const MID_GPU = /mali-g(?:7\d|6[1-9]|7\d\d|6\d\d)|adreno\D*(?:6[2-9]\d|7\d\d)|apple gpu|xclipse|immortalis|intel.*(?:uhd|iris)/i;

export function isMobileDevice(nav = globalThis.navigator, match = globalThis.matchMedia) {
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  const ua = nav.userAgent ?? '';
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return true;
  // iPadOS reports a Mac UA; touch points give it away.
  if (/macintosh/i.test(ua) && nav.maxTouchPoints > 1) return true;
  return !!match?.('(pointer: coarse)')?.matches && !match?.('(pointer: fine)')?.matches;
}

export function gpuRendererString(gl) {
  if (!gl) return '';
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

export function classifyGpu(renderer) {
  if (!renderer) return 'unknown';
  if (SOFTWARE_GPU.test(renderer)) return 'software';
  if (LOW_GPU.test(renderer)) return 'low';
  if (MID_GPU.test(renderer)) return 'mid';
  return 'high';
}

/**
 * Pure classification, testable without a browser.
 * @param signals { mobile, deviceMemory, cores, renderer, benchmarkMs }
 */
export function classifyDevice({ mobile = false, deviceMemory = null, cores = null, renderer = '', benchmarkMs = null } = {}) {
  const reasons = [];
  const gpu = classifyGpu(renderer);
  let tier = mobile ? 'mid' : 'high';
  if (mobile) reasons.push('mobile');
  const lower = (to, reason) => {
    if (DEVICE_TIERS.indexOf(to) < DEVICE_TIERS.indexOf(tier)) tier = to;
    reasons.push(reason);
  };
  if (gpu === 'software') lower('low', 'software GL');
  else if (gpu === 'low') lower('low', 'entry-level GPU');
  else if (gpu === 'mid') lower('mid', 'mid-range GPU');
  if (deviceMemory !== null && deviceMemory <= 2) lower('low', `${deviceMemory} GB RAM`);
  else if (deviceMemory !== null && deviceMemory <= 4) lower('mid', `${deviceMemory} GB RAM`);
  if (cores !== null && cores <= 2) lower('low', `${cores} cores`);
  else if (mobile && cores !== null && cores <= 4) lower('low', `${cores} cores (mobile)`);
  else if (cores !== null && cores <= 4) lower('mid', `${cores} cores`);
  if (benchmarkMs !== null) {
    if (benchmarkMs > 45) lower('low', `GPU benchmark ${benchmarkMs.toFixed(0)} ms`);
    else if (benchmarkMs > 14) lower('mid', `GPU benchmark ${benchmarkMs.toFixed(0)} ms`);
  }
  return { tier, gpu, reasons };
}

const BENCH_VERTEX = `#version 300 es
in vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const BENCH_FRAGMENT = `#version 300 es
precision highp float; in vec2 uv; uniform float seed; out vec4 color;
void main() {
  vec3 c = vec3(uv, seed);
  for (int i = 0; i < 48; i++) c = fract(sin(c.yzx * 12.9898 + c * 78.233) * 43758.5453) * 0.9 + c * 0.1;
  color = vec4(c, 1.0);
}`;
const BENCH_CACHE_KEY = 'vibe-coffee.gpu-bench.v1';

// Draws a fragment-heavy shader into a separate 256² context (so the app's
// own GL state is untouched) and times it to completion. Roughly: desktop
// GPUs < 3 ms, mid phones 5-14 ms, entry phones and software GL far above.
export function quickGpuBenchmark({ renderer = '', storage = globalThis.localStorage } = {}) {
  try {
    const cached = JSON.parse(storage?.getItem(BENCH_CACHE_KEY) ?? 'null');
    if (cached?.renderer === renderer && Number.isFinite(cached.ms)) return cached.ms;
  } catch { /* storage unavailable */ }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return null;
  let ms = null;
  try {
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, BENCH_VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, BENCH_FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const seed = gl.getUniformLocation(program, 'seed');
    const pixel = new Uint8Array(4);
    const draw = (passes) => {
      for (let i = 0; i < passes; i += 1) {
        gl.uniform1f(seed, i / passes);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    };
    draw(1); // warm-up: driver compiles lazily
    const started = performance.now();
    draw(8);
    ms = performance.now() - started;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  try { storage?.setItem(BENCH_CACHE_KEY, JSON.stringify({ renderer, ms })); } catch { /* storage unavailable */ }
  return ms;
}

export function detectDeviceProfile({
  gl = null,
  nav = globalThis.navigator,
  params = new URLSearchParams(globalThis.location?.search ?? ''),
  benchmark = true,
  // Used instead of detection when no ?tier is given (comparable audits).
  defaultTier = null,
} = {}) {
  if (DEVICE_TIERS.includes(defaultTier) && !DEVICE_TIERS.includes(params.get('tier'))) {
    params = new URLSearchParams(params);
    params.set('tier', defaultTier);
  }
  const renderer = gpuRendererString(gl);
  const signals = {
    mobile: isMobileDevice(nav),
    deviceMemory: Number.isFinite(nav?.deviceMemory) ? nav.deviceMemory : null,
    cores: Number.isFinite(nav?.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    renderer,
    benchmarkMs: null,
  };
  // The benchmark only refines an otherwise capable-looking device.
  const provisional = classifyDevice(signals);
  if (benchmark && provisional.tier !== 'low') signals.benchmarkMs = quickGpuBenchmark({ renderer });
  const result = classifyDevice(signals);
  const forced = params.get('tier');
  if (DEVICE_TIERS.includes(forced)) {
    result.tier = forced;
    result.reasons.push('forced by ?tier');
  }
  return {
    ...signals,
    ...result,
    settings: TIER_SETTINGS[result.tier],
  };
}

// Applies the device's ceilings to a quality-tier config from
// src/qualityTier.js ({ effects, pixelRatio }, null meaning adaptive), so a
// manual "Ultra" on an entry phone still respects its resolution and effect
// budget.
export function capQualityTier(config, settings) {
  if (!config) return config;
  return {
    ...config,
    effects: config.effects === null ? null : Math.min(config.effects, settings.maxManualEffectLevel),
    pixelRatio: config.pixelRatio === null ? null : Math.min(config.pixelRatio, settings.maxPixelRatio),
  };
}
