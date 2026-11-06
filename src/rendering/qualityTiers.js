// Rendering quality tiers. This module is plain data plus detection so other
// workstreams (performance, UI, assets) can read the active budget without
// pulling in Three.js: `renderQuality.config` is always the live tier object.
//
// Each effect scales independently. `effectLevel` keeps the older 0..2 scale
// that cafe.setQuality / crowd.setQuality understand (point-light budget,
// steam cadence, street detail).

export const TIER_NAMES = Object.freeze(['low', 'medium', 'high', 'ultra']);

// Persisted `qualityMode` ids used by preferences and the settings UI
// ('smooth'/'detail' predate tiers and stay valid in saved preferences).
export const TIER_ALIASES = Object.freeze({ smooth: 'low', balanced: 'medium', detail: 'high' });

export function resolveTierName(id) {
  const name = TIER_ALIASES[id] ?? id;
  return TIER_NAMES.includes(name) ? name : null;
}

const TIERS = {
  low: {
    name: 'low',
    effectLevel: 0,
    maxPixelRatio: 0.8,
    // Direct-to-canvas forward render with the renderer's own tone mapping:
    // the cheapest path, identical in cost to the original "smooth" mode.
    post: false,
    msaa: 0,
    antialias: 'none',
    ao: null,
    bloom: null,
    godRays: null,
    dof: null,
    grade: true,
    grain: 0,
    chromaticAberration: 0,
    shadows: { mapSize: 1024, filter: 'pcf', radius: 1.5, updateHz: 8 },
    probe: null,
  },
  medium: {
    name: 'medium',
    effectLevel: 0,
    maxPixelRatio: 1,
    post: true,
    msaa: 0,
    antialias: 'fxaa',
    // Quarter-area AO reconstructed from the main pass's depth buffer: no
    // normal or depth pre-pass, so the scene is still drawn exactly once.
    // Its denoise happens in the composite's depth-aware upsample: on
    // software rasterizers every extra full-screen pass costs thread syncs.
    ao: { scale: 0.5, samples: 6, radius: 0.32, intensity: 0.85, blur: false },
    bloom: { levels: 3, scale: 0.5 },
    godRays: null,
    dof: null,
    grade: true,
    grain: 0.012,
    chromaticAberration: 0,
    shadows: { mapSize: 2048, filter: 'pcf', radius: 1.6, updateHz: 8 },
    probe: { size: 96 },
  },
  high: {
    name: 'high',
    effectLevel: 1,
    maxPixelRatio: 1.25,
    post: true,
    msaa: 0,
    antialias: 'smaa',
    ao: { scale: 0.5, samples: 12, radius: 0.36, intensity: 1, blur: true },
    bloom: { levels: 5, scale: 0.5 },
    godRays: { scale: 0.25, samples: 40 },
    dof: { maxBlur: 5 },
    grade: true,
    grain: 0.02,
    chromaticAberration: 0.0012,
    shadows: { mapSize: 2048, filter: 'pcss', radius: 1, updateHz: 12 },
    probe: { size: 128 },
  },
  ultra: {
    name: 'ultra',
    effectLevel: 2,
    maxPixelRatio: 1.5,
    post: true,
    msaa: 4,
    antialias: 'smaa',
    ao: { scale: 1, samples: 16, radius: 0.4, intensity: 1, blur: true },
    bloom: { levels: 6, scale: 0.5 },
    godRays: { scale: 0.5, samples: 64 },
    dof: { maxBlur: 7 },
    grade: true,
    grain: 0.022,
    chromaticAberration: 0.0016,
    shadows: { mapSize: 4096, filter: 'pcss', radius: 1, updateHz: 20 },
    probe: { size: 192 },
  },
};

for (const tier of Object.values(TIERS)) Object.freeze(tier);
export const QUALITY_TIERS = Object.freeze(TIERS);

export function tierConfig(name) {
  return QUALITY_TIERS[resolveTierName(name)] ?? QUALITY_TIERS.medium;
}

export function tierIndex(name) {
  const index = TIER_NAMES.indexOf(resolveTierName(name));
  return index < 0 ? 1 : index;
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;
const MOBILE_GPU = /adreno|mali|powervr|apple gpu|videocore|tegra/i;
const DISCRETE_GPU = /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|rx \d{3,4}|arc a\d/i;
const HIGH_END_GPU = /rtx ?[2-5]0\d0|rx ?[6-9]\d{3}|apple m\d (pro|max|ultra)|arc a7/i;
const APPLE_SILICON = /apple m\d/i;

// Picks the highest tier Auto may use. The adaptive loop in main.js can still
// step down from here when measured frame time misses its budget. Auto stops
// at 'high' (this is an all-day ambient app, so thermals matter); 'ultra' is
// always an explicit choice.
export function detectAutoTier({
  gpu = '', mobile = false, deviceMemory = 8, cores = 8, screenPixels = 1920 * 1080,
} = {}) {
  if (SOFTWARE_GL.test(gpu)) return 'low';
  if (mobile || MOBILE_GPU.test(gpu)) return deviceMemory >= 6 && cores >= 8 ? 'medium' : 'low';
  if (deviceMemory <= 2 || cores <= 2) return 'low';
  if (HIGH_END_GPU.test(gpu)) return 'high';
  if (!DISCRETE_GPU.test(gpu) && !APPLE_SILICON.test(gpu)) return 'medium';
  // mid-range GPUs driving a 4K panel spend their budget on pixels
  return screenPixels > 3840 * 2160 * 0.9 ? 'medium' : 'high';
}

export function readGpuInfo(gl) {
  if (!gl) return '';
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(renderer ?? '');
}

// `?quality=low|medium|high|ultra` (or a persisted alias) pins a tier for
// audits and screenshots.
export function qualityOverrideFromUrl(search = '') {
  return resolveTierName(new URLSearchParams(search).get('quality'));
}

// Shared, observable selection. `mode` is the user's choice ('auto' or a
// tier); `tier` is what is actually rendering right now.
export function createQualityState(initialTier = 'medium') {
  const listeners = new Set();
  const state = {
    mode: 'auto',
    autoTier: initialTier,
    tier: initialTier,
    get config() { return tierConfig(state.tier); },
    setTier(name) {
      const next = resolveTierName(name) ?? 'medium';
      if (next === state.tier) return false;
      state.tier = next;
      listeners.forEach((listener) => listener(state.config));
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return state;
}

export const renderQuality = createQualityState();
