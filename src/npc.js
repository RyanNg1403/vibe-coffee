// Café life v2. Customers run a full behavior loop:
//   enter -> join the queue -> order at the register -> wait at pickup
//   -> find a seat -> do something (laptop / book / phone / chat) -> leave
// Pairs come in together, sit at the same table and chat. Walkers steer
// around each other. Outside, pedestrians pass the windows.
// The barista mirrors the queue: takes orders at the register, brews at
// the machine (synced with the espresso sound), and putters when idle.

import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SKIN_TONES = [0xf1c9a5, 0xe0ac7e, 0xc68a5b, 0x9c6b43, 0x71492c, 0x513425];
const SHIRT = [0x7a5c8f, 0x4a7a6f, 0xa85751, 0x4f6d9c, 0xb08d4f, 0x5a5f66, 0x8a4a68, 0x3f6b4f, 0x946b52, 0x6b7f5a];
const PANTS = [0x37414f, 0x4a4038, 0x2f3438, 0x5a4a5f, 0x39504a, 0x54452f];
const HAIR = [0x241a12, 0x3f2a17, 0x6b4a26, 0x8a8a8a, 0x151515, 0x743e21, 0x4a3b32];

export function makePerson(tint = 1) {
  const g = new THREE.Group();
  const dim = (c) => new THREE.Color(c).multiplyScalar(tint);
  const skin = new THREE.MeshStandardMaterial({ color: dim(pick(SKIN_TONES)), roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: dim(pick(SHIRT)), roughness: 0.95 });
  const pants = new THREE.MeshStandardMaterial({ color: dim(pick(PANTS)), roughness: 0.95 });
  const hair = new THREE.MeshStandardMaterial({ color: dim(pick(HAIR)), roughness: 0.95 });

  const parts = {};

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

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.34, 4, 10), shirt);
  torso.position.y = 0.82;
  torso.castShadow = true;
  g.add(torso);
  parts.torso = torso;

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

  // to-go cup, hidden until they've ordered
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.028, 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xece5d8, roughness: 0.6 })
  );
  cup.position.set(0, -0.38, 0.05);
  cup.visible = false;
  parts.armR.add(cup);
  parts.cup = cup;

  // soft contact-shadow blob so people feel grounded
  const blobTex = personBlobTexture();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.62),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  g.add(blob);
  parts.blob = blob;

  g.userData.parts = parts;
  return g;
}

let _blobTex = null;
function personBlobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

function routeBetween(a, b, corridorX) {
  const pts = [a.clone()];
  const ax = Math.abs(a.x - corridorX) > 0.4;
  const bx = Math.abs(b.x - corridorX) > 0.4;
  if (ax) pts.push(new THREE.Vector3(corridorX, 0, a.z));
  if (ax || bx) pts.push(new THREE.Vector3(corridorX, 0, b.z));
  pts.push(b.clone());
  return pts;
}

// seated activities and their props
const ACTIVITIES = ['laptop', 'book', 'phone', 'none', 'laptop', 'book'];

function makeLaptop() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.2), bodyMat);
  g.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.19, 0.01), bodyMat);
  lid.position.set(0, 0.09, -0.1);
  lid.rotation.x = 0.28;
  g.add(lid);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.27, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xbfd4e8 })
  );
  screen.position.set(0, 0.09, -0.093);
  screen.rotation.x = 0.28;
  g.add(screen);
  g.userData.screen = screen;
  return g;
}

function makeBook() {
  const g = new THREE.Group();
  const cover = new THREE.MeshStandardMaterial({ color: pick([0x8a3b2e, 0x2e5e6e, 0x777a3c, 0x5d3f6e]), roughness: 0.9 });
  const pages = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.95 });
  for (const s of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.16), cover);
    half.position.x = s * 0.055;
    half.rotation.z = -s * 0.35;
    g.add(half);
    const pg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.15), pages);
    pg.position.set(s * 0.05, 0.008, 0);
    pg.rotation.z = -s * 0.35;
    g.add(pg);
  }
  return g;
}

