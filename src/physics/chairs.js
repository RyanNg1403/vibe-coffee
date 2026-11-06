import * as THREE from 'three';
import { criticalSpring } from './playerMotor.js';

// Chairs that move like chairs. Patrons pull a chair out as they sit and
// scoot it back in, push it out as they stand (and may leave it there); a
// walking player shoves loose chairs aside with a scrape. Occupied chairs are
// held by their sitter. Offsets are planar (x, z, yaw) about each chair's
// own root and capped, so seat logic, picking and the table stay valid.
//
// Standard café chairs are instanced (seat, cushion, back, legs batches that
// share an instance index); lounge chairs and stools are individual objects
// and only budge a few centimetres.

const CHAIR_RADIUS = 0.24;
const MAX_OFFSET = 0.32;
const MAX_HEAVY_OFFSET = 0.06;
const MAX_TOWARD_TABLE = 0.05;
const SCOOT_OUT = 0.12;
const STAND_OUT = 0.15;
const _matrix = new THREE.Matrix4();
const _delta = new THREE.Matrix4();
const _rotation = new THREE.Matrix4();
const _translate = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function chairBatches(group, seatBatch) {
  const children = group.children;
  const start = children.indexOf(seatBatch);
  const n = seatBatch.count;
  const out = [];
  for (let i = start; i >= 0 && i < children.length && out.length < 4; i += 1) {
    const object = children[i];
    if (!object.isInstancedMesh || (object.count !== n && object.count !== n * 4)) break;
    out.push({ mesh: object, stride: object.count === n * 4 ? 4 : 1 });
  }
  return out.length ? out : [{ mesh: seatBatch, stride: 1 }];
}

export class ChairRig {
  constructor(cafe) {
    this.chairs = [];
    this.cafe = cafe;
    this.dirtyMeshes = new Set();
    const batchCache = new Map();
    (cafe?.seats ?? []).forEach((seat, seatIndex) => {
      const handle = seat.chair;
      if (!handle) return;
      const away = new THREE.Vector3().subVectors(seat.pos, seat.tableCenter).setY(0);
      if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
      away.normalize();
      const chair = {
        seatIndex, seat, away,
        levelId: seat.levelId ?? 'ground',
        x: 0, z: 0, yaw: 0, vx: 0, vz: 0, vyaw: 0,
        target: 0, scripted: false, settled: true,
        root: new THREE.Vector3(), parts: [], object: null, homeYaw: 0, heavy: false,
      };
      if (handle.isInstancedSeat) {
        if (!batchCache.has(handle.batch)) batchCache.set(handle.batch, chairBatches(cafe.group, handle.batch));
        for (const { mesh, stride } of batchCache.get(handle.batch)) {
          for (let k = 0; k < stride; k += 1) {
            const index = handle.instanceId * stride + k;
            const home = new THREE.Matrix4();
            mesh.getMatrixAt(index, home);
            chair.parts.push({ mesh, index, home });
          }
        }
        chair.parts[0].home.decompose(_position, _quaternion, _scale);
        chair.root.set(_position.x, 0, _position.z);
      } else if (handle.isObject3D) {
        chair.object = handle;
        chair.heavy = true;
        chair.homePosition = handle.position.clone();
        chair.homeYaw = handle.rotation.y;
        handle.getWorldPosition(chair.root).setY(0);
      } else {
        return;
      }
      this.chairs.push(chair);
    });
    this.scrapes = 0;
    this.lastScrapeAt = -Infinity;
    this.time = 0;
  }

  get size() { return this.chairs.length; }

  // Patrons drive chair scoots from their seat transitions.
  update(dt, crowd, playerSeat = -1, onScrape = null) {
    this.time += dt;
    const occupant = new Map();
    for (const npc of crowd?.npcs ?? []) {
      if (npc.seatIndex >= 0) occupant.set(npc.seatIndex, npc);
    }
    for (const chair of this.chairs) {
      const npc = occupant.get(chair.seatIndex);
      let target = null;
      if (npc && !chair.heavy) {
        const t = npc.stateT ?? 0;
        if (npc.state === 'aligningSeat') {
          // pull it out while lowering, scoot back in to sit
          target = SCOOT_OUT * Math.sin(Math.PI * Math.min(1, t / 0.9));
          if (t < dt * 1.5) this._scrape(chair, onScrape, 0.8);
        } else if (npc.state === 'standingSeat') {
          target = STAND_OUT * Math.min(1, t / 0.35);
        } else if (npc.state === 'sitting') {
          target = 0;
        }
      } else if (chair.seatIndex === playerSeat && !chair.heavy) {
        target = 0;
      }
      chair.scripted = target !== null;
      if (target === null) {
        if (chair.settled) continue;
        // a loose chair glides to rest from its last shove
        const k = Math.exp(-dt * 9);
        chair.vx *= k; chair.vz *= k; chair.vyaw *= k;
        chair.x += chair.vx * dt; chair.z += chair.vz * dt; chair.yaw += chair.vyaw * dt;
        this._limit(chair);
        if (Math.abs(chair.vx) + Math.abs(chair.vz) + Math.abs(chair.vyaw) < 1e-3) chair.settled = true;
        this._apply(chair);
        continue;
      }
      // the sitter moves the chair along its seat axis, squaring it up
      const tx = chair.away.x * target;
      const tz = chair.away.z * target;
      const sx = criticalSpring(chair.x, chair.vx, tx, 11, dt);
      const sz = criticalSpring(chair.z, chair.vz, tz, 11, dt);
      const sy = criticalSpring(chair.yaw, chair.vyaw, 0, 8, dt);
      const changed = Math.abs(sx.x - chair.x) + Math.abs(sz.x - chair.z) + Math.abs(sy.x - chair.yaw) > 1e-5;
      chair.x = sx.x; chair.vx = sx.v;
      chair.z = sz.x; chair.vz = sz.v;
      chair.yaw = sy.x; chair.vyaw = sy.v;
      if (changed) {
        chair.settled = false;
        this._apply(chair);
      }
    }
    this.flush();
  }

