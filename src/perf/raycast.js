// Raycast acceleration for pointer picking.
//
// - Static meshes get a three-mesh-bvh bounds tree, built lazily the first
//   time a ray actually reaches their bounding volume (instanced chairs share
//   one tree across all instances). `indirect` keeps the shared library index
//   buffers untouched. Until the BVH chunk arrives, picks use Three's default.
// - Skinned meshes cannot use a static BVH: Three skins every tested vertex
//   on the CPU, which made hovering a pet cost ~20 ms. They are picked against
//   a coarse LOD of the same skin instead (same bones, far fewer triangles).
import * as THREE from 'three';
import { loadBvh } from './bvhLoader.js';

const MIN_BVH_TRIANGLES = 64;
const _sphere = new THREE.Sphere();
let installed = false;
let proxyFor = () => null;
let bvh = null;
export const raycastStats = { bvhLoaded: false, boundsTreesBuilt: 0, buildMs: 0, skinnedProxyPicks: 0 };

function wantsBoundsTree(geometry) {
  if (!bvh || geometry.boundsTree || geometry.userData.noBvh || !geometry.attributes.position) return false;
  const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  return triangles >= MIN_BVH_TRIANGLES && geometry.groups.length <= 1
    && geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity;
}

export function installAcceleratedRaycast({ skinnedProxy } = {}) {
  if (skinnedProxy) proxyFor = skinnedProxy;
  if (installed) return;
  installed = true;

  loadBvh().then((module) => {
    if (!module) return;
    bvh = module;
    raycastStats.bvhLoaded = true;
  }).catch((error) => console.warn('[perf] BVH raycasting unavailable:', error.message));

  const meshRaycast = THREE.Mesh.prototype.raycast;
  THREE.Mesh.prototype.raycast = function raycast(raycaster, intersects) {
    if (!bvh || this.isSkinnedMesh || this.isBatchedMesh || (this.morphTargetInfluences?.length ?? 0) > 0) {
      return meshRaycast.call(this, raycaster, intersects);
    }
    const geometry = this.geometry;
    if (wantsBoundsTree(geometry)) {
      // Only pay for the tree once a ray actually reaches this mesh.
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      _sphere.copy(geometry.boundingSphere).applyMatrix4(this.matrixWorld);
      if (!raycaster.ray.intersectsSphere(_sphere)) return undefined;
      const startedAt = performance.now();
      geometry.boundsTree = new bvh.MeshBVH(geometry, { indirect: true });
      raycastStats.boundsTreesBuilt += 1;
      raycastStats.buildMs += performance.now() - startedAt;
    }
    // three-mesh-bvh's own fallback is whatever Mesh.raycast was when its
    // chunk evaluated (this patch), so only hand it meshes that have a tree.
    if (!geometry.boundsTree) return meshRaycast.call(this, raycaster, intersects);
    return bvh.acceleratedRaycast.call(this, raycaster, intersects);
  };

  const skinnedRaycast = THREE.SkinnedMesh.prototype.raycast;
  THREE.SkinnedMesh.prototype.raycast = function raycast(raycaster, intersects) {
    const proxy = proxyFor(this.geometry);
    if (!proxy || proxy === this.geometry) return skinnedRaycast.call(this, raycaster, intersects);
    const geometry = this.geometry;
    this.geometry = proxy;
    raycastStats.skinnedProxyPicks += 1;
    try {
      return skinnedRaycast.call(this, raycaster, intersects);
    } finally {
      this.geometry = geometry;
    }
  };
}