function makePhone() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.09, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.3, emissive: 0x6a7c96, emissiveIntensity: 0.7 })
  );
}

class NPC {
  constructor(sim, opts = {}) {
    this.sim = sim;
    this.mesh = makePerson();
    this.mesh.scale.setScalar(rand(0.9, 1.06));
    this.seatIndex = opts.seatIndex ?? -1;
    this.partner = null;            // set for pairs
    this.activity = opts.activity ?? pick(ACTIVITIES);
    this.state = 'entering';
    this.stateT = 0;
    this.path = null;
    this.pathI = 0;
    this.walkPhase = rand(0, 10);
    this.speed = rand(0.72, 1.05);
    this.sitDuration = rand(40, 150);
    this.orderTime = rand(3.5, 7);
    this.sitY = -0.10;
    this.props = [];
    this.headTarget = 0;            // desired head yaw offset
    this.glanceT = rand(2, 8);

    const { nav } = sim.cafe;
    this.mesh.position.copy(nav.door);
    this.mesh.position.x += rand(-0.15, 0.15);
    sim.cafe.group.add(this.mesh);
    if (!opts.silent && sim.audio?.started) sim.audio.playChime();

    // head straight to the back of the queue
    this.queueIndex = sim.queue.length;
    sim.queue.push(this);
    this.state = 'queueing';
    this._walkTo(sim.queueSlot(this.queueIndex));
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

  _addProps() {
    const seat = this.sim.cafe.seats[this.seatIndex];
    if (!seat || this.activity === 'none' || this.activity === 'chat') return;
    const toTable = new THREE.Vector3().subVectors(seat.tableCenter, seat.pos).setY(0);
    const yaw = Math.atan2(toTable.x, toTable.z);
    if (this.activity === 'laptop') {
      const laptop = makeLaptop();
      const d = toTable.length();
      const edge = Math.max(0.25, d - 0.42);
      const surfaceY = seat.pos.y > 0.05 ? 1.035 : 0.815; // window bar is taller
      laptop.position.set(
        seat.pos.x + (toTable.x / d) * edge,
        surfaceY,
        seat.pos.z + (toTable.z / d) * edge
      );
      laptop.rotation.y = yaw + Math.PI;
      this.sim.cafe.group.add(laptop);
      this.props.push(laptop);
      this.isTyping = true;
    } else if (this.activity === 'book') {
      const book = makeBook();
      book.position.set(0, 1.02, 0.26);
      book.rotation.x = -0.5;
      this.mesh.add(book);
      this.props.push(book);
    } else if (this.activity === 'phone') {
      const phone = makePhone();
      phone.position.set(0, -0.36, 0.06);
      phone.rotation.x = -0.6;
      this.mesh.userData.parts.armR.add(phone);
      this.props.push(phone);
    }
  }

  _clearProps() {
    for (const prop of this.props) {
      prop.parent?.remove(prop);
      prop.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.props = [];
    this.isTyping = false;
  }

  // gentle steering away from other walkers
  _separation(dir) {
    const pos = this.mesh.position;
    for (const other of this.sim.npcs) {
      if (other === this || !other.path) continue;
      const dx = pos.x - other.mesh.position.x;
      const dz = pos.z - other.mesh.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.45 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        dir.x += (dx / d) * (0.45 - d) * 2.2;
        dir.z += (dz / d) * (0.45 - d) * 2.2;
      }
    }
    return dir;
  }

  update(dt, t) {
    this.stateT += dt;
    const p = this.mesh.userData.parts;
    const seat = this.seatIndex >= 0 ? this.sim.cafe.seats[this.seatIndex] : null;

    const walking = !!this.path;
    if (walking) {
      const target = this.path[this.pathI];
      const pos = this.mesh.position;
      const dir = new THREE.Vector3(target.x - pos.x, 0, target.z - pos.z);
      const dist = dir.length();
      if (dist < 0.07) {
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = null;
          this._arrived();
          return;
        }
      } else {
        dir.normalize();
        this._separation(dir).normalize();
        pos.addScaledVector(dir, this.speed * dt);
        const targetYaw = Math.atan2(dir.x, dir.z);
        // turn smoothly instead of snapping
        let dy = targetYaw - this.mesh.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.mesh.rotation.y += dy * Math.min(1, dt * 10);
      }
      this.walkPhase += dt * 7 * this.speed;
      const s = Math.sin(this.walkPhase);
      p.legL.rotation.x = s * 0.55;
      p.legR.rotation.x = -s * 0.55;
      p.armL.rotation.x = -s * 0.4;
      p.armR.rotation.x = p.cup.visible ? -0.9 : s * 0.4;
      this.mesh.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.03;
      // walkers glance around now and then
      this.glanceT -= dt;
      if (this.glanceT < 0) {
        this.headTarget = rand(-0.6, 0.6);
        this.glanceT = rand(2, 6);
      }
      p.head.rotation.y += (this.headTarget - p.head.rotation.y) * dt * 3;
      return;
    }

    if (this.state === 'queueing') {
      this._setPose(false);
      this.mesh.rotation.y = Math.PI; // face the counter
      // idle shifting weight
      this.mesh.position.y = 0;
      p.torso.rotation.z = Math.sin(t * 0.9 + this.walkPhase) * 0.03;
      p.head.rotation.y = Math.sin(t * 0.5 + this.walkPhase) * 0.25;
      // reached the front and the register is free?
      if (this.queueIndex === 0 && !this.sim.ordering) {
        this.sim.ordering = this;
        this.state = 'ordering';
        this.stateT = 0;
      }
    } else if (this.state === 'ordering') {
      this.mesh.rotation.y = Math.PI;
      // chatting with the barista
      p.armL.rotation.x = Math.sin(t * 1.6 + this.walkPhase) * 0.12;
      p.armR.rotation.x = Math.sin(t * 1.3 + this.walkPhase) * 0.12;
      p.head.rotation.y = Math.sin(t * 0.8) * 0.1;
      if (this.stateT > this.orderTime) {
        this.sim.dequeue(this);
        this.sim.ordering = null;
        this.sim.brewFor = this;
        this.sim.brewT = 0;
        this.sim.brewDuration = rand(6, 10);
        this.state = 'waitingPickup';
        this.stateT = 0;
        this._walkTo(this.sim.cafe.nav.pickup);
      }
    } else if (this.state === 'waitingPickup') {
      this.mesh.rotation.y = Math.PI;
      p.head.rotation.y = Math.sin(t * 0.4 + this.walkPhase) * 0.35;
      p.torso.rotation.z = Math.sin(t * 0.7 + this.walkPhase) * 0.025;
      if (this.sim.brewFor !== this) {
        // coffee's up
        p.cup.visible = true;
        this.stateT = 0;
        if (this.seatIndex >= 0) {
          this.state = 'toSeat';
          this._walkTo(this.sim.cafe.seats[this.seatIndex].pos);
        } else {
          this.state = 'leaving';
          this._walkTo(this.sim.cafe.nav.door);
        }
      }
    } else if (this.state === 'sitting') {
      this._setPose(true);
      const isChat = this.activity === 'chat' && this.partner && this.partner.state === 'sitting';
      if (isChat) {
        // face your friend
        const pp = this.partner.mesh.position;
        const yaw = Math.atan2(pp.x - seat.pos.x, pp.z - seat.pos.z);
        this.mesh.rotation.y += (yaw - this.mesh.rotation.y) * dt * 2;
        // turn-taking: one leans in and gestures while the other nods
        const turn = Math.sin(t * 0.13 + (this.pairLead ? 0 : Math.PI));
        if (turn > 0) {
          p.armR.rotation.x = -0.5 + Math.sin(t * 2.2) * 0.25;
          p.armL.rotation.x = -0.3 + Math.sin(t * 1.7 + 1) * 0.15;
          p.head.rotation.x = 0.03;
        } else {
          p.armR.rotation.x = -0.55;
          p.armL.rotation.x = -0.45;
          p.head.rotation.x = 0.12 + Math.sin(t * 2.8) * 0.06; // nodding along
        }
        p.head.rotation.y = Math.sin(t * 0.4 + this.walkPhase) * 0.1;
      } else {
        const look = seat.tableCenter;
        const yaw = Math.atan2(look.x - seat.pos.x, look.z - seat.pos.z);
        this.mesh.rotation.y += (yaw - this.mesh.rotation.y) * dt * 2;
        p.torso.scale.y = 1 + Math.sin(t * 1.8 + this.walkPhase) * 0.012;
        if (this.activity === 'laptop') {
          // hands forward, small typing jitter
          p.armL.rotation.x = -0.85 + Math.sin(t * 9 + this.walkPhase) * 0.03;
          p.armR.rotation.x = -0.85 + Math.cos(t * 8.2 + this.walkPhase) * 0.03;
          p.head.rotation.x = 0.22;
          p.head.rotation.y = Math.sin(t * 0.2 + this.walkPhase) * 0.08;
        } else if (this.activity === 'book') {
          p.armL.rotation.x = p.armR.rotation.x = -1.0;
          p.head.rotation.x = 0.3;
          p.head.rotation.y = Math.sin(t * 0.1 + this.walkPhase) * 0.05;
        } else if (this.activity === 'phone') {
          p.armR.rotation.x = -1.15;
          p.armL.rotation.x = -0.4;
          p.head.rotation.x = 0.3;
          p.head.rotation.y = 0.1;
        } else {
          // people-watching, sipping
          p.head.rotation.x = Math.sin(t * 0.5 + this.walkPhase * 2) * 0.06;
          p.head.rotation.y = Math.sin(t * 0.3 + this.walkPhase) * 0.45;
          const sip = (t * 0.13 + this.walkPhase) % 1;
          p.armR.rotation.x = sip < 0.12 ? -1.9 : -0.6;
          p.armL.rotation.x = -0.5;
        }
        // occasional sip regardless of activity
        if (this.activity !== 'none') {
          const sip = (t * 0.06 + this.walkPhase) % 1;
          if (sip < 0.06) p.armR.rotation.x = -1.9;
        }
      }
      if (this.stateT > this.sitDuration) {
        this.state = 'leaving';
        this.stateT = 0;
        this._setPose(false);
        this._clearProps();
        if (this.sim.audio?.started && Math.random() < 0.7) this.sim.audio.playChairScrape(seat.pos);
        this._walkTo(this.sim.cafe.nav.door);
        this.sim.releaseSeat(this.seatIndex);
        this.seatIndex = -1;
      }
    }
  }

