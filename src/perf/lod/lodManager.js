// Runtime LODs for heavy library meshes (patrons, pets, plants, furniture).
//
// Levels are generated once per shared library geometry in a Web Worker and
// share the source vertex attributes, so a level costs one index buffer. Each
// render, every managed mesh shows the coarsest level whose simplification
// error projects to less than `maxErrorPx` rendered pixels. Skinned meshes
// work unchanged because vertices (and their bone weights) are untouched.
import * as THREE from 'three';
import { DEFAULT_LOD_RATIOS, pixelsPerUnit, selectLodLevel, usefulLevels } from './lodSelect.js';
import { bakedLevels, selectBakedLevel } from './bakedLods.js';

const _center = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _skinMatrix = new THREE.Matrix4();

// World units per geometry unit. A skinned mesh's own node transform does not
// carry the skin's scale (rigs often keep it on the armature and bind matrix),
// so measure what the vertex shader applies: bone × boneInverse × bindMatrix.
export function meshWorldScale(mesh) {
  const skeleton = mesh.isSkinnedMesh ? mesh.skeleton : null;
  if (skeleton?.bones.length) {
    _skinMatrix.multiplyMatrices(skeleton.bones[0].matrixWorld, skeleton.boneInverses[0]).multiply(mesh.bindMatrix);
    if (mesh.bindMode === 'detached') _skinMatrix.premultiply(mesh.bindMatrixInverse).premultiply(mesh.matrixWorld);
    return _skinMatrix.getMaxScaleOnAxis();
  }
  return mesh.matrixWorld.getMaxScaleOnAxis();
}

function triangleCount(geometry) {
  const index = geometry.index;
  return index ? index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
}

function defaultWorkerFactory() {
  return new Worker(new URL('./simplify.worker.js', import.meta.url), { type: 'module' });
}

export class LodManager {
  constructor({
    minTriangles = 3000,
    ratios = DEFAULT_LOD_RATIOS,
    maxErrorPx = 1,
    maxSimplifyError = 0.05,
    hysteresis = 0.2,
    createWorker = defaultWorkerFactory,
  } = {}) {
    this.minTriangles = minTriangles;
    this.ratios = ratios;
    this.maxErrorPx = maxErrorPx;
    this.maxSimplifyError = maxSimplifyError;
    this.hysteresis = hysteresis;
    this.createWorker = createWorker;
    this.enabled = true;
    this.records = new WeakMap();     // source geometry -> { state, scale, levels }
    this.sourceOf = new WeakMap();    // LOD geometry -> source geometry
    this.meshLevel = new WeakMap();   // mesh -> displayed level
    this.meshes = [];
    this.queue = [];
    this.inFlight = null;
    this.worker = null;
    this.workerFailed = false;
    this.nextJobId = 1;
    this.stats = { managed: 0, ready: 0, pending: 0, generatedLevels: 0, sourceTriangles: 0, drawnTriangles: 0, histogram: [0, 0, 0, 0] };
    this.geometriesBuilt = 0;
    this.bakedSources = 0;
    this.buildMs = 0;
  }

  sourceGeometry(geometry) {
    return this.sourceOf.get(geometry) ?? geometry;
  }

  isCandidate(mesh) {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isBatchedMesh || mesh.userData.noLod) return false;
    const geometry = this.sourceGeometry(mesh.geometry);
    // Only shared library geometry: it outlives every café, so its levels can
    // be cached for the session without any per-room disposal bookkeeping.
    if (!geometry?.userData?.vibeShared || !geometry.index || !geometry.attributes.position) return false;
    if (geometry.groups.length > 1 || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return false;
    return bakedLevels.has(geometry) || triangleCount(geometry) >= this.minTriangles;
  }

  scan(root) {
    if (!this.enabled) return;
    const meshes = [];
    root.traverse((object) => {
      if (!this.isCandidate(object)) return;
      meshes.push(object);
      const source = this.sourceGeometry(object.geometry);
      if (!this.records.has(source)) {
        const baked = bakedLevels.get(source);
        if (baked) {
          // Blender-baked chains win; the worker only covers models without.
          this.records.set(source, {
            state: 'ready',
            mode: 'baked',
            scale: 1,
            levels: baked.map(({ geometry, distance }) => {
              geometry.userData.vibeShared = true;
              this.sourceOf.set(geometry, source);
              return { geometry, distance, triangles: triangleCount(geometry), error: 0 };
            }),
          });
          this.bakedSources += 1;
        } else {
          this.records.set(source, { state: 'pending', mode: 'runtime', scale: 1, levels: [] });
          this.queue.push(source);
        }
      }
    });
    this.meshes = meshes;
    this.pump();
  }

