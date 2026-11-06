// Private generators for the physics layer. The seeded audits replace the
// global Math.random, so any extra draws from it would reshuffle the audited
// crowd and props; cosmetic jitter here never touches that sequence.
export function createRandom(seed = 0x2545f491) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
