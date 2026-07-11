// Raycast registry for the handful of world objects that respond to pointer
// input (the player's laptop, pets — never every prop). The main pointer flow
// asks this registry first and only lets a registered target claim the click
// when it is nearer than the seat the ray would otherwise select, so chair
// picking keeps working exactly as before when nothing is registered.
//
// Kept free of Three.js imports: it only relies on `.parent` chains and the
// raycaster interface, which keeps the arbitration unit-testable in Node.

// Walks intersections (already sorted nearest-first by the raycaster) and
// returns the first one that belongs to a registered root, resolved through
// the object's parent chain.
export function resolveRegisteredHit(hits, entryFor) {
  for (const hit of hits) {
    const entry = entryFor(hit.object);
    if (entry) return { entry, distance: hit.distance, point: hit.point, object: hit.object };
  }
  return null;
}

export class WorldInteractions {
  constructor() {
    this.entries = new Map(); // root object -> entry
    this._roots = [];         // cached for raycasting without per-pick allocation
    this._hits = [];          // reusable intersection scratch array
    this._hovered = null;
  }

  register(root, { onClick = null, onHover = null, cursor = 'pointer', cooldownMs = 0 } = {}) {
    if (!root) return null;
    const entry = { root, onClick, onHover, cursor, cooldownMs, lastClickAt: -Infinity };
    this.entries.set(root, entry);
    this._roots = [...this.entries.keys()];
    return entry;
  }

  unregister(root) {
    const entry = this.entries.get(root);
    if (!entry) return false;
    if (this._hovered === entry) this._setHovered(null);
    this.entries.delete(root);
    this._roots = [...this.entries.keys()];
    return true;
  }

  clear() {
    this._setHovered(null);
    this.entries.clear();
    this._roots = [];
  }

  get size() { return this.entries.size; }

  _entryFor(object) {
    let node = object;
    while (node) {
      const entry = this.entries.get(node);
      if (entry) return entry;
      node = node.parent;
    }
    return null;
  }

  // Nearest registered target under the ray, or null. The caller compares the
  // returned distance against its seat hit to arbitrate who owns the click.
  pick(raycaster) {
    if (!this.entries.size) return null;
    this._hits.length = 0;
    raycaster.intersectObjects(this._roots, true, this._hits);
    const hit = resolveRegisteredHit(this._hits, (object) => this._entryFor(object));
    this._hits.length = 0;
    return hit;
  }

  // Dispatches a click on a picked hit, honouring the target's cooldown.
  // Returns true when consumed (even while cooling down: the pointer was on an
  // interactive object, so the click must not fall through and move the seat).
  click(hit, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const entry = hit?.entry;
    if (!entry || !this.entries.has(entry.root)) return false;
    if (now - entry.lastClickAt >= entry.cooldownMs) {
      entry.lastClickAt = now;
      entry.onClick?.(hit);
    }
    return true;
  }

  // Hover transition bookkeeping; pass null when the pointer leaves all
  // registered targets. Returns the cursor the canvas should show.
  hover(hit) {
    this._setHovered(hit?.entry ?? null);
    return this._hovered?.cursor ?? null;
  }

  _setHovered(entry) {
    if (this._hovered === entry) return;
    this._hovered?.onHover?.(false);
    this._hovered = entry;
    this._hovered?.onHover?.(true);
  }
}
