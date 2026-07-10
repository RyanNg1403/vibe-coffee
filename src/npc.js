// Café life v2. Customers run a full behavior loop:
//   enter -> join the queue -> order at the register -> wait at pickup
//   -> find a seat -> do something (laptop / book / phone / chat) -> leave
// Pairs come in together, sit at the same table and chat. Walkers steer
// around each other. Outside, pedestrians pass the windows.
// The barista mirrors the queue: takes orders at the register, brews at
// the machine (synced with the espresso sound), and putters when idle.

import * as THREE from 'three';
import { ROOM } from './cafe.js';
import { cloneCharacter, cloneModel, characterKeys, sitCharacterKeys } from './modelLoader.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SKIN_TONES = [0xf1c9a5, 0xe0ac7e, 0xc68a5b, 0x9c6b43, 0x71492c, 0x513425];
const SHIRT = [0x7a5c8f, 0x4a7a6f, 0xa85751, 0x4f6d9c, 0xb08d4f, 0x5a5f66, 0x8a4a68, 0x3f6b4f, 0x946b52, 0x6b7f5a];
const PANTS = [0x37414f, 0x4a4038, 0x2f3438, 0x5a4a5f, 0x39504a, 0x54452f];
const HAIR = [0x241a12, 0x3f2a17, 0x6b4a26, 0x8a8a8a, 0x151515, 0x743e21, 0x4a3b32];

// Muted, natural-dye colours keep the imported characters in the same visual
// world as the café.  A controlled palette also prevents the old unrestricted
// hue rotation from producing fluorescent suits or green hair.
const IMPORTED_OUTFITS = [
  0x334653, 0x5b3d35, 0x435744, 0x665345, 0x51465f,
  0x7a6750, 0x3e5557, 0x6b4149, 0x54585f, 0x796f58,
];
const IMPORTED_HAIR = [0x17120f, 0x2b2019, 0x49301f, 0x6a4930, 0x8a8177];

const EYE_MAT = new THREE.MeshStandardMaterial({ color: 0x110e0c, roughness: 0.3 });
const EYE_WHITE_MAT = new THREE.MeshPhysicalMaterial({ color: 0xf4eee7, roughness: 0.35, clearcoat: 0.15 });

function disposeOwnedObject(root) {
  root?.traverse?.((object) => {
    if (object.geometry && !object.geometry.userData.vibeShared && !object.geometry.userData.shared) {
      object.geometry.dispose();
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture && !value.userData.vibeShared && !value.userData.shared) value.dispose();
      }
      if (!material.userData.vibeShared && !material.userData.shared) material.dispose();
    }
  });
}

const _clothTextures = [];
function clothTexture(style = 0) {
  if (_clothTextures[style]) return _clothTextures[style];
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = style === 1 ? '#b2b2b2' : '#a8a8a8';
  x.fillRect(0, 0, c.width, c.height);
  if (style === 1) {
    // Fine yarn-dyed stripes read as fabric without introducing noisy moire.
    for (let i = 0; i < 96; i += 12) {
      x.fillStyle = 'rgba(255,255,255,.13)';
      x.fillRect(i, 0, 3, 96);
      x.fillStyle = 'rgba(0,0,0,.08)';
      x.fillRect(i + 3, 0, 1, 96);
    }
  } else if (style === 2) {
    // A restrained diagonal twill for jackets and heavier shirts.
    x.strokeStyle = 'rgba(255,255,255,.09)';
    x.lineWidth = 1;
    for (let i = -96; i < 192; i += 6) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i - 96, 96); x.stroke();
    }
  } else {
    for (let i = 0; i < 96; i += 3) {
      x.fillStyle = i % 6 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
      x.fillRect(i, 0, 1, 96);
      x.fillRect(0, i, 96, 1);
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(style === 1 ? 2 : 4, 6);
  texture.anisotropy = 2;
  texture.userData.vibeShared = true;
  _clothTextures[style] = texture;
  return texture;
}

// one shared strand-streak texture makes every hair cap read as combed hair
// instead of a painted shell; the material colour supplies the hue
let _hairTex = null;
function hairStrandTexture() {
  if (_hairTex) return _hairTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 128;
    const w = 0.6 + Math.random() * 1.6;
    const shade = 165 + Math.floor(Math.random() * 90);
    g.strokeStyle = `rgba(${shade},${shade},${shade},0.55)`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, -4);
    g.bezierCurveTo(x + rand(-9, 9), 40, x + rand(-9, 9), 88, x + rand(-14, 14), 132);
    g.stroke();
  }
  _hairTex = new THREE.CanvasTexture(c);
  _hairTex.colorSpace = THREE.SRGBColorSpace;
  _hairTex.wrapS = _hairTex.wrapT = THREE.RepeatWrapping;
  _hairTex.userData.vibeShared = true;
  _hairTex.userData.shared = true; // one copy for the whole cast
  return _hairTex;
}