  _arrived() {
    if (this.state === 'queueing') {
      // settled into the current queue slot; update() takes it from here
    } else if (this.state === 'toSeat') {
      this.state = 'sitting';
      this.stateT = 0;
      const seat = this.sim.cafe.seats[this.seatIndex];
      this.sitY = seat.pos.y > 0.05 ? 0.07 : -0.10;
      this.mesh.position.set(seat.pos.x, 0, seat.pos.z);
      this._setPose(true);
      this._addProps();
    } else if (this.state === 'leaving') {
      this.state = 'gone';
      if (this.sim.audio?.started && Math.random() < 0.5) this.sim.audio.playChime();
    }
  }

  dispose() {
    this._clearProps();
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map !== _blobTex) o.material.dispose?.();
    });
  }
}

class Barista {
  constructor(sim) {
    this.sim = sim;
    this.mesh = makePerson();
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.34, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 })
    );
    apron.position.set(0, 0.82, 0.13);
    this.mesh.add(apron);
    this.home = sim.cafe.nav.baristaHome.clone();
    this.registerSpot = sim.cafe.nav.baristaRegister.clone();
    this.machineSpot = sim.cafe.nav.baristaMachine.clone();
    this.mesh.position.copy(this.home);
    this.phase = rand(0, 10);
    this.target = this.home.clone();
    this.espressoPlayed = false;
    sim.cafe.group.add(this.mesh);
  }

  update(dt, t) {
    const p = this.mesh.userData.parts;

    // where should I be?
    if (this.sim.ordering) this.target.copy(this.registerSpot);
    else if (this.sim.brewFor) this.target.copy(this.machineSpot);
    else if (Math.random() < 0.002) this.target.set(this.home.x + rand(-1.7, 1.7), 0, this.home.z);

    const dx = this.target.x - this.mesh.position.x;
    if (Math.abs(dx) > 0.06) {
      this.mesh.position.x += Math.sign(dx) * Math.min(Math.abs(dx), dt * 1.0);
      this.phase += dt * 6;
      const s = Math.sin(this.phase);
      p.legL.rotation.x = s * 0.4;
      p.legR.rotation.x = -s * 0.4;
      this.mesh.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.espressoPlayed = false;
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      if (this.sim.brewFor) {
        // working the machine, back half-turned
        this.mesh.rotation.y = Math.PI;
        p.armL.rotation.x = -0.9 + Math.sin(t * 3.2) * 0.2;
        p.armR.rotation.x = -0.7 + Math.cos(t * 2.7) * 0.25;
        if (!this.espressoPlayed) {
          this.espressoPlayed = true;
          if (this.sim.audio?.started) this.sim.audio.playEspresso();
        }
      } else if (this.sim.ordering) {
        // face the customer, take the order
        this.mesh.rotation.y = 0;
        p.armL.rotation.x = -0.3 + Math.sin(t * 1.8) * 0.1;
        p.armR.rotation.x = Math.sin(t * 1.4) * 0.15;
        p.head.rotation.x = 0.05;
        this.espressoPlayed = false;
      } else {
        this.mesh.rotation.y = 0;
        p.armL.rotation.x = -0.7 + Math.sin(t * 2.6 + this.phase) * 0.25;
        p.armR.rotation.x = -0.7 + Math.sin(t * 2.2 + this.phase + 1) * 0.25;
        p.head.rotation.y = Math.sin(t * 0.4 + this.phase) * 0.3;
        this.espressoPlayed = false;
      }
    }
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map !== _blobTex) o.material.dispose?.();
    });
  }
}

