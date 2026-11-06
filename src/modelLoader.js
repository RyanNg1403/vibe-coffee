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
import { ktx2Loader, releaseAfterUpload } from './perf/textureCompression.js';
import { assetUrl } from './assetUrl.js';
import { BakedLodPlugin } from './perf/lod/bakedLods.js';
// Content-hashed build assets instead of a fixed /draco/ folder: they resolve
// under any deployment base path and never go stale behind a cache.
const DRACO_FILES = {
  'draco_wasm_wrapper.js': new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', import.meta.url).href,
  'draco_decoder.wasm': new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm', import.meta.url).href,
  'draco_decoder.js': new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', import.meta.url).href,
};

// This asset's exaggerated head/hair proportions and seated silhouette clash
// with the established café cast. Keep the source in the repository for
// provenance, but do not download or instantiate it in the live experience.
const CAST_EXCLUSIONS = new Set(['char_matt', 'char_wcasual', 'char_j', 'char_l', 'char_wdress', 'char_hero_female', 'char_hero_male', 'patron_seated_female']);

// target height per prop, meters
const NORMALIZE = {
  studio_cup: { height: 0.09 },
  studio_espresso: { height: 0.52 },
  studio_pendant: { height: 0.2 },
  studio_chair: { height: 0.89 },
  cup: { height: 0.1 },
  armchair: { height: 0.89 },
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
  // The Blender stool includes a backrest: 0.65 m was the old backless
  // model's total height and incorrectly lowered its cushion below the actor.
  bar_stool: { height: 1.10 },
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
  // greenery fidelity kit (Immersion V2): heights are real-world plant sizes
  plant_monstera: { height: 1.15 },
  plant_snake: { height: 0.72 },
  plant_pothos: { height: 0.6 },
  plant_pothos_vine: { height: 0.55 }, // trailing: hung so its top meets the pot rim
  plant_fern: { height: 0.5 },
  plant_succulent: { height: 0.3 },
  plant_cacti: { height: 0.26 },
  tree_park_a: { height: 3.4 },
  tree_park_b: { height: 2.9 },
  crate: { height: 0.42 },
  table_lamp: { height: 0.48 },
  typewriter: { height: 0.16 },
};
// Device-class budgets (perf/deviceProfile.js): the largest texture edge
// uploaded and the anisotropic filtering level of library colour maps.
const budget = { textureMaxSize: Infinity, anisotropy: 8 };
export function configureModelBudget({ textureMaxSize = Infinity, anisotropy = 8 } = {}) {
  budget.textureMaxSize = textureMaxSize;
  budget.anisotropy = anisotropy;
}

