// Café pets with real agency: rigged, animated animals that wander the room,
// nap, react to the player, and (for the dog) belong to a seated patron and
// leave with them. Replaces the old primitive-shape cat/dog stand-ins.

import * as THREE from 'three';
import { clonePet } from './modelLoader.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// candidate floor spots shared by all four rooms (the old cat's waypoint
// list, extended). These predate the blueprint rebuild, so each venue must
// filter them against its own colliders (audit S7/S8: stale spots now land
// inside furniture, leaving a stalled pet clipping through a chair or table).
const FLOOR_SPOTS = [
  { x: 4.9, z: -0.2 }, { x: -5.4, z: 1.8 }, { x: 1.4, z: 4.1 },
  { x: -1.2, z: -3.6 }, { x: 6.2, z: 2.6 }, { x: -6.4, z: -2.2 },
  { x: 0.4, z: 1.2 }, { x: -3.2, z: 4.4 },
];

// a spot is only a valid wander target if it clears every ground collider by
// a pet-body margin — the jitter added at walk time stays inside that margin
function clearFloorSpots(cafe) {
  const clear = FLOOR_SPOTS.filter((s) => !cafe.colliders.some((c) =>
    (c.levelId ?? 'ground') === 'ground' && c.r
    && Math.hypot(s.x - c.x, s.z - c.z) < c.r + 0.55));
  return clear.length ? clear : FLOOR_SPOTS;
}

class Pet {
  constructor(cafe, kind, mesh, animations) {
    this.cafe = cafe;
    this.spots = clearFloorSpots(cafe);
    this.kind = kind; // 'cat' | 'dog'
    this.mesh = mesh;
    this.mixer = new THREE.AnimationMixer(mesh);
    this.actions = {};
    const find = (n) => animations.find((a) => a.name.toLowerCase().endsWith('|' + n))
      ?? animations.find((a) => a.name.toLowerCase().includes(n));
    const CLIPS = kind === 'cat'
      ? { idle: 'idle', walk: 'walk', groom: 'idle_eating', nudge: 'headbutt', lie: 'death' }
      : { idle: 'idle', walk: 'walk', sniff: 'idle_2_headlow', alert: 'idle_2', eat: 'eating', lie: 'death' };
    for (const [slot, name] of Object.entries(CLIPS)) {
      const clip = find(name);
      if (clip) this.actions[slot] = this.mixer.clipAction(clip);
    }
    // 'lie' doubles as sleeping: play once and hold the lying pose
    if (this.actions.lie) {
      this.actions.lie.setLoop(THREE.LoopOnce);
      this.actions.lie.clampWhenFinished = true;
    }
    this.mode = null;
    this._setMode('idle');
    this.state = 'idle';
    this.stateT = rand(0, 3);
    this.target = null;
    this.speed = kind === 'cat' ? 0.5 : 0.62;
    this.velocity = new THREE.Vector2();
    this._stallT = 0;
    this._bestDist = Infinity;
    this.owner = null; // dog only
    this.dead = false;
    this.audio = null;         // CafeAudio, set by PetSystem
    this.interactions = null;  // world-interaction registry, set by PetSystem
    this.voiceCooldown = rand(10, 25); // semantic cooldown for spontaneous voices
    this.forceReactT = 0;      // keeps the click reaction visible from further away
    cafe.group.add(mesh);
  }

  // A spontaneous voice: proximity, concurrency and the audio-side gates all
  // apply, plus this pet's own 20-60 s semantic cooldown.
  _tryVoice(event, fallbackEvent = null) {
    if (this.voiceCooldown > 0 || !this.audio) return;
    const played = this.audio.playPetVoice(this.kind, event, this.mesh.position)
      || (fallbackEvent && this.audio.playPetVoice(this.kind, fallbackEvent, this.mesh.position));
    if (played) this.voiceCooldown = rand(20, 60);
  }

  _setMode(mode, timeScale = 1) {
    const action = this.actions[mode] ?? this.actions.idle;
    if (!action) return;
    if (this.mode !== mode) {
      const prev = this.actions[this.mode];
      action.reset().fadeIn(0.25).play();
      prev?.fadeOut(0.25);
      this.mode = mode;
    }
    action.timeScale = timeScale;
  }

