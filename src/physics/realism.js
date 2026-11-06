import { PlayerMotor } from './playerMotor.js';
import { attachHingePhysics } from './hingeDoor.js';
import { AirField, SwayRig, SteamDisturbance } from './secondaryMotion.js';
import { ImpactAudio, impactLoudness } from './impactAudio.js';
import { TablePropPhysics } from './propPhysics.js';
import { BodyDynamics, GazeDirector } from './bodyDynamics.js';
import { detectPhysicsTier, PhysicsBudget } from './deviceTier.js';

// One owner for the café's physical layer. main.js forwards four hooks (sim
// step, frame, before/after render) plus the player's walk step; everything
// else lives here so the rest of the app keeps its existing contracts.

const PLAYER_RADIUS = 0.3;
const BUMP_MIN_SPEED = 0.45;
const AIR_RADIUS = 9;

export function collectTables(cafe) {
  const tables = [];
  const seen = new Map();
  for (const seat of cafe?.seats ?? []) {
    const c = seat.tableCenter;
    if (!c) continue;
    const key = `${c.x.toFixed(2)},${c.z.toFixed(2)}`;
    let table = seen.get(key);
    if (!table) {
      const shape = seat.supportShape;
      table = {
        key,
        x: shape?.center.x ?? c.x,
        z: shape?.center.z ?? c.z,
        y: seat.tableTopY ?? 0.81,
        levelId: seat.levelId ?? 'ground',
        yaw: -(shape?.rotation ?? 0),
        shape: shape?.kind === 'circle' || (!shape && seat.tableRadius) ? 'cylinder' : 'box',
        radius: shape?.radius ?? seat.tableRadius ?? 0.4,
        hx: shape?.kind === 'rect' ? shape.width / 2 : shape?.kind === 'ellipse' ? shape.rx * 0.85 : (seat.tableRadius ?? 0.4),
        hz: shape?.kind === 'rect' ? shape.depth / 2 : shape?.kind === 'ellipse' ? shape.rz * 0.85 : (seat.tableRadius ?? 0.4),
        seats: [],
      };
      seen.set(key, table);
      tables.push(table);
    }
    table.seats.push(seat);
  }
  return tables;
}

// distance from a point to a table's edge (negative inside)
function tableEdgeDistance(table, x, z) {
  const dx = x - table.x;
  const dz = z - table.z;
  if (table.shape === 'cylinder') return Math.hypot(dx, dz) - table.radius;
  const c = Math.cos(table.yaw);
  const s = Math.sin(table.yaw);
  const lx = Math.abs(dx * c - dz * s) - table.hx;
  const lz = Math.abs(dx * s + dz * c) - table.hz;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
}

export class RealismSystem {
  constructor({ audio = null, env = globalThis, looseProps = null } = {}) {
    this.device = detectPhysicsTier(env);
    this.enabled = this.device.tier !== 'off';
    this.motor = new PlayerMotor();
    this.motor.reducedMotion = this.device.reducedMotion;
    this.air = new AirField();
    this.impacts = new ImpactAudio(audio);
    this.props = new TablePropPhysics({
      useWorker: this.device.worker,
      onImpact: (material, position, intensity) => this.impacts.play(material, position, intensity),
    });
    this.body = new BodyDynamics();
    this.gaze = new GazeDirector();
    this.budget = new PhysicsBudget(2);
    this.budgetPinned = /[?&]physics=/.test(env.location?.search ?? '');
    this.looseProps = looseProps;
    this.player = { x: 0, y: 0, z: 0, walking: false, levelId: 'ground' };
    this.cafe = null;
    this.crowd = null;
    this.pets = null;
    this.door = null;
    this.sway = null;
    this.steam = null;
    this.tables = [];
    this.bumps = 0;
    this.costMs = 0;
    this._actors = [];
    this._contact = { x: 0, z: 0 };
    this._lastBumpAt = -Infinity;
    this._simTick = 0;
    this._clock = 0;
  }

  get level() { return this.enabled ? this.budget.level : -1; }

  attach({ cafe, crowd = null, pets = null, theme = null }) {
    this.detach();
    if (!cafe) return;
    // cord-hung fixtures are kept out of static merging for the rig; batch
    // them even when physics is off so they never cost a draw per part
    this.sway = new SwayRig(cafe.group);
    if (!this.enabled) {
      this._staticSway = this.sway;
      this.sway = null;
      return;
    }
    this.cafe = cafe;
    this.crowd = crowd;
    this.pets = pets;
    this.door = attachHingePhysics(cafe.entrance);
    this.steam = new SteamDisturbance(cafe.group);
    this.tables = collectTables(cafe);
    const open = !!(theme ?? cafe.theme)?.openAir;
    const rain = !!(theme ?? cafe.theme)?.rain;
    this.air.breeze = open ? (rain ? 0.95 : 0.6) : 0;
  }

