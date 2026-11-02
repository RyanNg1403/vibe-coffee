// One allocation pool for the whole visible world, including staff and street.
export const MAX_CHARACTER_COPIES = 2;
export const PROCEDURAL_CHARACTER_ASSET = 'procedural_person';

export class CharacterAllocator {
  constructor(keys, random = Math.random) {
    this.keys = new Set(keys);
    this.random = random;
    this.counts = new Map([...this.keys].map(key => [key, 0]));
    this.leases = new Set();
    this.lastKey = null;
  }

  available(pool = this.keys) {
    return [...new Set(pool)].reduce((sum, key) => sum
      + (this.keys.has(key) ? MAX_CHARACTER_COPIES - this.counts.get(key) : 0), 0);
  }

  reserve(pool = this.keys) {
    const candidates = [...new Set(pool)].filter(key => this.keys.has(key)
      && this.counts.get(key) < MAX_CHARACTER_COPIES);
    if (!candidates.length) return null;
    const leastUsed = Math.min(...candidates.map(key => this.counts.get(key)));
    let choices = candidates.filter(key => this.counts.get(key) === leastUsed);
    if (choices.length > 1) choices = choices.filter(key => key !== this.lastKey);
    const key = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    const lease = Object.freeze({ key });
    this.leases.add(lease);
    this.counts.set(key, this.counts.get(key) + 1);
    this.lastKey = key;
    return lease;
  }

  // Pairs either receive both slots or consume none. No half-created guests.
  reserveMany(pool, count) {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('Invalid character count');
    if (this.available(pool) < count) return null;
    return Array.from({ length: count }, () => this.reserve(pool));
  }

  release(lease) {
    if (!this.leases.delete(lease)) return false;
    this.counts.set(lease.key, this.counts.get(lease.key) - 1);
    return true;
  }

  snapshot() {
    return Object.fromEntries([...this.counts].filter(([, count]) => count > 0));
  }
}

// A doorway handoff briefly has two actor wrappers for one mesh. Count that
// person once, using the actual displayed asset rather than a wardrobe label.
export function countCharacterAssets(actors) {
  const seen = new Set();
  const counts = {};
  for (const actor of actors) {
    const root = actor?.mesh;
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const key = actor.avatar?.key ?? root.userData?.characterLease?.key ?? PROCEDURAL_CHARACTER_ASSET;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
