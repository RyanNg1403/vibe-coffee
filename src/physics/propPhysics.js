import * as THREE from 'three';

// Main-thread side of tabletop prop physics. When the player walks into a
// table, its loose props are described to the Rapier worker, which simulates
// the knock and streams transforms back. If the worker is unavailable (low
// tier, no WebAssembly, the single-file edition, or still loading), an
// analytic rocking fallback gives the same cue at a fraction of the cost.

const FALLBACK_LIFETIME = 1.6;
const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
const savedQuaternion = new THREE.Quaternion();
const axis = new THREE.Vector3();
const tilt = new THREE.Quaternion();

function defaultWorkerFactory() {
  return new Worker(new URL('./physics.worker.js', import.meta.url), { type: 'module' });
}

// Measure a prop in its own unrotated frame and turn it into a rigid body.
export function describeProp(object, id, topY) {
  if (!object?.parent) return null;
  savedQuaternion.copy(object.quaternion);
  object.quaternion.identity();
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  object.quaternion.copy(savedQuaternion);
  object.updateMatrixWorld(true);
  if (box.isEmpty()) return null;
  box.getSize(size);
  box.getCenter(center);
  if (Math.abs(box.min.y - topY) > 0.07 || size.y > 0.6 || Math.max(size.x, size.z) > 0.6) return null;
  const round = Math.abs(size.x - size.z) < 0.25 * Math.max(size.x, size.z);
  const hy = Math.max(0.004, size.y / 2);
  const thin = size.y < 0.05;
  const mass = THREE.MathUtils.clamp(size.x * size.y * size.z * (thin ? 0.85 : 0.32) * 650, 0.05, 2.4);
  return {
    id,
    x: object.position.x, y: object.position.y, z: object.position.z,
    qx: object.quaternion.x, qy: object.quaternion.y, qz: object.quaternion.z, qw: object.quaternion.w,
    shape: round ? 'cylinder' : 'box',
    hx: size.x / 2 * 0.96, hy, hz: size.z / 2 * 0.96,
    radius: Math.max(size.x, size.z) / 2 * 0.92,
    // the collider rests exactly on the tabletop so nothing pops on wake-up
    ox: center.x - object.position.x,
    oy: topY + hy - object.position.y,
    oz: center.z - object.position.z,
    mass,
    friction: thin ? 0.5 : 0.42,
    restitution: thin ? 0.05 : 0.14,
    height: size.y,
    material: thin || size.y < 0.06 ? 'soft' : 'ceramic',
  };
}

export class TablePropPhysics {
  constructor({ useWorker = true, onImpact = null, createWorker = defaultWorkerFactory } = {}) {
    this.useWorker = useWorker;
    this.onImpact = onImpact;
    this.createWorker = createWorker;
    this.state = useWorker ? 'idle' : 'off';
    this.worker = null;
    this.scenes = new Map();     // worker scenes by table key
    this.fallback = [];          // analytic rocking props
    this.pendingImpacts = [];
    this.awakeProps = 0;
    this._nextScene = 1;
    this._contactCooldown = new Map();
  }

