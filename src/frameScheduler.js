// Keeps direct interaction responsive while avoiding 60 full WebGL renders
// every second when the user is simply watching the room. requestAnimationFrame
// still drives the clock; rejected callbacks do no scene or GPU work.
export class AdaptiveFrameScheduler {
  constructor({
    interactiveFps = 45,
    ambientFps = 24,
    hiddenFps = 2,
    interactionHoldMs = 1200,
  } = {}) {
    this.interactiveFps = interactiveFps;
    this.ambientFps = ambientFps;
    this.hiddenFps = hiddenFps;
    this.interactionHoldMs = interactionHoldMs;
    this.lastInteractionAt = -Infinity;
    this.lastFrameAt = null;
    this.targetFps = ambientFps;
    this.renderedFrames = 0;
    this.skippedFrames = 0;
  }

  markInteraction(now) {
    this.lastInteractionAt = now;
  }

  reset(now = null) {
    this.lastFrameAt = now;
  }

  chooseFps(now, { moving = false, visible = true } = {}) {
    if (!visible) return this.hiddenFps;
    if (moving || now - this.lastInteractionAt <= this.interactionHoldMs) {
      return this.interactiveFps;
    }
    return this.ambientFps;
  }

  shouldRender(now, state) {
    this.targetFps = this.chooseFps(now, state);
    const interval = 1000 / this.targetFps;
    if (this.lastFrameAt === null) {
      this.lastFrameAt = now;
      this.renderedFrames += 1;
      return true;
    }
    const elapsed = now - this.lastFrameAt;
    // A small tolerance prevents a 60 Hz callback arriving a fraction of a
    // millisecond early from accidentally becoming a 30 Hz cadence.
    if (elapsed < interval - 0.75) {
      this.skippedFrames += 1;
      return false;
    }
    this.lastFrameAt = now - (elapsed % interval);
    this.renderedFrames += 1;
    return true;
  }
}
