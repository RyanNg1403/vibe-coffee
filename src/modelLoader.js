// Loads the recorded 3D model library (public/models + modelManifest.js).
// Same philosophy as the sound library: every model is optional, and the
// procedural version of each prop remains as fallback.
//
// data: URIs are parsed directly (GLTFLoader.load would fetch, which strict
// CSPs refuse for data URLs).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_MANIFEST } from './modelManifest.js';

// target footprint per prop: [height in meters, sitOnFloor]
const NORMALIZE = {
  cup: { height: 0.1 },
  armchair: { height: 0.78 },
  croissant: { height: 0.07 },
  plant: { height: 1.0 },
  espresso_machine: { height: 0.52 },
};

function dataUriToArrayBuffer(uri) {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// scale + center the template so `clone()` drops in at world scale, base at y=0
function normalize(scene, key) {
  const spec = NORMALIZE[key] ?? { height: 0.5 };
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
      models.set(key, normalize(gltf.scene, key));
    } catch (e) {
      console.warn(`[models] "${key}" unavailable (${e.message}) — procedural fallback`);
    }
  })).then(() => models);
  return libraryPromise;
}

// synchronous accessor once loaded; returns a fresh clone or null
export function cloneModel(models, key) {
  const tpl = models?.get(key);
  return tpl ? tpl.clone(true) : null;
}