  // Start loading Rapier ahead of the first bump; harmless to call often.
  warm() {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    try {
      this.worker = this.createWorker();
    } catch (error) {
      this._fail(error);
      return;
    }
    const timeout = setTimeout(() => {
      if (this.state === 'loading') this._fail(new Error('physics worker timed out'));
    }, 10000);
    this.worker.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(timeout);
        if (this.state === 'loading') this.state = 'ready';
        this.version = data.version;
      } else if (data.type === 'error') {
        clearTimeout(timeout);
        this._fail(new Error(data.message));
      } else if (data.type === 'frame') {
        this._receiveFrame(data);
      }
    });
    this.worker.addEventListener('error', (event) => {
      clearTimeout(timeout);
      event.preventDefault?.();
      this._fail(new Error(event.message || 'physics worker failed to load'));
    });
  }

  _fail(error) {
    if (this.state === 'failed') return;
    this.state = 'failed';
    this.failure = String(error?.message ?? error);
    this.worker?.terminate();
    this.worker = null;
    this.scenes.clear();
    console.info('[physics] Rapier worker unavailable, using analytic props:', this.failure);
  }

  // table: { key, x, y, z, yaw, shape, hx, hz, radius }
  bump(table, objects, dirX, dirZ, speed) {
    const props = [];
    objects.forEach((object, index) => {
      const description = describeProp(object, index, table.y);
      if (description) props.push({ object, description });
    });
    if (!props.length) return 0;
    if (this.state === 'ready') {
      const previous = this.scenes.get(table.key);
      if (previous) this.worker.postMessage({ type: 'cancel', scene: previous.id });
      const id = this._nextScene++;
      this.scenes.set(table.key, { id, props, key: table.key });
      this.worker.postMessage({
        type: 'bump',
        scene: id,
        description: {
          top: {
            x: table.x, y: table.y, z: table.z, yaw: table.yaw ?? 0,
            shape: table.shape, hx: table.hx, hz: table.hz, radius: table.radius,
          },
          props: props.map(({ description }) => description),
          kick: { dx: dirX, dz: dirZ, speed },
        },
      });
    } else {
      for (const prop of props) this._rock(prop, dirX, dirZ, speed);
    }
    return props.length;
  }

  _receiveFrame(data) {
    let scene = null;
    for (const candidate of this.scenes.values()) {
      if (candidate.id === data.scene) { scene = candidate; break; }
    }
    if (!scene) return;
    const t = data.transforms;
    for (let o = 0; o < t.length; o += 8) {
      const prop = scene.props[t[o]];
      if (!prop?.object.parent) continue;
      prop.object.position.set(t[o + 1], t[o + 2], t[o + 3]);
      prop.object.quaternion.set(t[o + 4], t[o + 5], t[o + 6], t[o + 7]);
    }
    const now = performance.now();
    for (const contact of data.contacts) {
      const prop = scene.props[contact.id];
      if (!prop?.object.parent) continue;
      const last = this._contactCooldown.get(prop.object) ?? 0;
      if (now - last < 70) continue;
      this._contactCooldown.set(prop.object, now);
      const intensity = Math.min(1, contact.force / (prop.description.mass * 60));
      const material = contact.other >= 0 ? 'ceramic' : prop.description.material;
      this.onImpact?.(material, prop.object.position, intensity);
    }
    if (data.done) this.scenes.delete(scene.key);
  }

  _rock(prop, dirX, dirZ, speed) {
    const { object, description } = prop;
    const height = Math.max(0.03, description.height);
    // rocking about the base edge, a few hertz for mug-sized objects
    const omega0 = Math.sqrt(9.81 / (height * 0.55)) * 0.9;
    const kick = Math.min(0.06, (speed * 0.012) / height) * (0.7 + Math.random() * 0.6);
    axis.set(dirZ, 0, -dirX).normalize();
    this.fallback.push({
      object,
      baseQuaternion: object.quaternion.clone(),
      axis: axis.clone(),
      theta: 0,
      omega: kick * omega0,
      omega0,
      slideX: dirX * speed * 0.0035 * (0.6 + Math.random() * 0.8),
      slideZ: dirZ * speed * 0.0035 * (0.6 + Math.random() * 0.8),
      slid: 0,
      t: 0,
    });
    this.pendingImpacts.push({
      at: Math.random() * 0.08,
      material: description.material,
      object,
      intensity: Math.min(1, speed * 0.45) * (0.5 + Math.random() * 0.5),
    });
  }

  update(dt) {
    let awake = 0;
    for (let i = this.fallback.length - 1; i >= 0; i -= 1) {
      const item = this.fallback[i];
      item.t += dt;
      const w = item.omega0;
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let s = 0; s < steps; s += 1) {
        item.omega += (-w * w * item.theta - 2 * 0.22 * w * item.omega) * h;
        item.theta += item.omega * h;
      }
      const slideStep = Math.min(1, dt / 0.12);
      const remaining = 1 - item.slid;
      if (remaining > 0) {
        const k = Math.min(remaining, slideStep);
        item.object.position.x += item.slideX * k;
        item.object.position.z += item.slideZ * k;
        item.slid += k;
      }
      tilt.setFromAxisAngle(item.axis, item.theta);
      item.object.quaternion.copy(tilt).multiply(item.baseQuaternion);
      const settled = item.t > 0.3 && Math.abs(item.theta) < 2e-4 && Math.abs(item.omega) < 2e-3;
      if (settled || item.t > FALLBACK_LIFETIME || !item.object.parent) {
        item.object.quaternion.copy(item.baseQuaternion);
        this.fallback.splice(i, 1);
      } else {
        awake += 1;
      }
    }
    for (let i = this.pendingImpacts.length - 1; i >= 0; i -= 1) {
      const impact = this.pendingImpacts[i];
      impact.at -= dt;
      if (impact.at > 0) continue;
      this.pendingImpacts.splice(i, 1);
      if (impact.object.parent) this.onImpact?.(impact.material, impact.object.position, impact.intensity);
    }
    for (const scene of this.scenes.values()) awake += scene.props.length;
    this.awakeProps = awake;
  }

  // drop in-flight work for a departing café without killing the worker
  clear() {
    for (const scene of this.scenes.values()) this.worker?.postMessage({ type: 'cancel', scene: scene.id });
    this.scenes.clear();
    for (const item of this.fallback) item.object.quaternion.copy(item.baseQuaternion);
    this.fallback.length = 0;
    this.pendingImpacts.length = 0;
  }

  dispose() {
    this.clear();
    this.worker?.terminate();
    this.worker = null;
    if (this.state !== 'failed') this.state = this.useWorker ? 'idle' : 'off';
  }
}