  // Walking player vs loose chairs. Returns whether anything was touched.
  resolvePlayer(position, levelId, radius, motor, onScrape = null) {
    let touched = false;
    const reach = radius + CHAIR_RADIUS;
    for (const chair of this.chairs) {
      if (chair.levelId !== levelId) continue;
      const cx = chair.root.x + chair.x;
      const cz = chair.root.z + chair.z;
      const dx = cx - position.x;
      const dz = cz - position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const nx = dx / d;
      const nz = dz / d;
      const overlap = reach - d;
      touched = true;
      if (chair.scripted) {
        // held by its sitter: it is furniture now
        position.x -= nx * overlap;
        position.z -= nz * overlap;
        continue;
      }
      // a chair yields most of the overlap; its friction pushes back the rest
      const share = chair.heavy ? 0.25 : 0.75;
      const beforeX = chair.x;
      const beforeZ = chair.z;
      chair.x += nx * overlap * share;
      chair.z += nz * overlap * share;
      this._limit(chair);
      const movedX = chair.x - beforeX;
      const movedZ = chair.z - beforeZ;
      const moved = Math.hypot(movedX, movedZ);
      // whatever the chair could not take, the player must
      const blocked = overlap - moved;
      position.x -= nx * blocked;
      position.z -= nz * blocked;
      // an off-centre shove turns the chair a little
      const lateral = motor ? (motor.vx * -nz + motor.vz * nx) : 0;
      chair.vyaw += THREE.MathUtils.clamp(lateral * 0.6, -1.5, 1.5) * (chair.heavy ? 0.2 : 1);
      chair.vx = motor?.vx ?? 0;
      chair.vz = motor?.vz ?? 0;
      chair.settled = false;
      const speed = motor ? Math.hypot(motor.vx, motor.vz) : 0;
      if (moved > 1e-4) {
        this._apply(chair);
        if (speed > 0.6) this._scrape(chair, onScrape, Math.min(1, speed / 2));
      }
    }
    if (touched) this.flush();
    return touched;
  }

  _limit(chair) {
    // never into the table, never far from its place
    const toward = -(chair.x * chair.away.x + chair.z * chair.away.z);
    if (toward > MAX_TOWARD_TABLE) {
      chair.x += chair.away.x * (toward - MAX_TOWARD_TABLE);
      chair.z += chair.away.z * (toward - MAX_TOWARD_TABLE);
      chair.vx = chair.vz = 0;
    }
    const max = chair.heavy ? MAX_HEAVY_OFFSET : MAX_OFFSET;
    const r = Math.hypot(chair.x, chair.z);
    if (r > max) {
      chair.x *= max / r;
      chair.z *= max / r;
      chair.vx = chair.vz = 0;
    }
    chair.yaw = THREE.MathUtils.clamp(chair.yaw, -0.5, 0.5);
  }

  _scrape(chair, onScrape, loudness) {
    if (!onScrape || this.time - this.lastScrapeAt < 0.35) return;
    this.lastScrapeAt = this.time;
    this.scrapes += 1;
    onScrape(chair.root.x + chair.x, chair.root.z + chair.z, loudness);
  }

  _apply(chair) {
    if (chair.object) {
      const parent = chair.object.parent;
      _position.copy(chair.homePosition);
      if (parent) {
        parent.localToWorld(_position);
        _position.x += chair.x;
        _position.z += chair.z;
        parent.worldToLocal(_position);
      }
      chair.object.position.copy(_position);
      chair.object.rotation.y = chair.homeYaw + chair.yaw;
      return;
    }
    // offset = translate(root + offset) · rotateY(yaw) · translate(-root)
    _translate.makeTranslation(-chair.root.x, 0, -chair.root.z);
    _rotation.makeRotationY(chair.yaw);
    _delta.makeTranslation(chair.root.x + chair.x, 0, chair.root.z + chair.z).multiply(_rotation).multiply(_translate);
    for (const part of chair.parts) {
      part.mesh.setMatrixAt(part.index, _matrix.multiplyMatrices(_delta, part.home));
      this.dirtyMeshes.add(part.mesh);
    }
  }

  flush() {
    for (const mesh of this.dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    this.dirtyMeshes.clear();
  }

  offsetOf(seatIndex) {
    const chair = this.chairs.find((c) => c.seatIndex === seatIndex);
    return chair ? Math.hypot(chair.x, chair.z) : 0;
  }
}
