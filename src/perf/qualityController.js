// Frame-time driven dynamic quality scaling.
//
// The controller never touches the renderer directly. It walks an ordered
// ladder of { tier, scale } steps and reports changes through a small target
// interface, so any subsystem that exposes discrete quality tiers (the
// rendering pipeline, post-processing, shadows) can be driven by it:
//
//   QualityTarget = {
//     tierCount: number,               // tiers are 0 (cheapest) .. tierCount - 1
//     getTier(): number,
//     setTier(tier: number): void,
//     // optional render-resolution knob (device-pixel multiplier)
//     getRenderScale?(): number,
//     setRenderScale?(scale: number): void,
//   }
//
// The ladder is ordered from cheapest (index 0) to richest. Resolution is the
// fast, cheap knob; tiers change shader programs or allocate buffers, so the
// ladder prefers trading resolution near the top and only changes tiers when
// a whole resolution band is exhausted.

export function buildQualityLadder({
  tierCount = 1,
  minTier = 0,
  maxTier = tierCount - 1,
  // Resolution bands, richest first. The first entry is the native scale used
  // with every tier; later entries are only used at the lowest tier.
  scales = [1],
  // Scales that may be combined with tiers above minTier (cheap supersampling
  // trims before giving up post effects).
  tierScales = scales.slice(0, 2),
} = {}) {
  const steps = [];
  const lowTierScales = [...scales].sort((a, b) => a - b);
  for (const scale of lowTierScales) steps.push({ tier: minTier, scale });
  for (let tier = minTier + 1; tier <= maxTier; tier += 1) {
    for (const scale of [...tierScales].sort((a, b) => a - b)) steps.push({ tier, scale });
  }
  // De-duplicate while keeping order (identical bands collapse).
  const seen = new Set();
  return steps.filter(({ tier, scale }) => {
    const key = `${tier}@${scale}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function nearestStep(ladder, tier, scale) {
  let best = 0;
  let bestScore = Infinity;
  ladder.forEach((step, index) => {
    const score = Math.abs(step.tier - tier) * 10 + Math.abs(step.scale - scale);
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

// Mean of the lower (1 - trim) share. A mean (not a median) is needed because
// a frame cap on a fixed-refresh display alternates short and long intervals
// (24 fps on 60 Hz renders at 50/33 ms); trimming drops isolated GC or decode
// spikes that say nothing about sustained cost.
export function trimmedMean(values, trim = 0.1) {
  const sorted = [...values].sort((a, b) => a - b);
  const keep = Math.max(1, Math.ceil(sorted.length * (1 - trim)));
  let sum = 0;
  for (let i = 0; i < keep; i += 1) sum += sorted[i];
  return sum / keep;
}

export class AdaptiveQualityController {
  constructor(target, {
    ladder = buildQualityLadder({ tierCount: target.tierCount }),
    // Over-budget ratio that triggers a downgrade, and the ratio under which
    // the frame budget is considered met.
    degradeRatio = 1.18,
    upgradeRatio = 1.05,
    // GPU (or CPU work) time below this share of the budget proves headroom.
    headroomRatio = 0.62,
    sampleSeconds = 2.5,
    minSamples = 3,
    degradeCooldown = 4,
    upgradeCooldown = 12,
    // A step that failed right after an upgrade waits this much longer before
    // it is probed again; it doubles on every repeated failure.
    failurePenalty = 30,
    maxFailurePenalty = 480,
    stallSeconds = 2,
    startStep = null,
  } = {}) {
    this.stallSeconds = stallSeconds;
    this.target = target;
    this.ladder = ladder;
    this.degradeRatio = degradeRatio;
    this.upgradeRatio = upgradeRatio;
    this.headroomRatio = headroomRatio;
    this.sampleSeconds = sampleSeconds;
    this.minSamples = minSamples;
    this.degradeCooldown = degradeCooldown;
    this.upgradeCooldown = upgradeCooldown;
    this.failurePenalty = failurePenalty;
    this.maxFailurePenalty = maxFailurePenalty;
    this.enabled = true;
    this.cooldown = 0;
    this.clock = 0;
    this.lastUpgradeAt = -Infinity;
    this.blockedUntil = new Map();
    this.penalties = new Map();
    this.history = [];
    this._frames = [];
    this._work = [];
    this._sampleTime = 0;
    this._longFrames = 0;
    this.step = startStep ?? nearestStep(ladder, target.getTier?.() ?? 0, target.getRenderScale?.() ?? 1);
  }

  get current() { return this.ladder[this.step]; }

  reset() {
    this._frames.length = 0;
    this._work.length = 0;
    this._sampleTime = 0;
  }

  // Re-anchor to externally applied settings (manual quality modes).
  sync() {
    this.step = nearestStep(this.ladder, this.target.getTier?.() ?? 0, this.target.getRenderScale?.() ?? 1);
    this.reset();
  }

  apply(stepIndex, reason) {
    const index = Math.max(0, Math.min(this.ladder.length - 1, stepIndex));
    if (index === this.step) return false;
    const from = this.ladder[this.step];
    const to = this.ladder[index];
    this.step = index;
    if (to.tier !== this.target.getTier?.()) this.target.setTier(to.tier);
    if (this.target.setRenderScale && Math.abs((this.target.getRenderScale?.() ?? 0) - to.scale) > 1e-3) {
      this.target.setRenderScale(to.scale);
    }
    this.history.push({ at: Number(this.clock.toFixed(2)), from, to, reason });
    if (this.history.length > 24) this.history.shift();
    return true;
  }

  /**
   * Feed one rendered frame.
   * @param frameSeconds wall time since the previous rendered frame
   * @param targetFps    the frame rate the scheduler is aiming for
   * @param workMs       optional measured render work (GPU timer, or CPU)
   * @returns the new ladder step when it changed, otherwise null
   */
  update(frameSeconds, targetFps, workMs = null) {
    if (!this.enabled || !(frameSeconds > 0) || !(targetFps > 0)) return null;
    this.clock += frameSeconds;
    // An isolated multi-second frame (breakpoint, blocked main thread) says
    // nothing about steady-state cost: drop that sample but keep the window.
    // Consecutive long frames are a genuinely slow device and must count.
    // Hidden tabs and scene holds reset explicitly.
    if (frameSeconds > this.stallSeconds) {
      this._longFrames += 1;
      if (this._longFrames < 2) return null;
    } else {
      this._longFrames = 0;
    }
    this.cooldown = Math.max(0, this.cooldown - frameSeconds);
    // Budget-relative samples: the scheduler switches between interactive and
    // ambient frame rates, so raw milliseconds from both cannot be pooled.
    this._frames.push(frameSeconds * targetFps);
    if (Number.isFinite(workMs)) this._work.push((workMs * targetFps) / 1000);
    this._sampleTime += frameSeconds;
    if (this._sampleTime < this.sampleSeconds || this._frames.length < this.minSamples) return null;

    const ratio = trimmedMean(this._frames);
    const workRatio = this._work.length >= this.minSamples ? trimmedMean(this._work) : null;
    this.reset();

    const percent = `${Math.round(ratio * 100)}% of frame budget`;
    let changed = false;
    if (ratio > this.degradeRatio) {
      // A frame far over budget drops several steps at once: pixel cost
      // scales with the square of resolution, so waiting a sample window per
      // step would leave a slow device stuttering for half a minute.
      const drop = ratio > 3 ? 3 : ratio > 1.8 ? 2 : 1;
      if (this.clock - this.lastUpgradeAt < this.sampleSeconds * 2.5) {
        const failed = this.step;
        const penalty = Math.min(this.maxFailurePenalty, (this.penalties.get(failed) ?? this.failurePenalty / 2) * 2);
        this.penalties.set(failed, penalty);
        this.blockedUntil.set(failed, this.clock + penalty);
      }
      changed = this.apply(this.step - drop, `over budget: ${percent}`);
      this.cooldown = this.degradeCooldown;
    } else if (ratio < this.upgradeRatio && this.cooldown <= 0 && this.step < this.ladder.length - 1) {
      const next = this.step + 1;
      const blocked = (this.blockedUntil.get(next) ?? -Infinity) > this.clock;
      // When work timing exists, require real headroom; otherwise probe and
      // let the failure memory learn the ceiling.
      const headroom = workRatio === null || workRatio < this.headroomRatio;
      if (!blocked && headroom) {
        changed = this.apply(next, `headroom: ${percent}`);
        if (changed) {
          this.lastUpgradeAt = this.clock;
          this.cooldown = this.upgradeCooldown;
        }
      }
    }
    return changed ? this.current : null;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      step: this.step,
      steps: this.ladder.length,
      tier: this.current.tier,
      scale: this.current.scale,
      cooldown: Number(this.cooldown.toFixed(1)),
      history: this.history.slice(-6),
    };
  }
}
