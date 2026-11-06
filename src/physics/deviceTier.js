// Pick how much physics a device should run. `?physics=off|lite|full` forces
// a tier for testing. Lite keeps every cue (door hinge, sway, lean, impacts)
// but replaces the Rapier worker with analytic prop motion.
export function detectPhysicsTier(env = globalThis) {
  const nav = env.navigator ?? {};
  let forced = null;
  try {
    forced = new URLSearchParams(env.location?.search ?? '').get('physics');
  } catch { /* no location in tests */ }
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const canWorker = typeof env.Worker === 'function' && typeof env.WebAssembly === 'object';
  let tier = cores <= 2 || memory <= 2 ? 'lite' : 'full';
  if (forced === 'off' || forced === 'lite' || forced === 'full') tier = forced;
  let reducedMotion = false;
  try {
    reducedMotion = !!env.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch { /* matchMedia unavailable */ }
  return { tier, worker: tier === 'full' && canWorker, reducedMotion, cores, memory };
}

// Sheds optional physics work when frames run long and restores it after a
// sustained recovery. Level 2 = everything, 1 = analytic props and half-rate
// secondary motion, 0 = essentials only (door hinge, player motor).
export class PhysicsBudget {
  constructor(maxLevel = 2) {
    this.maxLevel = maxLevel;
    this.level = maxLevel;
    this.slow = 0;
    this.fast = 0;
  }

  observe(frameSeconds) {
    if (!(frameSeconds > 0) || frameSeconds > 0.25) return this.level;
    if (frameSeconds > 1 / 20) {
      this.slow += frameSeconds;
      this.fast = 0;
    } else if (frameSeconds < 1 / 40) {
      this.fast += frameSeconds;
      this.slow = Math.max(0, this.slow - frameSeconds * 0.5);
    }
    if (this.slow > 4 && this.level > 0) {
      this.level -= 1;
      this.slow = 0;
    } else if (this.fast > 12 && this.level < this.maxLevel) {
      this.level += 1;
      this.fast = 0;
    }
    return this.level;
  }
}