  ensureWorker() {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      this.worker = this.createWorker();
    } catch {
      this.workerFailed = true;
      return null;
    }
    this.worker.onmessage = ({ data }) => this.receive(data);
    // Builds without a reachable worker chunk (the single-file artifact
    // pre-simplifies its models instead) simply keep full-detail meshes.
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      this.workerFailed = true;
      this.worker?.terminate();
      this.worker = null;
      if (this.inFlight) this.records.get(this.inFlight.source).state = 'failed';
      this.inFlight = null;
    };
    return this.worker;
  }

  pump() {
    if (this.inFlight || !this.queue.length) return;
    const worker = this.ensureWorker();
    if (!worker) return;
    // Heaviest first: they buy back the most vertex work.
    this.queue.sort((a, b) => triangleCount(b) - triangleCount(a));
    const source = this.queue.shift();
    const position = source.attributes.position;
    const positions = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      positions[index * 3] = position.getX(index);
      positions[index * 3 + 1] = position.getY(index);
      positions[index * 3 + 2] = position.getZ(index);
    }
    const normal = source.attributes.normal;
    let normals = null;
    if (normal?.itemSize === 3) {
      normals = new Float32Array(normal.count * 3);
      for (let index = 0; index < normal.count; index += 1) {
        normals[index * 3] = normal.getX(index);
        normals[index * 3 + 1] = normal.getY(index);
        normals[index * 3 + 2] = normal.getZ(index);
      }
    }
    const indices = Uint32Array.from(source.index.array);
    const id = this.nextJobId++;
    this.inFlight = { id, source, startedAt: performance.now() };
    const transfer = [positions.buffer, indices.buffer];
    if (normals) transfer.push(normals.buffer);
    worker.postMessage({ id, positions, normals, indices, ratios: this.ratios, maxError: this.maxSimplifyError }, transfer);
  }

  receive({ id, scale, levels, error }) {
    const job = this.inFlight;
    if (!job || job.id !== id) return;
    this.inFlight = null;
    this.buildMs += performance.now() - job.startedAt;
    const record = this.records.get(job.source);
    if (error || !levels) {
      record.state = 'failed';
    } else {
      const source = job.source;
      if (!source.boundingBox) source.computeBoundingBox();
      if (!source.boundingSphere) source.computeBoundingSphere();
      const vertexCount = source.attributes.position.count;
      record.scale = scale;
      record.levels = usefulLevels(source.index.count, levels).map((level, index) => {
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
        geometry.morphAttributes = source.morphAttributes;
        geometry.morphTargetsRelative = source.morphTargetsRelative;
        const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
        geometry.setIndex(new THREE.BufferAttribute(IndexArray.from(level.indices), 1));
        geometry.boundingBox = source.boundingBox.clone();
        geometry.boundingSphere = source.boundingSphere.clone();
        geometry.name = `${source.name || 'geometry'}#lod${index + 1}`;
        // Shared like its source: room disposal must never free it, and it
        // lives exactly as long as the model library.
        geometry.userData.vibeShared = true;
        geometry.userData.lodLevel = index + 1;
        this.sourceOf.set(geometry, source);
        this.geometriesBuilt += 1;
        return { geometry, error: level.error, triangles: level.indexCount / 3 };
      });
      record.state = record.levels.length ? 'ready' : 'failed';
    }
    this.pump();
  }

  // Geometry to raycast instead of `geometry` (CPU skinning per vertex makes
  // full-detail skinned picks cost tens of milliseconds).
  raycastProxy(geometry) {
    const record = this.records.get(this.sourceGeometry(geometry));
    if (!record || record.state !== 'ready') return null;
    if (record.mode === 'baked') return record.levels.at(-1)?.geometry ?? null;
    // Coarsest level within ~3% of the mesh extent (about a centimetre on a
    // pet): plenty for choosing what the pointer is over.
    const level = record.levels.findLast((candidate) => candidate.error <= 0.03) ?? record.levels[0];
    return level?.geometry ?? null;
  }

  update(camera, viewportHeightPx, sphereFor = null) {
    const stats = this.stats;
    stats.managed = this.meshes.length;
    stats.ready = 0;
    stats.pending = this.queue.length + (this.inFlight ? 1 : 0);
    stats.sourceTriangles = 0;
    stats.drawnTriangles = 0;
    stats.histogram.fill(0);
    stats.generatedLevels = this.geometriesBuilt;
    stats.bakedSources = this.bakedSources;
    if (!this.enabled || !camera.isPerspectiveCamera) return;
    const fov = THREE.MathUtils.degToRad(camera.getEffectiveFOV ? camera.getEffectiveFOV() : camera.fov);
    for (const mesh of this.meshes) {
      const source = this.sourceGeometry(mesh.geometry);
      const record = this.records.get(source);
      const sourceTriangles = triangleCount(source);
      stats.sourceTriangles += sourceTriangles;
      if (!record || record.state !== 'ready') {
        stats.drawnTriangles += sourceTriangles;
        stats.histogram[0] += 1;
        continue;
      }
      stats.ready += 1;
      const sphere = sphereFor?.(mesh);
      if (sphere) {
        _sphere.copy(sphere);
      } else {
        if (!source.boundingSphere) source.computeBoundingSphere();
        _sphere.copy(source.boundingSphere).applyMatrix4(mesh.matrixWorld);
      }
      _center.copy(_sphere.center);
      const distance = Math.max(0.05, _center.distanceTo(camera.position) - _sphere.radius * 0.5);
      const extent = record.scale * meshWorldScale(mesh);
      const current = this.meshLevel.get(mesh) ?? 0;
      const level = record.mode === 'baked'
        ? selectBakedLevel(record.levels, _center.distanceTo(camera.position), viewportHeightPx, current)
        : selectLodLevel(
        [{ error: 0 }, ...record.levels],
        extent,
        pixelsPerUnit(distance, fov, viewportHeightPx),
        this.maxErrorPx,
        current,
        this.hysteresis,
      );
      const geometry = level === 0 ? source : record.levels[level - 1].geometry;
      if (mesh.geometry !== geometry) mesh.geometry = geometry;
      this.meshLevel.set(mesh, level);
      stats.histogram[Math.min(level, stats.histogram.length - 1)] += 1;
      stats.drawnTriangles += level === 0 ? sourceTriangles : record.levels[level - 1].triangles;
    }
  }

  // Put every managed mesh back on its source geometry (A/B toggles).
  restore() {
    for (const mesh of this.meshes) {
      mesh.geometry = this.sourceGeometry(mesh.geometry);
      this.meshLevel.set(mesh, 0);
    }
  }

  dispose() {
    this.restore();
    this.worker?.terminate();
    this.worker = null;
    this.queue.length = 0;
    this.meshes = [];
  }
}
