// Procedural coffee shop builder: three themed locations, built entirely
// from Three.js primitives + canvas textures (no external assets).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloneModel } from './modelLoader.js';
import { TEXTURE_MANIFEST } from './textureManifest.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Collapse the static decor into one mesh per (material, shadow flags,
// attribute layout). The room is assembled from hundreds of tiny primitive
// meshes — tables, shelves, clutter — and each one is a draw call in the
// beauty pass, the AO prepass and every shadow refresh. Merging runs once at
// build time, before the first render, so the source geometries never reach
// the GPU. Skips: anything animated (callers pass those roots), clickable
// chairs (tagged with seatIndex), transparent materials (draw order),
// multi-material meshes, and structural parents with children.
const MERGE_MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'emissiveMap',
  'metalnessMap', 'aoMap', 'alphaMap', 'envMap', 'lightMap'];
function mergeStaticDecor(group, animatedRoots) {
  const skip = new Set();
  for (const root of animatedRoots) {
    if (root) root.traverse((o) => skip.add(o));
  }
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
    if (skip.has(o) || o.children.length > 0 || !o.visible) return;
    if (o.userData.tableSurfaceProp) return;
    if (o.userData.seatIndex !== undefined) return;
    const material = o.material;
    if (!material || Array.isArray(material) || material.transparent) return;
    const geometry = o.geometry;
    if (!geometry?.attributes?.position) return;
    if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length) return;
    // quantized (normalized-integer) attributes can't survive a baked world
    // transform — values clamp at the type range; leave those props as-is
    for (const name of Object.keys(geometry.attributes)) {
      const attr = geometry.attributes[name];
      if (attr.normalized || !(attr.array instanceof Float32Array)) return;
    }
    const flags = (geometry.index ? 'i' : 'n') + (o.castShadow ? 'c' : '')
      + (o.receiveShadow ? 'r' : '') + `l${o.layers.mask}`;
    // Untextured flat-colour standard materials — most of the procedural
    // clutter — merge across material instances: their colour moves into a
    // vertex-colour attribute and near-equal roughness/metalness quantise
    // into one shared material per bucket.
    const bakeable = material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial
      && MERGE_MAP_SLOTS.every((slot) => !material[slot])
      && (!material.emissive || material.emissive.getHex() === 0)
      && material.side === THREE.FrontSide && !material.flatShading
      && !material.polygonOffset && material.opacity === 1
      && !material.vertexColors && !!geometry.attributes.normal;
    const sig = bakeable
      ? `bake|${Math.round(material.roughness * 10)}|${Math.round(material.metalness * 10)}|${flags}`
      : `mat|${material.uuid}|${Object.keys(geometry.attributes).sort().join(',')}|${flags}`;
    if (!buckets.has(sig)) buckets.set(sig, []);
    buckets.get(sig).push(o);
  });
  const groupInverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const relative = new THREE.Matrix4();
  for (const [sig, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const bake = sig.startsWith('bake|');
    const baked = meshes.map((o) => {
      const g = o.geometry.clone(); // originals may be shared (library templates)
      g.applyMatrix4(relative.multiplyMatrices(groupInverse, o.matrixWorld));
      if (bake) {
        // strip unused attributes (no maps ⇒ no uvs) and carry the material
        // colour per vertex so unrelated materials can share one draw
        for (const name of Object.keys(g.attributes)) {
          if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        }
        const { r, g: cg, b } = o.material.color;
        const count = g.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          colors[i * 3] = r; colors[i * 3 + 1] = cg; colors[i * 3 + 2] = b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      return g;
    });
    const mergedGeometry = mergeGeometries(baked, false);
    baked.forEach((g) => g.dispose());
    if (!mergedGeometry) continue;
    const material = bake
      ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: meshes[0].material.roughness,
        metalness: meshes[0].material.metalness,
      })
      : meshes[0].material;
    const merged = new THREE.Mesh(mergedGeometry, material);
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    merged.layers.mask = meshes[0].layers.mask;
    group.add(merged);
    for (const o of meshes) o.parent.remove(o);
  }
}

// Room shell is shared across themes; palette, light, view and layout differ.
export const ROOM = { W: 17, D: 13.5, H: 3.8 };

// The picture surface must sit measurably in front of the solid backing. The
// old values put both faces at exactly the same x coordinate, so the depth
// buffer alternated between the print and its dark frame as the camera moved.
export const WALL_ART_DEPTH_GAP = 0.018;
export function wallArtDepths(roomWidth = ROOM.W) {
  const frameCenterX = roomWidth / 2 - 0.07;
  const frameInteriorFaceX = frameCenterX - 0.02;
  return {
    frameCenterX,
    frameInteriorFaceX,
    artX: frameInteriorFaceX - WALL_ART_DEPTH_GAP,
  };
}

export const WALL_CLOCK_RADIUS = 0.3;
export const WALL_MIRROR_RADIUS = 0.345;
export function rightWallDecorLayout() {
  return {
    clock: { y: 2.55, z: 2.2, radius: WALL_CLOCK_RADIUS },
    // The indoor cafés share this mirror. It sits above the central artwork;
    // the old z=1.95 placement was only 25 cm from the clock centre and made
    // the two circles look like one broken object from across the room.
    mirror: { y: 2.72, z: 0.8, radius: WALL_MIRROR_RADIUS },
  };
}

// ---------- environment: time of day × weather ----------
// Each café keeps its interior palette and layout; these presets only patch
// the sky-driven fields (sun, ambient light, fog, exposure, street look).
// 'auto' keeps the café's authored signature look.
export const TIME_NAMES = ['morning', 'noon', 'sunset', 'night'];
const TIME_PRESETS = {
  morning: {
    exposure: 1.0, envIntensity: 0.5, bloom: 0.18,
    fog: { color: 0xe8e6da, density: 0.007 },
    hemi: [0xdff0ff, 0x5c4a34, 0.85],
    sun: { color: 0xfff6e2, intensity: 2.2, pos: [-7, 7, 10] },
    lampIntensity: 2.2, outside: 'morning',
  },
  noon: {
    exposure: 1.0, envIntensity: 0.55, bloom: 0.14,
    fog: { color: 0xdfe4e2, density: 0.006 },
    hemi: [0xd7e8f5, 0x5c5240, 0.95],
    sun: { color: 0xfff3d8, intensity: 2.4, pos: [3, 10, 6] },
    lampIntensity: 1.6, outside: 'city',
  },
  sunset: {
    exposure: 1.12, envIntensity: 0.42, bloom: 0.26,
    fog: { color: 0x2e2415, density: 0.011 },
    hemi: [0xffd9a8, 0x46372a, 0.6],
    sun: { color: 0xffbd77, intensity: 1.9, pos: [9, 4.5, 9] },
    lampIntensity: 6.5, outside: 'sunset',
  },
  night: {
    exposure: 1.05, envIntensity: 0.18, bloom: 0.4,
    fog: { color: 0x0b0d14, density: 0.015 },
    hemi: [0x34435c, 0x120d0a, 0.4],
    sun: { color: 0x879bc2, intensity: 0.45, pos: [4, 6, 12] },
    // 'rainNight' selects the street's night palette; whether it actually
    // rains stays with theme.rain
    lampIntensity: 6.8, outside: 'rainNight',
  },
};

// the terrace looks onto a park, not a street — keep its garden panorama
const GARDEN_OUTSIDE = { morning: 'garden', noon: 'garden', sunset: 'garden_dusk', night: 'garden_night' };
const AUTHORED_TIME = { goldenhour: 'sunset', roastery: 'noon', midnight: 'night', terrace: 'morning' };

export function resolveEnvironment(theme, time = 'auto', sky = 'auto') {
  let resolved = {
    ...theme,
    timeOfDay: time === 'auto' ? (AUTHORED_TIME[theme.id] ?? 'noon') : time,
  };
  if (time !== 'auto' && TIME_PRESETS[time]) {
    resolved = { ...resolved, ...TIME_PRESETS[time] };
    if (theme.openAir) resolved.outside = GARDEN_OUTSIDE[time];
  }
  if (sky === 'rain' && !resolved.rain) {
    // damp light, heavier air, streaks on the glass; the rain audio bed and
    // thunder follow the rain flag automatically
    resolved = {
      ...resolved,
      rain: true,
      envIntensity: resolved.envIntensity * 0.7,
      bloom: resolved.bloom + 0.06,
      sun: { ...resolved.sun, intensity: resolved.sun.intensity * 0.45, color: 0xaab4c4 },
      hemi: [0x8fa0b4, resolved.hemi[1], resolved.hemi[2] * 0.8],
      fog: { color: resolved.fog.color, density: resolved.fog.density * 1.5 },
    };
  } else if (sky === 'clear' && resolved.rain) {
    resolved = { ...resolved, rain: false, bloom: resolved.bloom + 0.12 };
  }
  return resolved;
}

export function shouldRenderSunShafts(theme) {
  return !!theme.shafts && theme.timeOfDay !== 'night' && !theme.rain;
}

export const THEMES = [
  {
    id: 'goldenhour',
    name: 'Golden Hour Café',
    blurb: 'Warm wood, late-afternoon sun, plants everywhere.',
    musicKey: 0, rain: false, exposure: 1.12, envIntensity: 0.45, bloom: 0.2,
    fog: { color: 0x2b1d12, density: 0.012 },
    floor: '#8a6242', floorLine: '#6d4b31', wall: '#c9b394', wallTrim: '#8a6242',
    wood: 0x6f4a2d, woodDark: 0x4e3018, accent: 0x3e684f, cushion: 0x914438,
    counter: 0x5b3a20, counterTop: 0xd9c9a8,
    hemi: [0xffe7c7, 0x4d3827, 0.65],
    sun: { color: 0xffc58a, intensity: 2.25, pos: [6, 4.5, 12] },
    lampColor: 0xffb46e, lampIntensity: 6.5, lampY: 2.3,
    outside: 'sunset',
    dust: true, neon: null,
    tables: [
      { x: -4.9, z: 2.6, type: 'round', lounge: true }, { x: -5.1, z: -0.5, type: 'round' },
      { x: -4.7, z: -3.4, type: 'round' }, { x: -2.4, z: 1.1, type: 'square' },
      { x: -2.6, z: -2.0, type: 'round' }, { x: -2.1, z: 4.3, type: 'round' },
      { x: 2.2, z: 2.9, type: 'round' }, { x: 2.0, z: -0.2, type: 'square' },
      { x: 2.4, z: -3.2, type: 'round' }, { x: 5.0, z: 1.3, type: 'round' },
      { x: 5.2, z: -1.9, type: 'square' },
    ],
    windowBar: true, plants: 9, crowd: 16, shafts: true, stringLights: true,
    pendant: 'cone', beams: true, hangingPlants: true, chalkboard: true, cat: 0xb0713a,
    varName: 'sunset',
    variant: {
      name: 'morning',
      blurb: 'Early light, quiet tables, the first pour of the day.',
      exposure: 1.0, envIntensity: 0.5, bloom: 0.18,
      fog: { color: 0xe8e6da, density: 0.007 },
      hemi: [0xdff0ff, 0x5c4a34, 0.85],
      sun: { color: 0xfff6e2, intensity: 2.2, pos: [-7, 7, 10] },
      lampIntensity: 2.2, outside: 'morning', crowd: 10,
    },
  },
  {
    id: 'roastery',
    name: 'Downtown Roastery',
    blurb: 'Concrete and steel, big windows onto a bright city street.',
    musicKey: 5, rain: false, exposure: 1.05, envIntensity: 0.55, bloom: 0.15,
    fog: { color: 0x272a2e, density: 0.010 },
    floor: '#7d7f83', floorLine: '#6a6c70', wall: '#b9bcc0', wallTrim: '#55585e',
    wood: 0x806447, woodDark: 0x303238, accent: 0x293137, cushion: 0x48545c,
    counter: 0x2c2e32, counterTop: 0xcfd2d6,
    hemi: [0xdfeaf5, 0x53565c, 1.0],
    sun: { color: 0xf2f7ff, intensity: 2.0, pos: [-10, 6, 6] },
    lampColor: 0xffd2a0, lampIntensity: 3.2, lampY: 2.4,
    outside: 'city',
    dust: false, neon: null,
    tables: [
      { x: -4.6, z: 0.9, type: 'long' }, { x: 4.7, z: -0.9, type: 'long' },
      { x: -4.8, z: -3.4, type: 'square' }, { x: -2.2, z: 3.4, type: 'round' },
      { x: 2.2, z: 3.6, type: 'round' }, { x: -2.3, z: -2.0, type: 'square' },
      { x: 2.4, z: 0.4, type: 'square' }, { x: 2.3, z: -3.4, type: 'round' },
      { x: 5.2, z: 2.9, type: 'round', lounge: true },
    ],
    windowBar: true, plants: 5, crowd: 18, fan: true,
    pendant: 'bulb', ducts: true, roaster: true, chalkboard: true, cat: 0x3a3d42,
    varName: 'noon',
    variant: {
      name: 'evening',
      blurb: 'The rush is over — low sun on steel, lamps coming on.',
      exposure: 1.15, envIntensity: 0.3, bloom: 0.3,
      fog: { color: 0x2e2a22, density: 0.012 },
      hemi: [0xffd9b0, 0x3a3630, 0.5],
      sun: { color: 0xffb469, intensity: 1.2, pos: [10, 4, 8] },
      lampIntensity: 7.5, outside: 'sunset', crowd: 12,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Jazz Corner',
    blurb: 'Rain on the glass, warm lamps, a neon glow. Open late.',
    musicKey: -3, rain: true, exposure: 1.05, envIntensity: 0.16, bloom: 0.34,
    fog: { color: 0x0b0d14, density: 0.016 },
    floor: '#4a3628', floorLine: '#38281d', wall: '#4e4038', wallTrim: '#2c2119',
    wood: 0x4e3323, woodDark: 0x2a1a10, accent: 0x71342e, cushion: 0x304a3d,
    counter: 0x332419, counterTop: 0x26352e,
    hemi: [0x34435c, 0x120d0a, 0.36],
    sun: { color: 0x879bc2, intensity: 0.4, pos: [4, 6, 12] },
    lampColor: 0xffa05c, lampIntensity: 6.2, lampY: 2.25,
    outside: 'rainNight',
    dust: false, neon: { text: 'open late', color: '#ff5d8f' },
    tables: [
      { x: -5.0, z: 2.4, type: 'round', lounge: true }, { x: -5.2, z: -0.7, type: 'round' },
      { x: -4.8, z: -3.5, type: 'round' }, { x: -2.4, z: 0.9, type: 'round' },
      { x: -2.6, z: -2.2, type: 'square' }, { x: -2.0, z: 4.2, type: 'round' },
      { x: 2.2, z: 2.5, type: 'round' }, { x: 2.0, z: -0.5, type: 'round' },
      { x: 2.4, z: -3.3, type: 'square' }, { x: 5.0, z: 1.5, type: 'round' },
    ],
    windowBar: true, plants: 6, crowd: 13, candles: true,
    pendant: 'drum', bookshelf: true, vinyl: true, cat: 0x9a6a38,
    varName: 'rainy',
    variant: {
      name: 'clear night',
      blurb: 'The rain moved on — city lights, quiet jazz, a clear sky.',
      rain: false, bloom: 0.55, crowd: 15,
    },
  },
  {
    id: 'terrace',
    name: 'Garden Terrace',
    blurb: 'Open air under a pergola — birdsong, leaves, and sun on the pavers.',
    musicKey: 2, rain: false, exposure: 1.0, envIntensity: 0.8, bloom: 0.12,
    fog: { color: 0xe4ecd8, density: 0.004 },
    floor: '#b9a888', floorLine: '#a08f70', wall: '#d9d2bc', wallTrim: '#8a7a5c',
    wood: 0x755a3c, woodDark: 0x524026, accent: 0x4f7355, cushion: 0x6d835f,
    counter: 0x6a5638, counterTop: 0xe4dcc4,
    hemi: [0xd7e8f5, 0x566748, 1.0],
    sun: { color: 0xfff0d2, intensity: 2.15, pos: [8, 9, 6] },
    lampColor: 0xffd9a3, lampIntensity: 1.8, lampY: 2.45,
    outside: 'garden',
    dust: true, neon: null,
    tables: [
      { x: -4.9, z: 2.4, type: 'round', lounge: true }, { x: -5.0, z: -0.8, type: 'round' },
      { x: -4.6, z: -3.5, type: 'round' }, { x: -2.2, z: 1.0, type: 'round' },
      { x: -2.5, z: -2.2, type: 'square' }, { x: -1.9, z: 4.0, type: 'round' },
      { x: 2.2, z: 2.7, type: 'round' }, { x: 2.1, z: -0.4, type: 'round' },
      { x: 2.4, z: -3.3, type: 'square' }, { x: 5.1, z: 1.2, type: 'round' },
      { x: 5.2, z: -2.1, type: 'round' },
    ],
    windowBar: false, plants: 12, crowd: 14, openAir: true, birds: true,
    pendant: 'cone', stringLights: true, hangingPlants: true, chalkboard: true, cat: 0xc9924e,
    varName: 'noon',
    variant: {
      name: 'golden evening',
      blurb: 'Long shadows on the pavers, string lights against a warm sky.',
      exposure: 1.12, envIntensity: 0.45, bloom: 0.3,
      fog: { color: 0xe8d2b0, density: 0.005 },
      hemi: [0xffd9a8, 0x4a5638, 0.55],
      sun: { color: 0xffc478, intensity: 1.6, pos: [10, 4, 6] },
      lampIntensity: 6.5, outside: 'garden_dusk', crowd: 16,
    },
  },
];

// ---------- canvas texture helpers ----------

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function woodFloorTexture(base, line) {
  const tex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const plank = 64;
    for (let y = 0; y < h; y += plank) {
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(0,0,0,${rand(0.02, 0.07)})`;
        g.fillRect(rand(0, w), y + rand(0, plank), rand(20, 130), rand(1, 3));
      }
      g.fillStyle = line;
      g.fillRect(0, y, w, 2);
      const off = (y / plank) % 2 ? w / 2 : w / 4;
      g.fillRect(off, y, 2, plank);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

// subtle grayscale wood grain, multiplied by each material's color —
// one shared texture makes every wooden surface read as actual wood
let _grainTex = null;
function woodGrainTexture() {
  if (_grainTex) return _grainTex;
  _grainTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b9b3aa'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const wave = Math.sin(y * 0.11) * 8 + Math.sin(y * 0.031) * 20;
      g.fillStyle = `rgba(70,50,30,${0.05 + 0.05 * Math.sin(y * 0.6)})`;
      g.fillRect(0, y, w, 1);
      g.fillStyle = `rgba(255,245,225,${0.04 + 0.03 * Math.sin(y * 0.9 + 2)})`;
      g.fillRect(wave, y + 1, w, 1);
    }
    for (let i = 0; i < 8; i++) { // knots
      const x = rand(0, w), y = rand(0, h);
      for (let r = 1; r < 9; r += 1.6) {
        g.strokeStyle = `rgba(60,40,25,${0.1 - r * 0.01})`;
        g.beginPath(); g.ellipse(x, y, r * 1.7, r, 0.3, 0, 7); g.stroke();
      }
    }
  });
  _grainTex.wrapS = _grainTex.wrapT = THREE.RepeatWrapping;
  _grainTex.userData.vibeShared = true;
  return _grainTex;
}

function plasterTexture(base) {
  const tex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rand(0.01, 0.05)})`;
      g.fillRect(rand(0, w), rand(0, h), rand(1, 4), rand(1, 4));
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
}

function fabricTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#aaa'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 3) {
      g.fillStyle = i % 6 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)';
      g.fillRect(i, 0, 1, h);
      g.fillRect(0, i, w, 1);
    }
  });
}