export function makePerson(tint = 1) {
  const g = new THREE.Group();
  const dim = (c) => new THREE.Color(c).multiplyScalar(tint);
  const skin = new THREE.MeshStandardMaterial({ color: dim(pick(SKIN_TONES)), roughness: rand(0.72, 0.86) });
  const cloth = clothTexture(Math.floor(rand(0, 3)));
  const shirt = new THREE.MeshStandardMaterial({
    color: dim(pick(SHIRT)), roughness: 0.88, map: cloth, bumpMap: cloth, bumpScale: 0.003,
  });
  const pants = new THREE.MeshStandardMaterial({ color: dim(pick(PANTS)), roughness: 0.95 });
  const hair = new THREE.MeshStandardMaterial({
    color: dim(pick(HAIR)), roughness: 0.82,
    map: hairStrandTexture(), bumpMap: hairStrandTexture(), bumpScale: 0.0016,
  });
  const shoeMat = new THREE.MeshStandardMaterial({ color: dim(pick([0x2a2118, 0x1e1e22, 0x4a3a2a, 0x50505a])), roughness: 0.8 });

  // body-shape variety: slim to broad
  const build = rand(0.88, 1.14);
  const parts = {};

  for (const side of [-1, 1]) {
    // two-segment legs: thigh from the hip, shin+foot from a knee pivot,
    // so seated people fold naturally instead of sticking straight out
    const hip = new THREE.Group();
    hip.position.set(side * 0.09 * build, 0.5, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.17, 4, 12), pants);
    thigh.position.y = -0.125;
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.25;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.15, 4, 12), pants);
    shin.position.y = -0.11;
    shin.castShadow = true;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.075, 4, 10), shoeMat);
    foot.position.set(0, -0.225, 0.035);
    foot.rotation.x = Math.PI / 2;
    foot.castShadow = true;
    knee.add(foot);
    g.add(hip);
    parts[side === -1 ? 'legL' : 'legR'] = hip;
    parts[side === -1 ? 'kneeL' : 'kneeR'] = knee;
  }

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.29, 6, 16), shirt);
  torso.scale.x = build;
  torso.position.y = 0.82;
  torso.castShadow = true;
  g.add(torso);
  parts.torso = torso;

  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2 * build, 0.98, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.3, 4, 12), shirt);
    arm.position.y = -0.19;
    arm.castShadow = true;
    shoulder.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 9), skin);
    hand.position.y = -0.38;
    shoulder.add(hand);
    g.add(shoulder);
    parts[side === -1 ? 'armL' : 'armR'] = shoulder;
  }

  // neck connects head to shoulders instead of a floating head
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 12), skin);
  neck.position.y = 1.1;
  g.add(neck);

  const headG = new THREE.Group();
  headG.position.y = 1.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin);
  head.scale.set(rand(0.9, 1.02), rand(1.0, 1.1), rand(0.94, 1.02));
  head.castShadow = true;
  headG.add(head);

  // Proper eye whites, irises, a nose and a restrained mouth keep faces
  // readable at café distance without the toy-like dot-eye look.
  parts.eyes = [];
  const irisMat = new THREE.MeshStandardMaterial({
    color: pick([0x33251b, 0x4d3825, 0x52614b, 0x40586a, 0x241d18]),
    roughness: 0.25,
  });
  for (const s of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 10, 8), EYE_WHITE_MAT);
    white.scale.y = 0.62;
    white.position.set(s * 0.041, 0.018, 0.105);
    headG.add(white);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), irisMat);
    iris.position.set(s * 0.041, 0.018, 0.116);
    headG.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 7, 5), EYE_MAT);
    pupil.position.set(s * 0.041, 0.018, 0.122);
    headG.add(pupil);
    parts.eyes.push({ white, iris });

    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.003, 0.026, 2, 6), hair);
    brow.rotation.z = Math.PI / 2 + s * 0.08;
    brow.position.set(s * 0.043, 0.052, 0.107);
    headG.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), skin);
  nose.scale.set(rand(0.55, 0.75), rand(0.9, 1.15), rand(1.05, 1.35));
  nose.position.set(0, -0.005, 0.117);
  headG.add(nose);
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.018, 0.0022, 5, 12, Math.PI * 0.9),
    new THREE.MeshStandardMaterial({ color: 0x7d413c, roughness: 0.8 })
  );
  mouth.rotation.set(0, 0, Math.PI * 0.05);
  mouth.position.set(0, -0.045, 0.109);
  headG.add(mouth);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), skin);
    ear.scale.set(0.55, 1, 0.55);
    ear.position.set(s * 0.112, 0, 0);
    headG.add(ear);
  }

  // hair: cap, long, or beanie
  const style = Math.random();
  if (style < 0.16) {
    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
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
      new THREE.SphereGeometry(0.12, 18, 12, 0, Math.PI * 2, 0, Math.PI * (style < 0.32 ? 0.35 : 0.52)),
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
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0045, 6, 14), glassMat);
      rim.position.set(s * 0.048, 0.018, 0.105);
      headG.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), glassMat);
    bridge.position.set(0, 0.018, 0.108);
    headG.add(bridge);
  }

  // Layered clothing details break the one-piece capsule silhouette.
  if (Math.random() < 0.58) {
    const collarMat = new THREE.MeshStandardMaterial({ color: dim(pick([0xe5ddcc, 0x2c3138, 0x7d684e])), roughness: 0.9 });
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.105 * build, 0.012, 6, 18, Math.PI), collarMat);
    collar.rotation.set(Math.PI / 2, 0, 0);
    collar.position.set(0, 1.045, 0.09);
    g.add(collar);
  }

  // Small, silhouette-safe wardrobe details create variety without adding
  // expensive textures or making every customer look like the same capsule.
  const outfitDetail = Math.random();
  if (outfitDetail < 0.24) {
    const jacketMat = new THREE.MeshStandardMaterial({
      color: dim(pick([0x35434b, 0x665044, 0x465442, 0x51445c, 0x7a6452])),
      roughness: 0.9,
      map: clothTexture(2),
    });
    for (const side of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.075 * build, 0.27, 0.018), jacketMat);
      lapel.position.set(side * 0.07 * build, 0.87, 0.137);
      lapel.rotation.z = side * 0.16;
      lapel.castShadow = true;
      g.add(lapel);
    }
  } else if (outfitDetail < 0.4) {
    const scarfMat = new THREE.MeshStandardMaterial({
      color: dim(pick([0x9b594b, 0x446271, 0x8b794d, 0x6d4968])), roughness: 1,
    });
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.105 * build, 0.022, 7, 20), scarfMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.set(0, 1.075, 0.005);
    g.add(scarf);
  } else if (outfitDetail < 0.54) {
    const buttonMat = new THREE.MeshStandardMaterial({ color: 0x302a25, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.009, 7, 5), buttonMat);
      button.position.set(0, 0.94 - i * 0.09, 0.145);
      g.add(button);
    }
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

function animateMicroMotion(parts, t, phase = 0) {
  if (!parts) return;
  // Each person gets a different phase. The narrow waveform produces a quick
  // double-sided blink rather than a slow mechanical eyelid animation.
  const blinkWave = Math.sin(t * 0.64 + phase * 1.71);
  const closure = Math.pow(Math.max(0, (blinkWave - 0.972) / 0.028), 0.42);
  for (const eye of parts.eyes ?? []) {
    eye.white.scale.y = 0.62 * (1 - closure * 0.92);
    eye.iris.scale.y = 1 - closure * 0.92;
  }
  if (parts.torso) parts.torso.scale.z = 1 + Math.sin(t * 1.18 + phase) * 0.012;
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
  _blobTex.userData.vibeShared = true;
  return _blobTex;
}

// Keep the soft contact shadow planted while the root rises and falls with a
// gait cycle or moves down into a seated pose.
function setGroundedY(root, y, blob) {
  root.position.y = y;
  if (blob) blob.position.y = (0.015 - y) / Math.max(0.001, root.scale.y);
}

// ---------- skinned avatar: downloaded rigged character ----------
// Wraps the bundled rigged characters and exposes the small control surface the
// NPC brain needs. Three rigs use authored seated idles; the manual bone pose is
// retained for future compatible assets that only provide standing clips.