// Caps a freshly parsed texture to budget.textureMaxSize before it is ever
// uploaded: block-compressed chains drop their top mip levels (each halves
// the edge and quarters the bytes); decoded images are resized once.
export async function capTextureSize(texture) {
  const max = budget.textureMaxSize;
  if (!Number.isFinite(max)) return;
  if (texture.isCompressedTexture) {
    const mips = texture.mipmaps ?? [];
    let drop = 0;
    while (drop < mips.length - 1 && Math.max(mips[drop].width, mips[drop].height) > max) drop += 1;
    if (!drop) return;
    texture.mipmaps = mips.slice(drop);
    texture.image = { ...texture.image, width: texture.mipmaps[0].width, height: texture.mipmaps[0].height };
    return;
  }
  const image = texture.image;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (Math.max(width, height) <= max || typeof createImageBitmap !== 'function') return;
  const scale = max / Math.max(width, height);
  try {
    const resized = await createImageBitmap(image, {
      resizeWidth: Math.max(1, Math.round(width * scale)),
      resizeHeight: Math.max(1, Math.round(height * scale)),
      resizeQuality: 'high',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    texture.image = resized;
    image.close?.();
  } catch { /* keep the original resolution */ }
}

// any key starting char_ is a rigged character
function specFor(key) {
  if (key.startsWith('atelier_')) return { worldSpace: true };
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
export function normalizeModel(scene, key) {
  const spec = specFor(key);
  let box = new THREE.Box3().setFromObject(scene);
  // Use the authored body bounds: hats must not shrink patrons, and a raised
  // tail must not shrink or offset an animal away from its planted paws.
  const anatomicalBounds = spec.character ? 'portrait_bounds'
    : (spec.pet || key === 'cat') ? 'pet_bounds' : null;
  if (anatomicalBounds) {
    scene.traverse((object) => {
      const bounds = object.userData[anatomicalBounds];
      if (Array.isArray(bounds) && bounds.length === 6 && bounds.every(Number.isFinite)
          && bounds[4] > bounds[1]) {
        box = new THREE.Box3(new THREE.Vector3(...bounds.slice(0, 3)), new THREE.Vector3(...bounds.slice(3)));
      }
    });
  }
  const size = box.getSize(new THREE.Vector3());
  const s = spec.worldSpace ? 1 : spec.height / Math.max(0.0001, size.y);
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  scene.scale.setScalar(s);
  const box2 = box.clone();
  box2.min.multiplyScalar(s);
  box2.max.multiplyScalar(s);
  const center = box2.getCenter(new THREE.Vector3());
  if (!spec.worldSpace) {
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box2.min.y;
  }
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
        o.material.map.anisotropy = budget.anisotropy;
        // library textures outlive every café — clones must never dispose them
        o.material.map.userData.shared = true;
      }
    }
  });
  return wrapper;
}

// Venue dressing is authored per café. The first café only waits for its own
// set; the other venues stream in afterwards while the room is already live.
const VENUE_ASSET = /^atelier_(?:decor|tables)_(.+)$/;
const BACKGROUND_DELAY_MS = 4000;
// The cast (patrons, staff, pets) is spawned by the crowd, not the room, so it
// can stream in after the café's first frame (see loadModels()).
export const isCastModel = (key) => key.startsWith('char_') || key === 'pet_cat' || key === 'pet_dog';
// What a café's build clones, measured per venue: these never reach a first
// frame (spares and fallbacks) or only one venue's. With streamCast they join
// the background set. A stale entry only costs a procedural stand-in on a
// first visit; development builds warn when that happens (cloneModel).
const NOT_IN_FIRST_FRAME = new Set(['bookcase', 'cactus_pot', 'crate', 'cup', 'espresso_machine',
  'iceCream', 'plant', 'plant_snake', 'cat']);
const VENUE_ONLY = {
  tree_park_a: ['terrace'],
  tree_park_b: ['terrace'],
  atelier_piano: ['midnight'],
  atelier_roaster: ['roastery'],
  atelier_streetscape: ['goldenhour', 'roastery', 'midnight'],
  atelier_car: ['goldenhour', 'roastery', 'midnight'],
};

function neededForFirstFrame(key, themeId, streamCast) {
  const venue = VENUE_ASSET.exec(key)?.[1];
  if (venue) return !themeId || venue === themeId;
  if (!streamCast) return true;
  // The room itself checks for the pet cat (a live cat replaces its décor cat).
  if (isCastModel(key)) return key === 'pet_cat';
  if (NOT_IN_FIRST_FRAME.has(key)) return false;
  return !themeId || !VENUE_ONLY[key] || VENUE_ONLY[key].includes(themeId);
}
let library = null;