function rugTexture(accent, dark) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = `#${new THREE.Color(accent).getHexString()}`; g.fillRect(0, 0, w, h);
    g.strokeStyle = `#${new THREE.Color(dark).getHexString()}`;
    g.globalAlpha = 0.38;
    for (let r = 28; r < 170; r += 24) {
      g.lineWidth = r % 48 ? 3 : 7;
      g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 0.18;
    g.lineWidth = 1;
    for (let i = 0; i < 256; i += 4) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
    }
  });
}

// The world seen through the windows, painted per theme.
function outsideTexture(kind) {
  return canvasTexture(1024, 512, (g, w, h) => {
    if (kind === 'sunset') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#ffb45e'); sky.addColorStop(0.55, '#ff8f4d');
      sky.addColorStop(0.75, '#d95f38'); sky.addColorStop(1, '#7c3a24');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff2ce';
      g.beginPath(); g.arc(w * 0.68, h * 0.42, 46, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,220,160,0.55)';
      g.beginPath(); g.arc(w * 0.68, h * 0.42, 80, 0, 7); g.fill();
      // distant rooftops and trees
      g.fillStyle = '#5e3822';
      for (let x = 0; x < w; x += rand(60, 140)) {
        const bh = rand(40, 110);
        g.fillRect(x, h * 0.72 - bh, rand(50, 120), bh + 40);
      }
      g.fillStyle = '#432616';
      for (let x = 0; x < w; x += rand(40, 90)) {
        g.beginPath(); g.arc(x, h * 0.78, rand(18, 42), 0, 7); g.fill();
      }
      g.fillStyle = '#33190d'; g.fillRect(0, h * 0.8, w, h * 0.2);
    } else if (kind === 'city') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#bcd7ee'); sky.addColorStop(1, '#e8f1f7');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += rand(50, 110)) {
        const bh = rand(120, 330), bw = rand(60, 110);
        g.fillStyle = `hsl(${rand(200, 220)},12%,${rand(52, 70)}%)`;
        g.fillRect(x, h * 0.86 - bh, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        for (let wy = h * 0.86 - bh + 10; wy < h * 0.82; wy += 18)
          for (let wx = x + 8; wx < x + bw - 10; wx += 16)
            if (Math.random() < 0.8) g.fillRect(wx, wy, 8, 10);
      }
      g.fillStyle = '#9aa1a6'; g.fillRect(0, h * 0.86, w, h * 0.14); // street
      g.fillStyle = '#c6ccd1'; g.fillRect(0, h * 0.86, w, 6);
    } else if (kind === 'morning') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#a8cfe8'); sky.addColorStop(0.7, '#e8ddc8'); sky.addColorStop(1, '#f2e2c4');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff8e0';
      g.beginPath(); g.arc(w * 0.22, h * 0.55, 34, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,244,210,0.5)';
      g.beginPath(); g.arc(w * 0.22, h * 0.55, 62, 0, 7); g.fill();
      g.fillStyle = '#8d8574';
      for (let x = 0; x < w; x += rand(60, 140)) {
        const bh = rand(50, 130);
        g.fillRect(x, h * 0.74 - bh, rand(50, 120), bh + 40);
      }
      g.fillStyle = '#6f6a5c'; g.fillRect(0, h * 0.8, w, h * 0.2);
    } else if (kind === 'garden' || kind === 'garden_dusk') {
      const dusk = kind === 'garden_dusk';
      const sky = g.createLinearGradient(0, 0, 0, h);
      if (dusk) {
        sky.addColorStop(0, '#e8a86a'); sky.addColorStop(0.6, '#f2c88a'); sky.addColorStop(1, '#d9b284');
      } else {
        sky.addColorStop(0, '#9ecbf2'); sky.addColorStop(0.6, '#cfe6f5'); sky.addColorStop(1, '#e8f2e0');
      }
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      if (dusk) {
        g.fillStyle = '#fff0d0';
        g.beginPath(); g.arc(w * 0.7, h * 0.5, 40, 0, 7); g.fill();
      }
      // puffy clouds
      for (let i = 0; i < 9; i++) {
        const cx = rand(0, w), cy = rand(h * 0.08, h * 0.4);
        g.fillStyle = dusk ? 'rgba(255,224,190,0.8)' : 'rgba(255,255,255,0.85)';
        for (let j = 0; j < 4; j++) {
          g.beginPath(); g.arc(cx + rand(-38, 38), cy + rand(-8, 8), rand(12, 30), 0, 7); g.fill();
        }
      }
      // layered tree line
      g.fillStyle = dusk ? '#4e5636' : '#5d7d4a';
      for (let x = 0; x < w; x += rand(30, 70)) {
        g.beginPath(); g.arc(x, h * 0.72, rand(28, 60), 0, 7); g.fill();
      }
      g.fillStyle = dusk ? '#3c452c' : '#48663c';
      for (let x = 0; x < w; x += rand(24, 60)) {
        g.beginPath(); g.arc(x, h * 0.8, rand(24, 48), 0, 7); g.fill();
      }
      g.fillStyle = dusk ? '#5c6640' : '#6f8a52'; g.fillRect(0, h * 0.82, w, h * 0.18);
    } else { // rainNight
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#060810'); sky.addColorStop(1, '#101627');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += rand(50, 120)) {
        const bh = rand(130, 340), bw = rand(60, 110);
        g.fillStyle = '#0c1120';
        g.fillRect(x, h * 0.88 - bh, bw, bh);
        for (let wy = h * 0.88 - bh + 10; wy < h * 0.84; wy += 18)
          for (let wx = x + 8; wx < x + bw - 10; wx += 16)
            if (Math.random() < 0.4) {
              g.fillStyle = `rgba(255,${rand(170, 220) | 0},120,${rand(0.5, 1)})`;
              g.fillRect(wx, wy, 8, 10);
            }
      }
      // street-light bokeh + wet street reflections
      for (let i = 0; i < 26; i++) {
        const x = rand(0, w), y = rand(h * 0.55, h * 0.85), r = rand(4, 16);
        const hue = Math.random() < 0.3 ? '340' : '35';
        const glow = g.createRadialGradient(x, y, 0, x, y, r * 3);
        glow.addColorStop(0, `hsla(${hue},90%,65%,0.8)`);
        glow.addColorStop(1, 'transparent');
        g.fillStyle = glow;
        g.beginPath(); g.arc(x, y, r * 3, 0, 7); g.fill();
        g.fillStyle = `hsla(${hue},80%,60%,0.25)`;
        g.fillRect(x - 2, y, 4, h - y);
      }
      g.fillStyle = 'rgba(10,14,26,0.6)'; g.fillRect(0, h * 0.88, w, h * 0.12);
    }
  });
}

function artTexture(accentHex) {
  return canvasTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#efe8da'; g.fillRect(0, 0, w, h);
    const cols = ['#c96f4a', accentHex, '#54683f', '#b89a5b', '#71563c'];
    for (let i = 0; i < 5; i++) {
      g.fillStyle = cols[i % cols.length];
      g.globalAlpha = rand(0.5, 0.9);
      g.beginPath();
      g.arc(rand(20, w - 20), rand(20, h - 20), rand(10, 34), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

function menuTexture() {
  return canvasTexture(256, 170, (g, w, h) => {
    g.fillStyle = '#232019'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8dcc0';
    g.font = 'bold 22px Georgia';
    g.fillText('— MENU —', 66, 30);
    g.font = '15px Georgia';
    const items = [['espresso', '3.0'], ['latte', '4.5'], ['pour over', '5.0'], ['matcha', '5.5'], ['croissant', '3.5']];
    items.forEach(([n, p], i) => {
      g.fillText(n, 28, 62 + i * 21);
      g.fillText(p, w - 58, 62 + i * 21);
    });
  });
}

function neonTexture(text, color) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'italic bold 72px Georgia';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 26;
    g.strokeStyle = color; g.lineWidth = 3;
    g.strokeText(text, w / 2, h / 2);
    g.shadowBlur = 8;
    g.fillStyle = '#fff';
    g.fillText(text, w / 2, h / 2);
  });
}

// one soft radial puff shared by every steam wisp and candle flame across all
// cafés — previously each candle allocated its own copy and never freed it
let _steamTex = null;
function steamTexture() {
  if (_steamTex) return _steamTex;
  _steamTex = canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.65)');
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  _steamTex.userData.shared = true;
  return _steamTex;
}

// ---------- small builders ----------

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function roundedBox(w, h, d, mat, radius = 0.025, segments = 2) {
  const safeRadius = Math.min(radius, w * 0.22, h * 0.22, d * 0.22);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, safeRadius), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