  _walkTo(x, z) {
    this.target = { x, z };
    this.state = 'walking';
    this.stateT = 0;
    this._stallT = 0;
    this._bestDist = Infinity;
  }

  // collider-aware steering; pets weave between furniture rather than route
  _step(dt) {
    const pos = this.mesh.position;
    const dx = this.target.x - pos.x;
    const dz = this.target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < this._bestDist - 0.01) { this._bestDist = dist; this._stallT = 0; }
    else this._stallT += dt;
    if (dist < 0.16 || this._stallT > 3.5) { this.target = null; return true; }
    let dirX = dx / dist, dirZ = dz / dist;
    const aheadX = pos.x + dirX * 0.4;
    const aheadZ = pos.z + dirZ * 0.4;
    for (const c of this.cafe.colliders) {
      if ((c.levelId ?? 'ground') !== 'ground') continue; // pets stay on the courtyard
      if (c.r) {
        const r = c.r + 0.18;
        const ox = aheadX - c.x, oz = aheadZ - c.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < r * r && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const k = (1 - d / r) * 2.0;
          dirX += (ox / d) * k;
          dirZ += (oz / d) * k;
        }
      } else if (c.rect) {
        const m = 0.16;
        if (aheadX > c.rect.x0 - m && aheadX < c.rect.x1 + m && aheadZ > c.rect.z0 - m && aheadZ < c.rect.z1 + m) {
          const cx = (c.rect.x0 + c.rect.x1) / 2, cz = (c.rect.z0 + c.rect.z1) / 2;
          const ox = pos.x - cx, oz = pos.z - cz;
          const l = Math.hypot(ox, oz) || 1;
          dirX += (ox / l) * 1.5;
          dirZ += (oz / l) * 1.5;
        }
      }
    }
    const l = Math.hypot(dirX, dirZ) || 1;
    const blend = 1 - Math.exp(-6 * dt);
    this.velocity.x += ((dirX / l) * this.speed - this.velocity.x) * blend;
    this.velocity.y += ((dirZ / l) * this.speed - this.velocity.y) * blend;
    pos.x = THREE.MathUtils.clamp(pos.x + this.velocity.x * dt, -7.6, 7.6);
    pos.z = THREE.MathUtils.clamp(pos.z + this.velocity.y * dt, -5.9, 6.1);
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > 0.06) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.y);
      let dy = targetYaw - this.mesh.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.mesh.rotation.y += THREE.MathUtils.clamp(dy * (1 - Math.exp(-7 * dt)), -3.6 * dt, 3.6 * dt);
    }
    this._setMode('walk', THREE.MathUtils.clamp(speed / this.speed, 0.5, 1.3));
    return false;
  }

  _facePoint(x, z, dt, rate = 4) {
    let dy = Math.atan2(x - this.mesh.position.x, z - this.mesh.position.z) - this.mesh.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.mesh.rotation.y += dy * Math.min(1, dt * rate);
  }

  dispose() {
    this.dead = true;
    this.interactions?.unregister(this.mesh);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mesh);
    this.mesh.parent?.remove(this.mesh);
    const skeletons = new Set();
    this.mesh.traverse((o) => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    skeletons.forEach((s) => s.dispose());
  }
}