class SkinnedAvatar {
  constructor(models, key, options = {}) {
    const { mesh, animations } = cloneCharacter(models, key);
    this.key = key;
    this.isHero = key.startsWith('char_hero_');
    this.root = new THREE.Group();
    this.root.add(mesh);
    this.inner = mesh;
    this._ownedMaterials = new Set();
    this._ownedGeometries = new Set();
    this._ownedSkeletons = new Set();
    this._animationDebt = 0;
    this._forcePose = true;

    // Each clone gets a restrained wardrobe/complexion variation.  The source
    // files mostly use named flat-colour materials, so this costs no additional
    // textures and makes a balanced rotation of four meshes read as a crowd.
    const appearanceIndex = options.appearanceIndex ?? Math.floor(rand(0, IMPORTED_OUTFITS.length));
    const keySalt = Math.max(0, key.charCodeAt(key.length - 1) - 97);
    const outfit = new THREE.Color(IMPORTED_OUTFITS[(appearanceIndex + keySalt * 2) % IMPORTED_OUTFITS.length]);
    const skinTone = new THREE.Color(SKIN_TONES[(appearanceIndex * 5 + keySalt) % SKIN_TONES.length]);
    const hairTone = new THREE.Color(IMPORTED_HAIR[(appearanceIndex * 3 + keySalt) % IMPORTED_HAIR.length]);
    mesh.traverse((o) => {
      if (o.isMesh) {
        if (o.isSkinnedMesh && o.skeleton) this._ownedSkeletons.add(o.skeleton);
        // Each high-detail hero is a single 159–171k-triangle draw. Keeping it out
        // of the shadow map retains the close-up silhouette and texture quality
        // without rendering that geometry twice every shadow refresh.
        o.castShadow = options.castShadow !== false && !this.isHero;
        o.receiveShadow = options.receiveShadow !== false;
        // Skinned parts get culled below with one shared whole-body bound;
        // per-part bind-pose spheres made heads and limbs pop out of view
        // whenever an animated pose (sitting, waving) left the bind volume.
        o.frustumCulled = !o.isSkinnedMesh;
        const source = Array.isArray(o.material) ? o.material : [o.material];
        const materials = source.map((sourceMaterial, materialIndex) => {
          const material = sourceMaterial.clone();
          this._ownedMaterials.add(material);
          material.metalness = Math.min(material.metalness ?? 0, 0.04);
          const name = (material.name || '').toLowerCase();
          const isSkin = name.includes('skin') || name.includes('face');
          const isHair = name.includes('hair') || name.includes('brown');
          const isEye = name.includes('eye');
          const hasTexture = !!material.map;

          if (material.color && !hasTexture) {
            if (isSkin) {
              material.color.copy(skinTone);
              material.roughness = rand(0.68, 0.82);
            } else if (isHair) {
              material.color.copy(hairTone);
              material.roughness = 0.84;
              // the same combed-strand texture the procedural cast uses —
              // flat-shaded hair shells read as helmets up close
              material.map = hairStrandTexture();
              material.bumpMap = material.map;
              material.bumpScale = 0.0015;
            } else if (isEye) {
              material.color.setHex(0x171411);
              material.roughness = 0.36;
            } else {
              // Related, rather than identical, tones preserve multi-material
              // garment details while keeping each outfit coherent.
              material.color.copy(outfit).offsetHSL(
                materialIndex * 0.025 - 0.025,
                rand(-0.05, 0.05),
                rand(-0.1, 0.1),
              );
              material.roughness = Math.max(0.72, material.roughness ?? 0.82);
            }
          } else if (hasTexture) {
            // Textured characters may share one atlas across skin and clothes;
            // preserve authored colour instead of tinting their skin as well.
            material.roughness = Math.max(0.76, material.roughness ?? 0.85);
          }
          material.needsUpdate = true;
          return material;
        });
        o.material = Array.isArray(o.material) ? materials : materials[0];
      }
    });

    // One conservative whole-body bound shared by every skinned part: culling
    // still rejects patrons fully off-screen, but no animated pose (sitting,
    // waving, folded legs) can drift outside its own culling sphere the way
    // small per-part bind-pose bounds allowed.
    {
      const skinnedParts = [];
      mesh.traverse((o) => { if (o.isSkinnedMesh) skinnedParts.push(o); });
      if (skinnedParts.length) {
        const union = new THREE.Box3();
        const corner = new THREE.Vector3();
        for (const part of skinnedParts) {
          part.computeBoundingSphere();
          const sp = part.boundingSphere;
          union.expandByPoint(corner.set(sp.center.x - sp.radius, sp.center.y - sp.radius, sp.center.z - sp.radius));
          union.expandByPoint(corner.set(sp.center.x + sp.radius, sp.center.y + sp.radius, sp.center.z + sp.radius));
        }
        const center = union.getCenter(new THREE.Vector3());
        const radius = union.getSize(new THREE.Vector3()).length() * 0.5 * 1.3;
        for (const part of skinnedParts) {
          part.boundingSphere = new THREE.Sphere(center.clone(), radius);
          part.frustumCulled = true;
        }
      }
    }

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
    // seated hold so the character never pops upright at the loop seam.
    // Frame slicing damages sparse resampled tracks (char_j/char_l), so when
    // the trim window catches nothing, freeze the mid-clip seated pose instead.
    let sitClip = find('sit');
    if (sitClip && sitClip.duration > 2.5) {
      const trimmed = THREE.AnimationUtils.subclip(sitClip, 'sit_hold', 21, Math.floor(sitClip.duration * 30) - 1, 30);
      if (trimmed.tracks.length > 4 && trimmed.duration > 0.1) {
        sitClip = trimmed;
      } else {
        const tMid = sitClip.duration * 0.6;
        const tracks = sitClip.tracks.map((tr) => {
          const v = tr.createInterpolant().evaluate(tMid);
          return new tr.constructor(tr.name, [0], Array.from(v));
        });
        sitClip = new THREE.AnimationClip('sit_hold', 0.5, tracks);
      }
    }
    this.actions = {
      idle: mk(find('idle')),
      walk: mk(find('walk')),
      work: mk(find('working', 'interact-right', 'pick-up', 'pickup', 'interact')),
      wave: mk(find('wave', 'emote-yes')), // 'interact' reads as a scarecrow mid-walk
      sit: mk(sitClip),
    };
    this.hasWave = !!this.actions.wave;
    this.hasSitClip = !!this.actions.sit;
    this.mode = 'idle';
    if (this.actions.idle) {
      this.actions.idle.play();
      this.actions.idle.time = Math.random() * this.actions.idle.getClip().duration;
    }

    // rigs differ across packs — resolve bones through alias lists
    const ALIASES = {
      Hips: ['Hips', 'hips', 'Torso', 'torso', 'Body', 'body'],
      Neck: ['Neck', 'neck'],
      Head: ['Head', 'head'],
      LeftUpLeg: ['LeftUpLeg', 'UpperLeg.L', 'UpperLegL', 'leg-left', 'Leg.L'],
      RightUpLeg: ['RightUpLeg', 'UpperLeg.R', 'UpperLegR', 'leg-right', 'Leg.R'],
      LeftLeg: ['LeftLeg', 'LowerLeg.L', 'LowerLegL'],
      RightLeg: ['RightLeg', 'LowerLeg.R', 'LowerLegR'],
      LeftHand: ['LeftHand', 'Hand.L', 'HandL', 'Palm.L', 'Wrist.L', 'hand-left', 'arm-left', 'LowerArm.L'],
      RightHand: ['RightHand', 'Hand.R', 'HandR', 'Palm.R', 'Wrist.R', 'hand-right', 'arm-right', 'LowerArm.R'],
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
    this._ownedGeometries.add(blob.geometry);
    this._ownedMaterials.add(blob.material);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    this.root.add(blob);
    this.blob = blob;

    // to-go cup lives in the right hand
    this.cup = makeToGoCup();
    this.cup.traverse((o) => {
      if (o.geometry) this._ownedGeometries.add(o.geometry);
      if (o.material) this._ownedMaterials.add(o.material);
    });
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
      // Desynchronise every ambient loop, not only sitting.  People entering in
      // pairs should never breathe, step, or fidget on the same frame.
      if (next === 'sit' || next === 'idle' || next === 'work') {
        action.time = Math.random() * action.getClip().duration;
      }
      prev?.fadeOut(0.22);
      this.mode = next;
      this._forcePose = true;
    }
    if (action) action.timeScale = timeScale;
  }

  setCup(v) { this.cup.visible = v; }

  ownObject(object) {
    object.traverse((o) => {
      if (o.geometry) this._ownedGeometries.add(o.geometry);
      const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      materials.forEach((material) => this._ownedMaterials.add(material));
    });
  }