function createLibrary() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // Blender-baked LOD chains (MSFT_lod) feed the LOD manager; the scene graph
  // keeps level 0 only, so batching and instancing never see other levels.
  loader.register((parser) => new BakedLodPlugin(parser));
  const dracoManager = new THREE.LoadingManager();
  dracoManager.setURLModifier((url) => DRACO_FILES[url.split('/').pop()] ?? url);
  const dracoLoader = new DRACOLoader(dracoManager);
  loader.setDRACOLoader(dracoLoader);
  // Deployed builds carry KTX2 colour textures; resolve the transcoder once,
  // in parallel with the first downloads.
  const ktx2Ready = ktx2Loader().then((ktx2) => {
    if (ktx2) loader.setKTX2Loader(ktx2);
  });
  const models = new Map();
  const sharedTextures = new Map();
  const pending = new Map();
  async function loadEntry(key, def) {
    try {
      let gltf;
      if (def.url.startsWith('data:')) {
        await ktx2Ready;
        gltf = await loader.parseAsync(dataUriToArrayBuffer(def.url), '');
      } else {
        const res = await fetch(assetUrl(def.url));
        if (!res.ok) throw new Error(`http ${res.status}`);
        const buffer = await res.arrayBuffer();
        await ktx2Ready;
        gltf = await loader.parseAsync(buffer, '');
      }
      // Packed exports name identical embedded images by content hash. Reuse
      // one GPU texture across models while retaining distinct UV transforms.
      const fresh = new Set();
      gltf.scene.traverse((object) => {
        if (!object.material) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const [slot, texture] of Object.entries(material)) {
            if (!texture?.isTexture) continue;
            if (!texture.name.startsWith('asset-texture-')) {
              fresh.add(texture);
              continue;
            }
            const id = [texture.name, texture.colorSpace, texture.channel, texture.flipY,
              texture.minFilter, texture.magFilter, texture.anisotropy, texture.generateMipmaps,
              texture.wrapS, texture.wrapT, ...texture.repeat.toArray(), ...texture.offset.toArray(),
              ...texture.center.toArray(), texture.rotation].join('|');
            if (sharedTextures.has(id)) material[slot] = sharedTextures.get(id);
            else {
              sharedTextures.set(id, texture);
              fresh.add(texture);
            }
          }
        }
      });
      await Promise.all([...fresh].map(capTextureSize));
      fresh.forEach(releaseAfterUpload);
      const spec = specFor(key);
      const isChar = spec.character;
      models.set(key, {
        template: normalizeModel(gltf.scene, key),
        animations: (isChar || spec.pet) ? gltf.animations : null,
        character: !!isChar,
        pet: !!spec.pet,
        hasSit: !!(isChar && gltf.animations?.some((a) => a.name.toLowerCase().includes('sit'))),
      });
    } catch (e) {
      console.warn(`[models] "${key}" unavailable (${e.message}) — procedural fallback`);
    }
  }

  function load(key) {
    if (!pending.has(key)) pending.set(key, loadEntry(key, MODEL_MANIFEST[key]));
    return pending.get(key);
  }

  function fixups() {
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
  }

  let backgroundScheduled = false;
  // `warmOnly` downloads into the HTTP cache without parsing, so a later café
  // switch needs no network yet nothing extra stays resident.
  function streamRemaining(keys, { warmOnly = false } = {}) {
    if (backgroundScheduled) return;
    backgroundScheduled = true;
    const warm = async () => {
      const aliasMap = await aliases;
      for (const key of keys) {
        if (models.has(key) || pending.has(key)) continue;
        const url = MODEL_MANIFEST[aliasMap[key]]?.url ?? MODEL_MANIFEST[key].url;
        if (url.startsWith('data:')) continue;
        await fetch(assetUrl(url), { priority: 'low' }).then((res) => res.arrayBuffer()).catch(() => null);
      }
    };
    const start = () => (warmOnly ? warm() : keys.forEach(load));
    setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 4000 });
      else start();
    }, BACKGROUND_DELAY_MS);
  }

  // ---- residency (LRU under a byte budget) ----
  const lastUsed = new Map();
  function touch(keys) {
    const now = performance.now();
    for (const key of keys) lastUsed.set(key, now);
  }

  function texturesOf(template, into = new Set()) {
    template.traverse((object) => {
      for (const material of [object.material].flat()) {
        for (const value of Object.values(material ?? {})) if (value?.isTexture) into.add(value);
      }
    });
    return into;
  }

  // Approximate bytes a resident model costs: geometry (CPU copy + vertex
  // buffers) and its textures as uploaded.
  function residentBytes(entry) {
    if (entry.bytes !== undefined) return entry.bytes;
    const arrays = new Set();
    entry.template.traverse((object) => {
      const geometry = object.geometry;
      if (!geometry) return;
      for (const attribute of Object.values(geometry.attributes)) arrays.add(attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array);
      if (geometry.index) arrays.add(geometry.index.array);
    });
    let bytes = 0;
    for (const array of arrays) bytes += 2 * (array?.byteLength ?? 0);
    for (const texture of texturesOf(entry.template)) {
      const image = texture.image;
      bytes += texture.isCompressedTexture
        ? texture.userData.gpuBytes ?? (texture.mipmaps ?? []).reduce((sum, mip) => sum + (mip.data?.byteLength ?? 0), 0)
        : (image?.width ?? 0) * (image?.height ?? 0) * 4 * (4 / 3);
    }
    entry.bytes = bytes;
    return bytes;
  }

  function disposeEntry(entry, keptTextures, onGeometry) {
    const geometries = new Set();
    entry.template.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      object.skeleton?.dispose();
      for (const material of [object.material].flat()) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value?.isTexture && !keptTextures.has(value)) value.dispose();
        }
        material.dispose();
      }
    });
    for (const geometry of geometries) {
      onGeometry?.(geometry);
      geometry.dispose();
    }
    entry.template.clear();
  }

  /**
   * Evicts least-recently-used models until the rest fit `budgetBytes`.
   * Never evicts `keep` keys or models with a geometry in `inScene` (source
   * geometries of anything currently drawn). Evicted models reload from the
   * network/HTTP cache on demand.
   */
  function evict({ keep = new Set(), inScene = new Set(), budgetBytes = Infinity, onGeometry = null } = {}) {
    let total = 0;
    const candidates = [];
    for (const [key, entry] of models) {
      const bytes = residentBytes(entry);
      total += bytes;
      if (keep.has(key)) continue;
      let drawn = false;
      entry.template.traverse((object) => { if (object.geometry && inScene.has(object.geometry)) drawn = true; });
      if (!drawn) candidates.push({ key, entry, bytes });
    }
    candidates.sort((a, b) => (lastUsed.get(a.key) ?? 0) - (lastUsed.get(b.key) ?? 0));
    const evicted = [];
    for (const candidate of candidates) {
      if (total <= budgetBytes) break;
      evicted.push(candidate);
      total -= candidate.bytes;
    }
    if (!evicted.length) return { evicted: [], freedBytes: 0, residentBytes: total };
    for (const { key } of evicted) {
      models.delete(key);
      pending.delete(key);
    }
    const keptTextures = new Set();
    for (const entry of models.values()) texturesOf(entry.template, keptTextures);
    for (const [id, texture] of sharedTextures) if (!keptTextures.has(texture)) sharedTextures.delete(id);
    for (const { entry } of evicted) disposeEntry(entry, keptTextures, onGeometry);
    backgroundScheduled = false;
    return {
      evicted: evicted.map(({ key }) => key),
      freedBytes: evicted.reduce((sum, { bytes }) => sum + bytes, 0),
      residentBytes: total,
    };
  }

  function totalBytes() {
    let total = 0;
    for (const entry of models.values()) total += residentBytes(entry);
    return total;
  }

  function report() {
    return [...models].map(([key, entry]) => ({ key, MB: Number((residentBytes(entry) / 1048576).toFixed(2)) }))
      .sort((a, b) => b.MB - a.MB);
  }

  return { load, fixups, streamRemaining, models, touch, evict, totalBytes, report };
}

