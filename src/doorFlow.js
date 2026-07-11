// Serializes two-way foot traffic through one physical café door. The scene
// owns the hinge animation; this coordinator only grants one actor passage at
// a time and waits for the door to close before reversing its swing direction.
export class DoorCoordinator {
  constructor(entrance = null, onOpen = null) {
    this.entrance = entrance;
    this.onOpen = onOpen;
    this.active = null;
    this.activeDirection = null;
    this.opening = false;
    this.queue = [];
  }

  join(actor, direction) {
    if (!this.entrance) return true;
    if (this.active === actor || this.queue.some((entry) => entry.actor === actor)) return true;
    this.queue.push({ actor, direction });
    this._activateNext();
    return true;
  }

  isActive(actor) {
    return !this.entrance || this.active === actor;
  }

  queueIndex(actor) {
    return this.queue.findIndex((entry) => entry.actor === actor);
  }

  request(actor, direction) {
    if (!this.entrance) return true;
    this.join(actor, direction);
    if (this.active !== actor) return false;
    if (!this.opening) {
      this.opening = true;
      this.onOpen?.(actor, this.activeDirection);
    }
    this.entrance.setDirection(this.activeDirection);
    return this.entrance.openness >= 0.82;
  }

  release(actor) {
    if (!this.entrance) return;
    if (this.active === actor) {
      this.active = null;
      this.activeDirection = null;
      this.opening = false;
      this.entrance.setDirection(null);
      return;
    }
    this.cancel(actor);
  }

  cancel(actor) {
    const index = this.queue.findIndex((entry) => entry.actor === actor);
    if (index >= 0) this.queue.splice(index, 1);
    if (this.active === actor) this.release(actor);
  }

  update() {
    if (!this.entrance) return;
    if (this.active) {
      this.entrance.setDirection(this.opening ? this.activeDirection : null);
      return;
    }
    this.entrance.setDirection(null);
    this._activateNext();
  }

  _activateNext() {
    if (!this.entrance || this.active || this.entrance.openness > 0.06 || !this.queue.length) return;
    const next = this.queue.shift();
    this.active = next.actor;
    this.activeDirection = next.direction;
    this.opening = false;
  }

  get queueLength() { return this.queue.length; }
  get totalWaiting() { return this.queue.length + (this.active ? 1 : 0); }
}
