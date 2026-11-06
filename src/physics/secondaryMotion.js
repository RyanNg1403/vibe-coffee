import * as THREE from 'three';

// Secondary motion driven by a cheap air-velocity field: people and pets drag
// a wake of air behind them, the door pumps a gust as it swings and lets the
// outside draught in while open, and open-air venues add a gusting breeze.
// Hanging plants and pendants are spherical pendulums pushed by that air, and
// cup steam bends with it. Everything sleeps when the air is still.

const MAX_SOURCES = 16;
const WAKE_COUPLING = 0.38;   // fraction of a mover's speed its wake carries

export class AirField {
  constructor() {
    this.sources = Array.from({ length: MAX_SOURCES }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vz: 0, r2: 1, top: 1.8,
    }));
    this.count = 0;
    this.time = 0;
    this.breeze = 0;           // m/s mean outdoor wind (open-air venues)
    this.breezeDirX = 0.8;
    this.breezeDirZ = -0.6;
    this.draught = null;       // { x, z, vx, vz, r2 } inflow through an open door
  }

  begin(dt) {
    this.time += dt;
    this.count = 0;
  }

  // A moving body of roughly human height. Velocities in m/s.
  addMover(x, y, z, vx, vz, radius = 0.85, top = 1.8) {
    if (this.count >= MAX_SOURCES) return;
    if (vx * vx + vz * vz < 0.01) return;
    const s = this.sources[this.count++];
    s.x = x; s.y = y; s.z = z;
    s.vx = vx * WAKE_COUPLING;
    s.vz = vz * WAKE_COUPLING;
    s.r2 = radius * radius;
    s.top = y + top;
  }

  // A bulk push of air such as a swinging door leaf.
  addGust(x, y, z, vx, vz, radius) {
    if (this.count >= MAX_SOURCES) return;
    const s = this.sources[this.count++];
    s.x = x; s.y = y; s.z = z;
    s.vx = vx; s.vz = vz;
    s.r2 = radius * radius;
    s.top = y + 2.4;
  }

  get active() {
    return this.count > 0 || this.breeze > 0.01 || !!this.draught;
  }

  sample(x, y, z, out) {
    let wx = 0;
    let wz = 0;
    for (let i = 0; i < this.count; i += 1) {
      const s = this.sources[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const above = Math.max(0, y - s.top);
      const d2 = dx * dx + dz * dz + above * above * 1.6;
      if (d2 > s.r2 * 9) continue;
      const k = Math.exp(-d2 / s.r2);
      wx += s.vx * k;
      wz += s.vz * k;
    }
    const d = this.draught;
    if (d) {
      const dx = x - d.x;
      const dz = z - d.z;
      const k = Math.exp(-(dx * dx + dz * dz) / d.r2);
      wx += d.vx * k;
      wz += d.vz * k;
    }
    if (this.breeze > 0) {
      const t = this.time;
      // a few incommensurate sines read as natural gusting; the spatial term
      // makes neighbouring fixtures move slightly out of phase
      const gust = 0.55 + 0.3 * Math.sin(t * 0.37 + x * 0.21)
        + 0.18 * Math.sin(t * 1.13 + z * 0.37 + 1.3)
        + 0.08 * Math.sin(t * 2.9 + x * 0.9);
      wx += this.breezeDirX * this.breeze * gust;
      wz += this.breezeDirZ * this.breeze * gust;
    }
    out.x = wx;
    out.z = wz;
    return out;
  }
}

// Small-angle spherical pendulum: tilt angles (ax toward +x, az toward +z).
export class Pendulum {
  constructor({ length = 0.9, damping = 0.06, drag = 0.9, quadraticDrag = 0.6 } = {}) {
    this.length = length;
    this.omega0 = Math.sqrt(9.81 / Math.max(0.05, length));
    this.damping = damping;
    this.drag = drag;                 // linear air coupling, 1/s
    this.quadraticDrag = quadraticDrag; // 1/m
    this.ax = 0; this.az = 0;
    this.wx = 0; this.wz = 0;
  }

  step(dt, windX, windZ) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    const w2 = this.omega0 * this.omega0;
    const c = 2 * this.damping * this.omega0;
    const L = this.length;
    for (let i = 0; i < steps; i += 1) {
      // air drag on the bob, relative to its own velocity
      const relX = windX - this.wx * L;
      const relZ = windZ - this.wz * L;
      const rel = Math.hypot(relX, relZ);
      const kx = (this.drag + this.quadraticDrag * rel) * relX / L;
      const kz = (this.drag + this.quadraticDrag * rel) * relZ / L;
      this.wx += (-w2 * this.ax - c * this.wx + kx) * h;
      this.wz += (-w2 * this.az - c * this.wz + kz) * h;
      this.ax += this.wx * h;
      this.az += this.wz * h;
    }
    const limit = 0.35;
    if (Math.abs(this.ax) > limit) { this.ax = Math.sign(this.ax) * limit; this.wx = 0; }
    if (Math.abs(this.az) > limit) { this.az = Math.sign(this.az) * limit; this.wz = 0; }
  }

  get energy() {
    return this.ax * this.ax + this.az * this.az
      + (this.wx * this.wx + this.wz * this.wz) / (this.omega0 * this.omega0);
  }
}