  detach() {
    this.props.clear();
    this.sway?.reset();
    this.sway?.dispose();
    this._staticSway?.dispose();
    this._staticSway = null;
    if (this.crowd) this.crowd.playerAgent = null;
    this.cafe = this.crowd = this.pets = this.door = this.sway = this.steam = null;
    this.tables = [];
    this._actors.length = 0;
  }

  // The player stood up: start loading Rapier, since bumps only happen on foot.
  onStandUp(groundY) {
    this.motor.reset(groundY);
    if (this.enabled && this.budget.level >= 2) this.props.warm();
  }

  onSit() {
    this.motor.reset();
    this.player.walking = false;
    if (this.crowd) this.crowd.playerAgent = null;
  }

  // ---- player walk step hooks (called from main's walking branch) ----

  beginPlayerMove(proposed) {
    this._contact.x = proposed.x;
    this._contact.z = proposed.z;
  }

  // Called right after furniture collision. A push-out means the walker hit
  // something; hitting a table fast enough knocks it and rattles its props.
  notePlayerFurniture(proposed, levelId) {
    if (!this.cafe) return;
    const cx = proposed.x - this._contact.x;
    const cz = proposed.z - this._contact.z;
    const push = Math.hypot(cx, cz);
    if (push < 1e-4) return;
    const nx = cx / push;
    const nz = cz / push;
    const speedInto = -(this.motor.vx * nx + this.motor.vz * nz);
    if (speedInto < BUMP_MIN_SPEED || this._clock - this._lastBumpAt < 0.5) return;
    this._lastBumpAt = this._clock;
    let best = null;
    let bestDistance = 0.55;
    for (const table of this.tables) {
      if (table.levelId !== levelId) continue;
      const d = tableEdgeDistance(table, this._contact.x, this._contact.z);
      if (d < bestDistance) { best = table; bestDistance = d; }
    }
    const contactX = proposed.x - nx * PLAYER_RADIUS;
    const contactZ = proposed.z - nz * PLAYER_RADIUS;
    const loudness = impactLoudness(speedInto, 1.6);
    if (!best) {
      this.impacts.play('wood', { x: contactX, y: 0.7, z: contactZ }, loudness * 0.6);
      return;
    }
    this.bumps += 1;
    this.impacts.play('wood', { x: contactX, y: best.y, z: contactZ }, loudness);
    const objects = this._tableObjects(best);
    if (objects.length) this.props.bump(best, objects, -nx, -nz, speedInto);
  }

  _tableObjects(table) {
    const objects = new Set();
    for (const seat of table.seats) {
      for (const entry of seat.surfaceProps ?? []) if (entry.object?.parent) objects.add(entry.object);
      for (const entry of seat.npcTableProps ?? []) if (entry.object?.parent) objects.add(entry.object);
    }
    for (const object of this.looseProps?.() ?? []) {
      if (!object?.parent) continue;
      if (tableEdgeDistance(table, object.position.x, object.position.z) < 0
        && Math.abs(object.position.y - table.y) < 0.08) objects.add(object);
    }
    const group = this.cafe.group;
    return [...objects].filter((object) => object.parent === group);
  }

  // Door leaf vs player capsule (ground floor only).
  resolvePlayer(proposed, levelId) {
    if (!this.door || levelId !== 'ground') return false;
    return this.door.resolveActor(proposed, PLAYER_RADIUS);
  }

  updatePlayer(position, groundY, levelId, walking) {
    const p = this.player;
    p.x = position.x;
    p.y = groundY;
    p.z = position.z;
    p.levelId = levelId;
    p.walking = walking;
    if (!this.crowd) return;
    if (!walking) {
      this.crowd.playerAgent = null;
      return;
    }
    const agent = this.crowd.playerAgent ?? (this.crowd.playerAgent = { x: 0, y: 0, z: 0, vx: 0, vz: 0, radius: 0.32 });
    agent.x = p.x;
    agent.y = groundY;
    agent.z = p.z;
    agent.vx = this.motor.vx;
    agent.vz = this.motor.vz;
  }

  // ---- fixed-rate simulation (after café, crowd and pets have stepped) ----

