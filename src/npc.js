// Café life v2. Customers run a full behavior loop:
//   enter -> join the queue -> order at the register -> wait at pickup
//   -> find a seat -> do something (laptop / book / phone / chat) -> leave
// Pairs come in together, sit at the same table and chat. Walkers steer
// around each other. Outside, pedestrians pass the windows.
// The barista mirrors the queue: takes orders at the register, brews at
// the machine (synced with the espresso sound), and putters when idle.

import * as THREE from 'three';
import { ROOM } from './cafe.js';
import { cloneCharacter, characterKeys, sitCharacterKeys } from './modelLoader.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SKIN_TONES = [0xf1c9a5, 0xe0ac7e, 0xc68a5b, 0x9c6b43, 0x71492c, 0x513425];
const SHIRT = [0x7a5c8f, 0x4a7a6f, 0xa85751, 0x4f6d9c, 0xb08d4f, 0x5a5f66, 0x8a4a68, 0x3f6b4f, 0x946b52, 0x6b7f5a];
const PANTS = [0x37414f, 0x4a4038, 0x2f3438, 0x5a4a5f, 0x39504a, 0x54452f];
const HAIR = [0x241a12, 0x3f2a17, 0x6b4a26, 0x8a8a8a, 0x151515, 0x743e21, 0x4a3b32];

const EYE_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.3 });

export function makePerson(tint = 1) {
  const g = new THREE.Group();
  const dim = (c) => new THREE.Color(c).multiplyScalar(tint);
  const skin = new THREE.MeshStandardMaterial({ color: dim(pick(SKIN_TONES)), roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: dim(pick(SHIRT)), roughness: 0.95 });
  const pants = new THREE.MeshStandardMaterial({ color: dim(pick(PANTS)), roughness: 0.95 });
  const hair = new THREE.MeshStandardMaterial({ color: dim(pick(HAIR)), roughness: 0.95 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: dim(pick([0x2a2118, 0x1e1e22, 0x4a3a2a, 0x50505a])), roughness: 0.8 });

  // body-shape variety: slim to broad
  const build = rand(0.88, 1.14);
  const parts = {};

  for (const side of [-1, 1]) {
    // two-segment legs: thigh from the hip, shin+foot from a knee pivot,
    // so seated people fold naturally instead of sticking straight out
    const hip = new THREE.Group();
    hip.position.set(side * 0.09 * build, 0.5, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.15, 3, 8), pants);
    thigh.position.y = -0.125;
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.25;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.13, 3, 8), pants);
    shin.position.y = -0.11;
    shin.castShadow = true;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.15), shoeMat);
    foot.position.set(0, -0.225, 0.035);
    foot.castShadow = true;
    knee.add(foot);
    g.add(hip);
    parts[side === -1 ? 'legL' : 'legR'] = hip;
    parts[side === -1 ? 'kneeL' : 'kneeR'] = knee;
  }

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.34, 4, 10), shirt);
  torso.scale.x = build;
  torso.position.y = 0.82;
  torso.castShadow = true;
  g.add(torso);
  parts.torso = torso;

  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2 * build, 0.98, 0);
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

  // neck connects head to shoulders instead of a floating head
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 8), skin);
  neck.position.y = 1.1;
  g.add(neck);

  const headG = new THREE.Group();
  headG.position.y = 1.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
  head.scale.set(0.95, 1.05, 0.98);
  head.castShadow = true;
  headG.add(head);

  // eyes — the single cheapest thing that makes them read as people
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), EYE_MAT);
    eye.position.set(s * 0.045, 0.015, 0.102);
    headG.add(eye);
  }

  // hair: cap, long, or beanie
  const style = Math.random();
  if (style < 0.16) {
    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshStandardMaterial({ color: dim(pick([0x8a4a3a, 0x3a4a5c, 0x54683f, 0x6a5a4a])), roughness: 1 })
    );
    beanie.position.y = 0.028;
    headG.add(beanie);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.02, 6, 14), beanie.material);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.033;
    headG.add(brim);
  } else {
    const long = style > 0.72;
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * (style < 0.32 ? 0.35 : 0.52)),
      hair
    );
    cap.position.y = 0.015;
    headG.add(cap);
    if (long) {
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hair);
      back.scale.set(0.9, 1.3, 0.7);
      back.position.set(0, -0.05, -0.06);
      headG.add(back);
      if (Math.random() < 0.5) {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 3, 6), hair);
        tail.position.set(0, -0.08, -0.12);
        tail.rotation.x = 0.4;
        headG.add(tail);
      }
    }
  }

  // some people wear glasses
  if (Math.random() < 0.28) {
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x24211c, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 6, 12), glassMat);
      rim.position.set(s * 0.048, 0.018, 0.105);
      headG.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), glassMat);
    bridge.position.set(0, 0.018, 0.108);
    headG.add(bridge);
  }

  g.add(headG);
  parts.head = headG;

  // to-go cup with a cardboard sleeve and lid, hidden until they've ordered
  const cup = new THREE.Group();
  const cupBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.028, 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xece5d8, roughness: 0.6 })
  );
  cup.add(cupBody);
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0365, 0.0315, 0.045, 10),
    new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.95 })
  );
  sleeve.position.y = -0.005;
  cup.add(sleeve);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.012, 10),
    new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.5 })
  );
  lid.position.y = 0.056;
  cup.add(lid);
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