// pedestrians drifting past the windows outside
class OutsideLife {
  constructor(cafe) {
    this.cafe = cafe;
    this.group = new THREE.Group();
    cafe.group.add(this.group);
    this.walkers = [];
    const night = !!cafe.theme.rain;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const person = makePerson(night ? 0.35 : 0.75);
      person.userData.parts.blob.visible = false;
      const s = rand(0.85, 1.0);
      person.scale.setScalar(s);
      if (night && Math.random() < 0.8) {
        const umbrella = new THREE.Group();
        const canopy = new THREE.Mesh(
          new THREE.ConeGeometry(0.5, 0.22, 10),
          new THREE.MeshStandardMaterial({ color: pick([0x333940, 0x5c2e33, 0x2e4650]), roughness: 0.7 })
        );
        canopy.position.y = 1.75;
        umbrella.add(canopy);
        const stick = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.85, 6),
          new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        stick.position.y = 1.35;
        umbrella.add(stick);
        person.add(umbrella);
      }
      const dir = Math.random() < 0.5 ? 1 : -1;
      const walker = {
        mesh: person,
        dir,
        speed: rand(0.7, 1.4),
        phase: rand(0, 10),
        x: rand(-11, 11),
        z: this.streetZ() + rand(-0.4, 0.6),
      };
      person.position.set(walker.x, 0, walker.z);
      person.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(person);
      this.walkers.push(walker);
    }
  }

  streetZ() {
    return 10.5 / 2 + 1.7; // just past the front windows
  }

  update(dt) {
    for (const w of this.walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x > 12) { w.x = -12; this.reroll(w); }
      if (w.x < -12) { w.x = 12; this.reroll(w); }
      w.phase += dt * 7 * w.speed;
      const p = w.mesh.userData.parts;
      const s = Math.sin(w.phase);
      p.legL.rotation.x = s * 0.55;
      p.legR.rotation.x = -s * 0.55;
      p.armL.rotation.x = -s * 0.35;
      p.armR.rotation.x = s * 0.35;
      w.mesh.position.set(w.x, Math.abs(s) * 0.03, w.z);
    }
  }

  reroll(w) {
    w.speed = rand(0.7, 1.4);
    w.z = this.streetZ() + rand(-0.4, 0.6);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map !== _blobTex) o.material.dispose?.();
    });
  }
}

