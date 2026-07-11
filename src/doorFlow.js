// Serializes two-way foot traffic through one physical café door. The scene
// owns the hinge animation; this coordinator only grants one actor passage at
// a time and waits for the door to close before reversing its swing direction.
export class DoorCoordinator {
  constructor(entrance = null, onOpen = null) {
    this.entrance = entrance;
    this.onOpen = onOpen;
    this.active = null;
    this.activeDirection = null;
    this.queue = [];
  }

  request(actor, direction) {
    if (!this.entrance) return true;
    if (this.active === actor) return this.entrance.openness >= 0.82;
    if (!this.queue.some((entry) => entry.actor === actor)) {
      this.queue.push({ actor, direction });
    }
    this._activateNext();
    return this.active === actor && this.entrance.openness >= 0.82;
  }

  release(actor) {
    if (!this.entrance) return;
    if (this.active === actor) {
      this.active = null;
      this.activeDirection = null;
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
      this.entrance.setDirection(this.activeDirection);
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
    this.entrance.setDirection(next.direction);
    this.onOpen?.(next.actor, next.direction);
  }

  get queueLength() { return this.queue.length; }
}