class CatPet extends Pet {
  update(dt, playerPos) {
    this.mixer.update(dt);
    this.stateT += dt;
    this.voiceCooldown -= dt;
    this.forceReactT = Math.max(0, this.forceReactT - dt);
    const pos = this.mesh.position;
    const nearPlayer = playerPos
      && Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) < 1.15
      && playerPos.y < 1.8; // ignore the seated bird's-eye tween
    if (this.state === 'walking') {
      if (nearPlayer) {
        this.target = null; this.state = 'watchPlayer'; this.stateT = 0;
        this._tryVoice('chirp'); // a person! quiet greeting trill
      }
      else if (this._step(dt)) {
        this.state = pick(['idle', 'idle', 'nap', 'groom']);
        this.stateT = 0;
      }
      return;
    }
    if (this.state === 'watchPlayer') {
      // a person! stop, face them, affectionate little head-rub, move on
      this._facePoint(playerPos?.x ?? 0, playerPos?.z ?? 0, dt);
      this._setMode('nudge', 0.9);
      if (this.stateT > 3.2 || (!nearPlayer && this.forceReactT <= 0)) {
        this.state = 'idle';
        this.stateT = 0;
      }
      return;
    }
    if (this.state === 'groom') {
      this._setMode('groom', 0.8); // head-down wash between wanders
      if (this.stateT > rand(5, 9)) { this.state = 'idle'; this.stateT = 0; }
      return;
    }
    if (this.state === 'nap') {
      this._setMode('lie', 0.8); // properly lies down and holds the doze
      if (nearPlayer) { this.state = 'watchPlayer'; this.stateT = 0; }
      else if (this.stateT > rand(16, 32)) {
        const s = pick(this.spots);
        this._walkTo(s.x + rand(-0.25, 0.25), s.z + rand(-0.25, 0.25));
      }
      return;
    }
    // idle
    this._setMode('idle', 1);
    if (nearPlayer && this.stateT > 1) {
      this.state = 'watchPlayer'; this.stateT = 0;
      this._tryVoice('chirp', 'meow');
    }
    else if (this.stateT > rand(4, 9)) {
      const s = pick(this.spots);
      this._walkTo(s.x + rand(-0.25, 0.25), s.z + rand(-0.25, 0.25));
    }
  }

  // A deliberate click is petting: a napping cat purrs and dozes on; an awake
  // cat turns, gives the little head-rub and answers with a chirp or meow.
  onPlayerClick() {
    if (this.dead) return;
    const pos = this.mesh.position;
    if (this.state === 'nap') {
      this.audio?.playPetVoice('cat', 'purr', pos, { intentional: true });
      this.stateT = Math.min(this.stateT, 6); // content — stays put a while longer
      return;
    }
    this.target = null;
    this.state = 'watchPlayer';
    this.stateT = 0;
    this.forceReactT = 2.2;
    this.audio?.playPetVoice('cat', Math.random() < 0.5 ? 'chirp' : 'meow', pos, { intentional: true });
  }
}

class DogPet extends Pet {
  constructor(cafe, kind, mesh, animations, owner, restSpot) {
    super(cafe, kind, mesh, animations);
    this.owner = owner;
    this.restSpot = restSpot;
    // enters at the door and trots to its human
    const door = cafe.nav.door;
    mesh.position.set(door.x + rand(-0.2, 0.2), 0, door.z);
    this._walkTo(restSpot.x, restSpot.z);
    this.state = 'walking';
    this.arriving = true;
  }

  update(dt, playerPos) {
    this.mixer.update(dt);
    this.stateT += dt;
    this.voiceCooldown -= dt;
    this.forceReactT = Math.max(0, this.forceReactT - dt);
    const ownerGone = !this.owner || this.owner.state !== 'sitting';
    if (this.state === 'leaving') {
      if (this._step(dt)) this.dead = true; // PetSystem sweeps and disposes
      return;
    }
    if (ownerGone && !this.arriving) {
      // human's getting up — time to go home together
      const door = this.cafe.nav.door;
      this._walkTo(door.x, door.z + 0.3);
      this.state = 'leaving';
      return;
    }
    const pos = this.mesh.position;
    const nearPlayer = playerPos
      && Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) < 1.2
      && playerPos.y < 1.8;
    if (this.state === 'walking') {
      if (this._step(dt)) {
        this.arriving = false;
        this.state = 'settle';
        this.stateT = 0;
        // lie facing the room, next to the owner's chair
        if (this.owner) this._facePoint(this.owner.mesh.position.x, this.owner.mesh.position.z, 1, 1);
      }
      return;
    }
    if (this.state === 'settle') {
      this._setMode('sniff', 0.9); // sniff the spot before flopping down
      if (this.stateT > 2.2) { this.state = 'rest'; this.stateT = 0; }
      return;
    }
    if (this.state === 'alert') {
      this._facePoint(playerPos?.x ?? 0, playerPos?.z ?? 0, dt);
      this._setMode('alert', 1);
      if (this.stateT > 3 || (!nearPlayer && this.forceReactT <= 0)) { this.state = 'rest'; this.stateT = 0; }
      return;
    }
    // rest: lying beside the chair, with the odd sniff around
    if (nearPlayer) {
      this.state = 'alert'; this.stateT = 0;
      this._tryVoice(Math.random() < 0.6 ? 'huff' : 'whine'); // quiet acknowledgement
      return;
    }
    if (this.stateT > rand(18, 34) && this.actions.sniff) {
      this._setMode('sniff', 0.8);
      this.stateT = rand(0, 6);
    } else if (this.mode !== 'lie' && this.mode !== 'sniff') {
      this._setMode('lie', 0.9);
    } else if (this.mode === 'sniff' && this.stateT > 5) {
      this._setMode('lie', 0.9);
    }
  }

  // A deliberate click is a greeting: the dog perks up toward the player and
  // answers with one soft bark or an excited breath — never a barking fit.
  onPlayerClick() {
    if (this.dead || this.state === 'leaving') return;
    const pos = this.mesh.position;
    if (this.state === 'rest' || this.state === 'settle' || this.state === 'alert') {
      this.state = 'alert';
      this.stateT = 0;
      this.forceReactT = 2.2;
    }
    this.audio?.playPetVoice('dog', Math.random() < 0.6 ? 'bark' : 'huff', pos, { intentional: true });
  }
}