const _swing = new THREE.Quaternion();
const _offset = new THREE.Vector3();
const _euler = new THREE.Euler();
const _wind = { x: 0, z: 0 };

// Hangs authored fixtures from their anchors. Each target carries
// `userData.secondaryMotion = { anchor: [x, y, z], length, drag? }` in its
// parent's space.
export class SwayRig {
  constructor(root) {
    this.items = [];
    root?.traverse((object) => {
      const spec = object.userData?.secondaryMotion;
      if (!spec || spec.kind !== 'pendulum' || !Array.isArray(spec.anchor)) return;
      this.items.push({
        object,
        anchor: new THREE.Vector3().fromArray(spec.anchor),
        basePosition: object.position.clone(),
        baseQuaternion: object.quaternion.clone(),
        bobY: spec.anchor[1] - (spec.length ?? 0.9),
        pendulum: new Pendulum({
          length: spec.length ?? 0.9,
          drag: spec.drag ?? 0.9,
          damping: spec.damping ?? 0.06,
        }),
        awake: false,
        dirty: false,
      });
    });
    this.awakeCount = 0;
  }

  get size() { return this.items.length; }

  update(dt, field) {
    let awake = 0;
    const airActive = field.active;
    for (const item of this.items) {
      const p = item.pendulum;
      let wx = 0;
      let wz = 0;
      if (airActive) {
        field.sample(item.anchor.x, item.bobY, item.anchor.z, _wind);
        wx = _wind.x;
        wz = _wind.z;
      }
      const windy = wx * wx + wz * wz > 0.0004;
      if (!windy && !item.awake) continue;
      p.step(dt, wx, wz);
      item.awake = windy || p.energy > 1e-8;
      if (!item.awake) {
        p.ax = p.az = p.wx = p.wz = 0;
      }
      this._apply(item);
      if (item.awake) awake += 1;
    }
    this.awakeCount = awake;
  }

  _apply(item) {
    const p = item.pendulum;
    // tilt toward +x is a rotation about +z; toward +z is about -x
    _swing.setFromEuler(_euler.set(-p.az, 0, p.ax, 'XYZ'));
    item.object.quaternion.copy(_swing).multiply(item.baseQuaternion);
    _offset.copy(item.basePosition).sub(item.anchor).applyQuaternion(_swing);
    item.object.position.copy(item.anchor).add(_offset);
  }

  reset() {
    for (const item of this.items) {
      item.object.position.copy(item.basePosition);
      item.object.quaternion.copy(item.baseQuaternion);
      item.awake = false;
    }
    this.awakeCount = 0;
  }
}

// Bends the café's pooled steam wisps with the local air. The café rewrites
// the steam buffer on its own cadence; this layer detects a fresh write from
// the attribute version and otherwise replaces its previous offset, so the
// two never accumulate drift.
export class SteamDisturbance {
  constructor(root) {
    this.points = null;
    root?.traverse((object) => {
      if (this.points || !object.isPoints) return;
      const attributes = object.geometry?.attributes;
      if (attributes?.aScale && attributes?.aAlpha && attributes?.position) this.points = object;
    });
    const count = this.points?.geometry.attributes.position.count ?? 0;
    this.applied = new Float32Array(count * 2);
    this.filtered = new Float32Array(Math.ceil(count / 3) * 2);
    this.version = -1;
    this.active = false;
  }

  update(dt, field) {
    if (!this.points) return;
    const positions = this.points.geometry.attributes.position;
    const scales = this.points.geometry.attributes.aScale;
    const fresh = positions.version !== this.version;
    if (!field.active && !this.active) return;
    const array = positions.array;
    const blend = 1 - Math.exp(-2.4 * dt);
    let moving = false;
    for (let i = 0; i < positions.count; i += 1) {
      const ix = i * 3;
      if (!fresh) {
        array[ix] -= this.applied[i * 2];
        array[ix + 2] -= this.applied[i * 2 + 1];
      }
      const emitter = (i / 3) | 0;
      if (i % 3 === 0) {
        field.sample(array[ix], array[ix + 1], array[ix + 2], _wind);
        const f = this.filtered;
        f[emitter * 2] += (_wind.x - f[emitter * 2]) * blend;
        f[emitter * 2 + 1] += (_wind.z - f[emitter * 2 + 1]) * blend;
      }
      // wisps carry the cup's steam scale ramp (0.08 → 0.24 as they rise),
      // so the upper, older wisps bend furthest
      const rise = THREE.MathUtils.clamp((scales.array[i] - 0.08) / 0.16, 0, 1);
      const bend = rise * rise * 0.55;
      let ox = this.filtered[emitter * 2] * bend;
      let oz = this.filtered[emitter * 2 + 1] * bend;
      const length = Math.hypot(ox, oz);
      if (length > 0.22) { ox *= 0.22 / length; oz *= 0.22 / length; }
      if (length > 1e-4) moving = true;
      array[ix] += ox;
      array[ix + 2] += oz;
      this.applied[i * 2] = ox;
      this.applied[i * 2 + 1] = oz;
    }
    positions.needsUpdate = true;
    this.version = positions.version;
    this.active = moving;
  }
}