let _carGeometryKit = null;
function carGeometryKit() {
  if (_carGeometryKit) return _carGeometryKit;
  const shared = (geometry) => {
    geometry.userData.vibeShared = true;
    geometry.userData.shared = true;
    return geometry;
  };
  const cabin = shared(new THREE.BufferGeometry());
  cabin.setAttribute('position', new THREE.Float32BufferAttribute([
    -1.0, -0.25, -0.68, 0.85, -0.25, -0.68, 0.85, -0.25, 0.68, -1.0, -0.25, 0.68,
    -0.68, 0.25, -0.60, 0.48, 0.25, -0.60, 0.48, 0.25, 0.60, -0.68, 0.25, 0.60,
  ], 3));
  cabin.setIndex([
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  cabin.computeVertexNormals();
  _carGeometryKit = {
    body: shared(new RoundedBoxGeometry(3.4, 0.44, 1.5, 2, 0.1)),
    rocker: shared(new RoundedBoxGeometry(3.34, 0.16, 1.44, 2, 0.04)),
    hood: shared(new RoundedBoxGeometry(0.96, 0.11, 1.42, 2, 0.04)),
    trunk: shared(new RoundedBoxGeometry(0.64, 0.09, 1.42, 2, 0.035)),
    cabin,
    roof: shared(new RoundedBoxGeometry(1.22, 0.07, 1.22, 2, 0.025)),
    pillar: shared(new THREE.BoxGeometry(0.065, 0.43, 1.36)),
    bumper: shared(new RoundedBoxGeometry(0.08, 0.14, 1.52, 2, 0.025)),
    handle: shared(new RoundedBoxGeometry(0.16, 0.025, 0.025, 2, 0.008)),
    mirror: shared(new RoundedBoxGeometry(0.16, 0.09, 0.13, 2, 0.025)),
    seam: shared(new THREE.BoxGeometry(0.018, 0.28, 0.012)),
    wheel: shared(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 16)),
    hub: shared(new THREE.CylinderGeometry(0.14, 0.14, 0.022, 12)),
    headlight: shared(new RoundedBoxGeometry(0.035, 0.12, 0.26, 2, 0.012)),
    taillight: shared(new RoundedBoxGeometry(0.035, 0.1, 0.3, 2, 0.012)),
    plate: shared(new RoundedBoxGeometry(0.018, 0.11, 0.34, 2, 0.012)),
  };
  return _carGeometryKit;
}
let _chairBackGeometry = null;
function drawRoundedRect(path, x, y, width, height, radius, clockwise = false) {
  const x1 = x + width, y1 = y + height;
  if (!clockwise) {
    path.moveTo(x + radius, y);
    path.lineTo(x1 - radius, y); path.quadraticCurveTo(x1, y, x1, y + radius);
    path.lineTo(x1, y1 - radius); path.quadraticCurveTo(x1, y1, x1 - radius, y1);
    path.lineTo(x + radius, y1); path.quadraticCurveTo(x, y1, x, y1 - radius);
    path.lineTo(x, y + radius); path.quadraticCurveTo(x, y, x + radius, y);
  } else {
    path.moveTo(x + radius, y);
    path.lineTo(x, y + radius); path.quadraticCurveTo(x, y, x + radius, y);
    path.lineTo(x, y1 - radius); path.quadraticCurveTo(x, y1, x + radius, y1);
    path.lineTo(x1 - radius, y1); path.quadraticCurveTo(x1, y1, x1, y1 - radius);
    path.lineTo(x1, y + radius); path.quadraticCurveTo(x1, y, x1 - radius, y);
    path.lineTo(x + radius, y);
  }
}
function chairBackGeometry() {
  if (_chairBackGeometry) return _chairBackGeometry;
  const shape = new THREE.Shape();
  drawRoundedRect(shape, -0.21, -0.22, 0.42, 0.44, 0.055);
  const opening = new THREE.Path();
  drawRoundedRect(opening, -0.13, -0.1, 0.26, 0.23, 0.045, true);
  shape.holes.push(opening);
  _chairBackGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.045,
    steps: 1,
    curveSegments: 5,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.008,
    bevelThickness: 0.007,
  });
  _chairBackGeometry.center();
  return _chairBackGeometry;
}
function cyl(rt, rb, h, mat, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function makeStool(woodMat, cushionMat) {
  const g = new THREE.Group();
  const seat = cyl(0.19, 0.19, 0.06, cushionMat); seat.position.y = 0.62; g.add(seat);
  const pole = cyl(0.035, 0.035, 0.6, woodMat); pole.position.y = 0.31; g.add(pole);
  const base = cyl(0.16, 0.16, 0.03, woodMat); base.position.y = 0.02; g.add(base);
  return g;
}

let _latteArtTex = null;
function latteArtTexture() {
  if (_latteArtTex) return _latteArtTex;
  _latteArtTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#3a2113'; g.fillRect(0, 0, w, h);
    // a rosetta-ish leaf in crema foam
    g.strokeStyle = '#d8c4a0'; g.fillStyle = '#e6d6b8';
    g.translate(w / 2, h / 2);
    for (let i = 0; i < 7; i++) {
      const s = 1 - i * 0.12;
      g.beginPath();
      g.ellipse(0, (i - 3) * 4, 12 * s, 5 * s, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillRect(-1.5, -26, 3, 52);
  });
  _latteArtTex.userData.vibeShared = true;
  _latteArtTex.userData.shared = true;
  return _latteArtTex;
}

// a drink with variety: different downloaded cup/mug/latte models when
// available, otherwise a procedural cup, and a chance of latte art on top
function makeDrink(accent, models) {
  const drinkKeys = ['cup', 'mug', 'latte'].filter((k) => models?.get?.(k));
  if (drinkKeys.length && Math.random() < 0.7) {
    const key = drinkKeys[Math.floor(rand(0, drinkKeys.length))];
    const g = cloneModel(models, key);
    if (g) {
      // the library cups are empty shells — pour something into them.
      // A crema/latte-art disc just below the rim reads perfectly from the
      // seated player's top-down view of the table.
      const bb = new THREE.Box3().setFromObject(g);
      const size = bb.getSize(new THREE.Vector3());
      const rimR = Math.min(size.x, size.z) * 0.335;
      const surfaceY = bb.min.y + size.y * (key === 'latte' ? 0.8 : 0.76);
      const art = Math.random() < 0.45;
      const liquid = new THREE.Mesh(
        new THREE.CircleGeometry(rimR, 20),
        art
          ? new THREE.MeshStandardMaterial({ map: latteArtTexture(), roughness: 0.42 })
          : new THREE.MeshStandardMaterial({ map: cremaTexture(), roughness: 0.38 })
      );
      liquid.rotation.x = -Math.PI / 2;
      const center = bb.getCenter(new THREE.Vector3());
      liquid.position.set(center.x, surfaceY, center.z);
      g.add(liquid);
      return g;
    }
  }
  return makeCup(accent, models, Math.random() < 0.4);
}

// espresso surface: dark centre blooming into a hazelnut crema ring
let _cremaTex = null;
function cremaTexture() {
  if (_cremaTex) return _cremaTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, '#2c170d');
  grad.addColorStop(0.55, '#3a2010');
  grad.addColorStop(0.82, '#8a5a2e');
  grad.addColorStop(1, '#a8763e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // fine crema flecks
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(190,140,80,${rand(0.1, 0.3)})`;
    g.beginPath();
    g.arc(rand(6, 58), rand(6, 58), rand(0.4, 1.4), 0, 7);
    g.fill();
  }
  _cremaTex = new THREE.CanvasTexture(c);
  _cremaTex.userData.vibeShared = true;
  _cremaTex.userData.shared = true;
  _cremaTex.colorSpace = THREE.SRGBColorSpace;
  return _cremaTex;
}

function makeCup(accent, models, latteArt = false) {
  const fromLib = !latteArt && cloneModel(models, 'cup');
  if (fromLib) return fromLib;

  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xeee8dc, roughness: 0.26, metalness: 0 });
  // lathe-turned cup body: gentle outward flare with a foot
  const profile = [];
  for (const [r, y] of [[0.018, 0], [0.03, 0.004], [0.033, 0.012], [0.038, 0.035], [0.044, 0.062], [0.047, 0.08], [0.046, 0.082]]) {
    profile.push(new THREE.Vector2(r, y));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), mat);
  body.castShadow = true;
  g.add(body);
  const coffeeMat = latteArt
    ? new THREE.MeshStandardMaterial({ map: latteArtTexture(), roughness: 0.48, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: 0x2c170d, roughness: 0.36, metalness: 0 });
  const coffee = cyl(0.041, 0.041, 0.004, coffeeMat, 16);
  coffee.position.y = 0.072;
  g.add(coffee);
  // handle
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0065, 8, 14, Math.PI * 1.6), mat);
  handle.position.set(0.048, 0.045, 0);
  handle.rotation.z = -Math.PI / 2 + 0.35;
  g.add(handle);
  // saucer with a raised rim + a teaspoon resting on it
  const saucerProfile = [
    new THREE.Vector2(0.0, 0), new THREE.Vector2(0.05, 0.003),
    new THREE.Vector2(0.072, 0.008), new THREE.Vector2(0.082, 0.017),
  ];
  const saucer = new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, 20), mat);
  saucer.receiveShadow = true;
  g.add(saucer);
  const spoonMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.22, metalness: 0.95 });
  const spoonBowl = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), spoonMat);
  spoonBowl.scale.set(1, 0.35, 1.4);
  spoonBowl.position.set(-0.055, 0.014, 0.035);
  g.add(spoonBowl);
  const spoonHandle = box(0.006, 0.004, 0.05, spoonMat);
  spoonHandle.position.set(-0.05, 0.014, 0.07);
  spoonHandle.rotation.y = 0.3;
  g.add(spoonHandle);
  return g;
}

function makePastryPlate(models) {
  const g = new THREE.Group();
  const plate = cyl(0.085, 0.07, 0.012, new THREE.MeshStandardMaterial({ color: 0xeee9de, roughness: 0.3, metalness: 0 }), 18);
  plate.position.y = 0.006;
  g.add(plate);
  // whatever's on the plate today — the full menu of downloaded treats
  const options = ['croissant', 'donut', 'muffin', 'sandwich', 'cookie', 'cupcake', 'pancakes', 'cakeSlice', 'iceCream', 'apple']
    .filter((k) => models?.get?.(k));
  const fromLib = options.length ? cloneModel(models, options[Math.floor(rand(0, options.length))]) : null;
  if (fromLib) {
    fromLib.position.y = 0.012;
    fromLib.rotation.y = rand(0, Math.PI * 2);
    g.add(fromLib);
    return g;
  }
  // procedural croissant: three golden lobes in a crescent
  const doughMat = new THREE.MeshStandardMaterial({ color: 0xb87335, roughness: 0.76, metalness: 0 });
  for (const [a, s] of [[-0.5, 0.75], [0, 1], [0.5, 0.75]]) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.028 * s, 10, 8), doughMat);
    lobe.scale.set(1.5, 0.75, 0.9);
    lobe.position.set(Math.sin(a) * 0.035, 0.028, Math.cos(a) * 0.035 - 0.02);
    lobe.rotation.y = -a;
    lobe.castShadow = true;
    g.add(lobe);
  }
  return g;
}

function makeArmchair(fabricMat, woodDarkMat, models) {
  const fromLib = cloneModel(models, 'armchair');
  if (fromLib) {
    fromLib.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.lerp(fabricMat.color, 0.84);
      o.material.roughness = 0.9;
      if (!o.material.map) {
        o.material.map = fabricMat.map;
        o.material.bumpMap = fabricMat.bumpMap;
        o.material.bumpScale = fabricMat.bumpScale;
      }
    });
    return fromLib;
  }
  const g = new THREE.Group();
  const base = box(0.6, 0.22, 0.56, fabricMat); base.position.y = 0.22; g.add(base);
  const cushion = box(0.5, 0.1, 0.48, fabricMat); cushion.position.set(0, 0.38, 0.02); g.add(cushion);
  const back = box(0.6, 0.5, 0.14, fabricMat);
  back.position.set(0, 0.55, -0.24);
  back.rotation.x = -0.12;
  g.add(back);
  for (const s of [-1, 1]) {
    const arm = box(0.13, 0.2, 0.5, fabricMat);
    arm.position.set(s * 0.30, 0.43, 0);
    g.add(arm);
    const armTop = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.38, 4, 8), fabricMat);
    armTop.rotation.x = Math.PI / 2;
    armTop.position.set(s * 0.30, 0.54, 0);
    armTop.castShadow = true;
    g.add(armTop);
  }
  for (const [x, z] of [[-0.24, -0.22], [0.24, -0.22], [-0.24, 0.22], [0.24, 0.22]]) {
    const leg = cyl(0.02, 0.015, 0.12, woodDarkMat, 8);
    leg.position.set(x, 0.06, z);
    g.add(leg);
  }
  return g;
}

function makePlant(potColor, shared = {}) {
  const g = new THREE.Group();
  const potMat = shared.pot ?? new THREE.MeshStandardMaterial({ color: potColor, roughness: 0.92 });
  const leafMat = shared.leaf ?? new THREE.MeshStandardMaterial({ color: 0x3d7041, roughness: 0.94 });
  const pot = cyl(0.16, 0.12, 0.24, potMat);
  pot.position.y = 0.12; g.add(pot);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, rand(0.35, 0.6), 5), leafMat);
    leaf.position.set(rand(-0.07, 0.07), 0.24 + leaf.geometry.parameters.height / 2, rand(-0.07, 0.07));
    leaf.rotation.set(rand(-0.35, 0.35), 0, rand(-0.35, 0.35));
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

function makeBooks(n) {
  const g = new THREE.Group();
  const cols = [0x8a3b2e, 0x2e5e6e, 0x777a3c, 0xa08040, 0x5d3f6e];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const w = rand(0.035, 0.06), h = rand(0.18, 0.26);
    const b = box(w, h, 0.15, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.85 }));
    b.position.set(x + w / 2, h / 2, 0);
    b.rotation.z = Math.random() < 0.15 ? -0.25 : 0;
    g.add(b);
    x += w + 0.008;
  }
  return g;
}

// ---------- the café ----------

// ---------- décor expansion: small believable objects ----------

function makeNewspaper() {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ece7da'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#2a2620';
  ctx.font = 'bold 13px Georgia'; ctx.fillText('THE DAILY BREW', 8, 16);
  ctx.fillRect(8, 22, 52, 30); // photo block
  ctx.font = '4px Georgia';
  for (let y = 28; y < 90; y += 5) {
    if (y < 56) { ctx.fillRect(66, y, 54, 2); } else { ctx.fillRect(8, y, 112, 2); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const paperMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0xe4dfd2, roughness: 0.95 });
  for (const side of [0, 1]) {
    const half = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.24), side === 0 ? paperMat : backMat);
    half.position.set(side * 0.155, side * 0.004, 0);
    half.rotation.z = side * 0.06;
    half.castShadow = true;
    g.add(half);
  }
  return g;
}

function makeCushion(color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.98 });
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), mat);
  cushion.geometry.translate(0, 0.045, 0);
  cushion.castShadow = true;
  const g = new THREE.Group();
  g.add(cushion);
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x39322a, roughness: 0.8 }));
  btn.position.y = 0.095;
  g.add(btn);
  return g;
}

function makeCakeStand(models) {
  const g = new THREE.Group();
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xeee8dc, roughness: 0.25 });
  const foot = cyl(0.05, 0.085, 0.09, porcelain, 14);
  foot.position.y = 0.045;
  g.add(foot);
  const plate = cyl(0.17, 0.15, 0.02, porcelain, 20);
  plate.position.y = 0.1;
  g.add(plate);
  const cake = cloneModel(models, 'cake');
  if (cake) { cake.position.y = 0.11; cake.scale.setScalar(0.85); g.add(cake); }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false })
  );
  dome.position.y = 0.11;
  g.add(dome);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), porcelain);
  knob.position.y = 0.27;
  g.add(knob);
  return g;
}

function makeTipJar() {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.042, 0.11, 12),
    new THREE.MeshPhysicalMaterial({ color: 0xf4f8f8, transmission: 0.85, transparent: true, opacity: 0.35, roughness: 0.08 }));
  glass.position.y = 0.055;
  g.add(glass);
  for (let i = 0; i < 7; i++) { // loose change
    const coin = cyl(0.013, 0.013, 0.003, new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc9a03a : 0xb8bec4, metalness: 0.85, roughness: 0.3 }), 8);
    coin.position.set(rand(-0.02, 0.02), 0.006 + i * 0.005, rand(-0.02, 0.02));
    coin.rotation.set(rand(-0.4, 0.4), rand(0, 3), rand(-0.4, 0.4));
    g.add(coin);
  }
  // "tips" label
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f2e2'; ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = '#5c4630'; ctx.font = 'bold italic 17px Georgia';
  ctx.textAlign = 'center'; ctx.fillText('tips ☺', 32, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshBasicMaterial({ map: tex }));
  label.position.set(0, 0.06, 0.046);
  g.add(label);
  return g;
}

function makeWallMirror() {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9a03a, metalness: 0.75, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 10, 32), frameMat);
  g.add(ring);
  // an env-mapped disc reads as glass from every angle without real reflections
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.31, 32),
    new THREE.MeshStandardMaterial({ color: 0xcfe0e8, metalness: 1.0, roughness: 0.05 }));
  g.add(glass);
  return g;
}

function makeMagazineStack() {
  const g = new THREE.Group();
  const covers = [0x8a3b2e, 0x2e5e6e, 0xc98e4e, 0x54683f];
  for (let i = 0; i < 4; i++) {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.27),
      new THREE.MeshStandardMaterial({ color: covers[i], roughness: 0.6 }));
    mag.position.set(rand(-0.012, 0.012), 0.004 + i * 0.009, rand(-0.012, 0.012));
    mag.rotation.y = rand(-0.18, 0.18);
    mag.castShadow = true;
    g.add(mag);
  }
  return g;
}

// photographic PBR surface maps (public/textures, CC0 from ambientCG),
// cached across theme switches — these never get disposed
const _texLoader = new THREE.TextureLoader();
const _texCache = new Map();
function surfTex(name, { srgb = false, rx = 1, ry = 1 } = {}) {
  const key = `${name}|${rx}|${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const t = _texLoader.load(TEXTURE_MANIFEST[name] ?? '/textures/' + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  t.userData.shared = true; // cached across theme switches — never dispose
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.vibeShared = true;
  _texCache.set(key, t);
  return t;
}

// per-café floor surface
const FLOOR_SURF = {
  goldenhour: { c: 'floor_wood.jpg', n: 'floor_wood_n.jpg', r: 'floor_wood_r.jpg', tint: 0xe4c49a, roughness: 0.82, normal: 0.34 },
  roastery: { c: 'floor_conc.jpg', n: 'floor_conc_n.jpg', tint: 0xd1d2d2, roughness: 0.88, normal: 0.42 },
  midnight: { c: 'floor_dark.jpg', n: 'floor_dark_n.jpg', tint: 0xa88260, roughness: 0.78, normal: 0.28 },
  terrace: { c: 'floor_conc.jpg', n: 'floor_conc_n.jpg', tint: 0xd3bea0, roughness: 0.92, normal: 0.38 }, // sun-warmed pavers
};

export function buildCafe(theme, models = null) {
  const group = new THREE.Group();
  const { W, D, H } = ROOM;
  const disposables = [];
  const track = (t) => { disposables.push(t); return t; };
  const extraColliders = []; // decor added before the collider list is built

  const woodMap = surfTex('wood_dark.jpg', { srgb: true });
  const woodNorm = surfTex('wood_dark_n.jpg');
  const woodMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.wood).lerp(new THREE.Color(0xffffff), 0.5),
    roughness: 0.62, map: woodMap, normalMap: woodNorm,
    normalScale: new THREE.Vector2(0.32, 0.32),
  });
  const woodDarkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.woodDark).lerp(new THREE.Color(0xffffff), 0.28),
    roughness: 0.72, map: woodMap, normalMap: woodNorm,
    normalScale: new THREE.Vector2(0.26, 0.26),
  });
  const clothTex = track(fabricTexture());
  clothTex.wrapS = clothTex.wrapT = THREE.RepeatWrapping;
  clothTex.repeat.set(5, 5);
  const cushionMat = new THREE.MeshStandardMaterial({
    color: theme.cushion, roughness: 0.92,
    map: clothTex, bumpMap: clothTex, bumpScale: 0.006,
  });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x73767a, roughness: 0.32, metalness: 0.88 });
  // A compact material library keeps repeated table dressing visually related
  // and avoids dozens of near-identical shader/material instances.
  const ceramicMat = new THREE.MeshStandardMaterial({ color: 0xd9ceba, roughness: 0.3, metalness: 0 });
  const glazedCeramicMat = new THREE.MeshStandardMaterial({ color: 0xd6c6ad, roughness: 0.24, metalness: 0 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xd3c5aa, roughness: 0.96, metalness: 0 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x4c7147, roughness: 0.96, metalness: 0 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d6743, roughness: 0.98, metalness: 0 });
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xe2d5b9, roughness: 0.84, metalness: 0 });
  const plantPotMat = new THREE.MeshStandardMaterial({
    color: theme.openAir ? 0x9c6748 : new THREE.Color(theme.woodDark).lerp(new THREE.Color(0x8e725c), 0.42),
    roughness: 0.94, metalness: 0,
  });

  // floor: photographic planks/concrete per café
  const fs = FLOOR_SURF[theme.id] ?? FLOOR_SURF.goldenhour;
  const floorMat = new THREE.MeshStandardMaterial({
    map: surfTex(fs.c, { srgb: true, rx: 4, ry: 3 }),
    normalMap: surfTex(fs.n, { rx: 4, ry: 3 }),
    roughnessMap: fs.r ? surfTex(fs.r, { rx: 4, ry: 3 }) : null,
    color: fs.tint, roughness: fs.roughness,
    normalScale: new THREE.Vector2(fs.normal, fs.normal),
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ceiling — or, outdoors, a pergola of slats on posts
  if (!theme.openAir) {
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: theme.wallTrim, roughness: 0.92, metalness: 0 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    group.add(ceil);
  } else {
    const pergY = 3.15;
    for (const [px, pz] of [[-W / 2 + 0.3, -D / 2 + 0.3], [W / 2 - 0.3, -D / 2 + 0.3], [-W / 2 + 0.3, D / 2 - 0.3], [W / 2 - 0.3, D / 2 - 0.3], [-W / 2 + 0.3, 0], [W / 2 - 0.3, 0]]) {
      const post = box(0.16, pergY, 0.16, woodDarkMat);
      post.position.set(px, pergY / 2, pz);
      group.add(post);
    }
    // main beams along x, slats along z
    for (const bz of [-D / 2 + 0.3, -D / 4, 0, D / 4, D / 2 - 0.3]) {
      const beam = box(W, 0.14, 0.1, woodDarkMat);
      beam.position.set(0, pergY + 0.07, bz);
      group.add(beam);
    }
    for (let sx = -W / 2 + 0.5; sx < W / 2; sx += 0.85) {
      const slat = box(0.07, 0.05, D, woodMat);
      slat.position.set(sx, pergY + 0.19, 0);
      group.add(slat);
      // a few vines draped over the slats
      if (Math.random() < 0.4) {
        const vine = cyl(0.02, 0.012, rand(0.4, 0.9), new THREE.MeshStandardMaterial({ color: 0x4e7a3c, roughness: 0.9 }), 5);
        vine.position.set(sx, pergY - 0.15, rand(-D / 2 + 1, D / 2 - 1));
        vine.rotation.z = rand(-0.3, 0.3);
        group.add(vine);
      }
    }
  }

  // walls — front (+z) and left (-x) get window openings
  const wallMat = new THREE.MeshStandardMaterial({
    map: surfTex('wall_plaster.jpg', { srgb: true, rx: 2, ry: 1 }),
    normalMap: surfTex('wall_plaster_n.jpg', { rx: 2, ry: 1 }),
    color: theme.wall, roughness: 0.9, metalness: 0,
    normalScale: new THREE.Vector2(0.18, 0.18),
  });
  const sillY = 0.9, winH = 1.9, headY = sillY + winH;

  function windowedWall(len) {
    // returns group lying along local x, centered, opening from |x|<len/2-margin
    const g2 = new THREE.Group();
    const doorHalf = 0; // no door here
    const seg = (w, h, x, y) => {
      const m = box(w, h, 0.15, wallMat);
      m.position.set(x, y, 0);
      g2.add(m);
    };
    const m = 0.55; // margin columns at wall ends
    seg(len, sillY, 0, sillY / 2);                    // sill band
    seg(len, H - headY, 0, headY + (H - headY) / 2);  // header band
    seg(m, winH, -(len - m) / 2, sillY + winH / 2);   // end columns
    seg(m, winH, (len - m) / 2, sillY + winH / 2);
    // mullions
    for (const fx of [-len / 6, len / 6]) {
      const mm = box(0.08, winH, 0.08, woodDarkMat);
      mm.position.set(fx, sillY + winH / 2, 0);
      g2.add(mm);
    }
    // glass
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(len - m * 2, winH),
      new THREE.MeshPhysicalMaterial({
        color: 0xf4f8f8, transmission: 0.94, transparent: true, opacity: 0.24,
        roughness: 0.1, metalness: 0, ior: 1.5, thickness: 0.012,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    glass.position.set(0, sillY + winH / 2, 0);
    g2.add(glass);
    void doorHalf;
    return g2;
  }

  // front wall: door in the middle, windows either side
  const doorW = 1.1, doorH = 2.3;
  if (!theme.openAir) {
    const half = (W - doorW) / 2;
    for (const s of [-1, 1]) {
      const w = windowedWall(half);
      w.position.set(s * (doorW / 2 + half / 2), 0, D / 2);
      group.add(w);
    }
    const header = box(doorW, H - doorH, 0.15, wallMat);
    header.position.set(0, doorH + (H - doorH) / 2, D / 2);
    group.add(header);
    // door frame + glass door
    const frame = box(doorW + 0.12, 0.08, 0.2, woodDarkMat);
    frame.position.set(0, doorH, D / 2);
    group.add(frame);
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW - 0.1, doorH - 0.1),
      new THREE.MeshPhysicalMaterial({ color: 0xe2edf0, transmission: 0.9, transparent: true, opacity: 0.28, roughness: 0.12, ior: 1.5, thickness: 0.015, side: THREE.DoubleSide, depthWrite: false })
    );
    door.position.set(0, doorH / 2, D / 2 + 0.02);
    group.add(door);
    const handle = box(0.03, 0.5, 0.03, metalMat);
    handle.position.set(-0.35, 1.1, D / 2 - 0.06);
    group.add(handle);

    // left wall with windows
    const lw = windowedWall(D);
    lw.rotation.y = Math.PI / 2;
    lw.position.set(-W / 2, 0, 0);
    group.add(lw);

    // right + back walls solid
    for (const [len, pos, rotY] of [
      [D, [W / 2, 0, 0], -Math.PI / 2],
      [W, [0, 0, -D / 2], 0],
    ]) {
      const m = box(len, H, 0.15, wallMat);
      m.position.set(pos[0], H / 2, pos[2]);
      m.rotation.y = rotY;
      m.position.y = H / 2;
      group.add(m);
    }

    // baseboard trim
    const trimMat = new THREE.MeshStandardMaterial({ color: theme.wallTrim, roughness: 0.82, metalness: 0 });
    for (const [len, pos, rotY] of [
      [W, [0, 0.06, -D / 2 + 0.09], 0],
      [D, [W / 2 - 0.09, 0.06, 0], Math.PI / 2],
    ]) {
      const t = box(len, 0.12, 0.04, trimMat);
      t.position.set(...pos); t.rotation.y = rotY;
      group.add(t);
    }
  } else {
    // open air: waist-high planter boxes ring the terrace, hedge on top,
    // with the same gap at the front for the entrance path
    const planterMat = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.9, map: surfTex('wood_dark.jpg', { srgb: true }) });
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x4a6e3c, roughness: 1 });
    const ring = [
      // front, split around the entrance gap
      { w: (W - doorW) / 2 - 0.6, x: -(doorW / 2 + ((W - doorW) / 2 - 0.6) / 2 + 0.3), z: D / 2 - 0.15, ry: 0 },
      { w: (W - doorW) / 2 - 0.6, x: doorW / 2 + ((W - doorW) / 2 - 0.6) / 2 + 0.3, z: D / 2 - 0.15, ry: 0 },
      { w: D - 0.6, x: -W / 2 + 0.15, z: 0, ry: Math.PI / 2 },
      { w: D - 0.6, x: W / 2 - 0.15, z: 0, ry: Math.PI / 2 },
      // back: leave a solid kiosk wall behind the counter instead
    ];
    for (const seg of ring) {
      const pl = box(seg.w, 0.5, 0.34, planterMat);
      pl.position.set(seg.x, 0.25, seg.z);
      pl.rotation.y = seg.ry;
      group.add(pl);
      const hedge = box(seg.w - 0.1, 0.42, 0.3, hedgeMat);
      hedge.position.set(seg.x, 0.68, seg.z);
      hedge.rotation.y = seg.ry;
      group.add(hedge);
    }
    // the kiosk: a pavilion wall behind the counter carrying menu + shelves
    const kioskMat = new THREE.MeshStandardMaterial({
      map: surfTex('wall_plaster.jpg', { srgb: true, rx: 2, ry: 1 }),
      normalMap: surfTex('wall_plaster_n.jpg', { rx: 2, ry: 1 }),
      color: theme.wall, roughness: 0.9, metalness: 0,
      normalScale: new THREE.Vector2(0.18, 0.18),
    });
    const kiosk = box(W * 0.72, H - 0.6, 0.18, kioskMat);
    kiosk.position.set(-0.6, (H - 0.6) / 2, -D / 2 + 0.1);
    group.add(kiosk);
    const kioskRoof = box(W * 0.76, 0.1, 1.4, woodDarkMat);
    kioskRoof.position.set(-0.6, H - 0.55, -D / 2 + 0.6);
    group.add(kioskRoof);
  }

  // outside backdrops (emissive planes far past the street)
  const outTex = track(outsideTexture(theme.outside));
  const outMat = new THREE.MeshBasicMaterial({ map: outTex, fog: false });
  const back1 = new THREE.Mesh(new THREE.PlaneGeometry(W * 3.2, 13), outMat);
  back1.position.set(0, 4.2, D / 2 + 17);
  back1.rotation.y = Math.PI;
  group.add(back1);
  const back2 = new THREE.Mesh(new THREE.PlaneGeometry(D * 3.2, 13), outMat);
  back2.position.set(-W / 2 - 14, 4.2, 0);
  back2.rotation.y = Math.PI / 2;
  group.add(back2);
  if (theme.openAir) {
    // The terrace is open on every side, so close the distant horizon behind
    // the camera and to the right as well as at the two window-facing sides.
    const back3 = new THREE.Mesh(new THREE.PlaneGeometry(D * 3.2, 13), outMat);
    back3.position.set(W / 2 + 14, 4.2, 0);
    back3.rotation.y = -Math.PI / 2;
    group.add(back3);
    const back4 = new THREE.Mesh(new THREE.PlaneGeometry(W * 3.2, 13), outMat);
    back4.position.set(0, 4.2, -D / 2 - 17);
    group.add(back4);
  }

  // ---------- a real street outside the windows ----------
  let passingCar = null;
  if (theme.openAir) {
    // a park instead: lawn, gravel path, trees and bushes all around
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(70, 60),
      new THREE.MeshStandardMaterial({ color: 0x6f8a52, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = -0.02;
    lawn.receiveShadow = true;
    group.add(lawn);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 9),
      new THREE.MeshStandardMaterial({ color: 0xc9bda2, roughness: 1 }));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, -0.01, D / 2 + 4.5);
    group.add(path);
    const leafMats = [0x4e7a3c, 0x5d8a44, 0x6f9a50].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 0.95 });
    const mkTree = (tx, tz, s) => {
      const tr = new THREE.Group();
      const trunk = cyl(0.09 * s, 0.14 * s, 1.4 * s, trunkMat, 7);
      trunk.position.y = 0.7 * s;
      tr.add(trunk);
      for (let i = 0; i < 4; i++) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(rand(0.6, 0.95) * s, 8, 7), pick(leafMats));
        blob.position.set(rand(-0.5, 0.5) * s, (1.7 + rand(0, 0.8)) * s, rand(-0.5, 0.5) * s);
        blob.castShadow = true;
        tr.add(blob);
      }
      tr.position.set(tx, 0, tz);
      group.add(tr);
    };
    for (const [tx, tz, s] of [[-12, 4, 1.3], [-11, -4, 1.0], [12, 2, 1.2], [11.5, -5, 0.9],
      [-6, 11.5, 1.1], [5, 12.5, 1.4], [12, 10, 1.0], [-12.5, 10.5, 1.2], [-4, -11, 1.1], [6, -11.5, 1.3]]) {
      mkTree(tx, tz, s);
    }
    for (let i = 0; i < 14; i++) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(rand(0.3, 0.6), 7, 6), pick(leafMats));
      const ang = rand(0, Math.PI * 2), rr = rand(10, 16);
      bush.position.set(Math.cos(ang) * rr, 0.25, Math.sin(ang) * rr);
      bush.castShadow = true;
      group.add(bush);
    }
    // a park bench along the path
    const bench = new THREE.Group();
    for (const by of [0.42, 0.52]) {
      const slat = box(1.6, 0.05, 0.14, woodMat);
      slat.position.set(0, by === 0.42 ? 0.42 : 0.44, by === 0.42 ? 0 : -0.16);
      bench.add(slat);
    }
    const backSlat = box(1.6, 0.3, 0.05, woodMat);
    backSlat.position.set(0, 0.72, -0.24);
    bench.add(backSlat);
    for (const bx of [-0.7, 0.7]) {
      const leg = box(0.06, 0.42, 0.4, woodDarkMat);
      leg.position.set(bx, 0.21, -0.05);
      bench.add(leg);
    }
    bench.position.set(2.6, 0, D / 2 + 5.5);
    bench.rotation.y = -0.3;
    group.add(bench);
  } else {
    const night = theme.outside === 'rainNight';
    const dusk = theme.outside === 'sunset';
    const paveMat = new THREE.MeshStandardMaterial({
      color: night ? 0x232630 : dusk ? 0x98846f : 0xa2a5a8,
      emissive: night ? 0x090c12 : 0x000000,
      emissiveIntensity: night ? 0.32 : 0,
      roughness: 0.96, metalness: 0,
    });
    const roadMat = new THREE.MeshStandardMaterial({
      color: night ? 0x131620 : 0x373a3e,
      emissive: night ? 0x05070b : 0x000000,
      emissiveIntensity: night ? 0.24 : 0,
      roughness: 0.94, metalness: 0,
    });

    // near sidewalk (the pedestrians walk here), curb, road, far sidewalk
    const walk1 = new THREE.Mesh(new THREE.BoxGeometry(W + 30, 0.06, 2.9), paveMat);
    walk1.position.set(0, -0.03, D / 2 + 1.45);
    group.add(walk1);
    const road = new THREE.Mesh(new THREE.BoxGeometry(W + 30, 0.02, 4.6), roadMat);
    road.position.set(0, -0.06, D / 2 + 2.9 + 2.3);
    group.add(road);
    const walk2 = new THREE.Mesh(new THREE.BoxGeometry(W + 30, 0.06, 1.6), paveMat);
    walk2.position.set(0, -0.03, D / 2 + 7.5 + 0.8);
    group.add(walk2);
    // dashed center line
    const lineMat = new THREE.MeshBasicMaterial({ color: night ? 0x6a6f52 : 0xd8d3a8 });
    const dashPositions = [];
    for (let x = -W / 2 - 12; x < W / 2 + 12; x += 2.2) {
      dashPositions.push(x);
    }
    const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 0.12), lineMat, dashPositions.length);
    const dashMatrix = new THREE.Matrix4();
    const dashRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    dashPositions.forEach((x, index) => {
      dashMatrix.compose(
        new THREE.Vector3(x, -0.045, D / 2 + 5.2),
        dashRotation,
        new THREE.Vector3(1, 1, 1),
      );
      dashes.setMatrixAt(index, dashMatrix);
    });
    group.add(dashes);

    // Facing buildings use the same cached plaster maps as the interior and a
    // compact shared material palette. Window panes and sills are accumulated
    // into two instanced draws for the whole block, leaving room in the budget
    // for storefront depth, cornices and rooftop silhouettes.
    const faceRow = new THREE.Group();
    // Reuse the exact interior plaster texture instances (including repeat)
    // instead of cloning another pair solely for distant facades.
    const facadeMap = surfTex('wall_plaster.jpg', { srgb: true, rx: 2, ry: 1 });
    const facadeNormal = surfTex('wall_plaster_n.jpg', { rx: 2, ry: 1 });
    const facadeColors = night
      ? [0x343b48, 0x40383a, 0x303d3e]
      : dusk ? [0xa97860, 0x8e7568, 0x9b846a] : [0xaeb7bd, 0xb8afa5, 0x9eabb1];
    const facadeMaterials = facadeColors.map((color) => new THREE.MeshStandardMaterial({
      color, map: facadeMap, normalMap: facadeNormal,
      emissive: night ? 0x070a10 : 0x000000,
      emissiveIntensity: night ? 0.26 : 0,
      normalScale: new THREE.Vector2(0.16, 0.16), roughness: 0.9,
    }));
    const facadeTrimMat = new THREE.MeshStandardMaterial({
      color: night ? 0x262c34 : dusk ? 0x725b4d : 0x737b80,
      roughness: 0.76,
    });
    const storefrontMat = new THREE.MeshStandardMaterial({
      color: night ? 0x17212a : 0x52636b,
      emissive: night ? 0x6d4d2b : dusk ? 0x493523 : 0x101418,
      emissiveIntensity: night ? 0.72 : dusk ? 0.38 : 0.12,
      roughness: 0.2, metalness: 0.25,
    });
    const signMat = new THREE.MeshBasicMaterial({ color: night || dusk ? 0xe6b778 : 0xc5c9c7 });
    const awningMaterials = [0x8a3b2e, 0x2e5e6e, 0x777a3c].map((color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 });
    const windowRecords = [];
    let buildingIndex = 0;
    let fx = -W / 2 - 11;
    while (fx < W / 2 + 11) {
      const bw = rand(4.5, 7), bh = rand(5.2, 8.5), bd = 2.2;
      const centerX = fx + bw / 2;
      const centerZ = D / 2 + 9.5;
      const frontZ = centerZ - bd / 2;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        facadeMaterials[buildingIndex % facadeMaterials.length],
      );
      b.position.set(centerX, bh / 2, centerZ);
      b.receiveShadow = true;
      faceRow.add(b);

      // Projecting cornices and edge pilasters give each flat box an actual
      // facade silhouette. Small rooftop services break up the skyline.
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.18, 0.15, bd + 0.14), facadeTrimMat);
      cornice.position.set(centerX, bh + 0.025, centerZ);
      faceRow.add(cornice);
      for (const side of [-1, 1]) {
        const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.13, bh - 0.3, 0.1), facadeTrimMat);
        pilaster.position.set(centerX + side * (bw / 2 - 0.1), bh / 2, frontZ - 0.055);
        faceRow.add(pilaster);
      }
      const roofUnit = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.58), facadeTrimMat);
      roofUnit.position.set(centerX + bw * 0.18, bh + 0.25, centerZ);
      faceRow.add(roofUnit);

      // Recessed ground-floor glazing, a separate door and a warm sign make
      // the opposite block read as occupied shops rather than a window grid.
      const shop = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.68, 1.45), storefrontMat);
      shop.rotation.y = Math.PI;
      shop.position.set(centerX, 1.02, frontZ - 0.012);
      faceRow.add(shop);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.35), storefrontMat);
      door.rotation.y = Math.PI;
      door.position.set(centerX + bw * 0.28, 0.75, frontZ - 0.022);
      faceRow.add(door);
      const sign = new THREE.Mesh(new RoundedBoxGeometry(bw * 0.38, 0.18, 0.05, 2, 0.025), signMat);
      sign.position.set(centerX - bw * 0.12, 1.9, frontZ - 0.06);
      faceRow.add(sign);

      for (let wy = 2.65; wy < bh - 0.65; wy += 1.25) {
        for (let wx = -bw / 2 + 0.7; wx < bw / 2 - 0.5; wx += 1.08) {
          const lit = Math.random() < (night ? 0.58 : 0.88);
          windowRecords.push({
            position: new THREE.Vector3(centerX + wx, wy, frontZ - 0.012),
            color: new THREE.Color(night
              ? (lit ? pick([0xffc46a, 0xffd99a, 0xd9c28b]) : 0x18222d)
              : dusk ? (lit ? 0xffe1b0 : 0x53606a) : pick([0xc9dbe5, 0xdfeaf2, 0xb9ceda])),
          });
        }
      }

      // Awnings remain intermittent, but share three materials and the same
      // support treatment instead of allocating a material for every shop.
      if (buildingIndex % 2 === 0) {
        const awnMat = awningMaterials[buildingIndex % awningMaterials.length];
        const awn = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.7, 0.05, 0.9), awnMat);
        awn.position.set(centerX, 2.35, frontZ - 0.38);
        awn.rotation.x = 0.22;
        faceRow.add(awn);
        const valance = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.7, 0.14, 0.03), awnMat);
        valance.position.set(centerX, 2.21, frontZ - 0.82);
        faceRow.add(valance);
        for (const side of [-1, 1]) {
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 6), rodMat);
          rod.position.set(centerX + side * bw * 0.3, 1.98, frontZ - 0.55);
          rod.rotation.x = 0.75;
          faceRow.add(rod);
        }
      }
      fx += bw + rand(0.4, 1.1);
      buildingIndex += 1;
    }

    if (windowRecords.length) {
      const windowGeometry = new THREE.PlaneGeometry(0.56, 0.76);
      const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const windowMesh = new THREE.InstancedMesh(windowGeometry, windowMaterial, windowRecords.length);
      const sillMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.68, 0.055, 0.09), facadeTrimMat, windowRecords.length,
      );
      const matrix = new THREE.Matrix4();
      const paneRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
      const identityRotation = new THREE.Quaternion();
      const unitScale = new THREE.Vector3(1, 1, 1);
      windowRecords.forEach((record, index) => {
        matrix.compose(record.position, paneRotation, unitScale);
        windowMesh.setMatrixAt(index, matrix);
        windowMesh.setColorAt(index, record.color);
        matrix.compose(
          new THREE.Vector3(record.position.x, record.position.y - 0.405, record.position.z - 0.018),
          identityRotation,
          unitScale,
        );
        sillMesh.setMatrixAt(index, matrix);
      });
      windowMesh.instanceMatrix.needsUpdate = true;
      windowMesh.instanceColor.needsUpdate = true;
      sillMesh.instanceMatrix.needsUpdate = true;
      faceRow.add(windowMesh, sillMesh);
    }
    group.add(faceRow);

    // Five visible pavement fixtures are two instanced draws. Warm pool cards
    // make their spacing legible, while only two actual point lights affect
    // shading; this is substantially cheaper than one dynamic light per pole.
    const lampXs = [-W / 2 - 4.5, -W / 2 + 1.6, 0, W / 2 - 1.6, W / 2 + 4.5];
    const lampZ = D / 2 + 2.55;
    const lampMat2 = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.42, metalness: 0.82 });
    const glowMat = new THREE.MeshBasicMaterial({ color: night || dusk ? 0xffd9a0 : 0xcfd4d8 });
    const poleMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.055, 0.065, 3.4, 9), lampMat2, lampXs.length,
    );
    const headMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.14, 12, 9), glowMat, lampXs.length,
    );
    const lampMatrix = new THREE.Matrix4();
    const lampRotation = new THREE.Quaternion();
    const lampScale = new THREE.Vector3(1, 1, 1);
    lampXs.forEach((lx, index) => {
      lampMatrix.compose(new THREE.Vector3(lx, 1.7, lampZ), lampRotation, lampScale);
      poleMesh.setMatrixAt(index, lampMatrix);
      lampMatrix.compose(new THREE.Vector3(lx, 3.45, lampZ), lampRotation, lampScale);
      headMesh.setMatrixAt(index, lampMatrix);
    });
    poleMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    group.add(poleMesh, headMesh);

    if (night || dusk) {
      const poolMaterial = new THREE.MeshBasicMaterial({
        color: 0xffc978,
        transparent: true,
        opacity: night ? 0.16 : 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pools = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(3.4, 1.5), poolMaterial, lampXs.length,
      );
      const poolRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      lampXs.forEach((lx, index) => {
        lampMatrix.compose(new THREE.Vector3(lx, 0.012, lampZ), poolRotation, lampScale);
        pools.setMatrixAt(index, lampMatrix);
      });
      pools.instanceMatrix.needsUpdate = true;
      group.add(pools);

      // Two localized lights cover pedestrians, parked cars and the opposite
      // facade. The low-emissive pavement/facade materials fill the gaps, so
      // five visible fixtures do not become five costly real-time lights.
      for (const index of [1, 3]) {
        const light = new THREE.PointLight(0xffc47a, night ? 13 : 4, 10, 1.7);
        light.position.set(lampXs[index], 3.25, lampZ);
        group.add(light);
      }
    }

    // Cars share one cached geometry kit across every café rebuild. A tapered
    // glass cabin, rounded panels, mirrors and door seams improve the silhouette
    // while the third visible car adds only a paint material and transforms.
    const carGeo = carGeometryKit();
    const trimMat2 = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.68 });
    const glassMat2 = new THREE.MeshStandardMaterial({ color: 0x17232c, roughness: 0.12, metalness: 0.32 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.15, metalness: 0.95 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.88 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 0.9 });
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.7 });
    const headMat = night
      ? new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
      : new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.2, metalness: 0.3 });
    const tailMat = night
      ? new THREE.MeshBasicMaterial({ color: 0xff5040 })
      : new THREE.MeshStandardMaterial({ color: 0x8a2018, roughness: 0.3 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d4, roughness: 0.5 });
    const compactCar = (car) => {
      const buckets = new Map();
      for (const mesh of [...car.children]) {
        if (!mesh.isMesh || Array.isArray(mesh.material)) continue;
        const bucket = buckets.get(mesh.material.uuid) ?? { material: mesh.material, meshes: [] };
        bucket.meshes.push(mesh);
        buckets.set(mesh.material.uuid, bucket);
      }
      for (const { material, meshes } of buckets.values()) {
        if (meshes.length < 2) continue;
        const baked = meshes.map((mesh) => {
          mesh.updateMatrix();
          let geometry = mesh.geometry.clone();
          if (geometry.index) {
            const nonIndexed = geometry.toNonIndexed();
            geometry.dispose();
            geometry = nonIndexed;
          }
          return geometry.applyMatrix4(mesh.matrix);
        });
        const geometry = mergeGeometries(baked, false);
        baked.forEach((item) => item.dispose());
        if (!geometry) continue;
        meshes.forEach((mesh) => car.remove(mesh));
        const merged = new THREE.Mesh(geometry, material);
        merged.castShadow = false;
        merged.receiveShadow = true;
        car.add(merged);
      }
      return car;
    };
    const mkCar = (color) => {
      const car = new THREE.Group();
      const bodyMat2 = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 });
      const addPart = (geometry, material, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        car.add(mesh);
        return mesh;
      };
      addPart(carGeo.body, bodyMat2, 0, 0.62, 0);
      addPart(carGeo.rocker, trimMat2, 0, 0.36, 0);
      addPart(carGeo.hood, bodyMat2, 1.23, 0.87, 0);
      addPart(carGeo.trunk, bodyMat2, -1.37, 0.86, 0);
      addPart(carGeo.cabin, glassMat2, -0.12, 1.08, 0);
      addPart(carGeo.roof, bodyMat2, -0.22, 1.36, 0);
      for (const px2 of [-0.88, -0.15, 0.56]) addPart(carGeo.pillar, bodyMat2, px2, 1.08, 0);
      for (const bx2 of [1.71, -1.71]) addPart(carGeo.bumper, chromeMat, bx2, 0.46, 0);
      for (const side of [-1, 1]) {
        for (const hx2 of [0.35, -0.6]) addPart(carGeo.handle, chromeMat, hx2, 0.78, side * 0.755);
        addPart(carGeo.mirror, bodyMat2, 0.58, 1.07, side * 0.78);
        for (const seamX of [-0.42, 0.48]) addPart(carGeo.seam, seamMat, seamX, 0.67, side * 0.756);
      }
      for (const [wx2, wz2] of [[-1.15, 0.72], [1.15, 0.72], [-1.15, -0.72], [1.15, -0.72]]) {
        const wheel = addPart(carGeo.wheel, wheelMat, wx2, 0.32, wz2);
        wheel.rotation.x = Math.PI / 2;
        const hub = addPart(carGeo.hub, hubMat, wx2, 0.32, wz2 + Math.sign(wz2) * 0.11);
        hub.rotation.x = Math.PI / 2;
      }
      for (const side of [-1, 1]) {
        addPart(carGeo.headlight, headMat, 1.72, 0.66, side * 0.5);
        addPart(carGeo.taillight, tailMat, -1.72, 0.66, side * 0.5);
      }
      for (const bx2 of [1.735, -1.735]) addPart(carGeo.plate, plateMat, bx2, 0.5, 0);
      car.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = true;
      });
      return compactCar(car);
    };
    const parkedColors = [0x7a4a3a, 0x39505e, 0x5c5f64];
    const parked = mkCar(parkedColors[Math.floor(rand(0, parkedColors.length))]);
    parked.position.set(W / 2 - 1, 0, D / 2 + 3.6);
    parked.rotation.y = -0.035;
    group.add(parked);
    const parkedSecond = mkCar(parkedColors[(Math.floor(rand(0, parkedColors.length)) + 1) % parkedColors.length]);
    parkedSecond.position.set(-W / 2 + 2.2, 0, D / 2 + 3.55);
    parkedSecond.rotation.y = 0.025;
    group.add(parkedSecond);
    passingCar = mkCar(night ? 0x2a3340 : [0xa04638, 0x3d6070, 0xb8b4a8][Math.floor(rand(0, 3))]);
    passingCar.position.set(-30, 0, D / 2 + 6.2);
    passingCar.rotation.y = Math.PI; // faces -x on the far lane
    passingCar.userData = { t: rand(4, 10), dir: -1 };
    group.add(passingCar);
  }

  // ---------- counter along back wall ----------
  const counterIsWood = theme.id !== 'roastery';
  const counterMat = new THREE.MeshStandardMaterial({
    color: counterIsWood
      ? new THREE.Color(theme.counter).lerp(new THREE.Color(0xffffff), 0.22)
      : theme.counter,
    roughness: counterIsWood ? 0.7 : 0.58,
    metalness: 0,
    ...(counterIsWood ? {
      map: woodMap,
      normalMap: woodNorm,
      normalScale: new THREE.Vector2(0.22, 0.22),
    } : {}),
  });
  const counterTopMat = new THREE.MeshStandardMaterial({
    color: theme.counterTop,
    roughness: theme.id === 'roastery' ? 0.42 : theme.id === 'midnight' ? 0.48 : 0.4,
    metalness: 0,
  });
  const counter = roundedBox(8.2, 1.0, 0.75, counterMat, 0.045);
  counter.position.set(-0.6, 0.5, -D / 2 + 1.15);
  group.add(counter);
  const ctop = roundedBox(8.4, 0.06, 0.85, counterTopMat, 0.025);
  ctop.position.set(-0.6, 1.03, -D / 2 + 1.15);
  group.add(ctop);
  // counter front panel detail: vertical wood slats
  for (let i = 0; i < 20; i++) {
    const slat = box(0.1, 0.92, 0.03, woodDarkMat);
    slat.position.set(-4.5 + i * 0.41, 0.5, -D / 2 + 1.54);
    group.add(slat);
  }

  // espresso machine (downloaded model if available, else procedural)
  const machineModel = cloneModel(models, 'espresso_machine');
  if (machineModel) {
    machineModel.position.set(-2.2, 1.06, -D / 2 + 1.15);
    group.add(machineModel);
    // the asset ships with flat near-white palette colours; retint by
    // material name (never by guessed geometry) into a café machine:
    // espresso-red body panels over brushed steel
    machineModel.traverse((o) => {
      if (!o.isMesh || !o.material?.name) return;
      o.material = o.material.clone();
      const name = o.material.name.toLowerCase();
      if (name.includes('carpetwhite')) {
        o.material.color.set(0xa33b2e);
        o.material.metalness = 0.15;
        o.material.roughness = 0.4;
      } else if (name.includes('metalmedium')) {
        o.material.color.set(0x2e3236);
        o.material.metalness = 0.85;
        o.material.roughness = 0.3;
      } else if (name.includes('metal')) {
        o.material.color.set(0xb8bec4);
        o.material.metalness = 0.9;
        o.material.roughness = 0.25;
      }
    });
    const cupRowY = 1.06 + 0.52 + 0.028; // a row of warm cups staged on top
    for (let ci = 0; ci < 3; ci++) {
      const c2 = cyl(0.028, 0.022, 0.05, new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.5 }), 10);
      c2.position.set(-2.32 + ci * 0.12, cupRowY, -D / 2 + 1.15);
      group.add(c2);
    }
  } else {
    const m = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9f3430, roughness: 0.28, metalness: 0.12 });
    const body = box(0.85, 0.42, 0.5, bodyMat); body.position.y = 0.29; m.add(body);
    const top = box(0.9, 0.07, 0.55, metalMat); top.position.y = 0.53; m.add(top);
    for (const x of [-0.22, 0.22]) {
      const grp = cyl(0.035, 0.035, 0.12, metalMat); grp.position.set(x, 0.12, 0.2); m.add(grp);
      const hd = box(0.14, 0.05, 0.14, metalMat); hd.position.set(x, 0.06, 0.2); m.add(hd);
    }
    m.position.set(-2.2, 1.06, -D / 2 + 1.15);
    group.add(m);
  }
  // grinder + cup stack + register
  {
    const grinder = new THREE.Group();
    const b = cyl(0.09, 0.11, 0.3, woodDarkMat); b.position.y = 0.15; grinder.add(b);
    const hopper = cyl(0.11, 0.07, 0.14, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2, transparent: true, opacity: 0.85 }));
    hopper.position.y = 0.37; grinder.add(hopper);
    grinder.position.set(-1.2, 1.06, -D / 2 + 1.1);
    group.add(grinder);

    for (let i = 0; i < 8; i++) {
      const c = cyl(0.05, 0.04, 0.09, new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.5 }), 12);
      c.position.set(0.4 + (i % 4) * 0.12, 1.11 + Math.floor(i / 4) * 0.1, -D / 2 + 1.0);
      group.add(c);
    }
    const reg = box(0.4, 0.3, 0.35, woodDarkMat);
    reg.position.set(2.2, 1.21, -D / 2 + 1.15);
    group.add(reg);
    // a tilted screen + keypad so the register doesn't read as a bare box
    const regScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xaecfdd }));
    regScreen.position.set(2.2, 1.42, -D / 2 + 1.28);
    regScreen.rotation.x = -0.35;
    group.add(regScreen);
    const regFrame = box(0.34, 0.24, 0.02, new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4 }));
    regFrame.position.set(2.2, 1.42, -D / 2 + 1.273);
    regFrame.rotation.x = -0.35;
    group.add(regFrame);
    for (let i = 0; i < 6; i++) {
      const key = box(0.045, 0.012, 0.045, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.7 }));
      key.position.set(2.06 + (i % 3) * 0.09, 1.37, -D / 2 + 1.04 + Math.floor(i / 3) * 0.08);
      group.add(key);
    }
    // a tip jar with loose change beside the register
    const tips = makeTipJar();
    tips.position.set(2.62, 1.06, -D / 2 + 1.2);
    tips.rotation.y = rand(-0.3, 0.3);
    group.add(tips);
    // pastry case
    const caseGlass = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.6),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.92, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false }));
    caseGlass.position.set(-3.9, 1.31, -D / 2 + 1.15);
    group.add(caseGlass);
    const caseBase = box(1.55, 0.5, 0.65, counterMat);
    caseBase.position.set(-3.9, 0.81, -D / 2 + 1.15);
    group.add(caseBase);
    const caseGoods = ['croissant', 'donut', 'muffin', 'cupcake', 'cookie', 'cakeSlice']
      .map((k) => (models?.get?.(k) ? k : 'croissant'));
    const pastryMat = new THREE.MeshStandardMaterial({ color: 0xc98e4e, roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
      const good = cloneModel(models, caseGoods[i]);
      if (good) {
        good.position.set(-4.35 + (i % 3) * 0.4, 1.07 + Math.floor(i / 3) * 0.2, -D / 2 + 1.1);
        good.rotation.y = rand(0, Math.PI * 2);
        good.scale.setScalar(caseGoods[i] === 'cake' ? 0.8 : 1);
        group.add(good);
      } else {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), pastryMat);
        p.scale.set(1.4, 0.7, 1);
        p.position.set(-4.35 + (i % 3) * 0.35, 1.12 + Math.floor(i / 3) * 0.16, -D / 2 + 1.1);
        group.add(p);
      }
    }
    // kettle by the register, and a cake up on the counter under a glass dome
    const kettle = cloneModel(models, 'teapot');
    if (kettle) {
      kettle.position.set(1.2, 1.06, -D / 2 + 1.1);
      kettle.rotation.y = rand(0, Math.PI * 2);
      group.add(kettle);
    }
    // each café dresses this counter spot its own way
    if (theme.roaster) {
      // roastery: plump burlap sacks of fresh beans
      for (let i = 0; i < 2; i++) {
        const sack = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
          new THREE.MeshStandardMaterial({ color: i ? 0x8d7a55 : 0xa08a62, roughness: 1 }));
        sack.scale.set(1, 1.05, 0.8);
        sack.position.set(-2.95 + i * 0.26, 1.06, -D / 2 + 1.15);
        group.add(sack);
      }
    } else if (theme.vinyl) {
      // midnight: a slice on a stand and a record sleeve leaning on the shelf
      const slice = cloneModel(models, 'cakeSlice');
      if (slice) {
        slice.position.set(-2.9, 1.09, -D / 2 + 1.15);
        group.add(slice);
        const stand = cyl(0.12, 0.13, 0.03, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.4 }));
        stand.position.set(-2.9, 1.075, -D / 2 + 1.15);
        group.add(stand);
      }
      const sleeve = box(0.28, 0.28, 0.015, new THREE.MeshStandardMaterial({ color: 0x30262c, roughness: 0.7 }));
      sleeve.position.set(0.7, 1.86, -D / 2 + 0.28);
      sleeve.rotation.x = -0.18;
      group.add(sleeve);
    } else {
      // golden hour: the classic cake under a glass dome
      const counterCake = cloneModel(models, 'cake');
      if (counterCake) {
        counterCake.position.set(-2.9, 1.06, -D / 2 + 1.15);
        group.add(counterCake);
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false })
        );
        dome.position.set(-2.9, 1.06, -D / 2 + 1.15);
        group.add(dome);
      }
    }
    // a radio keeps the golden hour café company; the others have their own music
    if (!theme.roaster && !theme.vinyl) {
      const radio = cloneModel(models, 'radio');
      if (radio) {
        radio.position.set(0.0, 1.725, -D / 2 + 0.25);
        radio.rotation.y = 0.15;
        group.add(radio);
      }
    }
  }

  // back bar shelves with books/jars + menu board
  {
    const shelfMat = woodMat;
    for (const y of [1.7, 2.2]) {
      const s = box(5.8, 0.05, 0.3, shelfMat);
      s.position.set(-2.4, y, -D / 2 + 0.25);
      group.add(s);
    }
    const books = makeBooks(14);
    books.position.set(-5.1, 1.73, -D / 2 + 0.25);
    group.add(books);
    for (let i = 0; i < 9; i++) {
      const jar = cyl(0.08, 0.08, rand(0.18, 0.3), new THREE.MeshStandardMaterial({ color: [0x9c7844, 0x6a4a2a, 0x8d8d6a][i % 3], roughness: 0.6 }), 12);
      jar.position.set(-4.6 + i * 0.5, 2.2 + jar.geometry.parameters.height / 2 + 0.03, -D / 2 + 0.25);
      group.add(jar);
    }
    // small bags of beans on the lower shelf end
    for (let i = 0; i < 3; i++) {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xa08a62, roughness: 1 }));
      bag.scale.set(1, 0.95, 0.75);
      bag.position.set(-1.5 + i * 0.3, 1.83, -D / 2 + 0.25);
      group.add(bag);
    }
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.4),
      new THREE.MeshBasicMaterial({ map: track(menuTexture()) }));
    menu.position.set(2.2, 2.45, -D / 2 + 0.09);
    group.add(menu);
  }

  // neon sign (night café)
  let neonMesh = null;
  if (theme.neon) {
    neonMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65),
      new THREE.MeshBasicMaterial({ map: track(neonTexture(theme.neon.text, theme.neon.color)), transparent: true }));
    neonMesh.position.set(5.6, 2.5, -D / 2 + 0.09);
    group.add(neonMesh);
    const neonLight = new THREE.PointLight(theme.neon.color, 6, 6);
    neonLight.position.set(5.6, 2.5, -D / 2 + 0.6);
    group.add(neonLight);
  }

  // wall art on right wall
  const wallArtDepth = wallArtDepths(W);
  for (let i = 0; i < (theme.openAir ? 0 : 4); i++) {
    const artMap = track(artTexture('#' + theme.accent.toString(16).padStart(6, '0')));
    artMap.anisotropy = 8;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.95),
      new THREE.MeshStandardMaterial({
        map: artMap,
        roughness: 0.9,
        // A small depth bias is a second line of defence if the frame or wall
        // dimensions are adjusted later. The physical gap does the real work.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }));
    art.rotation.y = -Math.PI / 2;
    art.position.set(wallArtDepth.artX, 1.8, -3.8 + i * 2.3);
    art.castShadow = false;
    art.receiveShadow = false;
    art.renderOrder = 1;
    art.userData.wallArtwork = true;
    group.add(art);
    const frame = box(0.04, 1.05, 0.85, woodDarkMat);
    frame.position.set(wallArtDepth.frameCenterX, 1.8, -3.8 + i * 2.3);
    group.add(frame);
  }

  // ---------- tables + seats ----------
  const seats = [];      // {pos, look, tableCenter}
  const seatMeshes = []; // raycast targets
  const cups = [];       // for steam
  const tableSurfaceProps = [];

  function registerTableProp(surfaceProps, object) {
    if (!object) return object;
    object.traverse((part) => { part.userData.tableSurfaceProp = true; });
    surfaceProps.push({ object, home: object.position.clone() });
    return object;
  }

  // The standard café chair used to be seven separate meshes, repeated more
  // than thirty times in the larger rooms. Four instanced batches preserve the
  // rounded silhouette and proper shadows while turning ~230 chair draw calls
  // into four. Lounge chairs and authored bar stools stay individual because
  // their models and materials vary.
  const maxStandardChairs = 64;
  const chairSeatGeometry = new RoundedBoxGeometry(0.42, 0.05, 0.42, 2, 0.011);
  const chairCushionGeometry = new RoundedBoxGeometry(0.38, 0.045, 0.38, 2, 0.01);
  const chairBackBatchGeometry = chairBackGeometry().clone();
  const chairLegGeometry = new THREE.BoxGeometry(0.04, 0.45, 0.04);
  const chairSeatBatch = new THREE.InstancedMesh(chairSeatGeometry, woodMat, maxStandardChairs);
  const chairCushionBatch = new THREE.InstancedMesh(chairCushionGeometry, cushionMat, maxStandardChairs);
  const chairBackBatch = new THREE.InstancedMesh(chairBackBatchGeometry, woodMat, maxStandardChairs);
  const chairLegBatch = new THREE.InstancedMesh(chairLegGeometry, woodMat, maxStandardChairs * 4);
  const chairBatches = [chairSeatBatch, chairCushionBatch, chairBackBatch, chairLegBatch];
  chairBatches.forEach((batch) => {
    batch.count = 0;
    batch.castShadow = true;
    batch.receiveShadow = true;
    group.add(batch);
  });
  chairSeatBatch.userData.seatIndices = [];
  const chairRootMatrix = new THREE.Matrix4();
  const chairLocalMatrix = new THREE.Matrix4();
  const chairWorldMatrix = new THREE.Matrix4();
  const chairQuaternion = new THREE.Quaternion();
  const chairScale = new THREE.Vector3(1, 1, 1);
  let standardChairCount = 0;

  function setChairPart(batch, index, root, position) {
    chairLocalMatrix.compose(position, new THREE.Quaternion(), chairScale);
    chairWorldMatrix.multiplyMatrices(root, chairLocalMatrix);
    batch.setMatrixAt(index, chairWorldMatrix);
    batch.count = Math.max(batch.count, index + 1);
  }

  function addStandardChair(position, yaw) {
    const index = standardChairCount++;
    chairQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    chairRootMatrix.compose(position, chairQuaternion, chairScale);
    setChairPart(chairSeatBatch, index, chairRootMatrix, new THREE.Vector3(0, 0.45, 0));
    setChairPart(chairCushionBatch, index, chairRootMatrix, new THREE.Vector3(0, 0.49, 0));
    setChairPart(chairBackBatch, index, chairRootMatrix, new THREE.Vector3(0, 0.72, -0.19));
    [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach(([x, z], leg) => {
      setChairPart(chairLegBatch, index * 4 + leg, chairRootMatrix, new THREE.Vector3(x, 0.225, z));
    });
    return { isInstancedSeat: true, batch: chairSeatBatch, instanceId: index, visible: true };
  }

  function addSeat(chair, seatPos, lookAt, tableCenter, tableTopY = 0.81, surfaceProps = []) {
    if (chair.isInstancedSeat) {
      chair.batch.userData.seatIndices[chair.instanceId] = seats.length;
      if (!seatMeshes.includes(chair.batch)) seatMeshes.push(chair.batch);
    } else {
      chair.traverse((o) => { o.userData.seatIndex = seats.length; });
      chair.userData.seatIndex = seats.length;
      seatMeshes.push(chair);
    }
    const away = new THREE.Vector3().subVectors(seatPos, tableCenter).setY(0);
    if (away.lengthSq() < 0.0001) away.set(0, 0, 1);
    away.normalize();
    const approach = seatPos.clone().addScaledVector(away, 0.38);
    const facingYaw = Math.atan2(tableCenter.x - seatPos.x, tableCenter.z - seatPos.z);
    const seat = {
      pos: seatPos, look: lookAt, tableCenter, chair, tableTopY, approach, facingYaw, surfaceProps,
    };
    seats.push(seat);
    return seat;
  }

  function addTable(tx, tz, type, lounge = false, tableIndex = 0) {
    const tGroup = new THREE.Group();
    const center = new THREE.Vector3(tx, 0, tz);
    const surfaceProps = [];
    tableSurfaceProps.push(surfaceProps);
    let topY = 0.78;
    if (lounge) topY = 0.55; // lounge tables sit lower, armchair height
    if (type === 'long') {
      const top = roundedBox(1.1, 0.06, 2.6, woodMat, 0.028); top.position.y = topY; tGroup.add(top);
      for (const [lx, lz] of [[-0.45, -1.15], [0.45, -1.15], [-0.45, 1.15], [0.45, 1.15]]) {
        const leg = box(0.07, topY, 0.07, woodDarkMat);
        leg.position.set(lx, topY / 2, lz); tGroup.add(leg);
      }
    } else if (type === 'square') {
      const top = roundedBox(0.95, 0.055, 0.95, woodMat, 0.026); top.position.y = topY; tGroup.add(top);
      for (const [lx, lz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
        const leg = box(0.06, topY, 0.06, woodDarkMat);
        leg.position.set(lx, topY / 2, lz); tGroup.add(leg);
      }
    } else {
      const roundRadius = lounge ? 0.46 : 0.52;
      const top = cyl(roundRadius, roundRadius, 0.05, woodMat, 24); top.position.y = topY; tGroup.add(top);
      // rounded edge trim on round tables
      const rim = new THREE.Mesh(new THREE.TorusGeometry(roundRadius, 0.024, 8, 28), woodDarkMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = topY;
      tGroup.add(rim);
      const pole = cyl(0.05, 0.05, topY, woodDarkMat); pole.position.y = topY / 2; tGroup.add(pole);
      const base = cyl(0.3, 0.34, 0.04, woodDarkMat, 20); base.position.y = 0.02; tGroup.add(base);
    }
    tGroup.position.set(tx, 0, tz);
    group.add(tGroup);

    // seating: armchairs around lounge tables, chairs everywhere else
    const chairDefs = type === 'long'
      ? [[-0.95, -0.7], [-0.95, 0.7], [0.95, -0.7], [0.95, 0.7]]
      : lounge
        // A lounge vignette is a pair of armchairs across a low coffee table.
        // Three large chairs crowded the table and read as a second white
        // table underneath it when seen from the window-bar viewpoint.
        ? [[0, -1.22], [0, 1.22]]
        : [[0, -0.85], [0, 0.85], [-0.85, 0], [0.85, 0]].slice(0, type === 'square' ? 4 : 3);
    for (const [cx, cz] of chairDefs) {
      const px = tx + cx, pz = tz + cz;
      const facingYaw = Math.atan2(tx - px, tz - pz);
      const chair = lounge
        ? makeArmchair(cushionMat, woodDarkMat, models)
        : addStandardChair(new THREE.Vector3(px, 0, pz), facingYaw);
      if (lounge) {
        chair.position.set(px, 0, pz);
        chair.scale.multiplyScalar(0.9);
        chair.lookAt(tx, 0, tz);
        group.add(chair);
      }
      addSeat(chair,
        new THREE.Vector3(px, 0, pz),
        new THREE.Vector3(tx, 1.08, tz), // near eye level, so the room stays in view
        center, topY + 0.03, surfaceProps);
    }
    // Base place setting. Positions are reserved around the later curated
    // vignette instead of independently randomized, which previously allowed
    // cups, flowers, magazines and pastries to spawn inside one another.
    const vignette = tableIndex % 4;
    const cup = makeDrink(theme.accent, models);
    cup.position.set(tx - (lounge ? 0.18 : 0.24), topY + 0.03, tz - (lounge ? 0.04 : 0.12));
    group.add(cup);
    cups.push(cup);
    registerTableProp(surfaceProps, cup);
    // Only the deliberately sparse fourth vignette gets a pastry plate.
    if (!lounge && vignette === 3) {
      const plate = makePastryPlate(models);
      plate.position.set(tx + 0.02, topY + 0.028, tz + 0.18);
      plate.rotation.y = rand(0, Math.PI * 2);
      group.add(plate);
      registerTableProp(surfaceProps, plate);
    }
  }

  theme.tables.forEach((t, tableIndex) => addTable(t.x, t.z, t.type, !!t.lounge, tableIndex));
  chairBatches.forEach((batch) => {
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
  });

  // window bar with stools, looking out the front window
  if (theme.windowBar) {
    const looseBarProps = [];
    if (theme.id === 'goldenhour') {
      // somebody's vintage writing spot at the end of the bar
      const tw = cloneModel(models, 'typewriter');
      if (tw) {
        tw.position.set(-7.2, 1.03, D / 2 - 0.45);
        tw.rotation.y = Math.PI + rand(-0.15, 0.15);
        group.add(tw);
        registerTableProp(looseBarProps, tw);
        const paper = makeNewspaper();
        paper.position.set(-6.7, 1.035, D / 2 - 0.42);
        paper.rotation.y = rand(0, Math.PI * 2);
        group.add(paper);
        registerTableProp(looseBarProps, paper);
      }
    }
    for (const s of [-1, 1]) {
      const barLen = (W - doorW) / 2 - 1.3;
      const bx = s * (doorW / 2 + 0.65 + barLen / 2);
      const bar = box(barLen, 0.05, 0.42, woodMat);
      bar.position.set(bx, 1.0, D / 2 - 0.45);
      group.add(bar);
      for (const [lx] of [[-barLen / 2 + 0.2], [barLen / 2 - 0.2]]) {
        const leg = box(0.05, 1.0, 0.36, woodDarkMat);
        leg.position.set(bx + lx, 0.5, D / 2 - 0.45);
        group.add(leg);
      }
      const nStools = Math.floor(barLen / 1.1);
      for (let i = 0; i < nStools; i++) {
        const sx = bx - barLen / 2 + (i + 0.5) * (barLen / nStools);
        const surfaceProps = [];
        const stool = cloneModel(models, 'bar_stool') ?? makeStool(woodDarkMat, cushionMat);
        stool.position.set(sx, 0, D / 2 - 1.05);
        group.add(stool);
        addSeat(stool,
          new THREE.Vector3(sx, 0.15, D / 2 - 1.05),
          new THREE.Vector3(sx, 1.5, D / 2 + 3),
          new THREE.Vector3(sx, 0, D / 2 - 0.45),
          1.035, surfaceProps);
        if (Math.random() < 0.5) {
          const cup = makeDrink(theme.accent, models);
          cup.position.set(sx + rand(-0.1, 0.1), 1.03, D / 2 - 0.45);
          group.add(cup);
          cups.push(cup);
          registerTableProp(surfaceProps, cup);
        }
      }
    }
    // Attach authored bar props to the nearest workstation so the same
    // laptop-clearance rule applies to typewriters, papers and future props.
    for (const entry of looseBarProps) {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const seat of seats) {
        if (seat.pos.y <= 0.05) continue;
        const distance = Math.abs(seat.tableCenter.x - entry.home.x);
        if (distance < nearestDistance) { nearest = seat; nearestDistance = distance; }
      }
      nearest?.surfaceProps.push(entry);
    }
  }

  // plants
  const plantSpots = [
    [-W / 2 + 0.7, -D / 2 + 0.7], [W / 2 - 0.7, D / 2 - 1.3], [W / 2 - 0.6, -D / 2 + 3.0],
    [-W / 2 + 0.6, 3.6], [-W / 2 + 0.6, -2.0], [W / 2 - 0.6, 0.4],
    [3.8, -5.0], [-3.6, -5.0], [-0.9, 5.6],
  ];
  for (let i = 0; i < Math.min(theme.plants, plantSpots.length); i++) {
    // alternate downloaded plant models with procedural ones for variety
    const fromLib = i % 2 === 0 ? cloneModel(models, 'plant') : null;
    const p = fromLib ?? makePlant(theme.woodDark, { pot: plantPotMat, leaf: foliageMat });
    p.position.set(plantSpots[i][0], 0, plantSpots[i][1]);
    p.scale.setScalar(fromLib ? rand(1.0, 1.5) : rand(1.2, 2.0));
    group.add(p);
  }

  // rugs under the seating clusters
  const rugTex = track(rugTexture(theme.accent, theme.woodDark));
  const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1, bumpMap: rugTex, bumpScale: 0.004 });
  for (const [rx, rz, rr] of [[-4.9, -0.4, 2.5], [4.9, -0.2, 2.0]]) {
    const rug = new THREE.Mesh(new THREE.CircleGeometry(rr, 36), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(rx, 0.01, rz);
    rug.receiveShadow = true;
    group.add(rug);
    const rim = new THREE.Mesh(new THREE.RingGeometry(rr - 0.12, rr, 36),
      new THREE.MeshStandardMaterial({ color: theme.woodDark, roughness: 1 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(rx, 0.012, rz);
    group.add(rim);
  }

  // ---------- grounding & set dressing ----------

  // soft contact shadows under furniture
  const blobTex = track(canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }));
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: blobTex, transparent: true, depthWrite: false, opacity: 0.34,
  });
  function contactShadow(x, z, size) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      contactShadowMat,
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    group.add(m);
  }
  for (const t of theme.tables) contactShadow(t.x, t.z, t.type === 'long' ? 3.4 : 2.4);
  contactShadow(-0.6, -D / 2 + 1.3, 7.5);

  // Curated table vignettes. Repeating a handful of believable arrangements
  // reads as hospitality styling; independent random props read as clutter.
  const candleFlames = [];
  theme.tables.forEach((tt, ti) => {
    const surfaceProps = tableSurfaceProps[ti];
    // Lounge tables are intentionally coffee-table height. Their curated
    // place settings must use that lower surface instead of the standard
    // dining-table height, or they appear to float 25 cm above the top.
    const topY = tt.lounge ? 0.575 : tt.type === 'round' ? 0.805 : 0.81;
    if (tt.lounge) {
      // Lounge tables stay intentionally sparse: one drink from addTable and
      // a slim reading stack opposite it. This keeps the low surface visible.
      const mags = makeMagazineStack();
      mags.scale.setScalar(0.72);
      mags.position.set(tt.x + 0.15, topY + 0.02, tt.z + 0.08);
      mags.rotation.y = -0.18;
      group.add(mags);
      registerTableProp(surfaceProps, mags);
      return;
    }
    if (ti % 2 === 0) {
      const napkins = box(0.09, 0.07, 0.05, metalMat);
      napkins.position.set(tt.x + 0.24, topY + 0.035, tt.z - 0.12);
      group.add(napkins);
      registerTableProp(surfaceProps, napkins);
    }
    const sugar = cyl(0.03, 0.03, 0.08, ceramicMat, 10);
    sugar.position.set(tt.x + 0.28, topY + 0.04, tt.z + 0.08);
    group.add(sugar);
    registerTableProp(surfaceProps, sugar);
    const vignette = ti % 4;
    if (vignette === 0) {
      // Water tumbler and a folded menu beside a laptop-friendly seat.
      const glass = cyl(0.032, 0.027, 0.09, new THREE.MeshPhysicalMaterial({
        color: 0xdcecf0, transmission: 0.7, transparent: true, opacity: 0.48,
        roughness: 0.08, thickness: 0.01, depthWrite: false,
      }), 18);
      glass.position.set(tt.x - 0.24, topY + 0.045, tt.z + 0.12);
      group.add(glass);
      registerTableProp(surfaceProps, glass);
      const menu = box(0.18, 0.008, 0.11, paperMat);
      menu.position.set(tt.x + 0.05, topY + 0.006, tt.z + 0.2);
      menu.rotation.y = -0.22;
      group.add(menu);
      registerTableProp(surfaceProps, menu);
    } else if (vignette === 1) {
      // A tiny ceramic bud vase makes the setting feel intentionally dressed.
      const vase = new THREE.Group();
      const body = cyl(0.034, 0.042, 0.11, glazedCeramicMat, 18); body.position.y = 0.055; vase.add(body);
      for (const a of [-0.12, 0.08]) {
        const stem = cyl(0.004, 0.004, 0.18, stemMat, 6);
        stem.position.set(a * 0.18, 0.18, 0); stem.rotation.z = a; vase.add(stem);
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), foliageMat);
        leaf.scale.set(0.65, 0.24, 1.35);
        leaf.rotation.z = a * 3;
        leaf.position.set(-a * 0.14, 0.265, 0); vase.add(leaf);
      }
      vase.position.set(tt.x - 0.08, topY, tt.z - 0.16);
      group.add(vase);
      registerTableProp(surfaceProps, vase);
    } else if (vignette === 2) {
      const linen = box(0.16, 0.006, 0.12, cushionMat);
      linen.position.set(tt.x - 0.13, topY + 0.005, tt.z + 0.18);
      linen.rotation.y = 0.34;
      group.add(linen);
      registerTableProp(surfaceProps, linen);
    }
    if (theme.candles) {
      const candleX = vignette === 1 ? 0.12 : -0.05;
      const candleSet = new THREE.Group();
      const candle = cyl(0.022, 0.025, 0.05, waxMat, 8);
      candle.position.y = 0.025;
      candleSet.add(candle);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: steamTexture(), color: 0xffa33e, transparent: true, opacity: 0.9, depthWrite: false,
      }));
      flame.scale.setScalar(0.06);
      flame.position.y = 0.075;
      candleSet.add(flame);
      candleSet.position.set(tt.x + candleX, topY, tt.z - 0.22);
      group.add(candleSet);
      // Candle and flame move as one object when a laptop clears the table.
      registerTableProp(surfaceProps, candleSet);
      candleFlames.push(flame);
    }
  });

  // a working wall clock on the right wall
  const rightWallDecor = rightWallDecorLayout();
  const clockGroup = new THREE.Group();
  {
    const face = cyl(0.28, 0.28, 0.04, ceramicMat, 24);
    face.rotation.x = Math.PI / 2;
    clockGroup.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 8, 24), woodDarkMat);
    clockGroup.add(rim);
    const mkHand = (len, w) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.01), woodDarkMat);
      h.geometry.translate(0, len / 2, 0);
      h.position.z = 0.03;
      clockGroup.add(h);
      return h;
    };
    clockGroup.userData.hourHand = mkHand(0.14, 0.02);
    clockGroup.userData.minHand = mkHand(0.2, 0.014);
    if (theme.openAir) {
      // hangs on the kiosk face instead — there is no right wall out here
      clockGroup.position.set(-4.9, 2.75, -D / 2 + 0.22);
    } else {
      clockGroup.position.set(
        W / 2 - 0.12,
        rightWallDecor.clock.y,
        rightWallDecor.clock.z,
      );
      clockGroup.rotation.y = -Math.PI / 2;
    }
    group.add(clockGroup);
  }

  // ceiling fan for the roastery
  let fan = null;
  if (theme.fan) {
    fan = new THREE.Group();
    const pole = cyl(0.02, 0.02, 0.5, woodDarkMat, 8);
    pole.position.y = H - 0.25;
    group.add(pole);
    for (let b = 0; b < 4; b++) {
      const blade = box(1.0, 0.02, 0.14, woodMat);
      blade.position.x = 0.55;
      const holder = new THREE.Group();
      holder.rotation.y = (b / 4) * Math.PI * 2;
      holder.add(blade);
      fan.add(holder);
    }
    fan.position.set(0, H - 0.52, 0);
    group.add(fan);
  }

  // string lights along the window header
  if (theme.stringLights) {
    const bulbMat2 = new THREE.MeshBasicMaterial({ color: 0xffcf8a });
    for (let i = 0; i < 22; i++) {
      const x = -W / 2 + 0.6 + (i / 21) * (W - 1.2);
      const sag = Math.sin((i / 21) * Math.PI * 6) * 0.05;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), bulbMat2);
      b.position.set(x, headY + 0.12 + sag, D / 2 - 0.2);
      group.add(b);
    }
  }

  // sunbeam shafts through the front windows
  if (shouldRenderSunShafts(theme)) {
    const shaftTex = track(canvasTexture(64, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,205,140,0.55)');
      grad.addColorStop(1, 'rgba(255,205,140,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }));
    for (const sx of [-5.4, -2.6, 3.0, 6.0]) {
      const shaft = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 5.2),
        new THREE.MeshBasicMaterial({
          map: shaftTex, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      shaft.position.set(sx, headY - 1.1, D / 2 - 1.9);
      shaft.rotation.x = 0.62;
      group.add(shaft);
    }
  }

  // rain streaks running down the glass at night
  let glassStreaks = null;
  if (theme.rain) {
    const streakTex = track(canvasTexture(256, 256, (g, w, h) => {
      for (let i = 0; i < 90; i++) {
        const x = rand(0, w), y = rand(0, h), len = rand(8, 42);
        g.strokeStyle = `rgba(200,220,255,${rand(0.08, 0.3)})`;
        g.lineWidth = rand(0.5, 1.6);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y + len); g.stroke();
      }
    }));
    streakTex.wrapS = streakTex.wrapT = THREE.RepeatWrapping;
    glassStreaks = [];
    const streakMat = new THREE.MeshBasicMaterial({
      map: streakTex, transparent: true, opacity: 0.35, depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const half = (W - doorW) / 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(half - 1.1, winH), streakMat);
      m.position.set(s * (doorW / 2 + half / 2), sillY + winH / 2, D / 2 - 0.1);
      m.rotation.y = Math.PI;
      group.add(m);
      glassStreaks.push(m);
    }
    const mL = new THREE.Mesh(new THREE.PlaneGeometry(D - 1.1, winH), streakMat);
    mL.position.set(-W / 2 + 0.1, sillY + winH / 2, 0);
    mL.rotation.y = Math.PI / 2;
    group.add(mL);
    glassStreaks.push(mL);
    glassStreaks.tex = streakTex;
  }

  // ---------- theme signature decor ----------

  // Architectural surface details give each room an identity beyond palette.
  if (theme.id === 'roastery') {
    const tile = new THREE.MeshStandardMaterial({ color: 0xe9ebe7, roughness: 0.24, metalness: 0 });
    const tiles = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.34, 0.16, 0.018, 1, 0.008),
      tile,
      6 * 22,
    );
    const tileMatrix = new THREE.Matrix4();
    let tileIndex = 0;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 22; col++) {
        tileMatrix.makeTranslation(
          -4.0 + col * 0.37 + (row % 2) * 0.18,
          1.25 + row * 0.19,
          -D / 2 + 0.17,
        );
        tiles.setMatrixAt(tileIndex++, tileMatrix);
      }
    }
    tiles.receiveShadow = true;
    group.add(tiles);
  } else if (theme.id === 'midnight') {
    const velvet = new THREE.MeshStandardMaterial({ color: 0x241c22, roughness: 1, map: clothTex, bumpMap: clothTex, bumpScale: 0.008 });
    for (const x of [-4.8, -3.8, 3.8, 4.8]) {
      const panel = box(0.72, 1.25, 0.055, velvet);
      panel.position.set(x, 2.15, -D / 2 + 0.18);
      group.add(panel);
    }
  } else {
    const rail = box(6.8, 0.055, 0.07, woodDarkMat);
    rail.position.set(0.1, 1.75, -D / 2 + 0.19);
    group.add(rail);
  }

  // Give the quiet end of the back wall a single, legible purpose in every
  // room. These are composed as compact hospitality stations rather than
  // scattered props, and repeated details are instanced to keep draw calls low.
  const signatureZ = -D / 2 + 0.6;
  const makePlaque = (lines, ink, paper, width = 1.45, height = 0.62) => {
    const tex = track(canvasTexture(384, 164, (g, w, h) => {
      g.fillStyle = paper; g.fillRect(0, 0, w, h);
      g.strokeStyle = ink; g.lineWidth = 7; g.strokeRect(9, 9, w - 18, h - 18);
      g.fillStyle = ink; g.textAlign = 'center';
      lines.forEach((line, i) => {
        g.font = i === 0 ? 'bold 34px Georgia' : '18px Arial';
        g.fillText(line, w / 2, 61 + i * 38);
      });
    }));
    return new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
    );
  };

  if (theme.id === 'goldenhour') {
    // A dedicated filter-coffee bar: fitted joinery, a small ceramic library,
    // and one working pour-over setup. It balances the heavy service counter.
    const station = new THREE.Group();
    const ceramic = new THREE.MeshStandardMaterial({ color: 0xd5c4a4, roughness: 0.34, metalness: 0 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xa77a3c, roughness: 0.34, metalness: 0.86 });
    const cabinet = box(2.05, 0.76, 0.46, woodMat); cabinet.position.y = 0.38; station.add(cabinet);
    const top = box(2.15, 0.055, 0.54, counterTopMat); top.position.y = 0.79; station.add(top);
    for (const sx of [-0.98, 0.98]) {
      const side = box(0.055, 1.0, 0.3, woodDarkMat); side.position.set(sx, 1.35, -0.08); station.add(side);
    }
    for (const sy of [1.02, 1.7]) {
      const shelf = box(2.02, 0.045, 0.32, woodDarkMat); shelf.position.set(0, sy, -0.08); station.add(shelf);
    }
    const jarGeo = new THREE.CylinderGeometry(0.105, 0.11, 0.23, 12);
    const jars = new THREE.InstancedMesh(jarGeo, ceramic, 5);
    const matrix = new THREE.Matrix4();
    [-0.72, -0.36, 0, 0.36, 0.72].forEach((x, i) => {
      matrix.makeTranslation(x, 1.16, -0.08); jars.setMatrixAt(i, matrix);
    });
    station.add(jars);
    const standStem = cyl(0.015, 0.015, 0.38, brass, 8); standStem.position.set(0.45, 1.01, 0.02); station.add(standStem);
    const standArm = box(0.35, 0.025, 0.025, brass); standArm.position.set(0.29, 1.18, 0.02); station.add(standArm);
    const dripper = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.16, 14, 1, true), ceramic);
    dripper.rotation.x = Math.PI; dripper.position.set(0.13, 1.11, 0.02); station.add(dripper);
    const plaque = makePlaque(['FILTER BAR', 'single origin · hand brewed'], '#4b3523', '#e9ddc6');
    plaque.position.set(0, 2.12, -0.22); station.add(plaque);
    const kettle = cloneModel(models, 'teapot');
    if (kettle) { kettle.position.set(-0.52, 0.84, 0.03); kettle.scale.multiplyScalar(0.82); station.add(kettle); }
    station.position.set(5.25, 0, signatureZ);
    group.add(station);
    contactShadow(5.25, signatureZ, 2.35);
    extraColliders.push({ x: 5.25, z: signatureZ, r: 1.05 });
  } else if (theme.id === 'roastery') {
    // A green-bean sample library explains what this café actually roasts.
    // Opaque jars read more cleanly than costly transmissive glass at this scale.
    const station = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x555a5f, roughness: 0.34, metalness: 0.88 });
    const beanMat = new THREE.MeshStandardMaterial({ color: 0x9a8350, roughness: 0.82 });
    const cabinet = box(2.1, 0.78, 0.48, steel); cabinet.position.y = 0.39; station.add(cabinet);
    const top = box(2.18, 0.045, 0.54, counterTopMat); top.position.y = 0.8; station.add(top);
    const shelf = box(2.08, 0.04, 0.32, steel); shelf.position.set(0, 1.35, -0.08); station.add(shelf);
    const jarGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 12);
    const jars = new THREE.InstancedMesh(jarGeo, beanMat, 8);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 4);
      matrix.makeTranslation(-0.7 + (i % 4) * 0.46, 0.98 + row * 0.55, -0.02);
      jars.setMatrixAt(i, matrix);
    }
    station.add(jars);
    const bowls = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.09, 0.07, 14),
      ceramicMat,
      3
    );
    [-0.42, 0, 0.42].forEach((x, i) => {
      matrix.makeTranslation(x, 0.86, 0.08); bowls.setMatrixAt(i, matrix);
    });
    station.add(bowls);
    const plaque = makePlaque(['GREEN COFFEE', 'Ethiopia · Colombia · House'], '#ece8da', '#303338');
    plaque.position.set(0, 2.05, -0.22); station.add(plaque);
    station.position.set(5.25, 0, signatureZ);
    group.add(station);
    contactShadow(5.25, signatureZ, 2.35);
    extraColliders.push({ x: 5.25, z: signatureZ, r: 1.05 });
  } else if (theme.id === 'midnight') {
    // A restrained upright piano beneath the neon makes the jazz identity
    // spatial, not just musical. Keys are instanced into two draw calls.
    const piano = new THREE.Group();
    const lacquer = new THREE.MeshStandardMaterial({ color: 0x171416, roughness: 0.2, metalness: 0 });
    const ivory = new THREE.MeshStandardMaterial({ color: 0xe3ddcf, roughness: 0.38, metalness: 0 });
    const ebony = new THREE.MeshStandardMaterial({ color: 0x111014, roughness: 0.3, metalness: 0 });
    const body = roundedBox(1.55, 1.18, 0.42, lacquer, 0.035); body.position.y = 0.83; piano.add(body);
    const keyboardBed = roundedBox(1.68, 0.08, 0.46, lacquer, 0.025); keyboardBed.position.set(0, 0.94, 0.25); piano.add(keyboardBed);
    const whiteKeys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.074, 0.026, 0.32), ivory, 21);
    const blackKeys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.046, 0.045, 0.2), ebony, 15);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 21; i++) {
      matrix.makeTranslation(-0.74 + i * 0.074, 1.0, 0.36); whiteKeys.setMatrixAt(i, matrix);
    }
    const blackPattern = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12, 14, 15, 17, 18, 19];
    blackPattern.forEach((key, i) => {
      matrix.makeTranslation(-0.703 + key * 0.074, 1.035, 0.29); blackKeys.setMatrixAt(i, matrix);
    });
    piano.add(whiteKeys, blackKeys);
    for (const lx of [-0.59, 0.59]) {
      const leg = box(0.09, 0.68, 0.09, lacquer); leg.position.set(lx, 0.34, 0.08); piano.add(leg);
    }
    const musicRest = box(0.72, 0.42, 0.035, lacquer); musicRest.position.set(0, 1.36, 0.24); musicRest.rotation.x = -0.12; piano.add(musicRest);
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.92, side: THREE.DoubleSide }),
    );
    sheet.position.set(0, 1.39, 0.265); sheet.rotation.x = -0.12; piano.add(sheet);
    const pedalMat = new THREE.MeshStandardMaterial({ color: 0xa57b3e, roughness: 0.32, metalness: 0.85 });
    for (const x of [-0.09, 0.09]) {
      const pedal = roundedBox(0.08, 0.025, 0.18, pedalMat, 0.01, 1);
      pedal.position.set(x, 0.12, 0.34); piano.add(pedal);
    }
    const benchTop = box(0.75, 0.12, 0.34, new THREE.MeshStandardMaterial({ color: 0x3f2830, roughness: 0.8, map: clothTex }));
    benchTop.position.set(0, 0.5, 0.98); piano.add(benchTop);
    for (const x of [-0.27, 0.27]) {
      const leg = box(0.065, 0.46, 0.065, lacquer); leg.position.set(x, 0.23, 0.98); piano.add(leg);
    }
    piano.position.set(5.4, 0, signatureZ);
    group.add(piano);
    contactShadow(5.4, signatureZ + 0.25, 2.5);
    extraColliders.push({ x: 5.4, z: signatureZ + 0.22, r: 1.1 });
  } else if (theme.id === 'terrace') {
    // A working herb bench connects the terrace greenery to the drinks menu.
    const bench = new THREE.Group();
    const terracotta = new THREE.MeshStandardMaterial({ color: 0x9e6144, roughness: 0.96, metalness: 0 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x4f7049, roughness: 0.98, metalness: 0 });
    const top = box(2.25, 0.1, 0.62, woodMat); top.position.y = 0.82; bench.add(top);
    const lower = box(2.05, 0.07, 0.5, woodDarkMat); lower.position.y = 0.28; bench.add(lower);
    for (const x of [-0.91, 0.91]) {
      const leg = box(0.1, 0.82, 0.1, woodDarkMat); leg.position.set(x, 0.41, 0); bench.add(leg);
    }
    const pots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.11, 0.22, 12), terracotta, 5);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 5; i++) {
      matrix.makeTranslation(-0.76 + i * 0.38, i < 3 ? 0.97 : 0.43, i < 3 ? 0 : -0.02);
      pots.setMatrixAt(i, matrix);
    }
    bench.add(pots);
    const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), leaf, 12);
    for (let i = 0; i < 12; i++) {
      const pot = i % 3;
      const scale = new THREE.Vector3(0.7, 1.4, 0.5);
      const position = new THREE.Vector3(-0.76 + pot * 0.38 + ((i % 2) - 0.5) * 0.08, 1.17 + Math.floor(i / 6) * 0.08, ((i % 4) - 1.5) * 0.035);
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 0.8, (i % 2 ? 1 : -1) * 0.35));
      matrix.compose(position, quaternion, scale); leaves.setMatrixAt(i, matrix);
    }
    bench.add(leaves);
    const plaque = makePlaque(['HERB BENCH', 'mint · rosemary · lemon thyme'], '#385239', '#ddd9bf');
    plaque.position.set(0, 1.75, -0.24); bench.add(plaque);
    bench.position.set(5.2, 0, signatureZ);
    group.add(bench);
    contactShadow(5.2, signatureZ, 2.45);
    extraColliders.push({ x: 5.2, z: signatureZ, r: 1.05 });
  }

  // exposed wooden ceiling beams (golden hour)
  if (theme.beams) {
    for (const bx of [-6.2, -2.6, 1.0, 4.6]) {
      const beam = box(0.2, 0.26, D, woodDarkMat);
      beam.position.set(bx, H - 0.13, 0);
      group.add(beam);
    }
    const spine = box(W, 0.26, 0.2, woodDarkMat);
    spine.position.set(0, H - 0.14, -0.4);
    group.add(spine);
  }

  // industrial ductwork + steel beams (roastery)
  if (theme.ducts) {
    const ductMat = new THREE.MeshStandardMaterial({ color: 0x8b8e91, roughness: 0.38, metalness: 0.82 });
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, W - 2, 14), ductMat);
    duct.rotation.z = Math.PI / 2;
    duct.position.set(0, H - 0.45, -2.4);
    group.add(duct);
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 14), ductMat);
    elbow.position.set(-(W - 2) / 2 + 0.14, H - 0.45 - 0.4, -2.4);
    group.add(elbow);
    for (const bz of [1.6, 4.4]) {
      const steel = box(W, 0.2, 0.14, new THREE.MeshStandardMaterial({ color: 0x303338, roughness: 0.42, metalness: 0.78 }));
      steel.position.set(0, H - 0.1, bz);
      group.add(steel);
    }
  }

  // a big coffee roaster in the corner (roastery)
  if (theme.roaster) {
    // supply crates stacked beside the roaster, one tipped with bean bags
    for (const [cx2, cz2, cy2, ry2] of [[-7.6, -4.6, 0, 0.15], [-7.0, -4.7, 0, -0.3], [-7.3, -4.65, 0.42, 0.55]]) {
      const crate = cloneModel(models, 'crate');
      if (!crate) break;
      crate.position.set(cx2, cy2, cz2);
      crate.rotation.y = ry2;
      group.add(crate);
      if (cy2 === 0) extraColliders.push({ x: cx2, z: cz2, r: 0.35 });
    }
    const stand = makeCakeStand(models);
    stand.position.set(-0.55, 1.06, -D / 2 + 1.15);
    group.add(stand);
    const r = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5f6267, roughness: 0.36, metalness: 0.84 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xa88544, roughness: 0.32, metalness: 0.88 });
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 18), bodyMat);
    drum.rotation.x = Math.PI / 2;
    drum.position.y = 1.0;
    drum.castShadow = true;
    r.add(drum);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 18), brass);
    face.rotation.x = Math.PI / 2;
    face.position.set(0, 1.0, 0.46);
    r.add(face);
    const hopper = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 12), bodyMat);
    hopper.rotation.x = Math.PI;
    hopper.position.y = 1.58;
    r.add(hopper);
    const hopperTop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 12), brass);
    hopperTop.position.y = 1.79;
    r.add(hopperTop);
    const base = box(0.9, 0.55, 0.7, bodyMat);
    base.position.y = 0.28;
    r.add(base);
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18), brass);
    tray.position.set(0.65, 0.75, 0.2);
    r.add(tray);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, H - 1.9, 10), bodyMat);
    pipe.position.set(0, H - (H - 1.9) / 2 - 0.02, -0.2);
    r.add(pipe);
    r.position.set(-W / 2 + 1.3, 0, -D / 2 + 3.2);
    r.rotation.y = 0.9;
    group.add(r);
    contactShadow(-W / 2 + 1.3, -D / 2 + 3.2, 2.2);
    // burlap bean sacks beside it
    for (let i = 0; i < 3; i++) {
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x9a7f56, roughness: 1 }));
      sack.scale.set(1, 1.15, 0.85);
      sack.position.set(-W / 2 + 0.7 + i * 0.5, 0.34, -D / 2 + 4.4 + (i % 2) * 0.4);
      sack.rotation.y = rand(0, 3);
      sack.castShadow = true;
      group.add(sack);
    }
  }

  // floor-to-shoulder bookshelf on the right wall (midnight)
  if (theme.bookshelf) {
    const shelfG = new THREE.Group();
    const frameMat = woodDarkMat;
    const SW = 3.0, SH = 2.2, SD = 0.32;
    const back = box(SW, SH, 0.04, frameMat);
    back.position.set(0, SH / 2, -SD / 2);
    shelfG.add(back);
    for (const y of [0.08, 0.62, 1.16, 1.7, 2.2]) {
      const sh = box(SW, 0.05, SD, frameMat);
      sh.position.set(0, y, 0);
      shelfG.add(sh);
    }
    for (const x of [-SW / 2, SW / 2]) {
      const side = box(0.05, SH + 0.05, SD, frameMat);
      side.position.set(x, SH / 2, 0);
      shelfG.add(side);
    }
    for (const y of [0.11, 0.65, 1.19, 1.73]) {
      const row = makeBooks(Math.floor(rand(12, 17)));
      row.position.set(-SW / 2 + 0.12, y, 0);
      shelfG.add(row);
    }
    shelfG.position.set(W / 2 - 0.35, 0, 3.2);
    shelfG.rotation.y = -Math.PI / 2;
    group.add(shelfG);
    contactShadow(W / 2 - 0.5, 3.2, 1.6);
  }

  // sideboard with a spinning vinyl record (midnight)
  let vinylDisc = null;
  if (theme.vinyl) {
    const sb = new THREE.Group();
    const cab = box(1.5, 0.75, 0.5, woodMat);
    cab.position.y = 0.375;
    sb.add(cab);
    const player = box(0.55, 0.09, 0.42, woodDarkMat);
    player.position.set(-0.3, 0.8, 0);
    sb.add(player);
    vinylDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 24),
      new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.35 }));
    vinylDisc.position.set(-0.3, 0.86, 0);
    sb.add(vinylDisc);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.014, 16),
      new THREE.MeshStandardMaterial({ color: 0xb0402e, roughness: 0.6 }));
    label.position.set(-0.3, 0.861, 0);
    sb.add(label);
    const arm = box(0.02, 0.02, 0.22, metalMat);
    arm.position.set(-0.12, 0.9, 0.1);
    arm.rotation.y = 0.5;
    sb.add(arm);
    // record crate beside it
    const crate = box(0.45, 0.35, 0.4, woodDarkMat);
    crate.position.set(0.85, 0.18, 0);
    sb.add(crate);
    for (let i = 0; i < 7; i++) {
      const rec = box(0.02, 0.31, 0.31, new THREE.MeshStandardMaterial({ color: [0x2a2a30, 0x4a3040, 0x30402e, 0x403520][i % 4], roughness: 0.8 }));
      rec.position.set(0.68 + i * 0.045, 0.42, 0);
      rec.rotation.z = -0.12;
      sb.add(rec);
    }
    sb.position.set(W / 2 - 0.65, 0, -0.6);
    sb.rotation.y = -Math.PI / 2;
    group.add(sb);
    contactShadow(W / 2 - 0.65, -0.6, 1.8);
  }

  // hanging plants near the windows (golden hour)
  if (theme.hangingPlants) {
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a8a48, roughness: 0.85 });
    for (const hx of [-5.4, -1.9, 3.4, 6.0]) {
      const hp = new THREE.Group();
      const cord = cyl(0.006, 0.006, 0.8, woodDarkMat, 6);
      cord.position.y = 0.4;
      hp.add(cord);
      const pot = cyl(0.13, 0.09, 0.16, new THREE.MeshStandardMaterial({ color: 0xc9b394, roughness: 0.9 }));
      pot.position.y = -0.05;
      hp.add(pot);
      for (let i = 0; i < 6; i++) {
        const vine = cyl(0.015, 0.008, rand(0.3, 0.6), leafMat, 5);
        vine.position.set(rand(-0.1, 0.1), -0.25 - vine.geometry.parameters.height / 4, rand(-0.1, 0.1));
        vine.rotation.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
        hp.add(vine);
      }
      hp.position.set(hx, H - 1.0, D / 2 - 0.75);
      group.add(hp);
    }
  }

  // chalkboard A-frame by the door
  if (theme.chalkboard) {
    const cb = new THREE.Group();
    const boardTex = track(canvasTexture(128, 170, (g, w, h) => {
      g.fillStyle = '#26251f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#8d8b7a'; g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#e8e0c8';
      g.font = 'italic 19px Georgia'; g.textAlign = 'center';
      g.fillText('today:', w / 2, 48);
      g.font = 'bold 21px Georgia';
      g.fillText('pour over', w / 2, 84);
      g.fillText('+ banana', w / 2, 112);
      g.fillText('bread', w / 2, 138);
    }));
    for (const s of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.02),
        s === 1
          ? new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.9 })
          : woodDarkMat);
      panel.position.set(0, 0.42, s * 0.12);
      panel.rotation.x = s * -0.28;
      panel.castShadow = true;
      cb.add(panel);
    }
    cb.position.set(1.5, 0, D / 2 - 1.6);
    cb.rotation.y = -0.5;
    group.add(cb);
    contactShadow(1.5, D / 2 - 1.6, 1.0);
  }

  // warm wall sconces on the solid walls (kiosk face only, outdoors)
  {
    const sconceSpots = theme.openAir ? [
      [-3.9, 2.3, -D / 2 + 0.22, 0],
      [4.6, 2.3, -D / 2 + 0.22, 0],
    ] : [
      [W / 2 - 0.12, 2.3, -5.2, -Math.PI / 2],
      [W / 2 - 0.12, 2.3, 5.4, -Math.PI / 2],
      [-3.9, 2.3, -D / 2 + 0.12, 0],
      [4.6, 2.3, -D / 2 + 0.12, 0],
    ];
    const glowMat = new THREE.MeshBasicMaterial({ color: theme.lampColor });
    for (const [sx, sy, sz, ry] of sconceSpots) {
      const holder = new THREE.Group();
      const plate = box(0.16, 0.3, 0.03, woodDarkMat);
      holder.add(plate);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.06, 0.05);
      holder.add(glow);
      holder.position.set(sx, sy, sz);
      holder.rotation.y = ry;
      group.add(holder);
    }
  }

  // a reading nook against the right wall: sofa, floor lamp, side table
  // (indoor cafés only — the terrace keeps its perimeter green)
  if (!theme.openAir) {
    const sofa = cloneModel(models, 'sofa');
    if (sofa) {
      sofa.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.lerp(cushionMat.color, 0.88);
        o.material.roughness = 0.92;
        if (!o.material.map) { o.material.map = clothTex; o.material.bumpMap = clothTex; o.material.bumpScale = 0.006; }
      });
      sofa.position.set(W / 2 - 0.85, 0, -4.9);
      sofa.rotation.y = -Math.PI / 2;
      group.add(sofa);
      contactShadow(W / 2 - 0.85, -4.9, 2.2);
      extraColliders.push({ x: W / 2 - 0.85, z: -4.9, r: 1.0 });
    }
    const lamp = cloneModel(models, 'floor_lamp');
    if (lamp) {
      lamp.position.set(W / 2 - 0.6, 0, -3.6);
      group.add(lamp);
      const glow = new THREE.PointLight(theme.lampColor, 4, 4);
      glow.position.set(W / 2 - 0.6, 1.35, -3.6);
      group.add(glow);
      const lamp2 = cloneModel(models, 'floor_lamp');
      lamp2.position.set(-W / 2 + 0.6, 0, 1.2);
      group.add(lamp2);
    }
    // a proper bookcase for the golden hour café (midnight has its own wall)
    if (!theme.bookshelf) {
      const bc = cloneModel(models, 'bookcase');
      if (bc) {
        bc.position.set(W / 2 - 0.35, 0, -0.35);
        bc.rotation.y = -Math.PI / 2;
        group.add(bc);
        contactShadow(W / 2 - 0.5, -0.35, 1.4);
        extraColliders.push({ x: W / 2 - 0.5, z: -0.35, r: 0.8 });
        // dress the shelves — an empty bookcase reads unfinished
        for (const [sy, kind] of [[0.52, 'books'], [0.97, 'books'], [1.42, 'plant']]) {
          if (kind === 'books') {
            const row = makeBooks(6);
            row.rotation.y = Math.PI / 2;
            row.position.set(W / 2 - 0.35, sy, -0.35 + 0.22);
            group.add(row);
          } else {
            const pot = cloneModel(models, 'plant_small');
            if (pot) { pot.position.set(W / 2 - 0.35, sy, -0.5); group.add(pot); }
            const mug2 = cloneModel(models, 'mug');
            if (mug2) { mug2.position.set(W / 2 - 0.35, sy, -0.1); group.add(mug2); }
          }
        }
      }
    }
    // a peg board for coats on the right wall by the entrance
    const coats = cloneModel(models, 'coat_rack');
    if (coats) {
      coats.position.set(W / 2 - 0.10, 1.35, 4.9);
      coats.rotation.y = -Math.PI / 2;
      group.add(coats);
    }
    // a small trash bin tucked beside the counter
    const bin = cloneModel(models, 'trashcan');
    if (bin) {
      bin.position.set(3.4, 0, -D / 2 + 2.0);
      group.add(bin);
      contactShadow(3.4, -D / 2 + 2.0, 0.7);
    }
    // little potted succulents scattered on the counter and window sills
    const sillY = 0.9 + 1.9; // window head
    for (const [sx, sy, sz] of [[-3.3, 1.06, -D / 2 + 1.15], [3.0, 1.06, -D / 2 + 1.15], [-W / 2 + 0.15, sillY - 1.0, -2.5], [-W / 2 + 0.15, sillY - 1.0, 2.5]]) {
      const sm = Math.random() < 0.5 ? cloneModel(models, 'cactus_pot') : cloneModel(models, 'plant_small');
      if (sm) { sm.position.set(sx, sy, sz); sm.rotation.y = rand(0, Math.PI * 2); group.add(sm); }
    }
    // a round brass mirror above the art row
    const mirror = makeWallMirror();
    mirror.position.set(
      W / 2 - 0.1,
      rightWallDecor.mirror.y,
      rightWallDecor.mirror.z,
    );
    mirror.rotation.y = -Math.PI / 2;
    group.add(mirror);
    // a lantern on a lounge side table if we have one
    const sideT = cloneModel(models, 'side_table');
    if (sideT) {
      sideT.position.set(-5.1, 0, -0.5);
      group.add(sideT);
      contactShadow(-5.1, -0.5, 0.8);
      extraColliders.push({ x: -5.1, z: -0.5, r: 0.35 });
      // second one beside the sofa with a forgotten latte on it
      const sideT2 = cloneModel(models, 'side_table');
      sideT2.position.set(W / 2 - 0.7, 0, -6.1);
      group.add(sideT2);
      const lamp2m = cloneModel(models, 'table_lamp');
      if (lamp2m) {
        lamp2m.position.set(W / 2 - 0.7, 0.5, -6.1);
        group.add(lamp2m);
        const lg2 = new THREE.PointLight(theme.lampColor, 2.2, 3.5);
        lg2.position.set(W / 2 - 0.7, 0.95, -6.1);
        group.add(lg2);
      } else {
        const latte = cloneModel(models, 'latte') ?? cloneModel(models, 'mug');
        if (latte) {
          latte.position.set(W / 2 - 0.7, 0.5, -6.1);
          group.add(latte);
        }
      }
      const mags2 = makeMagazineStack();
      mags2.position.set(W / 2 - 0.95, 0, -5.7);
      group.add(mags2);
    }
    const lantern = cloneModel(models, 'lantern');
    if (lantern) {
      lantern.position.set(-5.1, sideT ? 0.5 : 0.56, -0.5);
      group.add(lantern);
      if (theme.candles) {
        const lg = new THREE.PointLight(theme.lampColor, 2.5, 3);
        lg.position.set(-5.1, 0.7, -0.5);
        group.add(lg);
      }
    }
    // a standing display unit near the pickup end of the counter
    const shelf = cloneModel(models, 'wall_shelf');
    if (shelf) {
      shelf.position.set(-6.5, 0, -D / 2 + 0.5);
      group.add(shelf);
      contactShadow(-6.5, -D / 2 + 0.5, 1.0);
      extraColliders.push({ x: -6.5, z: -D / 2 + 0.5, r: 0.5 });
    }
    // real pendant lamps hanging over the counter
    const counterPendant = cloneModel(models, 'pendant_lamp');
    if (counterPendant) {
      // keep clear of the menu board (x 1.15..3.25) so prices stay readable
      for (const px of [-3.4, -1.2, 0.9]) {
        const pl = cloneModel(models, 'pendant_lamp');
        pl.position.set(px, 2.15, -D / 2 + 1.15);
        group.add(pl);
        const cord = cyl(0.008, 0.008, H - 2.55, woodDarkMat, 6);
        cord.position.set(px, 2.55 + (H - 2.55) / 2, -D / 2 + 1.15);
        group.add(cord);
        const pglow = new THREE.PointLight(theme.lampColor, 1.6, 3.2);
        pglow.position.set(px, 2.25, -D / 2 + 1.15);
        group.add(pglow);
      }
    }
    // extra framed art to fill big wall gaps
    const painting = cloneModel(models, 'painting');
    if (painting) {
      painting.position.set(-W / 2 + 0.12, 2.1, -3.5);
      painting.rotation.y = Math.PI / 2;
      // The frame supplies the contact shadow; letting the thin print both
      // cast and receive a 1024px moving shadow creates a dark crawling edge.
      painting.traverse((part) => {
        if (!part.isMesh) return;
        part.castShadow = false;
        part.receiveShadow = false;
        part.userData.wallArtwork = true;
      });
      group.add(painting);
    }
  }

  // the café cat, asleep on a rug
  let cat = null;
  // the rigged pets system (pets.js) owns the cat when its model is present;
  // these built-in versions remain only as a fallback for missing assets
  const petsHandleCat = !!models?.get?.('pet_cat');
  const catModel = theme.cat !== undefined && !petsHandleCat ? cloneModel(models, 'cat') : null;
  if (catModel) {
    cat = new THREE.Group();
    cat.add(catModel);
    cat.userData.model = catModel;
    // The asset ships gloss-black (metalness 0.4, roughness 0.3 over a dark
    // map) and reads as a lump of wet plastic. Re-shade it as fur: fully
    // matte, and lift the near-black albedo with the theme's cat colour so
    // the shape reads — ears, tail and all — instead of a silhouette hole.
    catModel.traverse((o) => {
      if (!o.isMesh) return;
      const fur = o.material.clone();
      fur.metalness = 0;
      fur.roughness = 0.94;
      fur.color.set(theme.cat).multiplyScalar(1.35);
      if (fur.map) { fur.map = null; }
      fur.needsUpdate = true;
      o.material = fur;
    });
    cat.position.set(4.9, 0.02, -0.2);
    cat.rotation.y = rand(0, Math.PI * 2);
    group.add(cat);
  } else if (theme.cat !== undefined && !petsHandleCat) {
    cat = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: theme.cat, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), furMat);
    body.scale.set(1.25, 0.62, 1);
    body.position.y = 0.13;
    body.castShadow = true;
    cat.add(body);
    cat.userData.body = body;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), furMat);
    head.position.set(0.22, 0.14, 0.1);
    cat.add(head);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 6), furMat);
      ear.position.set(0.22 + s * 0.055, 0.24, 0.1);
      cat.add(ear);
    }
    // tail curled around the body
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 18, Math.PI * 1.3), furMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(-0.05, 0.04, 0.04);
    cat.add(tail);
    cat.position.set(4.9, 0.02, -0.2);
    cat.rotation.y = rand(0, Math.PI * 2);
    group.add(cat);
  }

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.set(...theme.sun.pos);
  sun.target.position.set(0, 0.8, -0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Fit the shadow frustum to the occupied room instead of spending texels on
  // the distant backdrop. A small normal bias prevents acne without making
  // chair and table legs appear to float.
  sun.shadow.camera.left = -10.5; sun.shadow.camera.right = 10.5;
  sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 32;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  group.add(sun);
  group.add(sun.target);

  // pendant lamps over the tables
  const lampLights = [];
  const shadeIsFabric = theme.pendant === 'drum';
  const shadeMat = new THREE.MeshStandardMaterial({
    color: shadeIsFabric ? 0x59483f : 0x302a26,
    roughness: shadeIsFabric ? 0.92 : 0.4,
    metalness: shadeIsFabric ? 0 : 0.72,
    emissive: theme.lampColor,
    emissiveIntensity: shadeIsFabric ? 0.07 : 0.025,
    side: THREE.DoubleSide,
  });
  const bulbMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(theme.lampColor).lerp(new THREE.Color(0xffffff), 0.28),
  });
  const litPendantCount = Math.min(theme.rain ? 8 : theme.openAir ? 4 : 6, theme.tables.length);
  const litPendantIndices = new Set(Array.from({ length: litPendantCount }, (_, index) => (
    litPendantCount === 1 ? 0 : Math.round(index * (theme.tables.length - 1) / (litPendantCount - 1))
  )));
  theme.tables.forEach((t, i) => {
    const cord = cyl(0.008, 0.008, H - theme.lampY, woodDarkMat, 6);
    cord.position.set(t.x, theme.lampY + (H - theme.lampY) / 2, t.z);
    group.add(cord);
    if (theme.pendant === 'bulb') {
      // industrial: bare Edison bulb under a small metal disc
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.04, 14), metalMat);
      disc.position.set(t.x, theme.lampY + 0.06, t.z);
      group.add(disc);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), bulbMat);
      bulb.scale.y = 1.35;
      bulb.position.set(t.x, theme.lampY - 0.03, t.z);
      group.add(bulb);
    } else if (theme.pendant === 'drum') {
      // fabric drum shade, glowing softly
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 16, 1, true), shadeMat);
      drum.position.set(t.x, theme.lampY, t.z);
      group.add(drum);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), bulbMat);
      bulb.position.set(t.x, theme.lampY - 0.04, t.z);
      group.add(bulb);
    } else {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.16, 16, 1, true), shadeMat);
      shade.position.set(t.x, theme.lampY, t.z);
      group.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), bulbMat);
      bulb.position.set(t.x, theme.lampY - 0.05, t.z);
      group.add(bulb);
    }
    if (litPendantIndices.has(i)) { // distribute practical pools across the room
      const pl = new THREE.PointLight(theme.lampColor, theme.lampIntensity, theme.rain ? 5 : 4.6, 2);
      pl.position.set(t.x, theme.lampY - 0.12, t.z);
      group.add(pl);
      lampLights.push(pl);
    }
  });

  // ---------- atmosphere particles ----------
  const steamTex = steamTexture();
  const steamSprites = [];
  for (const cup of cups) {
    if (Math.random() < 0.7) continue; // only some cups steam
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: steamTex, transparent: true, opacity: 0, depthWrite: false,
      }));
      s.scale.setScalar(0.1);
      cup.add(s);
      steamSprites.push({ sprite: s, phase: rand(0, 10), speed: rand(0.5, 0.9) });
    }
  }

  // sun dust motes
  let dust = null;
  if (theme.dust) {
    const n = 240;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-3, 7);
      pos[i * 3 + 1] = rand(0.4, 3.2);
      pos[i * 3 + 2] = rand(-1.5, 6.2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // soft round sprite so near-camera motes don't render as hard squares
    const moteTex = track(canvasTexture(32, 32, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffdda8, size: 0.02, transparent: true, opacity: 0.55, depthWrite: false,
      map: moteTex,
    }));
    group.add(dust);
  }

  // rain streaks outside the windows
  let rain = null;
  if (theme.rain) {
    const n = 500;
    const pos = new Float32Array(n * 3);
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // spread outside the front and left windows
      if (Math.random() < 0.6) {
        pos[i * 3] = rand(-W, W);
        pos[i * 3 + 1] = rand(0, 7);
        pos[i * 3 + 2] = D / 2 + rand(0.4, 2.8);
      } else {
        pos[i * 3] = -W / 2 - rand(0.4, 2.8);
        pos[i * 3 + 1] = rand(0, 7);
        pos[i * 3 + 2] = rand(-D, D);
      }
      speed[i] = rand(5, 9);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x8fa8cc, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
    }));
    rain.userData.speed = speed;
    group.add(rain);
  }

  // ---------- NPC navigation info ----------
  const nav = {
    door: new THREE.Vector3(0, 0, D / 2 - 0.4),
    doorInside: new THREE.Vector3(0, 0, D / 2 - 1.4),
    counter: new THREE.Vector3(2.2, 0, -D / 2 + 2.2),   // register spot (queue forms here)
    pickup: new THREE.Vector3(-0.7, 0, -D / 2 + 2.2),   // wait for your drink
    baristaHome: new THREE.Vector3(-1.0, 0, -D / 2 + 0.6),
    baristaRegister: new THREE.Vector3(2.2, 0, -D / 2 + 0.6),
    baristaMachine: new THREE.Vector3(-2.2, 0, -D / 2 + 0.6),
    machineWorld: new THREE.Vector3(-2.2, 1.1, -D / 2 + 1.15), // where espresso sounds come from
    corridorX: 0, // the clear vertical aisle
  };

  // circles the player can't walk through (walk mode)
  const colliders = theme.tables.map((tt) => ({
    x: tt.x, z: tt.z, r: tt.type === 'long' ? 1.5 : 1.05,
  }));
  colliders.push({ x: -0.6, z: -D / 2 + 1.15, r: 0, rect: { x0: -5.2, x1: 4.0, z0: -D / 2, z1: -D / 2 + 1.8 } });
  colliders.push(...extraColliders);
  if (theme.windowBar) {
    colliders.push({ rect: { x0: -W / 2, x1: -doorW / 2 - 0.3, z0: D / 2 - 0.9, z1: D / 2 } });
    colliders.push({ rect: { x0: doorW / 2 + 0.3, x1: W / 2, z0: D / 2 - 0.9, z1: D / 2 } });
  }

  // ---------- per-frame animation ----------
  let t = 0;
  function animate(dt) {
    t += dt;
    // a car drives past every so often
    if (passingCar) {
      const u = passingCar.userData;
      if (u.t > 0) {
        u.t -= dt;
        if (u.t <= 0) {
          u.dir = Math.random() < 0.5 ? -1 : 1;
          passingCar.position.x = -u.dir * 32;
          passingCar.position.z = D / 2 + (u.dir > 0 ? 3.9 : 6.2);
          passingCar.rotation.y = u.dir > 0 ? 0 : Math.PI;
          u.driving = true;
        }
      } else if (u.driving) {
        passingCar.position.x += u.dir * dt * rand(8.6, 9);
        if (Math.abs(passingCar.position.x) > 33) {
          u.driving = false;
          u.t = rand(9, 26);
        }
      }
    }
    for (const s of steamSprites) {
      const cycle = (t * s.speed + s.phase) % 3;
      const f = cycle / 3;
      s.sprite.position.y = 0.1 + f * 0.4;
      s.sprite.position.x = Math.sin((t + s.phase) * 1.7) * 0.03;
      s.sprite.material.opacity = f < 0.15 ? f * 2.3 : 0.35 * (1 - f);
      s.sprite.scale.setScalar(0.08 + f * 0.16);
    }
    if (dust) {
      const p = dust.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setY(i, p.getY(i) + Math.sin(t * 0.4 + i) * 0.0008);
        p.setX(i, p.getX(i) + Math.cos(t * 0.3 + i * 1.7) * 0.0006);
      }
      p.needsUpdate = true;
    }
    if (rain) {
      const p = rain.geometry.attributes.position;
      const speed = rain.userData.speed;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - speed[i] * dt;
        if (y < 0) y = 7;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    if (neonMesh) {
      // Keep the neon alive without single-frame random dropouts. The old
      // frame-dependent Math.random() dip read as a rendering fault and could
      // flash more often on faster displays.
      neonMesh.material.opacity = 0.88 + Math.sin(t * 1.6) * 0.012;
      neonMesh.material.transparent = true;
    }
    // Electric practical lights should remain steady. Continuously modulating
    // every point light made the entire room pulse, especially on PBR walls.
    lampLights.forEach((pl) => {
      pl.intensity = theme.lampIntensity;
    });
    // the clock keeps real time
    const now = new Date();
    const mins = now.getMinutes() + now.getSeconds() / 60;
    const hrs = (now.getHours() % 12) + mins / 60;
    clockGroup.userData.minHand.rotation.z = -(mins / 60) * Math.PI * 2;
    clockGroup.userData.hourHand.rotation.z = -(hrs / 12) * Math.PI * 2;
    if (fan) fan.rotation.y += dt * 2.4;
    candleFlames.forEach((f, i) => {
      // A low-amplitude, continuous flame motion preserves candle ambience
      // without producing harsh luminance changes in the surrounding scene.
      f.material.opacity = 0.78 + Math.sin(t * 5 + i * 2.4) * 0.07
        + Math.sin(t * 8.5 + i) * 0.025;
      f.scale.setScalar(0.055 + Math.sin(t * 4.2 + i * 1.7) * 0.004);
    });
    if (glassStreaks) glassStreaks.tex.offset.y -= dt * 0.045;
    if (vinylDisc) vinylDisc.rotation.y += dt * 3.5;
    if (cat) {
      // slow sleepy breathing, with the occasional ear twitch
      const breathe = 1 + Math.sin(t * 1.3) * 0.045;
      if (cat.userData.model) cat.userData.model.scale.y = breathe;
      else {
        cat.userData.body.scale.set(1.25, 0.62 * breathe, 1);
        if (Math.random() < 0.002) cat.children[2].rotation.z = rand(-0.25, 0.25);
      }
      // …and every so often the cat pads over to a new favourite spot
      const cu = cat.userData;
      if (cu.naptime === undefined) cu.naptime = rand(15, 45);
      if (cu.walkTo) {
        const dx = cu.walkTo.x - cat.position.x, dz = cu.walkTo.z - cat.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.12) {
          cu.walkTo = null;
          cu.walkT = 0;
          cu.naptime = rand(30, 90);
          cat.rotation.y = rand(0, Math.PI * 2);
        } else {
          // cats don't phase through table legs: steer around colliders
          let sx = dx / d, sz = dz / d;
          const aheadX = cat.position.x + sx * 0.5;
          const aheadZ = cat.position.z + sz * 0.5;
          for (const col of colliders) {
            if (!col.r) continue;
            const cdx = aheadX - col.x, cdz = aheadZ - col.z;
            const cd = Math.hypot(cdx, cdz);
            const rr = col.r + 0.18;
            if (cd < rr && cd > 0.001) {
              const push = (1 - cd / rr) * 1.8;
              sx += (cdx / cd) * push;
              sz += (cdz / cd) * push;
            }
          }
          const sl = Math.hypot(sx, sz) || 1;
          cat.position.x += (sx / sl) * dt * 0.45;
          cat.position.z += (sz / sl) * dt * 0.45;
          cat.rotation.y = Math.atan2(sx, sz) - Math.PI / 2;
          cat.position.y = 0.02 + Math.abs(Math.sin(t * 6)) * 0.015; // soft pad
          // steering can park the cat against a planter forever: nap there instead
          cu.walkStuck = (cu.walkStuck ?? 0) + (Math.abs(sx / sl) + Math.abs(sz / sl) < 0.2 ? dt : -cu.walkStuck);
          if ((cu.walkT = (cu.walkT ?? 0) + dt) > 40) {
            cu.walkTo = null;
            cu.walkT = 0;
            cu.naptime = rand(20, 60);
          }
        }
      } else {
        cu.naptime -= dt;
        cat.position.y = 0.02;
        if (cu.naptime <= 0) {
          cu.walkTo = pick([
            { x: 4.9, z: -0.2 }, { x: -5.4, z: 1.8 }, { x: 1.4, z: 4.1 },
            { x: -1.2, z: -3.6 }, { x: 6.2, z: 2.6 }, { x: -6.4, z: -2.2 },
          ]);
        }
      }
    }
  }

  function dispose() {
    group.traverse((o) => {
      // lights hold GPU shadow maps (the sun's is 1024–2048px); geometry and
      // material disposal alone leaked one per theme switch
      if (o.isLight) o.dispose();
      if (o.geometry && !o.geometry.userData.vibeShared && !o.geometry.userData.shared) {
        o.geometry.dispose();
      }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          for (const value of Object.values(m)) {
            if (value?.isTexture && !value.userData.vibeShared && !value.userData.shared) {
              value.dispose();
            }
          }
          if (!m.userData.vibeShared && !m.userData.shared) m.dispose();
        });
      }
    });
    disposables.forEach((d) => d.dispose());
  }

  // Forward-shaded point lights are one of the most expensive scene features:
  // every visible light is evaluated for every PBR fragment. Keep the strongest
  // interior pools first, while emissive bulbs preserve the fixtures themselves.
  const pointLights = [];
  group.traverse((object) => {
    if (!object.isPointLight) return;
    const outsidePenalty = Math.abs(object.position.x) > W / 2 || object.position.z > D / 2 ? 0.35 : 1;
    pointLights.push({
      light: object,
      importance: object.intensity * Math.max(1, object.distance) * outsidePenalty,
    });
  });
  pointLights.sort((a, b) => b.importance - a.importance);

  function setQuality(level) {
    const keep = level >= 2
      ? pointLights.length
      : level === 1 ? Math.min(9, pointLights.length) : Math.min(6, pointLights.length);
    pointLights.forEach(({ light }, index) => { light.visible = index < keep; });
    contactShadowMat.opacity = level >= 1 ? 0.3 : 0.48;
  }

  // Everything is placed — fold the static decor into per-material meshes.
  // The animate() loop only ever touches the roots excluded here.
  mergeStaticDecor(group, [passingCar, cat, clockGroup, fan, vinylDisc, neonMesh]);

  return { group, seats, seatMeshes, nav, colliders, theme, animate, setQuality, dispose, woodMat, cushionMat };
}