// ---------- skinned avatar: downloaded rigged character ----------
// Wraps a Quaternius/Kenney-style rigged character (mixamo bone names) and
// exposes the small control surface the NPC brain needs. Sitting is posed
// manually after the mixer update, since the packs ship no sit clip.

class SkinnedAvatar {
  constructor(models, key) {
    const { mesh, animations } = cloneCharacter(models, key);
    this.root = new THREE.Group();
    this.root.add(mesh);
    this.inner = mesh;

    // per-instance outfit tint so one model reads as many customers:
    // clothing materials get a bold hue spin; skin/textured materials don't
    const outfitShift = rand(0, 1);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned bounds lag the pose; avoid pop-out
        o.material = o.material.clone();
        o.material.metalness = Math.min(o.material.metalness ?? 0, 0.1);
        const name = (o.material.name || '').toLowerCase();
        const isSkin = name.includes('skin') || name.includes('face');
        const hasTex = !!o.material.map;
        if (o.material.color && !hasTex) {
          const hsl = { h: 0, s: 0, l: 0 };
          o.material.color.getHSL(hsl);
          if (isSkin) {
            o.material.color.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0.08, hsl.l * rand(0.75, 1.2))));
          } else {
            o.material.color.setHSL(
              (hsl.h + outfitShift) % 1,
              Math.min(1, hsl.s * rand(0.8, 1.2)),
              Math.min(0.8, Math.max(0.05, hsl.l * rand(0.85, 1.15)))
            );
          }
        }
      }
    });

    this.mixer = new THREE.AnimationMixer(mesh);
    const find = (...names) => {
      for (const n of names) {
        const c = animations.find((a) => a.name.toLowerCase().includes(n));
        if (c) return c;
      }
      return null;
    };
    const mk = (clip) => (clip ? this.mixer.clipAction(clip) : null);
    // sit clips usually open with a stand-to-sit transition; loop only the
    // seated hold so the character never pops upright at the loop seam
    let sitClip = find('sit');
    if (sitClip && sitClip.duration > 2.5) {
      sitClip = THREE.AnimationUtils.subclip(sitClip, 'sit_hold', 21, Math.floor(sitClip.duration * 30) - 1, 30);
    }
    this.actions = {
      idle: mk(find('idle')),
      walk: mk(find('walk')),
      work: mk(find('working', 'interact-right', 'pick-up', 'pickup', 'interact')),
      wave: mk(find('wave', 'emote-yes', 'interact')),
      sit: mk(sitClip),
    };
    this.hasWave = !!this.actions.wave;
    this.hasSitClip = !!this.actions.sit;
    this.mode = 'idle';
    this.actions.idle?.play();

    // rigs differ across packs — resolve bones through alias lists
    const ALIASES = {
      Hips: ['Hips', 'hips', 'Torso', 'torso', 'Body', 'body'],
      Neck: ['Neck', 'neck'],
      Head: ['Head', 'head'],
      LeftUpLeg: ['LeftUpLeg', 'UpperLeg.L', 'UpperLegL', 'leg-left', 'Leg.L'],
      RightUpLeg: ['RightUpLeg', 'UpperLeg.R', 'UpperLegR', 'leg-right', 'Leg.R'],
      LeftLeg: ['LeftLeg', 'LowerLeg.L', 'LowerLegL'],
      RightLeg: ['RightLeg', 'LowerLeg.R', 'LowerLegR'],
      LeftHand: ['LeftHand', 'Hand.L', 'HandL', 'hand-left', 'arm-left', 'LowerArm.L'],
      RightHand: ['RightHand', 'Hand.R', 'HandR', 'hand-right', 'arm-right', 'LowerArm.R'],
    };
    this.bones = {};
    for (const [key, names] of Object.entries(ALIASES)) {
      for (const n of names) {
        const found = mesh.getObjectByName(n);
        if (found) { this.bones[key] = found; break; }
      }
    }
    this.sitting = false;
    this.headYawTarget = 0;
    this.headPitch = 0;
    this._headYaw = 0;

    // grounding blob
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ map: personBlobTexture(), transparent: true, depthWrite: false, opacity: 0.5 })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    this.root.add(blob);
    this.blob = blob;

    // to-go cup lives in the right hand
    this.cup = makeToGoCup();
    this.cup.visible = false;
    this._cupScaled = false;
    this.bones.RightHand?.add(this.cup);
  }

  setMode(mode, timeScale = 1) {
    const next = this.actions[mode] ? mode : 'idle';
    const action = this.actions[next];
    if (action && this.mode !== next) {
      const prev = this.actions[this.mode];
      action.reset().fadeIn(0.22).play();
      // desync loops so a room of sitters doesn't shift in unison
      if (next === 'sit') action.time = Math.random() * action.getClip().duration;
      prev?.fadeOut(0.22);
      this.mode = next;
    }
    if (action) action.timeScale = timeScale;
  }

  setCup(v) { this.cup.visible = v; }

  update(dt) {
    this.mixer.update(dt);
    // one-time compensation for armature scale so the cup is world-sized
    if (!this._cupScaled && this.cup.visible && this.bones.RightHand) {
      const s = new THREE.Vector3();
      this.bones.RightHand.getWorldScale(s);
      if (s.x > 0.0001) {
        this.cup.scale.setScalar(1 / s.x);
        this.cup.position.set(0, 0.06 / s.x, 0.02 / s.x);
        this._cupScaled = true;
      }
    }
    // sit: use the pack's sit clip when it has one, else pose the legs
    // manually after the mixer (overriding whatever idle did)
    if (this.sitting && !this.hasSitClip) {
      const { LeftUpLeg, RightUpLeg, LeftLeg, RightLeg } = this.bones;
      if (LeftUpLeg) { LeftUpLeg.rotation.x = -1.45; LeftUpLeg.rotation.y = 0.1; }
      if (RightUpLeg) { RightUpLeg.rotation.x = -1.45; RightUpLeg.rotation.y = -0.1; }
      if (LeftLeg) LeftLeg.rotation.x = 1.35;
      if (RightLeg) RightLeg.rotation.x = 1.35;
    }
    // head look, applied post-mixer so it composes with the idle sway
    this._headYaw += (this.headYawTarget - this._headYaw) * Math.min(1, dt * 3);
    const head = this.bones.Head ?? this.bones.Neck;
    if (head) {
      head.rotation.y += this._headYaw;
      head.rotation.x += this.headPitch;
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map !== _blobTex) o.material.dispose?.();
    });
  }
}