export class PetSystem {
  constructor(cafe, models, theme, audio = null, interactions = null) {
    this.cafe = cafe;
    this.models = models;
    this.theme = theme;
    this.audio = audio;
    this.interactions = interactions;
    this.pets = [];
    this.dogTimer = rand(6, 18); // let the room settle before a dog shows up
    if (theme.cat !== undefined) {
      const cat = clonePet(models, 'pet_cat');
      if (cat) {
        const spot = pick(clearFloorSpots(cafe));
        cat.mesh.position.set(spot.x, 0, spot.z);
        cat.mesh.rotation.y = rand(0, Math.PI * 2);
        cat.mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
        this._adopt(new CatPet(cafe, 'cat', cat.mesh, cat.animations));
      }
    }
  }

  // live pet voice sources, surfaced through __vibe.metrics()
  get activeVoiceCount() { return this.audio?.activePetVoices ?? 0; }

  _adopt(pet) {
    pet.audio = this.audio;
    pet.interactions = this.interactions;
    // clicking a visible pet is an intentional interaction; 1.5 s cooldown so
    // rapid clicks can neither stack sources nor restart the animation loop
    this.interactions?.register(pet.mesh, {
      cooldownMs: 1500,
      onClick: () => pet.onPlayerClick(),
    });
    this.pets.push(pet);
    return pet;
  }

  _maybeSpawnDog(crowd) {
    if (this.pets.some((p) => p.kind === 'dog')) return;
    const owner = crowd?.npcs?.find((n) => n.state === 'sitting' && n.seatIndex >= 0
      && !n.partner && n.stateT > 4 && (n.sitDuration ?? 0) > 60
      && n.sim.cafe.seats[n.seatIndex].pos.y < 0.05);
    if (!owner) { this.dogTimer = 8; return; }
    const dog = clonePet(this.models, 'pet_dog');
    if (!dog) return;
    const seat = owner.sim.cafe.seats[owner.seatIndex];
    const away = new THREE.Vector3().subVectors(seat.pos, seat.tableCenter).setY(0).normalize();
    const perp = new THREE.Vector3(away.z, 0, -away.x);
    const rest = seat.pos.clone().addScaledVector(perp, 0.7).addScaledVector(away, 0.15);
    dog.mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this._adopt(new DogPet(this.cafe, 'dog', dog.mesh, dog.animations, owner, rest));
  }

  update(dt, crowd, playerPos) {
    this.dogTimer -= dt;
    if (this.dogTimer <= 0) {
      this.dogTimer = rand(30, 70);
      this._maybeSpawnDog(crowd);
    }
    for (const pet of this.pets) pet.update(dt, playerPos);
    for (let i = this.pets.length - 1; i >= 0; i--) {
      if (this.pets[i].dead) {
        this.pets[i].dispose();
        this.pets.splice(i, 1);
      }
    }
  }

  dispose() {
    this.pets.forEach((p) => p.dispose());
    this.pets = [];
  }
}
