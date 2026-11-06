// The single graphics-quality setting shared by the settings menu, the
// renderer and anything else that scales with GPU budget. Tier ids are the
// values persisted as `qualityMode` (the legacy 'smooth'/'detail' ids keep
// existing saved preferences and audit tooling valid).
//
// Subscribe with `onQualityTierChange(fn)` or listen for the
// `vibe:quality-tier` window event ({ detail: { tier, config } }).

export const QUALITY_TIERS = Object.freeze([
  Object.freeze({
    id: 'auto', label: 'Auto',
    description: 'Adapts effects and resolution to keep the café smooth on this device.',
    effects: null, pixelRatio: null,
  }),
  Object.freeze({
    id: 'smooth', label: 'Performance',
    description: 'Direct lighting at reduced resolution. Coolest and quietest for long sessions.',
    effects: 0, pixelRatio: 0.8,
  }),
  Object.freeze({
    id: 'balanced', label: 'Balanced',
    description: 'Native resolution with soft contact shadows.',
    effects: 1, pixelRatio: 1,
  }),
  Object.freeze({
    id: 'detail', label: 'Quality',
    description: 'Contact shadows, lamp bloom and light supersampling.',
    effects: 2, pixelRatio: 1.25,
  }),
  Object.freeze({
    id: 'ultra', label: 'Ultra',
    description: 'Every effect at the sharpest resolution this display supports.',
    effects: 2, pixelRatio: 1.5,
  }),
]);

export const QUALITY_TIER_IDS = Object.freeze(QUALITY_TIERS.map((tier) => tier.id));
export const DEFAULT_QUALITY_TIER = 'auto';

export function isQualityTier(id) {
  return QUALITY_TIER_IDS.includes(id);
}

export function qualityTierConfig(id) {
  return QUALITY_TIERS.find((tier) => tier.id === id) ?? QUALITY_TIERS[0];
}

let current = DEFAULT_QUALITY_TIER;
const listeners = new Set();

export function getQualityTier() {
  return current;
}

// Sets the starting tier (e.g. from saved preferences) without notifying.
export function initQualityTier(id) {
  current = isQualityTier(id) ? id : DEFAULT_QUALITY_TIER;
  return current;
}

export function setQualityTier(id) {
  if (!isQualityTier(id) || id === current) return false;
  current = id;
  for (const listener of listeners) listener(id, qualityTierConfig(id));
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('vibe:quality-tier', {
      detail: { tier: id, config: qualityTierConfig(id) },
    }));
  }
  return true;
}

export function onQualityTierChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