// Resolves once every model the given café needs is ready (all models when
// no café is named). With `streamCast`, patrons, staff and pets are left out:
// the room renders first and the crowd's cast arrives via loadModels(). The
// same Map instance is returned every time and gains later models.
export function loadModelLibrary(themeId = null, { streamCast = false } = {}) {
  library ??= createLibrary();
  const keys = Object.keys(MODEL_MANIFEST).filter((key) => !CAST_EXCLUSIONS.has(key));
  const needed = keys.filter((key) => neededForFirstFrame(key, themeId, streamCast));
  library.touch(needed);
  const ready = Promise.all(needed.map((key) => library.load(key))).then(() => library.fixups());
  // Streaming callers start the background set themselves once the cast is
  // in (streamBackgroundModels), so it never competes with the crowd.
  if (!streamCast && needed.length < keys.length) ready.then(() => library.streamRemaining(keys));
  return ready;
}

// Idle-time download of every non-cast model not loaded yet (other venues,
// spares): later café switches then need no network.
// With `warmOnly` (memory-constrained devices) they are only downloaded into
// the HTTP cache, not parsed into the resident library.
export function streamBackgroundModels({ warmOnly = false } = {}) {
  library ??= createLibrary();
  library.streamRemaining(Object.keys(MODEL_MANIFEST).filter((key) => !CAST_EXCLUSIONS.has(key) && !isCastModel(key)), { warmOnly });
}

