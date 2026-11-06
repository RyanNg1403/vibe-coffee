import * as THREE from 'three';
import { criticalSpring } from './playerMotor.js';

// Procedural IK layered over the authored clips, applied only around the
// render call and removed afterwards (like the body lean), so the mixer, the
// motion interpolator and steering never see it.
//
// Look-at: the crowd's gaze channel only twists the head about its own axis.
// Here the face direction is measured from the rig (Head -> headfront) and
// the remaining error to the gaze point is closed with a weighted head/neck
// rotation, pitch included; large turns recruit the neck and upper spine.
//
// Feet: on stair flights the root rides the navigation ramp while the drawn
// treads are steps, so feet sink into one tread and hover over the next. A
// two-bone leg solve plants each foot on the tread under it.

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAX_LOOK_CORRECTION = 0.55;  // rad beyond what the clip + gaze twist give
const MAX_SPINE_TWIST = 0.45;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _worldQ = new THREE.Quaternion();
const _endWorldQ = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();

function findBone(root, ...names) {
  const wanted = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''));
  let found = null;
  root.traverse((node) => {
    if (found || !node.isBone) return;
    const name = node.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.includes(name)) found = node;
  });
  return found;
}

// Rotate `bone` by a world-space rotation `q` (pre-multiplied in world space).
export function rotateBoneWorld(bone, q) {
  bone.getWorldQuaternion(_worldQ);
  _worldQ.premultiply(q);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_parentQ).invert();
    _worldQ.premultiply(_parentQ);
  }
  bone.quaternion.copy(_worldQ);
  bone.updateMatrixWorld(true);
}

// Analytic two-bone solve: bend `middle` so |upper→end| matches the target
// distance, then swing `upper` so the chain reaches it. `end` keeps its world
// orientation. Returns the remaining miss distance.
export function solveTwoBone(upper, middle, end, target) {
  upper.getWorldPosition(_a);
  middle.getWorldPosition(_b);
  end.getWorldPosition(_c);
  end.getWorldQuaternion(_endWorldQ);
  const la = _a.distanceTo(_b);
  const lb = _b.distanceTo(_c);
  if (la < 1e-5 || lb < 1e-5) return Infinity;
  const lt = THREE.MathUtils.clamp(_a.distanceTo(target), Math.abs(la - lb) + 1e-4, la + lb - 1e-4);
  _u.subVectors(_a, _b).normalize();
  _v.subVectors(_c, _b).normalize();
  const current = Math.acos(THREE.MathUtils.clamp(_u.dot(_v), -1, 1));
  const wanted = Math.acos(THREE.MathUtils.clamp((la * la + lb * lb - lt * lt) / (2 * la * lb), -1, 1));
  _n.crossVectors(_v, _u);
  if (_n.lengthSq() > 1e-10) {
    // rotating v about cross(v, u) swings it toward u, closing the knee
    _n.normalize();
    rotateBoneWorld(middle, _q.setFromAxisAngle(_n, current - wanted));
  }
  end.getWorldPosition(_c);
  _u.subVectors(_c, _a).normalize();
  _v.subVectors(target, _a).normalize();
  rotateBoneWorld(upper, _q.setFromUnitVectors(_u, _v));
  // restore the foot's own world orientation
  middle.getWorldQuaternion(_parentQ).invert();
  end.quaternion.copy(_endWorldQ).premultiply(_parentQ);
  end.updateMatrixWorld(true);
  end.getWorldPosition(_c);
  return _c.distanceTo(target);
}

// Height of the drawn tread under (x, z) on a stair flight, else null.
export function treadHeightAt(flights, x, z, steps = 10) {
  for (const f of flights) {
    if (x < f.x0 || x > f.x1) continue;
    const zMin = Math.min(f.z0, f.z1);
    const zMax = Math.max(f.z0, f.z1);
    if (z < zMin || z > zMax) continue;
    const run = f.z1 - f.z0;
    const i = THREE.MathUtils.clamp(Math.floor(((z - f.z0) / run) * steps), 0, steps - 1);
    return f.y0 + ((f.y1 - f.y0) / steps) * (i + 1);
  }
  return null;
}

function rigOf(avatar) {
  if (avatar._ikRig !== undefined) return avatar._ikRig;
  const root = avatar.inner ?? avatar.root;
  const bones = avatar.bones ?? {};
  const head = bones.Head ?? findBone(root, 'Head');
  const rig = {
    head,
    neck: bones.Neck ?? findBone(root, 'neck'),
    spine: findBone(root, 'Spine02', 'Spine2', 'Chest', 'Torso'),
    face: findBone(root, 'headfront'),
    legs: [
      [bones.LeftUpLeg, bones.LeftLeg, findBone(root, 'LeftFoot', 'Foot.L', 'FootL')],
      [bones.RightUpLeg, bones.RightLeg, findBone(root, 'RightFoot', 'Foot.R', 'FootR')],
    ].filter((leg) => leg.every(Boolean)),
  };
  avatar._ikRig = head ? rig : null;
  return avatar._ikRig;
}

export class CharacterIK {
  constructor() {
    this.states = new WeakMap();
    this.saved = [];
    this._pool = [];
    this.flights = [];
    this.maxLookActors = 8;
    this.maxDistance = 10;
    this.lookEnabled = true;
    this.feetEnabled = true;
    this.lookApplied = 0;
    this.feetApplied = 0;
  }