  simStep(dt, viewer) {
    if (!this.cafe) return;
    const started = now();
    this._simTick += 1;
    const level = this.budget.level;
    const air = this.air;
    air.begin(dt);
    const vx = viewer?.x ?? 0;
    const vz = viewer?.z ?? 0;
    const near = (x, z) => (x - vx) * (x - vx) + (z - vz) * (z - vz) < AIR_RADIUS * AIR_RADIUS;
    if (this.player.walking) {
      air.addMover(this.player.x, this.player.y, this.player.z, this.motor.vx, this.motor.vz);
    }
    for (const npc of this.crowd?.npcs ?? []) {
      const v = npc.velocity;
      const p = npc.mesh?.position;
      if (!v || !p || !npc.path || !near(p.x, p.z)) continue;
      air.addMover(p.x, p.y, p.z, v.x, v.z);
    }
    for (const pet of this.pets?.pets ?? []) {
      const p = pet.mesh.position;
      if (near(p.x, p.z)) air.addMover(p.x, p.y, p.z, pet.velocity.x, pet.velocity.y, 0.5, 0.4);
    }
    this._doorAir(air);

    // half-rate secondary motion at the lowest budget
    if (this.sway?.size && (level >= 1 || this._simTick % 2 === 0)) {
      this.sway.update(level >= 1 ? dt : dt * 2, air);
    }
    if (level >= 1) this.steam?.update(dt, air);

    this._actors.length = 0;
    if (level >= 1) {
      for (const npc of this.crowd?.npcs ?? []) {
        if (!npc.mesh) continue;
        const target = npc.avatar?.inner ?? npc.mesh;
        this._actors.push({ root: npc.mesh, target, local: target === npc.mesh, gain: 0.6 });
      }
      for (const staff of [this.crowd?.waiter, this.crowd?.barista]) {
        if (!staff?.mesh) continue;
        const target = staff.avatar?.inner ?? staff.mesh;
        this._actors.push({ root: staff.mesh, target, local: target === staff.mesh, gain: 0.45 });
      }
      for (const pet of this.pets?.pets ?? []) {
        this._actors.push({ root: pet.mesh, target: pet.mesh, local: true, gain: 0.9 });
      }
      this.body.update(dt, this._actors, viewer);
    }
    this.gaze.update(dt, this.crowd, viewer, this.player.walking && this.motor.speed > 0.2);

    for (const event of this.door?.drainEvents() ?? []) {
      this.impacts.play('door', { x: event.x, y: 1.1, z: event.z }, impactLoudness(event.speed, 2.2));
    }
    this.costMs += (now() - started - this.costMs) * 0.05;
  }

  _doorAir(air) {
    const door = this.door;
    if (!door) {
      air.draught = null;
      return;
    }
    const a = door.angle;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const half = door.options.width * 0.5;
    // the leaf sweeps air along its normal; its middle moves at ω·w/2
    const sweep = -door.omega * half;
    if (Math.abs(sweep) > 0.05) {
      air.addGust(door.pivot.x + c * half, 0, door.pivot.z - s * half, s * sweep * 1.4, c * sweep * 1.4, 1.7);
    }
    const open = door.openness;
    if (open > 0.05) {
      // an open door lets the street draught in (stronger on blustery days);
      // the room is at -z of the front wall
      air.draught = air.draught ?? { x: 0, z: 0, inX: 0, inZ: -1, speed: 0, r2: 6.8, top: 2.3 };
      air.draught.x = door.pivot.x + door.options.width * 0.5;
      air.draught.z = door.pivot.z;
      air.draught.speed = (0.55 + this.air.breeze * 0.5) * open;
    } else {
      air.draught = null;
    }
  }

  // ---- per rendered frame ----

  frame(rawDt) {
    this._clock += Math.min(rawDt, 0.25);
    if (!this.enabled) return;
    if (!this.budgetPinned) this.budget.observe(rawDt);
    this.props.update(Math.min(rawDt, 0.05));
  }

  beforeRender() {
    if (this.cafe && this.budget.level >= 1) this.body.beforeRender(this._actors);
  }

  afterRender() {
    this.body.afterRender();
  }

  metrics() {
    return {
      physicsTier: this.device.tier,
      physicsLevel: this.level,
      physicsWorker: this.props.state,
      physicsAwakeProps: this.props.awakeProps,
      physicsSwayFixtures: this.sway?.size ?? 0,
      physicsSwayAwake: this.sway?.awakeCount ?? 0,
      physicsTableBumps: this.bumps,
      physicsImpactVoices: this.impacts.voices,
      physicsImpactsPlayed: this.impacts.played,
      physicsSimMs: Number(this.costMs.toFixed(3)),
      doorAngle: Number((this.door?.angle ?? 0).toFixed(3)),
      doorOmega: Number((this.door?.omega ?? 0).toFixed(3)),
    };
  }
}

function now() {
  return globalThis.performance?.now() ?? Date.now();
}