export class CrowdSim {
  constructor(cafe, audio) {
    this.cafe = cafe;
    this.audio = audio;
    this.npcs = [];
    this.queue = [];
    this.ordering = null;   // NPC currently at the register
    this.brewFor = null;    // NPC whose drink is being made
    this.brewT = 0;
    this.brewDuration = 8;
    this.takenSeats = new Set();
    this.playerSeat = -1;
    this.maxCrowd = cafe.theme.crowd ?? 9;
    this.barista = new Barista(this);
    this.outside = new OutsideLife(cafe);
    this.spawnCooldown = rand(3, 7);
    this.spotSyncT = 0;

    // pre-seat customers so the café never starts empty
    const initial = Math.min(4 + Math.floor(Math.random() * 3), this.maxCrowd - 2);
    for (let i = 0; i < initial; i++) this._preseat();
    // one pre-seated chatting pair if there's room
    this._preseatPair();
  }

  _preseat() {
    const seat = this._freeSeat();
    if (seat < 0) return;
    this.takenSeats.add(seat);
    const npc = new NPC(this, { seatIndex: seat, silent: true });
    this.dequeue(npc);
    npc.state = 'sitting';
    npc.stateT = rand(0, 40);
    npc.path = null;
    npc.mesh.userData.parts.cup.visible = Math.random() < 0.7;
    const s = this.cafe.seats[seat];
    npc.sitY = s.pos.y > 0.05 ? 0.07 : -0.10;
    npc.mesh.position.set(s.pos.x, 0, s.pos.z);
    npc._setPose(true);
    npc._addProps();
    this.npcs.push(npc);
  }

