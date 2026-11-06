// Frame-rate ceilings for the adaptive frame scheduler, combined from:
//   - the device class (perf/deviceProfile.js),
//   - a thermal governor: phones throttle after a few minutes of sustained
//     load, so the same quality step starts costing more render time. When
//     work at an unchanged step drifts well above its own early baseline,
//     the frame rate steps down (less heat, more headroom); it steps back up
//     after a long stretch with comfortable headroom,
//   - the user's frame cap (30 fps option),
//   - battery saver (discharging and low, or Save-Data),
//   - an unfocused window (the café playing beside other work).
// Resolution is still the adaptive controller's job; pacing only lowers how
// often frames are drawn.

export const THERMAL_STEPS = [
  { interactive: Infinity, ambient: Infinity },
  { interactive: 30, ambient: 20 },
  { interactive: 24, ambient: 15 },
];

export class ThermalGovernor {
  constructor({
    baselineSeconds = 45,  // slow average: what this step cost when cool
    recentSeconds = 6,     // fast average: what it costs now
    warmupSeconds = 20,    // samples before a baseline is trusted
    driftRatio = 1.35,     // recent / baseline that reads as throttling
    sustainSeconds = 15,
    recoverSeconds = 90,
    recoverHeadroom = 0.45, // recent work under this share of the budget
  } = {}) {
    Object.assign(this, { baselineSeconds, recentSeconds, warmupSeconds, driftRatio, sustainSeconds, recoverSeconds, recoverHeadroom });
    this.level = 0;
    this.history = [];
    this._resetBaseline();
  }

  _resetBaseline() {
    this.baseline = null;
    this.recent = null;
    this.observed = 0;
    this.overFor = 0;
    this.calmFor = 0;
    this.step = undefined;
  }

  get caps() { return THERMAL_STEPS[this.level]; }

  /**
   * @param workMs     render work of one frame (GPU time when measured, else CPU)
   * @param dt         seconds since the previous rendered frame
   * @param step       current adaptive-quality step (any comparable value)
   * @param budgetMs   frame budget at the current target rate
   * @returns true when the level changed
   */
  update(workMs, dt, step, budgetMs) {
    if (!(workMs >= 0) || !(dt > 0) || dt > 1) return false;
    // A different quality step has a different cost; learn it afresh.
    if (step !== this.step) {
      const level = this.level;
      this._resetBaseline();
      this.level = level;
      this.step = step;
    }
    const slow = Math.min(1, dt / this.baselineSeconds);
    const fast = Math.min(1, dt / this.recentSeconds);
    this.baseline = this.baseline === null ? workMs : this.baseline + (workMs - this.baseline) * slow;
    this.recent = this.recent === null ? workMs : this.recent + (workMs - this.recent) * fast;
    this.observed += dt;
    if (this.observed < this.warmupSeconds) return false;

    const drifting = this.recent > this.baseline * this.driftRatio && this.recent > budgetMs * 0.5;
    this.overFor = drifting ? this.overFor + dt : 0;
    if (this.overFor >= this.sustainSeconds && this.level < THERMAL_STEPS.length - 1) {
      return this._set(this.level + 1, `work ${this.recent.toFixed(1)} ms vs ${this.baseline.toFixed(1)} ms baseline`);
    }
    const calm = this.recent < budgetMs * this.recoverHeadroom;
    this.calmFor = calm ? this.calmFor + dt : 0;
    if (this.level > 0 && this.calmFor >= this.recoverSeconds) {
      return this._set(this.level - 1, `headroom ${this.recent.toFixed(1)} ms of ${budgetMs.toFixed(1)} ms`);
    }
    return false;
  }

  _set(level, reason) {
    this.history.push({ level, reason });
    if (this.history.length > 8) this.history.shift();
    this.level = level;
    // Keep the learned cost; just restart the timers.
    this.overFor = 0;
    this.calmFor = 0;
    this.baseline = this.recent;
    return true;
  }
}

export const BATTERY_SAVER_CAPS = { interactive: 24, ambient: 15 };
export const UNFOCUSED_CAPS = { interactive: Infinity, ambient: 20 };

// Effective { interactiveFps, ambientFps } from every active ceiling.
export function frameCaps({ device, thermal = THERMAL_STEPS[0], userCap = 0, batterySaver = false, focused = true }) {
  let interactive = Math.min(device.interactiveFps, thermal.interactive);
  let ambient = Math.min(device.ambientFps, thermal.ambient);
  if (userCap > 0) {
    interactive = Math.min(interactive, userCap);
    ambient = Math.min(ambient, userCap);
  }
  if (batterySaver) {
    interactive = Math.min(interactive, BATTERY_SAVER_CAPS.interactive);
    ambient = Math.min(ambient, BATTERY_SAVER_CAPS.ambient);
  }
  if (!focused) ambient = Math.min(ambient, UNFOCUSED_CAPS.ambient);
  return { interactiveFps: interactive, ambientFps: Math.min(ambient, interactive) };
}

// Battery saver: discharging under 20 %, or the browser's Save-Data hint.
// `onChange(active)` fires on every change; returns a disposer.
export function watchBatterySaver(onChange, nav = globalThis.navigator) {
  let battery = null;
  let active = false;
  const evaluate = () => {
    const low = !!battery && !battery.charging && battery.level <= 0.2;
    const next = low || !!nav?.connection?.saveData;
    if (next !== active) {
      active = next;
      onChange(active);
    }
  };
  const events = ['chargingchange', 'levelchange'];
  nav?.getBattery?.().then((value) => {
    battery = value;
    events.forEach((type) => battery.addEventListener(type, evaluate));
    evaluate();
  }).catch(() => {});
  nav?.connection?.addEventListener?.('change', evaluate);
  evaluate();
  return () => {
    events.forEach((type) => battery?.removeEventListener(type, evaluate));
    nav?.connection?.removeEventListener?.('change', evaluate);
  };
}