// Loads specific manifest models (e.g. a café's cast) into the shared Map.
export function loadModels(keys) {
  library ??= createLibrary();
  const wanted = keys.filter((key) => MODEL_MANIFEST[key] && !CAST_EXCLUSIONS.has(key));
  library.touch(wanted);
  return Promise.all(wanted.map((key) => library.load(key))).then(() => library.fixups());
}

// Every non-cast model a café's room can clone, including its spares.
export function firstFrameKeys(themeId) {
  return Object.keys(MODEL_MANIFEST).filter((key) => !CAST_EXCLUSIONS.has(key) && !isCastModel(key)
    && (NOT_IN_FIRST_FRAME.has(key) || neededForFirstFrame(key, themeId, true)));
}

// See createLibrary().evict(). Returns { evicted, freedBytes, residentBytes }.
export function evictModels(options) {
  if (!library) return { evicted: [], freedBytes: 0, residentBytes: 0 };
  return library.evict(options);
}

export function libraryBytes() {
  return library?.totalBytes() ?? 0;
}

// Resident models by estimated bytes (window.__vibe.libraryReport()).
export function libraryReport() {
  return library?.report() ?? [];
}

// A live, filtered view of the library for a crowd: models that stream in
// later appear in it, cast members it was not given never do.
export class ModelView {
  constructor(source, include) {
    this.source = source;
    this.include = include;
  }

  get(key) { return this.include(key) ? this.source.get(key) : undefined; }
  has(key) { return this.include(key) && this.source.has(key); }
  get size() { return [...this.keys()].length; }
  * entries() { for (const entry of this.source) if (this.include(entry[0])) yield entry; }
  * keys() { for (const [key] of this.entries()) yield key; }
  * values() { for (const [, value] of this.entries()) yield value; }
  forEach(callback, thisArg) { for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this); }
  [Symbol.iterator]() { return this.entries(); }
}

// The resident library (key -> entry), for memory accounting.
export function residentModels() {
  return library?.models ?? new Map();
}

// Every streamable cast model in the manifest, and whether it is resident.
export function castCatalog() {
  return Object.keys(MODEL_MANIFEST).filter((key) => isCastModel(key) && !CAST_EXCLUSIONS.has(key))
    .map((key) => ({ key, loaded: !!library?.models.has(key) }));
}

// static props: plain clone
const warnedMissing = new Set();
export function cloneModel(models, key) {
  const entry = models?.get(key);
  if (!entry && MODEL_MANIFEST[key] && import.meta.env?.DEV && library && !warnedMissing.has(key)) {
    warnedMissing.add(key);
    console.warn(`[models] "${key}" was requested before it streamed in; update the first-frame sets in modelLoader.js`);
  }
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
  for (const [k, v] of models ?? []) if (v.character && !k.endsWith('_barista') && !k.endsWith('_server')) out.push(k);
  return out;
}

// characters that can sit down properly (have a sit clip); anyone else only
// ever walks through or queues, so their rig never has to fold into a chair
export function sitCharacterKeys(models) {
  const out = [];
  for (const [k, v] of models ?? []) if (v.character && v.hasSit && !k.endsWith('_barista') && !k.endsWith('_server')) out.push(k);
  return out;
}