  update(dt, distance = 0, qualityLevel = 2) {
    // Full-rate animation is reserved for people close enough to read facial
    // and hand motion.  Far indoor customers update at 20 Hz and figures seen
    // through the windows at 10 Hz.  Time is accumulated, so clips stay in sync
    // with world time instead of slowing down.
    this._animationDebt += dt;
    const interval = qualityLevel === 0
      ? (distance > 10 ? 0.1 : distance > 5 ? 0.05 : 0)
      : (distance > 13 ? 0.1 : distance > 8 ? 0.05 : 0);
    if (!this._forcePose && interval && this._animationDebt < interval) return;
    const animationDt = this._animationDebt;
    this._animationDebt = 0;
    this._forcePose = false;
    // Remove last update's look offset before the mixer runs. When the clip
    // animates the head the mixer overwrites this anyway; when it doesn't
    // (static single-key hold poses), this stops the offset from integrating
    // into a broken neck at +0.28 rad per update.
    const lookBone = this.bones.Head ?? this.bones.Neck;
    if (lookBone && this._appliedLook) {
      lookBone.rotation.y -= this._appliedLook.y;
      lookBone.rotation.x -= this._appliedLook.x;
    }
    this.mixer.update(animationDt);
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
    this._headYaw += (this.headYawTarget - this._headYaw) * Math.min(1, animationDt * 3);
    const head = this.bones.Head ?? this.bones.Neck;
    if (head) {
      // keep the look natural even if a state feeds a runaway target
      const pitch = THREE.MathUtils.clamp(this.headPitch, -0.6, 0.6);
      const yaw = THREE.MathUtils.clamp(this._headYaw, -1.1, 1.1);
      head.rotation.y += yaw;
      head.rotation.x += pitch;
      this._appliedLook = { y: yaw, x: pitch };
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.inner);
    // Three creates one GPU bone texture for every cloned skeleton on first
    // render. SkeletonUtils owns those clones per avatar, so release them here
    // instead of retaining an invisible texture for every departed patron and
    // every café switch.
    this._ownedSkeletons.forEach((skeleton) => skeleton.dispose());
    // SkeletonUtils clones share the library's geometries.  Disposing them here
    // invalidated every other customer using that template; only per-instance
    // materials and helper geometry are owned by this avatar.
    this._ownedGeometries.forEach((geometry) => geometry.dispose());
    this._ownedMaterials.forEach((material) => material.dispose());
    this._ownedGeometries.clear();
    this._ownedMaterials.clear();
    this._ownedSkeletons.clear();
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
  // measured: authored sit poses put the hip bone ~0.10 below these offsets
  // plus the cushion top, which reads as sinking through the chair
  return npc.avatar.hasSitClip ? (elevated ? 0.24 : 0.05) : (elevated ? -0.24 : -0.38);
}

// authored sit poses centre the hips on the rig origin; slide the body a
// palm's width back toward the chair so nobody perches off the front edge
function applySitOffset(npc, seat) {
  const yaw = seat.facingYaw ?? Math.atan2(
    seat.tableCenter.x - seat.pos.x, seat.tableCenter.z - seat.pos.z);
  if (npc.avatar?.hasSitClip) {
    npc.mesh.position.x -= Math.sin(yaw) * 0.14;
    npc.mesh.position.z -= Math.cos(yaw) * 0.14;
  }
}

class NPC {
  constructor(sim, opts = {}) {
    this.sim = sim;
    const willSit = (opts.seatIndex ?? -1) >= 0;
    // Imported, skinned people are the default. The procedural actor remains a
    // true resilience fallback for failed/missing assets; seated models use an
    // authored clip when present and the compatible leg-bone pose otherwise.
    const charKey = sim.pickCharacter(willSit);
    if (charKey) {
      this.avatar = new SkinnedAvatar(sim.models, charKey, {
        appearanceIndex: sim.nextAppearanceIndex(),
      });
      this.mesh = this.avatar.root;
    } else {
      this.mesh = makePerson();
    }
    if (this.avatar) {
      // 1.60–1.82 m with independent shoulder/depth variation.  The modest
      // range retains believable anatomy while breaking repeated silhouettes.
      this.mesh.scale.set(rand(0.93, 1.07), rand(0.94, 1.07), rand(0.94, 1.05));
    } else {
      this.mesh.scale.setScalar(rand(1.1, 1.23));
    }
    this.seatIndex = opts.seatIndex ?? -1;
    this.partner = null;            // set for pairs
    this.activity = opts.activity ?? pick(ACTIVITIES);
    this.state = 'entering';
    this.stateT = 0;
    this.path = null;
    this.pathI = 0;
    this.walkPhase = rand(0, 10);
    this.speed = rand(0.72, 1.05);
    this.currentSpeed = 0;
    this.velocity = new THREE.Vector3();
    this.walkDir = new THREE.Vector3(0, 0, 1);
    this.avoidanceSide = 1; // shared keep-right convention for head-on passes
    this.personalSpace = rand(0.44, 0.56);
    this.strideScale = rand(0.9, 1.08);
    this.turnRate = rand(6.2, 8.4);
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
    this._bestDist = Infinity;
    this._stallT = 0;
  }

  _setRootY(y) {
    setGroundedY(this.mesh, y, this.avatar?.blob ?? this.mesh.userData.parts?.blob);
  }

  _setPose(sitting) {
    if (this.avatar) {
      this.avatar.sitting = sitting;
      this._setRootY(sitting ? this.sitY : 0);
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
      this._setRootY(this.sitY);
    } else {
      p.legL.rotation.x = p.legR.rotation.x = 0;
      p.kneeL.rotation.x = p.kneeR.rotation.x = 0;
      p.torso.rotation.x = 0;
      this._setRootY(0);
    }
  }

  _beginLeavingSeat(seat) {
    this.state = 'standingSeat';
    this.stateT = 0;
    this.transitionFrom = this.mesh.position.clone();
    this._clearProps();
    if (this.sim.audio?.started && Math.random() < 0.7) this.sim.audio.playChairScrape(seat.pos);
  }

  _updateSeatTransition(seat) {
    if (!seat) return;
    const entering = this.state === 'aligningSeat';
    const duration = entering ? 0.72 : 0.62;
    const raw = THREE.MathUtils.clamp(this.stateT / duration, 0, 1);
    const eased = raw * raw * (3 - 2 * raw);
    const from = this.transitionFrom ?? this.mesh.position;
    const target = entering ? seat.pos : (seat.approach ?? seat.pos);
    this.mesh.position.x = THREE.MathUtils.lerp(from.x, target.x, eased);
    this.mesh.position.z = THREE.MathUtils.lerp(from.z, target.z, eased);

    const desiredYaw = seat.facingYaw ?? Math.atan2(
      seat.tableCenter.x - seat.pos.x,
      seat.tableCenter.z - seat.pos.z,
    );
    let yawDelta = desiredYaw - this.mesh.rotation.y;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    this.mesh.rotation.y += yawDelta * Math.min(1, 0.18 + eased * 0.42);

    const sitAmount = entering
      ? THREE.MathUtils.smoothstep(raw, 0.18, 1)
      : 1 - THREE.MathUtils.smoothstep(raw, 0, 0.82);
    if (this.avatar) {
      this.avatar.sitting = sitAmount > 0.18;
      if (this.avatar.sitting) {
        this.avatar.setMode(this.avatar.hasSitClip ? 'sit' : 'idle', 0.8);
      } else {
        this.avatar.setMode('idle', 0.8);
      }
      this._setRootY(THREE.MathUtils.lerp(0, this.sitY, sitAmount));
    } else {
      const p = this.mesh.userData.parts;
      p.legL.rotation.x = p.legR.rotation.x = -1.25 * sitAmount;
      p.kneeL.rotation.x = p.kneeR.rotation.x = 1.45 * sitAmount;
      this._setRootY(THREE.MathUtils.lerp(0, this.sitY, sitAmount));
    }

    if (raw < 1) return;
    if (entering) {
      this.state = 'sitting';
      this.stateT = 0;
      this.mesh.position.x = seat.pos.x;
      this.mesh.position.z = seat.pos.z;
      applySitOffset(this, seat);
      this._setPose(true);
      this._addProps();
    } else {
      this.state = 'leaving';
      this.stateT = 0;
      this._setPose(false);
      this.sim.releaseSeat(this.seatIndex);
      this.seatIndex = -1;
      this._walkTo(this.sim.cafe.nav.door);
    }
    this.transitionFrom = null;
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
      const surfaceY = seat.tableTopY ?? 0.815;
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
      const surfaceY = seat.tableTopY ?? 0.82;
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
      disposeOwnedObject(prop);
    }
    this.props = [];
    this.isTyping = false;
    this.queuePhone = null;
  }

