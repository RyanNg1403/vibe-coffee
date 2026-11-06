import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { pixelsPerUnit, selectLodLevel, usefulLevels } from '../src/perf/lod/lodSelect.js';
import { LodManager } from '../src/perf/lod/lodManager.js';
import { SkinnedCuller } from '../src/perf/skinnedCulling.js';
import { RollingWindow } from '../src/perf/frameStats.js';

const LEVELS = [{ error: 0 }, { error: 0.002 }, { error: 0.006 }, { error: 0.02 }];

test('projected pixel density falls off with distance', () => {
  const near = pixelsPerUnit(2, THREE.MathUtils.degToRad(62), 900);
  const far = pixelsPerUnit(8, THREE.MathUtils.degToRad(62), 900);
  assert.ok(Math.abs(near / far - 4) < 1e-9);
  assert.ok(near > 350 && near < 400);
});

test('LOD selection keeps the silhouette error under the pixel budget', () => {
  const extent = 1.7;
  const fov = THREE.MathUtils.degToRad(62);
  assert.equal(selectLodLevel(LEVELS, extent, pixelsPerUnit(1, fov, 900), 1), 0);
  const far = selectLodLevel(LEVELS, extent, pixelsPerUnit(60, fov, 900), 1);
  assert.equal(far, 3);
  for (let distance = 0.5; distance < 40; distance += 0.5) {
    const px = pixelsPerUnit(distance, fov, 900);
    const level = selectLodLevel(LEVELS, extent, px, 1);
    assert.ok(LEVELS[level].error * extent * px <= 1 + 1e-9, `error budget broken at ${distance} m`);
  }
});

test('hysteresis prevents flicker at a threshold distance', () => {
  const extent = 1.7;
  // Exactly at the level-1 threshold: a mesh showing level 0 stays there,
  // and a mesh already at level 1 keeps it.
  const px = 1 / (LEVELS[1].error * extent);
  assert.equal(selectLodLevel(LEVELS, extent, px, 1, 0), 0);
  assert.equal(selectLodLevel(LEVELS, extent, px, 1, 1), 1);
});

test('levels that barely reduce work are discarded', () => {
  const kept = usefulLevels(30000, [{ indexCount: 27000 }, { indexCount: 15000 }, { indexCount: 14000 }, { indexCount: 3600 }]);
  assert.deepEqual(kept.map((level) => level.indexCount), [15000, 3600]);
});

// Runs the worker's message handler in-process: same code path, no Worker.
async function inlineWorker() {
  const fake = { onmessage: null, onerror: null, terminate() {} };
  globalThis.self = { postMessage: (data) => setTimeout(() => fake.onmessage({ data }), 0) };
  await import('../src/perf/lod/simplify.worker.js');
  const handler = globalThis.self.onmessage;
  fake.postMessage = (message) => setTimeout(() => handler({ data: message }), 0);
  return fake;
}

function sharedSphere(widthSegments = 96, heightSegments = 64) {
  const geometry = new THREE.SphereGeometry(0.5, widthSegments, heightSegments);
  geometry.userData.vibeShared = true;
  return geometry;
}

test('LOD manager builds index-only levels that share the source vertices', async () => {
  await MeshoptSimplifier.ready;
  const worker = await inlineWorker();
  const manager = new LodManager({ minTriangles: 1000, createWorker: () => worker });
  const geometry = sharedSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group().add(mesh);
  manager.scan(root);
  for (let i = 0; i < 50 && manager.records.get(geometry).state === 'pending'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const record = manager.records.get(geometry);
  assert.equal(record.state, 'ready');
  assert.ok(record.levels.length >= 2);
  for (const level of record.levels) {
    assert.ok(level.geometry.attributes.position === geometry.attributes.position, 'vertex buffers are shared');
    assert.ok(level.geometry.index.count < geometry.index.count);
    assert.equal(level.geometry.userData.vibeShared, true, 'room disposal must skip cached levels');
  }

  const camera = new THREE.PerspectiveCamera(62, 1.6, 0.05, 100);
  root.updateMatrixWorld(true);
  camera.position.set(0, 0, 0.6);
  camera.updateMatrixWorld();
  manager.update(camera, 900);
  assert.ok(mesh.geometry === geometry, 'close up: full detail');
  camera.position.set(0, 0, 60);
  camera.updateMatrixWorld();
  manager.update(camera, 900);
  assert.ok(mesh.geometry !== geometry, 'far away: a generated level');
  assert.ok(manager.stats.drawnTriangles < manager.stats.sourceTriangles);
  assert.ok(manager.raycastProxy(geometry));
  manager.restore();
  assert.ok(mesh.geometry === geometry);
});

test('LOD manager ignores per-room geometry and small meshes', () => {
  const manager = new LodManager({ minTriangles: 1000, createWorker: () => { throw new Error('unused'); } });
  const roomOnly = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64));
  const tiny = new THREE.Mesh(sharedSphere(8, 6));
  assert.equal(manager.isCandidate(roomOnly), false);
  assert.equal(manager.isCandidate(tiny), false);
  assert.equal(manager.isCandidate(new THREE.Mesh(sharedSphere())), true);
});

