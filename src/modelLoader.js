// Loads the recorded 3D model library (public/models + modelManifest.js).
// Same philosophy as the sound library: every model is optional, and the
// procedural version of each prop remains as fallback.
//
// data: URIs are parsed directly (GLTFLoader.load would fetch, which strict
// CSPs refuse for data URLs).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODEL_MANIFEST } from './modelManifest.js';

// target height per prop, meters
const NORMALIZE = {
  cup: { height: 0.1 },
  armchair: { height: 0.78 },
  croissant: { height: 0.07 },
  plant: { height: 1.0 },
  espresso_machine: { height: 0.52 },
  floor_lamp: { height: 1.55 },
  sofa: { height: 0.8 },
  bookcase: { height: 1.9 },
  radio: { height: 0.32 },
  cake: { height: 0.16 },
  donut: { height: 0.07 },
  muffin: { height: 0.09 },
  teapot: { height: 0.2 },
  sandwich: { height: 0.09 },
  bar_stool: { height: 0.65 },
};
// any key starting char_ is a rigged character
function specFor(key) {
  if (key.startsWith('char_')) return { height: 1.7, character: true };
  return NORMALIZE[key] ?? { height: 0.5 };
}

function dataUriToArrayBuffer(uri) {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// scale + center the template so `clone()` drops in at world scale, base at y=0
function normalize(scene, key) {
  const spec = specFor(key);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = spec.height / Math.max(0.0001, size.y);
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  scene.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(scene);
  const center = box2.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= box2.min.y;
  wrapper.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return wrapper;
}

let libraryPromise = null;

export function loadModelLibrary() {
  if (libraryPromise) return libraryPromise;
  const loader = new GLTFLoader();
  const models = new Map();
  libraryPromise = Promise.all(Object.entries(MODEL_MANIFEST).map(async ([key, def]) => {
    try {
      let gltf;
      if (def.url.startsWith('data:')) {
        gltf = await loader.parseAsync(dataUriToArrayBuffer(def.url), '');
      } else {
        const res = await fetch(def.url);
        if (!res.ok) throw new Error(`http ${res.status}`);
        gltf = await loader.parseAsync(await res.arrayBuffer(), '');
      }
      const isChar = specFor(key).character;
      models.set(key, {
        template: normalize(gltf.scene, key),
        animations: isChar ? gltf.animations : null,
        character: !!isChar,
        hasSit: !!(isChar && gltf.animations?.some((a) => a.name.toLowerCase().includes('sit'))),
      });
    } catch (e) {
      console.warn(`[models] "${key}" unavailable (${e.message}) — procedural fallback`);
    }
  })).then(() => models);
  return libraryPromise;
}

// static props: plain clone
export function cloneModel(models, key) {
  const entry = models?.get(key);
  return entry && !entry.character ? entry.template.clone(true) : null;
}

// rigged characters: skeleton-aware clone + their animation clips
export function cloneCharacter(models, key) {
  const entry = models?.get(key);
  if (!entry || !entry.character) return null;
  return { mesh: skeletonClone(entry.template), animations: entry.animations };
}

export function characterKeys(models) {
  const out = [];
  for (const [k, v] of models ?? []) if (v.character) out.push(k);
  return out;
}

// characters that can sit down properly (have a sit clip); anyone else only
// ever walks through or queues, so their rig never has to fold into a chair
export function sitCharacterKeys(models) {
  const out = [];
  for (const [k, v] of models ?? []) if (v.character && v.hasSit) out.push(k);
  return out;
}
