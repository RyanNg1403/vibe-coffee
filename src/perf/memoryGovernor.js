// Keeps the tab inside the device class's memory budget.
//
// Every few seconds it samples a cheap footprint estimate (JS heap where
// Chrome exposes it, plus video memory from the WebGL call stream and the
// resident model library) and asks the app to trim when the heap nears its
// limit or the estimate exceeds the budget. A tab hidden for a while is
// trimmed too: on phones, background tabs are the first the OS kills.

export function memoryPressure({ heapUsed = null, heapLimit = null, estimateMB = null, budgetMB = Infinity } = {}) {
  const heapRatio = heapUsed && heapLimit ? heapUsed / heapLimit : 0;
  const budgetRatio = estimateMB !== null && Number.isFinite(budgetMB) && budgetMB > 0 ? estimateMB / budgetMB : 0;
  if (heapRatio > 0.85 || budgetRatio > 1.2) return 'critical';
  if (heapRatio > 0.7 || budgetRatio > 1) return 'moderate';
  return 'none';
}

const RANK = { none: 0, moderate: 1, hidden: 1, critical: 2 };

export class MemoryGovernor {
  /**
   * @param sample () => { heapUsed, heapLimit, estimateMB }
   * @param trim   (reason: 'moderate'|'critical'|'hidden') => void
   * @param idle   () => void, every tick (release idle workers and the like)
   */
  constructor({ budgetMB, sample, trim, idle = () => {}, intervalMs = 5000, hiddenTrimMs = 20000, minGapMs = 15000, now = () => performance.now() }) {
    Object.assign(this, { budgetMB, sample, trim, idle, intervalMs, hiddenTrimMs, minGapMs, now });
    this.pressure = 'none';
    this.trims = 0;
    this.lastTrim = null;
    this._lastTrimAt = -Infinity;
    this._lastRank = 0;
    this._timer = null;
    this._hiddenTimer = null;
    this._onVisibility = () => this.visibilityChanged(document.hidden);
  }

  start() {
    this._timer = setInterval(() => this.tick(), this.intervalMs);
    document.addEventListener('visibilitychange', this._onVisibility);
    return this;
  }

  tick() {
    const sample = this.sample();
    this.estimateMB = sample.estimateMB;
    this.pressure = memoryPressure({ ...sample, budgetMB: this.budgetMB });
    const rank = RANK[this.pressure];
    const now = this.now();
    // Trim on escalation at once, otherwise at most every minGapMs.
    if (rank > 0 && (rank > this._lastRank || now - this._lastTrimAt >= this.minGapMs)) this._trim(this.pressure, now);
    this._lastRank = rank;
    this.idle();
  }

  visibilityChanged(hidden) {
    clearTimeout(this._hiddenTimer);
    this._hiddenTimer = null;
    if (hidden) this._hiddenTimer = setTimeout(() => this._trim('hidden', this.now()), this.hiddenTrimMs);
  }

  trimNow(reason = 'moderate') { this._trim(reason, this.now()); }

  _trim(reason, now) {
    this._lastTrimAt = now;
    this.trims += 1;
    this.lastTrim = reason;
    this.trim(reason);
  }

  snapshot() {
    return { pressure: this.pressure, estimateMB: this.estimateMB ?? null, budgetMB: this.budgetMB, trims: this.trims, lastTrim: this.lastTrim };
  }

  dispose() {
    clearInterval(this._timer);
    clearTimeout(this._hiddenTimer);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }
}