function makeToGoCup() {
  const cup = new THREE.Group();
  const cupBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.028, 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xece5d8, roughness: 0.6 })
  );
  cup.add(cupBody);
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0365, 0.0315, 0.045, 10),
    new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.95 })
  );
  sleeve.position.y = -0.005;
  cup.add(sleeve);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.012, 10),
    new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.5 })
  );
  lid.position.y = 0.056;
  cup.add(lid);
  return cup;
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
const ACTIVITIES = ['laptop', 'book', 'phone', 'none', 'laptop', 'book', 'sketch'];

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

function makeSketchpad() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.008, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xf2ecd8, roughness: 0.95 }));
  g.add(pad);
  // a half-finished drawing
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const cg = c.getContext('2d');
  cg.fillStyle = '#f2ecd8'; cg.fillRect(0, 0, 64, 48);
  cg.strokeStyle = '#6a625250'; cg.lineWidth = 1.4;
  cg.beginPath();
  cg.moveTo(10, 36);
  for (let x = 10; x < 54; x += 4) cg.lineTo(x, 36 - Math.random() * 22);
  cg.stroke();
  cg.beginPath(); cg.arc(40, 18, 8, 0, 7); cg.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16),
    new THREE.MeshBasicMaterial({ map: tex }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0.006;
  g.add(sheet);
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.11, 6),
    new THREE.MeshStandardMaterial({ color: 0xc9a03a, roughness: 0.7 }));
  pencil.rotation.z = Math.PI / 2.3;
  pencil.position.set(0.09, 0.012, 0.05);
  g.add(pencil);
  return g;
}

function makeBoardGame() {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const cg = c.getContext('2d');
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      cg.fillStyle = (x + y) % 2 ? '#5c4630' : '#e2d4b4';
      cg.fillRect(x * 8, y * 8, 8, 8);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.014, 0.36),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  g.add(board);
  // a mid-game scatter of pieces
  for (let i = 0; i < 12; i++) {
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.035, 8),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2a2118 : 0xe8e0cc, roughness: 0.6 }));
    piece.position.set(rand(-0.15, 0.15), 0.025, rand(-0.15, 0.15));
    g.add(piece);
  }
  return g;
}

function makeDog() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: pick([0x8a6a44, 0x4a3a2c, 0xc9b490, 0x2c2c2c]), roughness: 1 });
  // lying down: body low, head resting forward on the paws
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.28, 4, 8), fur);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.12;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), fur);
  head.scale.set(1.15, 0.9, 0.9);
  head.position.set(0.26, 0.1, 0);
  head.castShadow = true;
  g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.06), fur);
  snout.position.set(0.36, 0.07, 0);
  g.add(snout);
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.4 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), noseMat);
  nose.position.set(0.41, 0.08, 0);
  g.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.03), fur);
    ear.position.set(0.24, 0.17, s * 0.07);
    ear.rotation.x = s * 0.35;
    g.add(ear);
    // front paws stretched out
    const paw = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.14, 3, 6), fur);
    paw.rotation.z = Math.PI / 2;
    paw.position.set(0.28, 0.035, s * 0.06);
    g.add(paw);
  }
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.16, 3, 6), fur);
  tail.rotation.z = Math.PI / 2.6;
  tail.position.set(-0.24, 0.08, 0.05);
  g.add(tail);
  g.userData.tail = tail;
  return g;
}

