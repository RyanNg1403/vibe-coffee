// Rigid-body hinge for the café's double-acting glass door. The door slab has
// real rotational inertia; whoever is passing drives it with a torque-limited
// push toward the requested swing, and a centring spring hinge (the closer)
// returns it with slight underdamping. Hard stops bounce with restitution and
// actors standing in the swing arc are pushed aside or bounce the door.
//
// This runs synchronously inside the café's fixed simulation step: the door
// coordinator reads `openness` within the same tick, so the hinge cannot live
// behind an asynchronous worker boundary.

export const DOOR_DEFAULTS = Object.freeze({
  width: 1.0,             // metres from hinge to the leading edge
  thickness: 0.06,
  mass: 26,               // kg: framed glass leaf
  openAngle: 1.24,        // rad: the coordinator's requested swing
  limit: 1.48,            // rad: door stop either side
  pushFrequency: 9,       // rad/s of the hand that walks the door open
  pushDamping: 1.0,
  maxPushTorque: 170,     // N·m: a firm adult push at the handle
  closerFrequency: 6.4,
  closerDamping: 0.8,     // a hint of overshoot as it swings back through centre
  hingeFriction: 1.2,     // N·m of Coulomb friction in the pivot
  stopRestitution: 0.3,
  actorRestitution: 0.15,
  doorShare: 0.6,         // fraction of an overlap the door yields to an actor
  substep: 1 / 120,
});

export class HingeDoor {
  constructor(options = {}) {
    this.options = { ...DOOR_DEFAULTS, ...options };
    const o = this.options;
    this.inertia = (o.mass * o.width * o.width) / 3; // slab about its edge
    this.angle = 0;
    this.omega = 0;
    this.target = null;
    this.pivot = { x: 0, z: 0 };
    this.events = [];
  }

  setPivot(x, z) {
    this.pivot.x = x;
    this.pivot.z = z;
  }

  setTarget(angle) {
    this.target = angle == null || angle === 0 ? null : angle;
  }

  get openness() {
    return Math.min(1, Math.abs(this.angle) / this.options.openAngle);
  }

  // speed of the leading edge, for wind and impact loudness
  get tipSpeed() {
    return Math.abs(this.omega) * this.options.width;
  }

  step(dt) {
    const o = this.options;
    const steps = Math.max(1, Math.ceil(dt / o.substep));
    const h = dt / steps;
    const I = this.inertia;
    for (let i = 0; i < steps; i += 1) {
      let torque;
      if (this.target !== null) {
        const w = o.pushFrequency;
        torque = I * w * w * (this.target - this.angle) - 2 * I * w * o.pushDamping * this.omega;
        torque = clamp(torque, -o.maxPushTorque, o.maxPushTorque);
      } else {
        const w = o.closerFrequency;
        torque = -I * w * w * this.angle - 2 * I * w * o.closerDamping * this.omega;
      }
      // Coulomb pivot friction, never strong enough to reverse the motion
      const frictionLimit = Math.abs(this.omega) * I / h;
      torque -= Math.sign(this.omega) * Math.min(o.hingeFriction, frictionLimit);
      this.omega += (torque / I) * h;
      this.angle += this.omega * h;
      if (Math.abs(this.angle) > o.limit) {
        const side = Math.sign(this.angle);
        this.angle = side * o.limit;
        if (Math.sign(this.omega) === side) {
          const speed = Math.abs(this.omega) * o.width;
          this.omega = -this.omega * o.stopRestitution;
          if (speed > 0.25) this._emit('stop', speed, o.width * 0.92);
        }
      }
    }
    // the centring detent catches a slow leaf that friction would otherwise
    // park a fraction of a degree off centre
    if (this.target === null && Math.abs(this.angle) < 0.004 && Math.abs(this.omega) < 0.03) {
      this.angle = 0;
      this.omega = 0;
    }
  }

  // Resolve a vertical-capsule actor (x, z, radius) against the slab. Moves
  // `position` out of the leaf, bounces the leaf off the actor, and returns
  // whether they touched.
  resolveActor(position, radius) {
    const o = this.options;
    const rx = position.x - this.pivot.x;
    const rz = position.z - this.pivot.z;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    // slab runs along local +x, which the hinge rotates to (cos a, -sin a)
    const along = rx * c - rz * s;
    const normal = rx * s + rz * c;
    const reach = radius + o.thickness / 2;
    if (along < 0.05 || along > o.width + radius * 0.5 || Math.abs(normal) >= reach) return false;
    const lever = Math.min(Math.max(along, 0.1), o.width);
    const side = normal >= 0 ? 1 : -1;
    const overlap = reach - Math.abs(normal);
    // rotating the leaf by +δ moves its points by -lever·δ along the normal,
    // so the actor's normal coordinate grows by lever·δ
    const doorShare = o.doorShare;
    this.angle += side * (overlap * doorShare) / lever;
    const actorPush = overlap * (1 - doorShare);
    position.x += s * side * actorPush;
    position.z += c * side * actorPush;
    // leaf velocity along the normal at the contact is -lever·ω
    const approaching = side * (-lever * this.omega) > 0;
    if (approaching) {
      const speed = Math.abs(this.omega) * lever;
      this.omega = -this.omega * o.actorRestitution;
      if (speed > 0.3) this._emit('actor', speed, lever);
    }
    return true;
  }

  _emit(kind, speed, lever) {
    if (this.events.length > 8) return;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    this.events.push({
      kind,
      speed,
      x: this.pivot.x + c * lever,
      z: this.pivot.z - s * lever,
    });
  }

  drainEvents() {
    if (!this.events.length) return EMPTY;
    const events = this.events;
    this.events = [];
    return events;
  }
}

const EMPTY = Object.freeze([]);

// Swap the café entrance's kinematic easing for the hinge. The entrance keeps
// its public contract (setDirection, angle, openness, root.rotation.y), so the
// door coordinator and NPC door choreography are unchanged.
export function attachHingePhysics(entrance, options = {}) {
  if (!entrance?.root) return null;
  if (entrance.hinge) return entrance.hinge;
  const openAngle = options.openAngle ?? 1.24;
  const door = new HingeDoor({ openAngle, ...options });
  const pivot = entrance.root.position;
  door.setPivot(pivot.x, pivot.z);
  door.angle = entrance.angle ?? 0;
  entrance.hinge = door;
  entrance.update = function updateHingedDoor(dt) {
    door.setTarget(this.targetAngle);
    door.step(dt);
    this.angle = door.angle;
    this.root.rotation.y = door.angle;
    this.openness = door.openness;
  };
  return door;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