  _preseatPair() {
    const pair = this._freePairSeats();
    if (!pair) return;
    const members = [];
    for (const seat of pair) {
      this.takenSeats.add(seat);
      const npc = new NPC(this, { seatIndex: seat, silent: true, activity: 'chat' });
      this.dequeue(npc);
      npc.state = 'sitting';
      npc.stateT = rand(0, 30);
      npc.sitDuration = rand(80, 200);
      npc.path = null;
      npc.mesh.userData.parts.cup.visible = true;
      const s = this.cafe.seats[seat];
      npc.sitY = s.pos.y > 0.05 ? 0.07 : -0.10;
      npc.mesh.position.set(s.pos.x, 0, s.pos.z);
      npc._setPose(true);
      members.push(npc);
      this.npcs.push(npc);
    }
    members[0].partner = members[1];
    members[1].partner = members[0];
    members[0].pairLead = true;
  }

  // position of slot i in the order queue (a line from the register toward the door)
  queueSlot(i) {
    const c = this.cafe.nav.counter;
    return new THREE.Vector3(c.x, 0, c.z + 0.75 * i);
  }

  dequeue(npc) {
    const i = this.queue.indexOf(npc);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.forEach((q, j) => {
      if (q.queueIndex !== j) {
        q.queueIndex = j;
        if (q.state === 'queueing') q._walkTo(this.queueSlot(j));
      }
    });
    npc.queueIndex = -1;
  }