// vertical mesh offset while seated: bar stools (elevated seat.pos) need the
// hips carried up to the stool top; regular chairs sink slightly instead
function sitYFor(npc, seat) {
  const elevated = seat.pos.y > 0.05;
  if (!npc.avatar) return elevated ? 0.17 : -0.10;
  return npc.avatar.hasSitClip
    ? (elevated ? 0.2 : -0.05)
    : (elevated ? -0.24 : -0.38);
}

class NPC {
  constructor(sim, opts = {}) {
    this.sim = sim;
    // seated customers use the procedural rig (it can actually sit at a
    // table); to-go customers who stay on their feet get the downloaded
    // animated character
    const willSit = (opts.seatIndex ?? -1) >= 0;
    // walkers draw from every rig; anyone headed straight for a chair may only
    // use a rig with a real sit clip (half stay procedural for variety)
    const pool = willSit ? sim.sitKeys : sim.charKeys;
    const charKey = pool?.length && (!willSit || Math.random() < 0.5) ? pick(pool) : null;
    if (charKey) {
      this.avatar = new SkinnedAvatar(sim.models, charKey);
      this.mesh = this.avatar.root;
    } else {
      this.mesh = makePerson();
    }
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
    this.stepTick = 0;
    this.props = [];
    this.headTarget = 0;            // desired head yaw offset
    this.glanceT = rand(2, 8);
    this.greetT = rand(4, 12);      // cooldown before this NPC greets again
    this.greeting = 0;              // remaining greeting time
    this.cheers = 0;                // remaining "cheers" toast time
    this.cheersT = rand(12, 30);    // cooldown between toasts

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
    if (this.avatar) {
      this.avatar.sitting = sitting;
      this.mesh.position.y = sitting ? this.sitY : 0;
      if (sitting) {
        if (this.avatar.hasSitClip) this.avatar.setMode('sit');
        else this.avatar.setMode('idle', 0.5);
      }
      return;
    }
    const p = this.mesh.userData.parts;
    if (sitting) {
      // thighs forward, shins folded back down toward the floor
      p.legL.rotation.x = p.legR.rotation.x = -1.25;
      p.kneeL.rotation.x = p.kneeR.rotation.x = 1.45;
      this.mesh.position.y = this.sitY;
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      p.kneeL.rotation.x = p.kneeR.rotation.x = 0;
      this.mesh.position.y = 0;
    }
  }

  setCup(v) {
    if (this.avatar) this.avatar.setCup(v);
    else this.mesh.userData.parts.cup.visible = v;
  }