  setStairs(deck) {
    const stair = deck?.stair;
    this.flights = stair ? [stair.flightA, stair.flightB].filter(Boolean) : [];
  }

  // Simulation rate: ease each patron's look weight in and out.
  update(dt, npcs) {
    for (const npc of npcs) {
      if (!npc.avatar) continue;
      let s = this.states.get(npc);
      if (!s) { s = { weight: 0, velocity: 0 }; this.states.set(npc, s); }
      const target = npc.gazeT > 0 && npc.gazeWorld ? 1 : 0;
      const spring = criticalSpring(s.weight, s.velocity, target, 6, dt);
      s.weight = THREE.MathUtils.clamp(spring.x, 0, 1);
      s.velocity = spring.v;
      if (target) s.gaze = npc.gazeWorld;
    }
  }

  beforeRender(npcs, viewer) {
    this.lookApplied = 0;
    this.feetApplied = 0;
    const maxD2 = this.maxDistance * this.maxDistance;
    for (const npc of npcs) {
      const avatar = npc.avatar;
      if (!avatar || !npc.mesh?.parent) continue;
      const p = npc.mesh.position;
      if (viewer && (p.x - viewer.x) ** 2 + (p.z - viewer.z) ** 2 > maxD2) continue;
      const s = this.states.get(npc);
      const looking = this.lookEnabled && s && s.weight > 0.01 && s.gaze && this.lookApplied < this.maxLookActors;
      const onStairs = this.feetEnabled && this.flights.length && npc.state === 'traversingStair';
      if (!looking && !onStairs) continue;
      const rig = rigOf(avatar);
      if (!rig) continue;
      npc.mesh.updateMatrixWorld(true);
      if (looking) {
        this._look(rig, s.gaze, s.weight, npc.mesh);
        this.lookApplied += 1;
      }
      if (onStairs) this.feetApplied += this._plant(rig);
    }
  }

  _save(bone) {
    const slot = this._pool[this.saved.length / 2] ??= new THREE.Quaternion();
    this.saved.push(bone, slot.copy(bone.quaternion));
  }

  _look(rig, gaze, weight, body) {
    const { head, neck, spine, face } = rig;
    head.getWorldPosition(_a);
    _t.set(gaze.x, gaze.y ?? _a.y, gaze.z).sub(_a);
    if (_t.lengthSq() < 0.04) return;
    _t.normalize();
    // large turns: neck and upper spine take the part the head cannot
    const bodyYaw = body.rotation.y;
    let yawError = Math.atan2(_t.x, _t.z) - bodyYaw;
    yawError = Math.atan2(Math.sin(yawError), Math.cos(yawError));
    const excess = Math.sign(yawError) * Math.max(0, Math.abs(yawError) - 0.95);
    const twist = THREE.MathUtils.clamp(excess, -MAX_SPINE_TWIST, MAX_SPINE_TWIST) * weight;
    if (Math.abs(twist) > 1e-3) {
      if (spine) { this._save(spine); rotateBoneWorld(spine, _q.setFromAxisAngle(WORLD_UP, twist * 0.55)); }
      if (neck) { this._save(neck); rotateBoneWorld(neck, _q.setFromAxisAngle(WORLD_UP, twist * 0.45)); }
    }
    if (!face) return;
    head.getWorldPosition(_a);
    face.getWorldPosition(_b);
    _u.subVectors(_b, _a);
    if (_u.lengthSq() < 1e-8) return;
    _u.normalize();
    _q.setFromUnitVectors(_u, _t);
    // cap the correction so a target behind the shoulder never snaps the neck
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(_q.w), 0, 1));
    const limit = Math.min(1, MAX_LOOK_CORRECTION / Math.max(angle, 1e-6));
    _q2.copy(IDENTITY).slerp(_q, Math.min(1, limit) * weight);
    if (neck) {
      this._save(neck);
      rotateBoneWorld(neck, _q.copy(IDENTITY).slerp(_q2, 0.3));
    }
    this._save(head);
    head.getWorldPosition(_a);
    face.getWorldPosition(_b);
    _u.subVectors(_b, _a).normalize();
    _q.setFromUnitVectors(_u, _t);
    _q2.copy(IDENTITY).slerp(_q, Math.min(1, limit) * weight);
    rotateBoneWorld(head, _q2);
  }

  _plant(rig) {
    let planted = 0;
    for (const [upper, middle, end] of rig.legs) {
      end.getWorldPosition(_c);
      const tread = treadHeightAt(this.flights, _c.x, _c.z);
      if (tread === null) continue;
      // the clip keeps the ankle ~8 cm above the sole it was authored on
      const ankle = 0.08;
      const delta = tread + ankle - _c.y;
      // lift a sinking foot fully; plant a hovering one only when close
      if (delta < -0.07 || Math.abs(delta) < 0.004) continue;
      this._save(upper);
      this._save(middle);
      this._save(end);
      _t.set(_c.x, _c.y + delta, _c.z);
      solveTwoBone(upper, middle, end, _t);
      planted += 1;
    }
    return planted;
  }

  afterRender() {
    // restore in reverse so overlapping saves unwind to the clip pose
    for (let i = this.saved.length - 2; i >= 0; i -= 2) this.saved[i].quaternion.copy(this.saved[i + 1]);
    this.saved.length = 0;
  }
}
