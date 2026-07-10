// Loads the recorded 3D model library (public/models + modelManifest.js).
// Same philosophy as the sound library: every model is optional, and the
// procedural version of each prop remains as fallback.
//
// data: URIs are parsed directly (GLTFLoader.load would fetch, which strict
// CSPs refuse for data URLs).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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
  // drinks & food (new)
  mug: { height: 0.1 },
  latte: { height: 0.12 },
  cookie: { height: 0.03 },
  cupcake: { height: 0.09 },
  pancakes: { height: 0.07 },
  cakeSlice: { height: 0.08 },
  apple: { height: 0.08 },
  iceCream: { height: 0.14 },
  // décor / furniture (new)
  pendant_lamp: { height: 0.4 },
  side_table: { height: 0.5 },
  wall_shelf: { height: 1.6 },  // actually a tall standing display unit
  coat_rack: { height: 0.4 },   // a wide peg board, not a standing rack
  trashcan: { height: 0.4 },
  painting: { height: 0.6 },
  lantern: { height: 0.3 },
  plant_small: { height: 0.35 },
  cat: { height: 0.32 },
  patron_seated_female: { height: 1.7 },
  // rigged pets: skinned + animated, but not part of the human casting pools
  pet_cat: { height: 0.34, pet: true },
  pet_dog: { height: 0.55, pet: true },
  // decor expansion
  cactus_pot: { height: 0.34 },
  crate: { height: 0.42 },
  table_lamp: { height: 0.48 },
  typewriter: { height: 0.16 },
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
    if (o.isMesh) {
      if (o.geometry) o.geometry.userData.vibeShared = true;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        if (!material) continue;
        material.userData.vibeShared = true;
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.userData.vibeShared = true;
        }
      }
      o.castShadow = true;
      o.receiveShadow = true;
      // avoid texture shimmer/moire on oblique surfaces (paintings, labels)
      if (o.material?.map) {
        o.material.map.anisotropy = 8;
        // library textures outlive every café — clones must never dispose them
        o.material.map.userData.shared = true;
      }
    }
  });
  return wrapper;
}

let libraryPromise = null;

export function loadModelLibrary() {
  if (libraryPromise) return libraryPromise;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/');
  loader.setDRACOLoader(dracoLoader);
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
      const spec = specFor(key);
      const isChar = spec.character;
      models.set(key, {
        template: normalize(gltf.scene, key),
        animations: (isChar || spec.pet) ? gltf.animations : null,
        character: !!isChar,
        pet: !!spec.pet,
        hasSit: !!(isChar && gltf.animations?.some((a) => a.name.toLowerCase().includes('sit'))),
      });
    } catch (e) {
      console.warn(`[models] "${key}" unavailable (${e.message}) — procedural fallback`);
    }
  })).then(() => {
    // char_j and char_l ship the same "HumanArmature" rig, but char_j's
    // authored "Sitting" is a floor pose — parked on a chair it reads as
    // kneeling behind the seat. char_l's clip is a proper chair sit and the
    // bone tracks transfer 1:1, so char_j borrows it.
    const j = models.get('char_j');
    const l = models.get('char_l');
    if (j?.animations && l?.animations) {
      const goodSit = l.animations.find((a) => a.name.toLowerCase().includes('sit'));
      const badIndex = j.animations.findIndex((a) => a.name.toLowerCase().includes('sit'));
      if (goodSit && badIndex >= 0) j.animations[badIndex] = goodSit;
    }
    return models;
  });
  return libraryPromise;
}

// static props: plain clone
export function cloneModel(models, key) {
  const entry = models?.get(key);
  return entry && !entry.character && !entry.pet ? entry.template.clone(true) : null;
}

// rigged pets: skeleton-aware clone + their animation clips
export function clonePet(models, key) {
  const entry = models?.get(key);
  if (!entry || !entry.pet) return null;
  const mesh = skeletonClone(entry.template);
  const skeletons = new Map();
  mesh.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const sig = o.skeleton.bones.map((b) => b.uuid).join('/');
    const shared = skeletons.get(sig);
    if (shared) o.bind(shared, o.bindMatrix);
    else skeletons.set(sig, o.skeleton);
  });
  return { mesh, animations: entry.animations };
}

// rigged characters: skeleton-aware clone + their animation clips
export function cloneCharacter(models, key) {
  const entry = models?.get(key);
  if (!entry || !entry.character) return null;
  const mesh = skeletonClone(entry.template);
  // SkeletonUtils.clone gives every SkinnedMesh its own Skeleton copy even
  // when the source parts share one, so a ten-part character pays for ten
  // bone textures and ten matrix passes per frame. Re-share one skeleton per
  // identical bone set (bind inverses included, so distinct skins stay apart).
  const skeletons = new Map();
  mesh.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const sig = o.skeleton.bones.map((b) => b.uuid).join('/')
      + '#' + o.skeleton.boneInverses.map((m) => m.elements.join(',')).join(';');
    const shared = skeletons.get(sig);
    if (shared) o.bind(shared, o.bindMatrix);
    else skeletons.set(sig, o.skeleton);
  });
  return { mesh, animations: entry.animations };
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