  get hasCup() {
    return this.avatar ? this.avatar.cup.visible : this.mesh.userData.parts.cup.visible;
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
      if (this.avatar) {
        const hand = this.avatar.bones.LeftHand;
        if (!hand) return; // rig has no hand bone: skip the prop gracefully
        const s = new THREE.Vector3();
        hand.getWorldScale(s);
        if (s.x > 0.0001) book.scale.setScalar(1 / s.x);
        book.rotation.x = -0.6;
        hand.add(book);
      } else {
        book.position.set(0, 1.02, 0.26);
        book.rotation.x = -0.5;
        this.mesh.add(book);
      }
      this.props.push(book);
    } else if (this.activity === 'phone') {
      const phone = makePhone();
      if (this.avatar) {
        const hand = this.avatar.bones.RightHand;
        if (!hand) return; // rig has no hand bone: skip the prop gracefully
        const s = new THREE.Vector3();
        hand.getWorldScale(s);
        if (s.x > 0.0001) phone.scale.setScalar(1 / s.x);
        phone.rotation.x = -0.6;
        hand.add(phone);
      } else {
        phone.position.set(0, -0.36, 0.06);
        phone.rotation.x = -0.6;
        this.mesh.userData.parts.armR.add(phone);
      }
      this.props.push(phone);
    } else if (this.activity === 'sketch') {
      const pad = makeSketchpad();
      const d = toTable.length();
      const edge = Math.max(0.25, d - 0.45);
      const surfaceY = seat.pos.y > 0.05 ? 1.04 : 0.82;
      pad.position.set(
        seat.pos.x + (toTable.x / d) * edge,
        surfaceY,
        seat.pos.z + (toTable.z / d) * edge
      );
      pad.rotation.y = yaw + rand(-0.4, 0.4);
      this.sim.cafe.group.add(pad);
      this.props.push(pad);
    }
    // some regulars bring a sleepy dog that settles beside the chair
    if (this.activity !== 'chat' && seat.pos.y < 0.05 && Math.random() < 0.14) {
      const dog = makeDog();
      const perp = new THREE.Vector3(toTable.z, 0, -toTable.x).normalize();
      dog.position.copy(seat.pos).addScaledVector(perp, 0.62);
      dog.position.y = 0;
      dog.rotation.y = rand(0, Math.PI * 2);
      this.sim.cafe.group.add(dog);
      this.props.push(dog);
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

  // occasional toast between a chatting pair: the lead starts it, both raise
  // cups, a clink plays. Only the lead runs the timer to keep them in sync.
  _pairCheers(dt, seat) {
    if (this.cheers > 0) { this.cheers -= dt; return; }
    if (!this.pairLead) return;
    this.cheersT -= dt;
    if (this.cheersT <= 0 && this.partner?.state === 'sitting') {
      this.cheers = 1.1;
      this.partner.cheers = 1.1;
      this.cheersT = rand(15, 35);
      if (this.sim.audio?.started) this.sim.audio.playClink(seat.pos);
    }
  }

  // wave hello if another person is close and roughly ahead
  _maybeGreet() {
    const pos = this.mesh.position;
    for (const other of this.sim.npcs) {
      if (other === this) continue;
      const dx = other.mesh.position.x - pos.x;
      const dz = other.mesh.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.0 && d2 > 0.05) {
        this.greeting = 1.4;
        this.greetT = rand(9, 22);
        // the other person, if idle-ish, waves back a beat later
        if (other.greeting <= 0 && (other.path || other.state === 'queueing')) {
          other.greeting = 1.1;
          other.greetT = rand(9, 22);
        }
        return;
      }
    }
    this.greetT = rand(2, 5); // nobody near; check again soon
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
      // passing greeting: when two people cross paths, one waves hello
      this.greetT -= dt;
      if (this.greeting > 0) this.greeting -= dt;
      if (this.greeting <= 0 && this.greetT <= 0) this._maybeGreet();
      const greetingNow = this.greeting > 0;
      if (this.avatar) {
        this.avatar.sitting = false;
        this.avatar.setMode(greetingNow && this.avatar.hasWave ? 'wave' : 'walk', this.speed * 1.25);
        this.mesh.position.y = 0;
      } else {
        const s = Math.sin(this.walkPhase);
        p.legL.rotation.x = s * 0.55;
        p.legR.rotation.x = -s * 0.55;
        p.kneeL.rotation.x = Math.max(0, -s) * 0.8;
        p.kneeR.rotation.x = Math.max(0, s) * 0.8;
        // procedural: raise the free hand in a wave during a greeting
        if (greetingNow && !p.cup.visible) {
          p.armR.rotation.x = -2.4;
          p.armR.rotation.z = Math.sin(this.greeting * 12) * 0.3;
        } else {
          p.armR.rotation.z = 0;
          p.armR.rotation.x = p.cup.visible ? -0.9 : s * 0.4;
        }
        p.armL.rotation.x = -s * 0.4;
        this.mesh.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.03;
      }
      // audible footsteps when they're near the listener
      const stepNow = Math.floor(this.walkPhase / Math.PI);
      if (stepNow !== this.stepTick) {
        this.stepTick = stepNow;
        const lp = this.sim.listenerPos;
        if (lp && this.sim.audio?.started) {
          const dx = this.mesh.position.x - lp.x, dz = this.mesh.position.z - lp.z;
          if (dx * dx + dz * dz < 64) this.sim.audio.playFootstep(this.mesh.position, 0.5);
        }
      }
      // walkers glance around now and then
      this.glanceT -= dt;
      if (this.glanceT < 0) {
        this.headTarget = rand(-0.6, 0.6);
        this.glanceT = rand(2, 6);
      }
      if (this.avatar) { this.avatar.headYawTarget = this.headTarget; this.avatar.update(dt); }
      else p.head.rotation.y += (this.headTarget - p.head.rotation.y) * dt * 3;
      return;
    }

    // ---- stationary states, skinned branch: drive the rig and bail ----
    if (this.avatar) {
      this._updateSkinnedStationary(dt, t, seat);
      this.avatar.update(dt);
      return;
    }