  setPlayerSeat(i) { this.playerSeat = i; }

  _playerTable() {
    return this.playerSeat >= 0 ? this.cafe.seats[this.playerSeat].tableCenter : null;
  }

  _freeSeat() {
    const free = [];
    const playerTable = this._playerTable();
    for (let i = 0; i < this.cafe.seats.length; i++) {
      if (i === this.playerSeat || this.takenSeats.has(i)) continue;
      if (playerTable && this.cafe.seats[i].tableCenter.distanceTo(playerTable) < 0.01) continue;
      free.push(i);
    }
    return free.length ? pick(free) : -1;
  }

  _freePairSeats() {
    // two free seats at the same (non-player, non-bar) table
    const playerTable = this._playerTable();
    const byTable = new Map();
    for (let i = 0; i < this.cafe.seats.length; i++) {
      if (i === this.playerSeat || this.takenSeats.has(i)) continue;
      const s = this.cafe.seats[i];
      if (playerTable && s.tableCenter.distanceTo(playerTable) < 0.01) continue;
      const key = `${s.tableCenter.x.toFixed(1)},${s.tableCenter.z.toFixed(1)}`;
      if (!byTable.has(key)) byTable.set(key, []);
      byTable.get(key).push(i);
    }
    const candidates = [...byTable.values()].filter((v) => v.length >= 2);
    if (!candidates.length) return null;
    const table = pick(candidates);
    return [table[0], table[1]];
  }

  update(dt, t) {
    this.barista.update(dt, t);
    this.outside.update(dt);

    // brewing timer
    if (this.brewFor) {
      this.brewT += dt;
      if (this.brewT > this.brewDuration) this.brewFor = null;
    }

    // arrivals
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0 && this.npcs.length < this.maxCrowd) {
      this.spawnCooldown = rand(7, 22);
      const asPair = Math.random() < 0.3 && this.npcs.length < this.maxCrowd - 1;
      if (asPair) {
        const pair = this._freePairSeats();
        if (pair) {
          this.takenSeats.add(pair[0]);
          this.takenSeats.add(pair[1]);
          const a = new NPC(this, { seatIndex: pair[0], activity: 'chat' });
          const b = new NPC(this, { seatIndex: pair[1], activity: 'chat', silent: true });
          a.partner = b; b.partner = a;
          a.pairLead = true;
          b.sitDuration = a.sitDuration = rand(60, 160);
          this.npcs.push(a, b);
        }
      } else {
        const seat = this._freeSeat();
        const toGo = Math.random() < 0.3 || seat < 0;
        if (!toGo) this.takenSeats.add(seat);
        this.npcs.push(new NPC(this, { seatIndex: toGo ? -1 : seat }));
      }
    }

    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      npc.update(dt, t);
      if (npc.state === 'gone') {
        this.dequeue(npc);
        if (this.ordering === npc) this.ordering = null;
        if (this.brewFor === npc) this.brewFor = null;
        npc.dispose();
        this.npcs.splice(i, 1);
      }
    }

    // let the audio engine know where people actually are
    this.spotSyncT -= dt;
    if (this.spotSyncT <= 0 && this.audio?.started) {
      this.spotSyncT = 3;
      const seated = this.npcs.filter((n) => n.state === 'sitting');
      this.audio.setClinkSpots(seated.map((n) => n.mesh.position));
      this.audio.setTypingSpots(seated.filter((n) => n.isTyping).map((n) => n.mesh.position));
    }
  }

  releaseSeat(i) { this.takenSeats.delete(i); }
  isSeatTaken(i) { return this.takenSeats.has(i); }

  dispose() {
    this.npcs.forEach((n) => n.dispose());
    this.barista.dispose();
    this.outside.dispose();
    this.npcs = [];
    this.queue = [];
  }
}