test('a missing worker leaves meshes at full detail instead of failing', () => {
  const manager = new LodManager({ minTriangles: 1000, createWorker: () => { throw new Error('no workers'); } });
  const mesh = new THREE.Mesh(sharedSphere());
  manager.scan(new THREE.Group().add(mesh));
  assert.equal(manager.workerFailed, true);
  manager.update(new THREE.PerspectiveCamera(), 900);
  assert.equal(manager.stats.histogram[0], 1);
});

function skinnedActor(x) {
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[1].position.y = 0.9;
  bones[2].position.y = 0.7;
  bones[0].add(bones[1]);
  bones[1].add(bones[2]);
  const geometry = new THREE.CylinderGeometry(0.2, 0.2, 1.6, 8, 4);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  // Authored in its own offset local space, like some imported rigs.
  mesh.position.set(5, 0, 0);
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.position.x = x;
  root.add(bones[0], mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { root, mesh, bones };
}

test('skinned culling follows the posed skeleton in every part space', () => {
  const scene = new THREE.Scene();
  const front = skinnedActor(0);
  const behind = skinnedActor(0);
  behind.root.position.z = 10;
  scene.add(front.root, behind.root);
  scene.updateMatrixWorld(true);
  const culler = new SkinnedCuller();
  culler.scan(scene);
  culler.update();
  assert.equal(culler.groups.length, 2);
  assert.equal(front.mesh.frustumCulled, true);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1, 4);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  assert.equal(frustum.intersectsObject(front.mesh), true, 'visible actor is drawn despite its offset mesh space');
  assert.equal(frustum.intersectsObject(behind.mesh), false, 'actor behind the camera is culled');

  // Raise an arm high above the bind volume: the sphere must follow it.
  front.bones[2].position.y = 6;
  scene.updateMatrixWorld(true);
  culler.update();
  const top = new THREE.Vector3();
  front.bones[2].getWorldPosition(top);
  assert.ok(culler.sphereFor(front.mesh).containsPoint(top));

  culler.restore(scene);
  assert.equal(front.mesh.frustumCulled, false);
});

test('rolling window percentiles cover only recorded samples', () => {
  const window = new RollingWindow(4);
  [10, 20, 30, 40, 50].forEach((value) => window.push(value));
  assert.deepEqual(window.toArray(), [20, 30, 40, 50]);
  assert.equal(window.average(), 35);
  assert.equal(window.percentile(1), 50);
});

test('runtime disposal frees owned GPU resources but never shared library ones', async () => {
  const { disposeObject3D } = await import('../src/perf/disposal.js');
  const disposed = [];
  const track = (resource, name) => { resource.addEventListener('dispose', () => disposed.push(name)); return resource; };
  const sharedGeometry = track(new THREE.BoxGeometry(), 'shared-geometry');
  sharedGeometry.userData.vibeShared = true;
  const ownTexture = track(new THREE.Texture(), 'own-texture');
  const sharedTexture = track(new THREE.Texture(), 'shared-texture');
  sharedTexture.userData.shared = true;
  const parent = new THREE.Group();
  const root = new THREE.Group();
  root.add(
    new THREE.Mesh(track(new THREE.BoxGeometry(), 'own-geometry'), track(new THREE.MeshStandardMaterial({ map: ownTexture }), 'own-material')),
    new THREE.Mesh(sharedGeometry, track(new THREE.MeshStandardMaterial({ map: sharedTexture }), 'clone-material')),
  );
  parent.add(root);
  disposeObject3D(root);
  assert.equal(root.parent, null);
  assert.deepEqual(disposed.sort(), ['clone-material', 'own-geometry', 'own-material', 'own-texture']);
});

test('Blender-baked LOD chains win over runtime simplification', async () => {
  const { bakedLevels, selectBakedLevel } = await import('../src/perf/lod/bakedLods.js');
  const geometry = sharedSphere();
  const level1 = new THREE.BufferGeometry();
  level1.setAttribute('position', geometry.attributes.position);
  level1.setIndex(Array.from(geometry.index.array.slice(0, geometry.index.count / 2)));
  bakedLevels.set(geometry, [{ geometry: level1, distance: 5 }]);
  let workerCreated = false;
  const manager = new LodManager({ minTriangles: 1000, createWorker: () => { workerCreated = true; throw new Error('unused'); } });
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group().add(mesh);
  manager.scan(root);
  assert.equal(workerCreated, false, 'no runtime simplification for baked models');
  assert.equal(manager.records.get(geometry).mode, 'baked');
  const camera = new THREE.PerspectiveCamera(62, 1.6, 0.05, 100);
  root.updateMatrixWorld(true);
  camera.position.set(0, 0, 2);
  camera.updateMatrixWorld();
  manager.update(camera, 900);
  assert.ok(mesh.geometry === geometry, 'inside the baked distance: level 0');
  camera.position.set(0, 0, 9);
  camera.updateMatrixWorld();
  manager.update(camera, 900);
  assert.ok(mesh.geometry === level1, 'beyond it: the baked level');
  assert.equal(level1.userData.vibeShared, true);
  // Lower render resolution switches earlier; hysteresis holds near the edge.
  assert.equal(selectBakedLevel([{ distance: 5 }], 3, 450), 1);
  assert.equal(selectBakedLevel([{ distance: 5 }], 4.8, 900, 1), 1);
  assert.equal(selectBakedLevel([{ distance: 5 }], 5.2, 900, 0), 0);
});