    if (this.state === 'queueing') {
      this._setPose(false);
      this.mesh.rotation.y = Math.PI; // face the counter
      // idle shifting weight
      this.mesh.position.y = 0;
      p.torso.rotation.z = Math.sin(t * 0.9 + this.walkPhase) * 0.03;
      // half of them kill queue time on their phone
      if (this.checksPhone === undefined) this.checksPhone = Math.random() < 0.5;
      if (this.checksPhone) {
        p.armR.rotation.x = -1.15;
        p.head.rotation.x = 0.32;
        p.head.rotation.y = Math.sin(t * 0.3 + this.walkPhase) * 0.06;
      } else {
        p.head.rotation.x = 0;
        p.head.rotation.y = Math.sin(t * 0.5 + this.walkPhase) * 0.25;
      }
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
      if (this.stateT > this.orderTime && !this.sim.brewFor) {
        if (this.sim.audio?.started) this.sim.audio.playRegister();
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
        this.setCup(true);
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
        this._pairCheers(dt, seat);
        if (this.cheers > 0) {
          // both raise their cups for a toast
          p.armR.rotation.x = -1.9;
          p.armL.rotation.x = -0.4;
          p.head.rotation.x = -0.05;
          p.head.rotation.y = 0;
        } else {
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
        }
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
        } else if (this.activity === 'sketch') {
          // bent over the pad, drawing hand moving in little strokes
          p.armR.rotation.x = -0.95 + Math.sin(t * 3.1 + this.walkPhase) * 0.08;
          p.armR.rotation.z = Math.sin(t * 1.7) * 0.06;
          p.armL.rotation.x = -0.55;
          p.head.rotation.x = 0.34;
          p.head.rotation.y = Math.sin(t * 0.15) * 0.05;
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
        // and every so often, a lean-back stretch
        const stretch = (t * 0.02 + this.walkPhase * 0.7) % 1;
        if (stretch < 0.035) {
          const k = Math.sin((stretch / 0.035) * Math.PI);
          p.armL.rotation.x = p.armR.rotation.x = -0.6 - k * 2.2;
          p.head.rotation.x = -k * 0.3;
          p.torso.rotation.x = -k * 0.12;
        } else {
          p.torso.rotation.x = 0;
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

  // same brain as the procedural branch below, driving the rigged character
  _updateSkinnedStationary(dt, t, seat) {
    const av = this.avatar;
    if (this.state === 'queueing') {
      this._setPose(false);
      av.setMode('idle');
      this.mesh.rotation.y = Math.PI;
      if (this.checksPhone === undefined) this.checksPhone = Math.random() < 0.5;
      if (this.checksPhone) {
        av.headPitch = 0.3;
        av.headYawTarget = 0;
        if (!this.queuePhone && av.bones.RightHand) {
          this.queuePhone = makePhone();
          av.bones.RightHand.add(this.queuePhone);
          const s = new THREE.Vector3();
          av.bones.RightHand.getWorldScale(s);
          if (s.x > 0.0001) this.queuePhone.scale.setScalar(1 / s.x);
          this.props.push(this.queuePhone);
        }
      } else {
        av.headPitch = 0;
        av.headYawTarget = Math.sin(t * 0.5 + this.walkPhase) * 0.35;
      }
      if (this.queueIndex === 0 && !this.sim.ordering) {
        this.sim.ordering = this;
        this.state = 'ordering';
        this.stateT = 0;
      }
    } else if (this.state === 'ordering') {
      av.setMode('idle');
      av.headPitch = 0;
      this.mesh.rotation.y = Math.PI;
      av.headYawTarget = Math.sin(t * 0.8) * 0.12;
      if (this.stateT > this.orderTime && !this.sim.brewFor) {
        if (this.sim.audio?.started) this.sim.audio.playRegister();
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
      av.setMode('idle');
      this.mesh.rotation.y = Math.PI;
      av.headYawTarget = Math.sin(t * 0.4 + this.walkPhase) * 0.4;
      if (this.sim.brewFor !== this) {
        this.setCup(true);
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
        const pp = this.partner.mesh.position;
        const yaw = Math.atan2(pp.x - seat.pos.x, pp.z - seat.pos.z);
        this.mesh.rotation.y += (yaw - this.mesh.rotation.y) * dt * 2;
        const turn = Math.sin(t * 0.13 + (this.pairLead ? 0 : Math.PI));
        av.headPitch = turn > 0 ? 0.05 : 0.12 + Math.sin(t * 2.8) * 0.05;
        av.headYawTarget = Math.sin(t * 0.4 + this.walkPhase) * 0.12;
      } else {
        const look = seat.tableCenter;
        const yaw = Math.atan2(look.x - seat.pos.x, look.z - seat.pos.z);
        this.mesh.rotation.y += (yaw - this.mesh.rotation.y) * dt * 2;
        if (this.activity === 'laptop' || this.activity === 'book' || this.activity === 'phone' || this.activity === 'sketch') {
          av.headPitch = 0.28;
          av.headYawTarget = Math.sin(t * 0.2 + this.walkPhase) * 0.08;
        } else {
          av.headPitch = Math.sin(t * 0.5 + this.walkPhase * 2) * 0.05;
          av.headYawTarget = Math.sin(t * 0.3 + this.walkPhase) * 0.5;
        }
      }
      if (this.stateT > this.sitDuration) {
        this.state = 'leaving';
        this.stateT = 0;
        av.headPitch = 0;
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
      this.sitY = sitYFor(this, seat);
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
    if (this.avatar) { this.avatar.dispose(); return; }
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
    if (sim.charKeys?.length) {
      this.avatar = new SkinnedAvatar(sim.models, pick(sim.charKeys));
      this.mesh = this.avatar.root;
    } else {
      this.mesh = makePerson();
      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.34, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 })
      );
      apron.position.set(0, 0.82, 0.13);
      this.mesh.add(apron);
    }
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
    const p = this.avatar ? null : this.mesh.userData.parts;

    // where should I be?
    if (this.sim.ordering) this.target.copy(this.registerSpot);
    else if (this.sim.brewFor) this.target.copy(this.machineSpot);
    else if (Math.random() < 0.002) this.target.set(this.home.x + rand(-1.7, 1.7), 0, this.home.z);

    const dx = this.target.x - this.mesh.position.x;
    if (Math.abs(dx) > 0.06) {
      this.mesh.position.x += Math.sign(dx) * Math.min(Math.abs(dx), dt * 1.0);
      this.phase += dt * 6;
      if (this.avatar) {
        this.avatar.setMode('walk', 1.1);
      } else {
        const s = Math.sin(this.phase);
        p.legL.rotation.x = s * 0.4;
        p.legR.rotation.x = -s * 0.4;
        p.kneeL.rotation.x = Math.max(0, -s) * 0.6;
        p.kneeR.rotation.x = Math.max(0, s) * 0.6;
      }
      this.mesh.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.espressoPlayed = false;
    } else if (this.avatar) {
      if (this.sim.brewFor) {
        // working the machine, back turned — the pack's Working clip is perfect
        this.mesh.rotation.y = Math.PI;
        this.avatar.setMode('work');
        if (!this.espressoPlayed) {
          this.espressoPlayed = true;
          if (this.sim.audio?.started) {
            const a = this.sim.audio;
            a.playGrinder(this.sim.cafe.nav.machineWorld);
            a._timer(() => a.playEspresso(), 2300);
          }
        }
      } else if (this.sim.ordering) {
        this.mesh.rotation.y = 0;
        this.avatar.setMode('idle');
        this.avatar.headPitch = 0.05;
        this.espressoPlayed = false;
      } else {
        this.mesh.rotation.y = 0;
        this.avatar.setMode('work', 0.7); // wiping, tidying
        this.avatar.headYawTarget = Math.sin(t * 0.4 + this.phase) * 0.3;
        this.espressoPlayed = false;
      }
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      p.kneeL.rotation.x = p.kneeR.rotation.x = 0;
      if (this.sim.brewFor) {
        // working the machine, back half-turned
        this.mesh.rotation.y = Math.PI;
        p.armL.rotation.x = -0.9 + Math.sin(t * 3.2) * 0.2;
        p.armR.rotation.x = -0.7 + Math.cos(t * 2.7) * 0.25;
        if (!this.espressoPlayed) {
          this.espressoPlayed = true;
          if (this.sim.audio?.started) {
            const a = this.sim.audio;
            a.playGrinder(this.sim.cafe.nav.machineWorld);
            a._timer(() => a.playEspresso(), 2300);
          }
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
    if (this.avatar) this.avatar.update(dt);
  }

  dispose() {
    if (this.avatar) { this.avatar.dispose(); return; }
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map !== _blobTex) o.material.dispose?.();
    });
  }
}

// pedestrians drifting past the windows outside
class OutsideLife {
  constructor(cafe, models = null, charKeys = []) {
    this.cafe = cafe;
    this.group = new THREE.Group();
    cafe.group.add(this.group);
    this.walkers = [];
    const night = !!cafe.theme.rain;
    const n = 8;
    for (let i = 0; i < n; i++) {
      // downloaded animated characters when available, procedural otherwise
      let person, avatar = null;
      if (charKeys.length && Math.random() < 0.85) {
        avatar = new SkinnedAvatar(models, pick(charKeys));
        avatar.blob.visible = false;
        if (night) {
          avatar.root.traverse((o) => { if (o.isMesh && o.material?.color) o.material.color.multiplyScalar(0.4); });
        }
        avatar.setMode('walk', rand(0.9, 1.2));
        person = avatar.root;
        person.userData.avatar = avatar;
        this._buildWalker(person, night, avatar);
        continue;
      }
      person = makePerson(night ? 0.35 : 0.75);
      person.userData.parts.blob.visible = false;
      this._buildWalker(person, night, null);
    }
  }

  _buildWalker(person, night, avatar) {
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
      avatar,
      dir,
      speed: rand(0.7, 1.4),
      phase: rand(0, 10),
      x: rand(-14, 14),
      z: this.streetZ() + rand(-0.4, 0.8),
    };
    person.position.set(walker.x, 0, walker.z);
    person.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.group.add(person);
    this.walkers.push(walker);
  }

  streetZ() {
    return ROOM.D / 2 + 1.7; // just past the front windows
  }

  update(dt) {
    for (const w of this.walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x > 15) { w.x = -15; this.reroll(w); }
      if (w.x < -15) { w.x = 15; this.reroll(w); }
      w.phase += dt * 7 * w.speed;
      if (w.avatar) {
        w.avatar.update(dt);
        w.mesh.position.set(w.x, 0, w.z);
        continue;
      }
      const p = w.mesh.userData.parts;
      const s = Math.sin(w.phase);
      p.legL.rotation.x = s * 0.55;
      p.legR.rotation.x = -s * 0.55;
      p.kneeL.rotation.x = Math.max(0, -s) * 0.8;
      p.kneeR.rotation.x = Math.max(0, s) * 0.8;
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
  constructor(cafe, audio, models = null) {
    this.cafe = cafe;
    this.audio = audio;
    this.models = models;
    this.charKeys = characterKeys(models);
    this.sitKeys = sitCharacterKeys(models);
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
    this.outside = new OutsideLife(cafe, models, this.charKeys);
    this.spawnCooldown = rand(3, 7);
    this.spotSyncT = 0;

    // pre-seat customers so the café never starts empty
    const initial = Math.min(Math.floor(this.maxCrowd * 0.45) + Math.floor(Math.random() * 3), this.maxCrowd - 3);
    for (let i = 0; i < initial; i++) this._preseat();
    // a couple of pre-seated chatting pairs if there's room
    this._preseatPair();
    if (this.maxCrowd >= 14) this._preseatPair();
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
    npc.setCup(Math.random() < 0.7);
    const s = this.cafe.seats[seat];
    npc.sitY = sitYFor(npc, s);
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
      npc.setCup(true);
      const s = this.cafe.seats[seat];
      npc.sitY = sitYFor(npc, s);
      npc.mesh.position.set(s.pos.x, 0, s.pos.z);
      npc._setPose(true);
      members.push(npc);
      this.npcs.push(npc);
    }
    members[0].partner = members[1];
    members[1].partner = members[0];
    members[0].pairLead = true;
    // some pairs are here for a long game, not just the coffee
    if (Math.random() < 0.3) {
      const seatA = this.cafe.seats[pair[0]];
      const board = makeBoardGame();
      board.position.set(seatA.tableCenter.x, (seatA.tableTopY ?? 0.81) + 0.008, seatA.tableCenter.z);
      board.rotation.y = rand(0, Math.PI * 2);
      this.cafe.group.add(board);
      members[0].props.push(board);
      members[0].sitDuration = members[1].sitDuration = rand(150, 300);
    }
  }

  // the player orders a drink: the barista brews it for real, then `done`
  // fires so the UI can put a cup on their table
  orderDrink(done) {
    if (this.brewFor) return false; // barista's hands are full
    if (this.audio?.started) this.audio.playRegister();
    this.brewFor = 'player';
    this.brewT = 0;
    this.brewDuration = 6 + Math.random() * 4;
    this._playerOrderDone = done;
    return true;
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
    if (!free.length) return -1;
    // prefer seats with elbow room so strangers don't shoulder into each other
    const roomy = free.filter((i) => {
      const p = this.cafe.seats[i].pos;
      for (const j of this.takenSeats) {
        if (this.cafe.seats[j].pos.distanceTo(p) < 0.65) return false;
      }
      return true;
    });
    return pick(roomy.length ? roomy : free);
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

  update(dt, t, listenerPos = null) {
    this.listenerPos = listenerPos;
    this.barista.update(dt, t);
    this.outside.update(dt);

    // let the soundscape breathe with the actual room population
    this.crowdPollT = (this.crowdPollT ?? 0) - dt;
    if (this.crowdPollT <= 0 && this.audio?.started) {
      this.crowdPollT = 1.5;
      const social = this.npcs.filter((n) => n.state === 'sitting' || n.state === 'queueing' || n.state === 'ordering').length;
      this.audio.setCrowdFactor(social / Math.max(1, this.maxCrowd * 0.8));
    }

    // brewing timer
    if (this.brewFor) {
      this.brewT += dt;
      if (this.brewT > this.brewDuration) {
        const wasPlayer = this.brewFor === 'player';
        this.brewFor = null;
        // the drink gets its final pour and an "order up" ding as it's handed over
        if (this.audio?.started) {
          this.audio.playPour(this.cafe.nav.machineWorld);
          if (wasPlayer || Math.random() < 0.6) this.audio.playOrderUp(this.cafe.nav.pickup);
        }
        if (wasPlayer && this._playerOrderDone) {
          const cb = this._playerOrderDone;
          this._playerOrderDone = null;
          cb();
        }
      }
    }

    // arrivals
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0 && this.npcs.length < this.maxCrowd) {
      // fill faster while the room is empty, trickle when it's lively
      const fill = this.npcs.length / this.maxCrowd;
      this.spawnCooldown = rand(4, 10) + fill * rand(6, 14);
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
