// Chooses which character models a café actually needs, so only those are
// downloaded. The crowd allocates every guest, street walker and pair from
// its pool with at most MAX_CHARACTER_COPIES of each asset, so the pool only
// has to cover the café's peak population, not the whole cast.
import { MAX_CHARACTER_COPIES } from '../sim/characterAllocator.js';

export const STAFF_KEYS = ['char_atelier_barista', 'char_atelier_server'];
export const PET_KEYS = ['pet_cat', 'pet_dog'];
// Street walkers plus pairs/arrivals on top of the room's own crowd size.
const POPULATION_HEADROOM = 10;

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

/**
 * @param catalog  [{ key, loaded }] from modelLoader.castCatalog()
 * @param theme    café theme ({ id, crowd })
 * @returns ordered keys: staff, then patrons (already resident first), then pets
 */
export function planCast(catalog, theme) {
  const available = new Map(catalog.map((entry) => [entry.key, entry.loaded]));
  const patrons = catalog
    .map((entry) => entry.key)
    .filter((key) => key.startsWith('char_') && !STAFF_KEYS.includes(key) && !key.startsWith('char_hero_'));
  const crowd = theme?.crowd ?? 9;
  const count = Math.min(patrons.length, Math.ceil((crowd + POPULATION_HEADROOM) / MAX_CHARACTER_COPIES));
  // Deterministic per café (so revisits reuse what is cached) but varied
  // between cafés; resident models are always preferred.
  const offset = stableHash(theme?.id ?? '') % Math.max(1, patrons.length);
  const rotated = [...patrons.slice(offset), ...patrons.slice(0, offset)];
  rotated.sort((a, b) => Number(available.get(b)) - Number(available.get(a)));
  const chosen = rotated.slice(0, count);
  return [
    ...STAFF_KEYS.filter((key) => available.has(key)),
    ...chosen,
    ...PET_KEYS.filter((key) => available.has(key)),
  ];
}
