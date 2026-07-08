// Café customers + barista: low-poly characters with a simple life cycle —
// walk in, order at the counter, sit for a while, head back out.

import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SKIN_TONES = [0xf1c9a5, 0xe0ac7e, 0xc68a5b, 0x9c6b43, 0x71492c, 0x513425];
const SHIRT = [0x7a5c8f, 0x4a7a6f, 0xa85751, 0x4f6d9c, 0xb08d4f, 0x5a5f66, 0x8a4a68, 0x3f6b4f];
const PANTS = [0x37414f, 0x4a4038, 0x2f3438, 0x5a4a5f, 0x39504a];
const HAIR = [0x241a12, 0x3f2a17, 0x6b4a26, 0x8a8a8a, 0x151515, 0x743e21];

function makePerson() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: pick(SKIN_TONES), roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: pick(SHIRT), roughness: 0.95 });
  const pants = new THREE.MeshStandardMaterial({ color: pick(PANTS), roughness: 0.95 });
  const hair = new THREE.MeshStandardMaterial({ color: pick(HAIR), roughness: 0.95 });

  const parts = {};

  // legs (pivot at hip so they can swing / fold when sitting)
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.09, 0.5, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.36, 3, 8), pants);
    leg.position.y = -0.24;
    leg.castShadow = true;
    hip.add(leg);
    g.add(hip);
    parts[side === -1 ? 'legL' : 'legR'] = hip;
  }

  // torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.34, 4, 10), shirt);
  torso.position.y = 0.82;
  torso.castShadow = true;
  g.add(torso);
  parts.torso = torso;

  // arms
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0.98, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.3, 3, 8), shirt);
    arm.position.y = -0.19;
    arm.castShadow = true;
    shoulder.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
    hand.position.y = -0.38;
    shoulder.add(hand);
    g.add(shoulder);
    parts[side === -1 ? 'armL' : 'armR'] = shoulder;
  }

  // head
  const headG = new THREE.Group();
  headG.position.y = 1.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
  head.castShadow = true;
  headG.add(head);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * (Math.random() < 0.25 ? 0.35 : 0.52)),
    hair
  );
  cap.position.y = 0.015;
  headG.add(cap);
  g.add(headG);
  parts.head = headG;

  // a to-go cup they sometimes hold
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.028, 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xece5d8, roughness: 0.6 })
  );
  cup.position.set(0, -0.38, 0.05);
  cup.visible = false;
  parts.armR.add(cup);
  parts.cup = cup;

  g.userData.parts = parts;
  return g;
}

// waypoint path through the central aisle so people don't cut through tables
function routeBetween(a, b, corridorX) {
  const pts = [a.clone()];
  const ax = Math.abs(a.x - corridorX) > 0.4;
  const bx = Math.abs(b.x - corridorX) > 0.4;
  if (ax) pts.push(new THREE.Vector3(corridorX, 0, a.z));
  if (ax || bx) pts.push(new THREE.Vector3(corridorX, 0, b.z));
  pts.push(b.clone());
  return pts;
}

class NPC {
  constructor(sim, seatIndex) {
    this.sim = sim;
    this.mesh = makePerson();
    this.mesh.scale.setScalar(rand(0.92, 1.05));
    this.seatIndex = seatIndex;
    this.state = 'entering';
    this.stateT = 0;
    this.path = null;
    this.pathI = 0;
    this.walkPhase = rand(0, 10);
    this.speed = rand(0.75, 1.05);
    this.sitDuration = rand(35, 120);
    this.orderTime = rand(4, 9);
    this.bodyYaw = Math.PI;
    this.sitY = -0.10;

    const { nav } = sim.cafe;
    this.mesh.position.copy(nav.door);
    this._walkTo(nav.counter);
    sim.cafe.group.add(this.mesh);
    if (sim.audio?.started) sim.audio.playChime();
  }

  _walkTo(target) {
    this.path = routeBetween(this.mesh.position, target, this.sim.cafe.nav.corridorX);
    this.pathI = 1;
  }

  _setPose(sitting) {
    const p = this.mesh.userData.parts;
    if (sitting) {
      p.legL.rotation.x = p.legR.rotation.x = -Math.PI / 2.3;
      this.mesh.position.y = this.sitY;
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      this.mesh.position.y = 0;
    }
  }