  _stowQueuePhone() {
    const phone = this.queuePhone;
    if (!phone) return;
    phone.parent?.remove(phone);
    const index = this.props.indexOf(phone);
    if (index >= 0) this.props.splice(index, 1);
    disposeOwnedObject(phone);
    this.queuePhone = null;
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
      const distance = Math.sqrt(d2);
      const facingDot = distance > 0.001
        ? (Math.sin(this.mesh.rotation.y) * dx + Math.cos(this.mesh.rotation.y) * dz) / distance
        : -1;
      if (d2 < 2.0 && d2 > 0.05 && facingDot > 0.2) {
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

  // Soft personal-space steering plus an earlier sidestep for oncoming
  // walkers. A stable preferred side avoids the left-right indecision common
  // to simple collision repulsion.
  _separation(dir) {
    const pos = this.mesh.position;
    for (const other of this.sim.npcs) {
      if (other === this) continue;
      const otherMoving = !!other.path;
      const blocksAisle = other.state === 'queueing'
        || other.state === 'ordering'
        || other.state === 'waitingPickup';
      if (!otherMoving && !blocksAisle) continue;
      const dx = pos.x - other.mesh.position.x;
      const dz = pos.z - other.mesh.position.z;
      const d2 = dx * dx + dz * dz;
      const radius = (this.personalSpace + (other.personalSpace ?? 0.48)) * 0.62;
      if (d2 < radius * radius && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const k = (1 - d / radius) ** 2 * 2.6;
        dir.x += (dx / d) * k;
        dir.z += (dz / d) * k;
      }

      if (otherMoving && d2 < 1.7 && d2 > 0.06) {
        const d = Math.sqrt(d2);
        const toward = -(dir.x * dx + dir.z * dz) / d;
        const otherToward = other.walkDir
          ? (other.walkDir.x * dx + other.walkDir.z * dz) / d
          : 0;
        if (toward > 0.35 && otherToward > 0.15) {
          const side = this.avoidanceSide;
          const k = (1 - d / Math.sqrt(1.7)) * 0.42;
          const px = dir.z;
          const pz = -dir.x;
          dir.x += px * side * k;
          dir.z += pz * side * k;
        }
      }
    }
    return dir;
  }

  _avoidFurniture(dir) {
    const pos = this.mesh.position;
    const lookAhead = 0.52;
    const x = pos.x + dir.x * lookAhead;
    const z = pos.z + dir.z * lookAhead;
    for (const collider of this.sim.cafe.colliders) {
      if (collider.r) {
        const radius = collider.r + 0.25;
        const dx = x - collider.x;
        const dz = z - collider.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const tangentSign = dir.x * -nz + dir.z * nx >= 0 ? 1 : -1;
        const strength = (1 - d / radius) * 1.7 + 0.35;
        dir.x += nx * strength + -nz * tangentSign * 0.28;
        dir.z += nz * strength + nx * tangentSign * 0.28;
      } else if (collider.rect) {
        const r = collider.rect;
        const margin = 0.24;
        if (x <= r.x0 - margin || x >= r.x1 + margin || z <= r.z0 - margin || z >= r.z1 + margin) continue;
        const edges = [
          { distance: x - (r.x0 - margin), x: -1, z: 0 },
          { distance: (r.x1 + margin) - x, x: 1, z: 0 },
          { distance: z - (r.z0 - margin), x: 0, z: -1 },
          { distance: (r.z1 + margin) - z, x: 0, z: 1 },
        ];
        edges.sort((a, b) => a.distance - b.distance);
        dir.x += edges[0].x * 1.25;
        dir.z += edges[0].z * 1.25;
      }
    }
    return dir;
  }

  update(dt, t) {
    this.stateT += dt;
    const p = this.mesh.userData.parts;
    const seat = this.seatIndex >= 0 ? this.sim.cafe.seats[this.seatIndex] : null;
    animateMicroMotion(p, t, this.walkPhase);

    const walking = !!this.path;
    if (walking) {
      const target = this.path[this.pathI];
      const pos = this.mesh.position;
      const dir = this.walkDir;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      // Stall rescue: steering equilibria (a crowded pickup counter, a
      // waypoint grazing a planter's avoidance margin) can hold a walker at
      // a fixed distance forever. When no progress is made for a while,
      // accept a generous arrival instead of walking in place.
      if (dist < (this._bestDist ?? Infinity) - 0.015) {
        this._bestDist = dist;
        this._stallT = 0;
      } else {
        this._stallT = (this._stallT ?? 0) + dt;
      }
      const stalled = this._stallT > 2.5 && dist < 0.9;
      if (this._stallT > 4.5) {
        // truly wedged: replan from here to the final destination, with a
        // sidestep first so the same steering equilibrium can't recapture us
        this._stallT = 0;
        this._bestDist = Infinity;
        const destination = this.path[this.path.length - 1];
        this._walkTo(destination);
        if (this.path && this.path.length > 1) {
          this.path.splice(1, 0, new THREE.Vector3(
            pos.x + (Math.random() - 0.5) * 1.3, 0,
            pos.z + (Math.random() - 0.5) * 1.3,
          ));
        }
        return;
      }
      if (dist < 0.07 || stalled) {
        pos.x = target.x;
        pos.z = target.z;
        this.pathI++;
        this._bestDist = Infinity;
        this._stallT = 0;
        if (this.pathI >= this.path.length) {
          this.path = null;
          this.currentSpeed = 0;
          this.velocity.set(0, 0, 0);
          this._arrived();
          return;
        }
      } else {
        dir.set(dx / dist, 0, dz / dist);

        // Start looking through a corner before reaching its exact waypoint.
        // This preserves the safe corridor route but removes right-angle pivots.
        if (this.pathI < this.path.length - 1 && dist < 0.58) {
          const next = this.path[this.pathI + 1];
          const ndx = next.x - target.x;
          const ndz = next.z - target.z;
          const nd = Math.hypot(ndx, ndz);
          if (nd > 0.001) {
            const blend = (1 - dist / 0.58) * 0.68;
            dir.x = THREE.MathUtils.lerp(dir.x, ndx / nd, blend);
            dir.z = THREE.MathUtils.lerp(dir.z, ndz / nd, blend);
          }
        }

        this._separation(dir);
        this._avoidFurniture(dir);
        const steerLength = Math.hypot(dir.x, dir.z) || 1;
        dir.x /= steerLength;
        dir.z /= steerLength;

        const finalSegment = this.pathI === this.path.length - 1;
        const arrivalScale = finalSegment
          ? Math.max(0.16, THREE.MathUtils.smoothstep(dist, 0.04, 0.68))
          : 1;
        const desiredSpeed = this.speed * arrivalScale;
        const response = desiredSpeed > this.currentSpeed ? 3.4 : 6.2;
        this.currentSpeed += (desiredSpeed - this.currentSpeed) * (1 - Math.exp(-response * dt));

        // Velocity smoothing absorbs avoidance corrections instead of turning
        // each neighbour update into a visible lateral twitch.
        const velocityBlend = 1 - Math.exp(-5.2 * dt);
        this.velocity.x += (dir.x * this.currentSpeed - this.velocity.x) * velocityBlend;
        this.velocity.z += (dir.z * this.currentSpeed - this.velocity.z) * velocityBlend;
        pos.x += this.velocity.x * dt;
        pos.z += this.velocity.z * dt;
        const actualSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (actualSpeed > 0.12) {
          // a near-stationary walker whose steering flips (waiting at a busy
          // pickup counter) must not whip around on the spot: face only real
          // movement, and turn slower the slower you walk
          this.walkDir.set(this.velocity.x / actualSpeed, 0, this.velocity.z / actualSpeed);
          const targetYaw = Math.atan2(this.walkDir.x, this.walkDir.z);
          let dy = targetYaw - this.mesh.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          const turn = this.turnRate * Math.min(1, actualSpeed / 0.45);
          // absolute rate cap: even a full about-face sweeps like a person
          // turning, not a top spinning
          const step = dy * (1 - Math.exp(-turn * dt));
          const maxStep = 4.2 * dt;
          this.mesh.rotation.y += THREE.MathUtils.clamp(step, -maxStep, maxStep);
        }
      }
      const speedRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(0.01, this.speed), 0, 1);
      this.walkPhase += dt * 6.7 * this.currentSpeed * this.strideScale;
      // passing greeting: when two people cross paths, one waves hello
      this.greetT -= dt;
      if (this.greeting > 0) this.greeting -= dt;
      if (this.greeting <= 0 && this.greetT <= 0) this._maybeGreet();
      const greetingNow = this.greeting > 0;
      if (this.avatar) {
        this.avatar.sitting = false;
        this.avatar.headPitch = 0;
        this.avatar.setMode(
          greetingNow && this.avatar.hasWave && this.currentSpeed < 0.2 ? 'wave' : 'walk',
          Math.max(0.45, this.currentSpeed * 1.25)
        );
        this._setRootY(0);
      } else {
        const s = Math.sin(this.walkPhase);
        const stride = 0.5 * this.strideScale * speedRatio;
        p.legL.rotation.x = s * stride;
        p.legR.rotation.x = -s * stride;
        p.kneeL.rotation.x = Math.max(0, -s) * 0.72 * speedRatio;
        p.kneeR.rotation.x = Math.max(0, s) * 0.72 * speedRatio;
        // procedural: raise the free hand in a wave during a greeting
        if (greetingNow && !p.cup.visible) {
          p.armR.rotation.x = -2.4;
          p.armR.rotation.z = Math.sin(this.greeting * 12) * 0.3;
        } else {
          p.armR.rotation.z = 0;
          p.armR.rotation.x = p.cup.visible ? -0.9 : s * 0.34 * speedRatio;
        }
        p.armL.rotation.x = -s * 0.34 * speedRatio;
        // Human centre-of-mass motion is subtle and peaks twice per stride.
        // Counter-rotation keeps the upper body balanced above planted feet.
        p.torso.rotation.x = 0.035 * speedRatio;
        p.torso.rotation.z = -s * 0.025 * speedRatio;
        const bob = (0.5 - 0.5 * Math.cos(this.walkPhase * 2)) * 0.014 * speedRatio;
        this._setRootY(bob);
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
      if (this.avatar) {
        this.avatar.headYawTarget = this.headTarget;
        this.avatar.update(dt, this._distanceToListener(), this.sim.qualityLevel);
      }
      else p.head.rotation.y += (this.headTarget - p.head.rotation.y) * dt * 3;
      return;
    }

    if (this.state === 'aligningSeat' || this.state === 'standingSeat') {
      this._updateSeatTransition(seat);
      if (this.avatar) {
        this.avatar.update(dt, this._distanceToListener(), this.sim.qualityLevel);
      }
      return;
    }

    // ---- stationary states, skinned branch: drive the rig and bail ----
    if (this.avatar) {
      this._updateSkinnedStationary(dt, t, seat);
      this.avatar.update(dt, this._distanceToListener(), this.sim.qualityLevel);
      return;
    }

    if (this.state === 'queueing') {
      this._setPose(false);
      this._faceCounter(dt); // never fight the walking block for the yaw
      // idle shifting weight
      this._setRootY(0);
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
        this._stowQueuePhone();
        this.sim.ordering = this;
        this.state = 'ordering';
        this.stateT = 0;
      }
    } else if (this.state === 'ordering') {
      this._faceCounter(dt);
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
        this.sim.brewDuration = rand(14.8, 16.2);
        this.state = 'waitingPickup';
        this.stateT = 0;
        this._walkTo(this.sim.pickupSlot(this));
      }
    } else if (this.state === 'waitingPickup') {
      this._faceCounter(dt);
      p.head.rotation.y = Math.sin(t * 0.4 + this.walkPhase) * 0.35;
      p.torso.rotation.z = Math.sin(t * 0.7 + this.walkPhase) * 0.025;
      if (this.sim.brewFor !== this) {
        // coffee's up
        this.setCup(true);
        this.stateT = 0;
        if (this.seatIndex >= 0) {
          this.state = 'toSeat';
          const seatTarget = this.sim.cafe.seats[this.seatIndex];
          this._walkTo(seatTarget.approach ?? seatTarget.pos);
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
      if (this.stateT > this.sitDuration) this._beginLeavingSeat(seat);
    }
  }

  _distanceToListener() {
    return this.sim.listenerPos ? this.mesh.position.distanceTo(this.sim.listenerPos) : 0;
  }

  // same brain as the procedural branch below, driving the rigged character
  // Ease toward facing the counter. Hard-setting the yaw here while a path
  // was still active meant two writers fought over it every frame — the
  // walking block turned toward the velocity, this snapped it back — which
  // read as customers spinning in place at the register and pickup counter.
  _faceCounter(dt) {
    if (this.path) return;
    let dy = Math.PI - this.mesh.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.mesh.rotation.y += dy * Math.min(1, dt * 5);
  }

  _updateSkinnedStationary(dt, t, seat) {
    const av = this.avatar;
    // While walking to the queue slot / pickup spot, the walking block owns
    // the gait and facing; forcing idle+yaw from here as well thrashed the
    // animation mixer every frame (both actions permanently mid-fade).
    const enRoute = !!this.path;
    if (this.state === 'queueing') {
      this._setPose(false);
      if (!enRoute) av.setMode('idle');
      this._faceCounter(dt);
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
        this._stowQueuePhone();
        this.sim.ordering = this;
        this.state = 'ordering';
        this.stateT = 0;
      }
    } else if (this.state === 'ordering') {
      if (!enRoute) av.setMode('idle');
      av.headPitch = 0;
      this._faceCounter(dt);
      av.headYawTarget = Math.sin(t * 0.8) * 0.12;
      if (this.stateT > this.orderTime && !this.sim.brewFor) {
        if (this.sim.audio?.started) this.sim.audio.playRegister();
        this.sim.dequeue(this);
        this.sim.ordering = null;
        this.sim.brewFor = this;
        this.sim.brewT = 0;
        this.sim.brewDuration = rand(14.8, 16.2);
        this.state = 'waitingPickup';
        this.stateT = 0;
        this._walkTo(this.sim.pickupSlot(this));
      }
    } else if (this.state === 'waitingPickup') {
      if (!enRoute) av.setMode('idle');
      this._faceCounter(dt);
      av.headYawTarget = Math.sin(t * 0.4 + this.walkPhase) * 0.4;
      if (this.sim.brewFor !== this) {
        this.setCup(true);
        this.stateT = 0;
        if (this.seatIndex >= 0) {
          this.state = 'toSeat';
          const seatTarget = this.sim.cafe.seats[this.seatIndex];
          this._walkTo(seatTarget.approach ?? seatTarget.pos);
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
        this._pairCheers(dt, seat);
        const turn = Math.sin(t * 0.13 + (this.pairLead ? 0 : Math.PI));
        av.headPitch = this.cheers > 0
          ? -0.06
          : turn > 0 ? 0.05 : 0.12 + Math.sin(t * 2.8) * 0.05;
        av.headYawTarget = this.cheers > 0
          ? 0
          : Math.sin(t * 0.4 + this.walkPhase) * 0.12;
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
        av.headPitch = 0;
        this._beginLeavingSeat(seat);
      }
    }
  }

  _arrived() {
    if (this.state === 'queueing') {
      // settled into the current queue slot; update() takes it from here
    } else if (this.state === 'toSeat') {
      this.state = 'aligningSeat';
      this.stateT = 0;
      const seat = this.sim.cafe.seats[this.seatIndex];
      this.sitY = sitYFor(this, seat);
      this.transitionFrom = this.mesh.position.clone();
    } else if (this.state === 'leaving') {
      this.state = 'gone';
      if (this.sim.audio?.started && Math.random() < 0.5) this.sim.audio.playChime();
    }
  }

  dispose() {
    this._clearProps();
    if (this.avatar) { this.avatar.dispose(); return; }
    this.mesh.parent?.remove(this.mesh);
    disposeOwnedObject(this.mesh);
  }
}

class Barista {
  constructor(sim) {
    this.sim = sim;
    if (sim.charKeys?.length) {
      this.avatar = new SkinnedAvatar(sim.models, sim.pickStandardCharacter(), {
        appearanceIndex: sim.nextAppearanceIndex(),
      });
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
    this.velocityX = 0;
    this.espressoPlayed = false;
    sim.cafe.group.add(this.mesh);
  }

  update(dt, t) {
    const p = this.avatar ? null : this.mesh.userData.parts;
    animateMicroMotion(p, t, this.phase);

    // where should I be?
    if (this.sim.ordering) this.target.copy(this.registerSpot);
    else if (this.sim.brewFor) this.target.copy(this.machineSpot);
    else if (Math.random() < 0.002) this.target.set(this.home.x + rand(-1.7, 1.7), 0, this.home.z);

    const dx = this.target.x - this.mesh.position.x;
    const moving = Math.abs(dx) > 0.06 || Math.abs(this.velocityX) > 0.025;
    if (moving) {
      const desired = Math.abs(dx) > 0.06
        ? Math.sign(dx) * Math.max(0.16, THREE.MathUtils.smoothstep(Math.abs(dx), 0.03, 0.55))
        : 0;
      const response = Math.abs(desired) > Math.abs(this.velocityX) ? 3.8 : 7;
      this.velocityX += (desired - this.velocityX) * (1 - Math.exp(-response * dt));
      const step = this.velocityX * dt;
      if (Math.sign(step) === Math.sign(dx) && Math.abs(step) >= Math.abs(dx)) {
        this.mesh.position.x = this.target.x;
        this.velocityX = 0;
      } else {
        this.mesh.position.x += step;
      }
      const motion = Math.abs(this.velocityX);
      this.phase += dt * 6.2 * motion;
      if (this.avatar) {
        this.avatar.setMode('walk', Math.max(0.5, motion * 1.1));
      } else {
        const s = Math.sin(this.phase);
        p.legL.rotation.x = s * 0.4 * motion;
        p.legR.rotation.x = -s * 0.4 * motion;
        p.kneeL.rotation.x = Math.max(0, -s) * 0.6 * motion;
        p.kneeR.rotation.x = Math.max(0, s) * 0.6 * motion;
        p.torso.rotation.z = -s * 0.02 * motion;
        const bob = (0.5 - 0.5 * Math.cos(this.phase * 2)) * 0.012 * motion;
        setGroundedY(this.mesh, bob, p.blob);
      }
      const targetYaw = this.velocityX >= 0 ? Math.PI / 2 : -Math.PI / 2;
      let turn = targetYaw - this.mesh.rotation.y;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      this.mesh.rotation.y += turn * (1 - Math.exp(-8 * dt));
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
      p.torso.rotation.z = 0;
      setGroundedY(this.mesh, 0, p.blob);
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
    if (this.avatar) this.avatar.update(dt, 0, this.sim.qualityLevel);
  }

  dispose() {
    if (this.avatar) { this.avatar.dispose(); return; }
    this.mesh.parent?.remove(this.mesh);
    disposeOwnedObject(this.mesh);
  }
}

// pedestrians drifting past the windows outside
class OutsideLife {
  constructor(cafe, models = null, charKeys = []) {
    this.cafe = cafe;
    this.group = new THREE.Group();
    cafe.group.add(this.group);
    this.walkers = [];
    this.qualityLevel = 2;
    this.updateDebt = 0;
    const night = !!cafe.theme.rain;
    const n = 8;
    for (let i = 0; i < n; i++) {
      // downloaded animated characters when available, procedural otherwise
      let person, avatar = null;
      if (charKeys.length && Math.random() < 0.85) {
        avatar = new SkinnedAvatar(models, charKeys[i % charKeys.length], {
          castShadow: false,
          receiveShadow: false,
          appearanceIndex: i,
        });
        avatar.blob.visible = false;
        if (night) {
          avatar.root.traverse((o) => {
            if (!o.isMesh) return;
            const materials = Array.isArray(o.material) ? o.material : [o.material];
            materials.forEach((material) => material?.color?.multiplyScalar(0.4));
          });
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
      avatar?.ownObject(umbrella);
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

  setQuality(level) { this.qualityLevel = level; }

  update(dt) {
    this.updateDebt += dt;
    if (this.qualityLevel === 0 && this.updateDebt < 1 / 15) return;
    dt = this.updateDebt;
    this.updateDebt = 0;
    for (const w of this.walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x > 15) { w.x = -15; this.reroll(w); }
      if (w.x < -15) { w.x = 15; this.reroll(w); }
      w.phase += dt * 7 * w.speed;
      if (w.avatar) {
        w.avatar.update(dt, 16, this.qualityLevel);
        w.mesh.position.set(w.x, 0, w.z);
        continue;
      }
      const p = w.mesh.userData.parts;
      const s = Math.sin(w.phase);
      const stride = THREE.MathUtils.clamp(w.speed / 1.2, 0.72, 1.08);
      p.legL.rotation.x = s * 0.5 * stride;
      p.legR.rotation.x = -s * 0.5 * stride;
      p.kneeL.rotation.x = Math.max(0, -s) * 0.72 * stride;
      p.kneeR.rotation.x = Math.max(0, s) * 0.72 * stride;
      p.armL.rotation.x = -s * 0.32 * stride;
      p.armR.rotation.x = s * 0.32 * stride;
      p.torso.rotation.z = -s * 0.02;
      const bob = (0.5 - 0.5 * Math.cos(w.phase * 2)) * 0.012;
      w.mesh.position.set(w.x, bob, w.z);
    }
  }

  reroll(w) {
    w.speed = rand(0.7, 1.4);
    w.z = this.streetZ() + rand(-0.4, 0.6);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const walker of this.walkers) {
      if (walker.avatar) {
        walker.avatar.dispose();
      } else {
        disposeOwnedObject(walker.mesh);
      }
    }
    this.walkers = [];
  }
}

export class CrowdSim {
  constructor(cafe, audio, models = null) {
    this.cafe = cafe;
    this.audio = audio;
    this.models = models;
    this.charKeys = characterKeys(models);
    this.heroKeys = this.charKeys.filter((key) => key.startsWith('char_hero_'));
    this.standardCharKeys = this.charKeys.filter((key) => !key.startsWith('char_hero_'));
    this._usedHeroKeys = new Set();
    this.authoredSitKeys = sitCharacterKeys(models);
    // Manual leg folding cannot reproduce hip translation, spine balance and
    // chair clearance reliably across rigs. Only use authored seated clips when
    // they exist; keep the wider cast for walking, queues and the barista.
    this.sitKeys = this.authoredSitKeys.length
      ? [...this.authoredSitKeys]
      : [...this.charKeys];
    this._characterBags = { standing: [], sitting: [] };
    this._lastCharacter = null;
    this._appearanceSerial = Math.floor(rand(0, IMPORTED_OUTFITS.length));
    this.npcs = [];
    this.queue = [];
    this.ordering = null;   // NPC currently at the register
    this.brewFor = null;    // NPC whose drink is being made
    this.brewT = 0;
    this.brewDuration = 8;
    this.takenSeats = new Set();
    this.playerSeat = -1;
    this.maxCrowd = cafe.theme.crowd ?? 9;
    this.qualityLevel = 2;
    this.barista = new Barista(this);
    // Detailed hero patrons stay indoors, where their face and clothing can be
    // read. Exterior walkers use the lighter cast and never duplicate heroes.
    this.outside = new OutsideLife(cafe, models, this.standardCharKeys);
    this.staticPatrons = [];
    this._placeStaticPatron();
    this.spawnCooldown = rand(3, 7);
    this.spotSyncT = 0;

    // pre-seat customers so the café never starts empty
    const initial = Math.min(Math.floor(this.maxCrowd * 0.45) + Math.floor(Math.random() * 3), this.maxCrowd - 3);
    for (let i = 0; i < initial; i++) this._preseat();
    // a couple of pre-seated chatting pairs if there's room
    this._preseatPair();
    if (this.maxCrowd >= 14) this._preseatPair();
  }

  // Shuffle-bag selection guarantees all suitable designs appear before one is
  // repeated.  Moving the previous pick away from the front also prevents the
  // conspicuous same-model twins produced by independent random selection.
  pickCharacter(willSit = false) {
    // Lead with each close-up-quality patron instead of burying them behind a
    // random shuffle. Every hero appears once per café visit, then the lighter
    // animated cast resumes for later arrivals.
    const unusedHero = willSit
      ? null
      : this.heroKeys.find((key) => !this._usedHeroKeys.has(key));
    if (unusedHero) {
      const key = unusedHero;
      this._usedHeroKeys.add(key);
      this._lastCharacter = key;
      return key;
    }
    const pool = willSit
      ? this.sitKeys
      : this.standardCharKeys;
    if (!pool.length) return null;
    const bagName = willSit ? 'sitting' : 'standing';
    let bag = this._characterBags[bagName];
    if (!bag.length) {
      bag = [...pool];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[bag.length - 1] === this._lastCharacter) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      this._characterBags[bagName] = bag;
    }
    const key = bag.pop();
    this._lastCharacter = key;
    return key;
  }

  pickStandardCharacter() {
    const pool = this.standardCharKeys.length ? this.standardCharKeys : this.charKeys;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  _placeStaticPatron() {
    const model = cloneModel(this.models, 'patron_seated_female');
    if (!model) return;
    // Her authored asset includes a matching pedestal chair, so reserve and
    // replace one window-bar stool. Garden Terrace has no window bar and simply
    // skips this guest rather than forcing a tall stool against a low table.
    const seatIndex = this.cafe.seats.findIndex((seat) => seat.pos.y > 0.05);
    if (seatIndex < 0) return;
    const seat = this.cafe.seats[seatIndex];
    this.takenSeats.add(seatIndex);
    seat.chair.visible = false;
    model.position.set(seat.pos.x, 0, seat.pos.z);
    model.rotation.y = seat.facingYaw;
    this.cafe.group.add(model);
    this.staticPatrons.push({ model, seatIndex });
  }

  nextAppearanceIndex() {
    return this._appearanceSerial++;
  }

  setQuality(level) {
    this.qualityLevel = THREE.MathUtils.clamp(Math.round(level), 0, 2);
    this.outside.setQuality(this.qualityLevel);
  }

  // Treat every patron as a soft capsule in first-person mode. Static furniture
  // already has room colliders; this closes the conspicuous gap where the camera
  // could walk straight through a moving customer or somebody in the queue.
  resolvePlayerCollision(position, playerRadius = 0.3) {
    for (let pass = 0; pass < 2; pass++) {
      for (const npc of this.npcs) {
        if (npc.state === 'gone') continue;
        const dx = position.x - npc.mesh.position.x;
        const dz = position.z - npc.mesh.position.z;
        const minDistance = playerRadius + (npc.state === 'sitting' ? 0.28 : 0.32);
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDistance * minDistance) continue;
        if (d2 < 0.000001) {
          position.x += Math.sin(npc.mesh.rotation.y) * minDistance;
          position.z += Math.cos(npc.mesh.rotation.y) * minDistance;
          continue;
        }
        const distance = Math.sqrt(d2);
        const push = (minDistance - distance) / distance;
        position.x += dx * push;
        position.z += dz * push;
      }
    }
    for (const patron of this.staticPatrons) {
      const dx = position.x - patron.model.position.x;
      const dz = position.z - patron.model.position.z;
      const minDistance = playerRadius + 0.34;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDistance * minDistance) continue;
      const distance = Math.max(0.001, Math.sqrt(d2));
      const push = (minDistance - distance) / distance;
      position.x += dx * push;
      position.z += dz * push;
    }
    return position;
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
    applySitOffset(npc, s);
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
      applySitOffset(npc, s);
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

  // Waiting customers fan out along the counter instead of stacking on the
  // single pickup point — several people pulled toward one spot while
  // separation pushed them apart made a permanent jostling knot.
  pickupSlot(self) {
    const p = this.cafe.nav.pickup;
    const waiting = this.npcs.filter((n) => n !== self && n.state === 'waitingPickup').length;
    const offset = [0, 0.6, -0.6, 1.2, -1.2][Math.min(waiting, 4)];
    return new THREE.Vector3(p.x + offset, 0, p.z);
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
        // lead the session with the hero patrons — they only walk through
        // (order + pick up at the counter), so give them the early arrivals
        // instead of leaving their appearance to a rare to-go roll
        const heroWaiting = this.heroKeys.length > this._usedHeroKeys.size;
        const toGo = heroWaiting || Math.random() < 0.3 || seat < 0;
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
      this.audio.setPageSpots(seated.filter((n) => n.activity === 'book').map((n) => n.mesh.position));
      this.audio.setOccupancy(this.npcs.length + this.staticPatrons.length, this.maxCrowd);
    }
  }

  releaseSeat(i) { this.takenSeats.delete(i); }
  isSeatTaken(i) { return this.takenSeats.has(i); }

  dispose() {
    this.npcs.forEach((n) => n.dispose());
    this.barista.dispose();
    this.outside.dispose();
    this.staticPatrons.forEach(({ model }) => model.parent?.remove(model));
    this.staticPatrons = [];
    this.npcs = [];
    this.queue = [];
  }
}
