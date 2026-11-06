import * as THREE from 'three';
import { angleDelta } from '../npc/motion.js';
import { criticalSpring } from './playerMotor.js';

// Whole-body dynamics layered over the authored clips: walkers and pets bank
// into turns (centripetal lean, atan(v·ω/g)) and pitch with acceleration. The
// lean is integrated at the simulation rate and applied only around the
// render call, then removed, so steering, collision, audio and the motion
// interpolator never see it.

const GRAVITY = 9.81;
const leanEuler = new THREE.Euler();
const leanQuaternion = new THREE.Quaternion();

export function centripetalLean(speed, yawRate, gain = 0.6, limit = 0.12) {
  const lean = Math.atan((speed * yawRate) / GRAVITY) * gain;
  return Math.max(-limit, Math.min(limit, lean));
}

export class BodyDynamics {
  constructor() {
    this.states = new WeakMap();
    this.applied = [];
    this.enabled = true;
    this.maxDistance = 14;
  }

  // actors: iterable of { root, target, local, gain }
  //   root   — simulation node whose position/rotation.y the sim writes
  //   target — node to lean (a child of root, or root itself when local)
  //   local  — true when target === root (lean in its own frame)
  update(dt, actors, camera) {
    if (!this.enabled || dt <= 0) return;
    const maxD2 = this.maxDistance * this.maxDistance;
    for (const actor of actors) {
      const root = actor.root;
      let s = this.states.get(root);
      const x = root.position.x;
      const z = root.position.z;
      const yaw = root.rotation.y;
      if (!s) {
        s = { x, z, yaw, speed: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, parent: root.parent };
        this.states.set(root, s);
        continue;
      }
      const moved = Math.hypot(x - s.x, z - s.z);
      // discontinuities (sidewalk wrap, reparenting) are not motion
      const jumped = moved > 0.5 || s.parent !== root.parent;
      const speed = jumped ? s.speed : moved / dt;
      const yawRate = jumped ? 0 : angleDelta(s.yaw, yaw) / dt;
      const accel = (speed - s.speed) / dt;
      s.x = x; s.z = z; s.yaw = yaw; s.parent = root.parent;
      s.speed += (speed - s.speed) * (1 - Math.exp(-10 * dt));
      let targetRoll = 0;
      let targetPitch = 0;
      if (camera) {
        const dx = x - camera.x;
        const dz = z - camera.z;
        if (dx * dx + dz * dz > maxD2) targetRoll = targetPitch = 0;
        else {
          targetRoll = -centripetalLean(s.speed, yawRate, actor.gain ?? 0.6);
          targetPitch = Math.max(-0.05, Math.min(0.05, Math.atan(accel / GRAVITY) * 0.35));
        }
      }
      const r = criticalSpring(s.roll, s.rollV, targetRoll, 9, dt);
      s.roll = r.x; s.rollV = r.v;
      const p = criticalSpring(s.pitch, s.pitchV, targetPitch, 8, dt);
      s.pitch = p.x; s.pitchV = p.v;
    }
  }

  beforeRender(actors) {
    if (!this.enabled) return;
    for (const actor of actors) {
      const s = this.states.get(actor.root);
      if (!s || Math.abs(s.roll) + Math.abs(s.pitch) < 2e-4) continue;
      const target = actor.target;
      // a character faces +z: roll is about its forward axis, pitch about its side
      leanQuaternion.setFromEuler(leanEuler.set(s.pitch, 0, s.roll, 'XYZ'));
      const record = { target, local: actor.local };
      if (actor.local) {
        record.euler = target.rotation.clone();
        target.quaternion.multiply(leanQuaternion);
      } else {
        record.quaternion = target.quaternion.clone();
        target.quaternion.premultiply(leanQuaternion);
      }
      this.applied.push(record);
    }
  }

  afterRender() {
    for (let i = this.applied.length - 1; i >= 0; i -= 1) {
      const record = this.applied[i];
      // the sim reads Euler yaw, so local roots restore the exact Euler
      if (record.local) record.target.rotation.copy(record.euler);
      else record.target.quaternion.copy(record.quaternion);
    }
    this.applied.length = 0;
  }
}

// Patrons occasionally glance at the player when they come close: a social
// look-at that reuses the crowd's own gaze channel (and its head limits).
export class GazeDirector {
  constructor() {
    this.cooldowns = new WeakMap();
    this.timer = 0;
    this.time = 0;
    this.enabled = true;
  }

  update(dt, crowd, viewer, viewerMoving) {
    this.time += dt;
    const now = this.time;
    if (!this.enabled || !crowd || !viewer) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    for (const npc of crowd.npcs ?? []) {
      if (!npc.avatar || (npc.gazeT ?? 0) > 0 || BUSY_STATES.has(npc.state)) continue;
      const until = this.cooldowns.get(npc) ?? 0;
      if (now < until) continue;
      const p = npc.mesh.position;
      if (Math.abs(viewer.y - 1.4 - p.y) > 1.6) continue;
      const dx = viewer.x - p.x;
      const dz = viewer.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.2 || d < 0.45) continue;
      const facing = angleDelta(npc.mesh.rotation.y, Math.atan2(dx, dz));
      if (Math.abs(facing) > 1.75) continue; // behind them: they would not notice
      const closeness = 1 - d / 3.2;
      const chance = (viewerMoving ? 0.32 : 0.1) * closeness;
      if (Math.random() > chance) {
        this.cooldowns.set(npc, now + 1.2);
        continue;
      }
      npc.gazeWorld = new THREE.Vector3(viewer.x, viewer.y, viewer.z);
      npc.gazeT = 1.1 + Math.random() * 1.6;
      this.cooldowns.set(npc, now + 9 + Math.random() * 10);
    }
  }
}

const BUSY_STATES = new Set([
  'approachingDoorIn', 'approachingDoorOut', 'crossingDoorIn', 'crossingDoorOut',
  'holdingDoorIn', 'holdingDoorOut', 'waitingDoorIn', 'waitingDoorOut',
  'traversingStair', 'ordering', 'aligningSeat', 'standingSeat', 'transferred', 'gone',
]);