  update(dt, t) {
    this.stateT += dt;
    const p = this.mesh.userData.parts;
    const seat = this.sim.cafe.seats[this.seatIndex];

    const walking = this.state === 'entering' || this.state === 'toSeat' || this.state === 'leaving';

    if (walking && this.path) {
      const target = this.path[this.pathI];
      const pos = this.mesh.position;
      const dir = new THREE.Vector3(target.x - pos.x, 0, target.z - pos.z);
      const dist = dir.length();
      if (dist < 0.06) {
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = null;
          this._arrived();
        }
      } else {
        dir.normalize();
        pos.addScaledVector(dir, this.speed * dt);
        this.bodyYaw = Math.atan2(dir.x, dir.z);
      }
      // walk cycle
      this.walkPhase += dt * 7 * this.speed;
      const s = Math.sin(this.walkPhase);
      p.legL.rotation.x = s * 0.55;
      p.legR.rotation.x = -s * 0.55;
      p.armL.rotation.x = -s * 0.4;
      p.armR.rotation.x = p.cup.visible ? -0.9 : s * 0.4;
      this.mesh.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.03;
      this.mesh.rotation.y = this.bodyYaw;
    } else if (this.state === 'ordering') {
      this._setPose(false);
      this.mesh.rotation.y = Math.PI; // face the counter/barista
      p.armL.rotation.x = Math.sin(t * 1.4 + this.walkPhase) * 0.08;
      p.armR.rotation.x = Math.sin(t * 1.2 + this.walkPhase) * 0.08;
      p.head.rotation.y = Math.sin(t * 0.7 + this.walkPhase) * 0.15;
      if (this.stateT > this.orderTime) {
        p.cup.visible = true;
        if (this.seatIndex >= 0) {
          this.state = 'toSeat';
          this.stateT = 0;
          this._walkTo(this.sim.cafe.seats[this.seatIndex].pos);
        } else {
          this.state = 'leaving';
          this.stateT = 0;
          this._walkTo(this.sim.cafe.nav.door);
        }
      }
    } else if (this.state === 'sitting') {
      this._setPose(true);
      // face the table
      const look = seat.tableCenter;
      this.mesh.rotation.y = Math.atan2(look.x - seat.pos.x, look.z - seat.pos.z);
      // idle: breathe, look around, sip sometimes
      p.torso.scale.y = 1 + Math.sin(t * 1.8 + this.walkPhase) * 0.012;
      p.head.rotation.y = Math.sin(t * 0.34 + this.walkPhase) * 0.4;
      p.head.rotation.x = Math.sin(t * 0.5 + this.walkPhase * 2) * 0.06;
      const sipCycle = (t * 0.14 + this.walkPhase) % 1;
      p.armR.rotation.x = sipCycle < 0.12 ? -1.9 : -0.6;
      p.armL.rotation.x = -0.5;
      if (sipCycle > 0.11 && sipCycle < 0.12 && Math.random() < 0.02 && this.sim.audio?.started) {
        this.sim.audio.playClink();
      }
      if (this.stateT > this.sitDuration) {
        this.state = 'leaving';
        this.stateT = 0;
        this._setPose(false);
        this._walkTo(this.sim.cafe.nav.door);
        this.sim.releaseSeat(this.seatIndex);
        this.seatIndex = -1;
      }
    } else if (this.state === 'gone') {
      // handled by sim
    }
  }

  _arrived() {
    if (this.state === 'entering') {
      this.state = 'ordering';
      this.stateT = 0;
    } else if (this.state === 'toSeat') {
      this.state = 'sitting';
      this.stateT = 0;
      const seat = this.sim.cafe.seats[this.seatIndex];
      this.sitY = seat.pos.y > 0.05 ? 0.07 : -0.10; // stools sit higher
      this.mesh.position.set(seat.pos.x, 0, seat.pos.z);
      this._setPose(true);
    } else if (this.state === 'leaving') {
      this.state = 'gone';
    }
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

class Barista {
  constructor(sim) {
    this.sim = sim;
    this.mesh = makePerson();
    // apron
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.34, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 })
    );
    apron.position.set(0, 0.82, 0.13);
    this.mesh.add(apron);
    this.home = sim.cafe.nav.baristaHome.clone();
    this.mesh.position.copy(this.home);
    this.mesh.rotation.y = 0; // face the room (+z)
    this.phase = rand(0, 10);
    this.targetX = this.home.x;
    sim.cafe.group.add(this.mesh);
  }

  update(dt, t) {
    const p = this.mesh.userData.parts;
    // shuffle side to side behind the counter now and then
    if (Math.random() < 0.003) this.targetX = this.home.x + rand(-1.6, 1.6);
    const dx = this.targetX - this.mesh.position.x;
    if (Math.abs(dx) > 0.05) {
      this.mesh.position.x += Math.sign(dx) * dt * 0.6;
      this.phase += dt * 6;
      const s = Math.sin(this.phase);
      p.legL.rotation.x = s * 0.4;
      p.legR.rotation.x = -s * 0.4;
      this.mesh.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      this.mesh.rotation.y = 0;
      // busy hands: wiping, tamping
      p.armL.rotation.x = -0.7 + Math.sin(t * 2.6 + this.phase) * 0.25;
      p.armR.rotation.x = -0.7 + Math.sin(t * 2.2 + this.phase + 1) * 0.25;
      p.head.rotation.y = Math.sin(t * 0.4 + this.phase) * 0.3;
    }
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

export class CrowdSim {
  constructor(cafe, audio) {
    this.cafe = cafe;
    this.audio = audio;
    this.npcs = [];
    this.takenSeats = new Set();
    this.playerSeat = -1;
    this.barista = new Barista(this);
    this.spawnCooldown = 1.5;

    // pre-seat a few customers so the café never starts empty
    const initial = Math.min(3 + Math.floor(Math.random() * 3), 5);
    for (let i = 0; i < initial; i++) {
      const seat = this._freeSeat();
      if (seat < 0) break;
      this.takenSeats.add(seat);
      const npc = new NPC(this, seat);
      npc.state = 'sitting';
      npc.stateT = rand(0, 30);
      npc.path = null;
      npc.mesh.userData.parts.cup.visible = Math.random() < 0.7;
      const s = this.cafe.seats[seat];
      npc.sitY = s.pos.y > 0.05 ? 0.07 : -0.10;
      npc.mesh.position.set(s.pos.x, 0, s.pos.z);
      npc._setPose(true);
      this.npcs.push(npc);
    }
  }

  setPlayerSeat(i) {
    this.playerSeat = i;
  }

  _freeSeat() {
    const free = [];
    for (let i = 0; i < this.cafe.seats.length; i++) {
      if (i !== this.playerSeat && !this.takenSeats.has(i)) {
        // don't let an NPC sit at the player's table either — a bit of personal space
        const playerTable = this.playerSeat >= 0 ? this.cafe.seats[this.playerSeat].tableCenter : null;
        if (playerTable && this.cafe.seats[i].tableCenter.distanceTo(playerTable) < 0.01) continue;
        free.push(i);
      }
    }
    return free.length ? pick(free) : -1;
  }

  update(dt, t) {
    this.barista.update(dt, t);

    this.spawnCooldown -= dt;
    const active = this.npcs.length;
    if (this.spawnCooldown <= 0 && active < 8) {
      this.spawnCooldown = rand(8, 26);
      const seat = this._freeSeat();
      // sometimes someone just grabs a coffee to go
      const toGo = Math.random() < 0.25;
      const npc = new NPC(this, toGo ? -1 : seat);
      if (!toGo && seat >= 0) this.takenSeats.add(seat);
      this.npcs.push(npc);
    }

    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      npc.update(dt, t);
      if (npc.state === 'gone') {
        npc.dispose();
        this.npcs.splice(i, 1);
      }
    }
  }

  releaseSeat(i) {
    this.takenSeats.delete(i);
  }

  isSeatTaken(i) {
    return this.takenSeats.has(i);
  }

  dispose() {
    this.npcs.forEach((n) => n.dispose());
    this.barista.dispose();
    this.npcs = [];
  }
}
