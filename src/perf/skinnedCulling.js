// Pose-following frustum culling for skinned actors.
//
// Indoor patrons disable frustum culling on their skinned parts because a
// bind-pose sphere misses animated limbs, so every patron behind the camera
// was still skinned, shaded and drawn into the shadow map. Here each skeleton
// gets one world-space sphere around its current bone positions (refreshed
// after the scene's matrix update, right before Three culls), expanded to
// cover flesh, hair and garments. The sphere is mapped into every part's own
// local space, so parts authored in different spaces stay correct. Three's
// main and shadow passes then cull each part against their own frustums.
import * as THREE from 'three';

const _box = new THREE.Box3();
const _point = new THREE.Vector3();
const _inverse = new THREE.Matrix4();

export class SkinnedCuller {
  constructor({ minMargin = 0.3, marginRatio = 0.25 } = {}) {
    this.minMargin = minMargin;
    this.marginRatio = marginRatio;
    this.enabled = true;
    this.managed = new WeakSet();
    this.groups = [];
    this.worldSpheres = new WeakMap(); // part -> world sphere of its skeleton
  }

  scan(root) {
    if (!this.enabled) return;
    const bySkeleton = new Map();
    root.traverse((object) => {
      if (!object.isSkinnedMesh || !object.skeleton || object.userData.noCull) return;
      // Parts that already cull themselves (exterior walkers) keep their own
      // bounds; only take over parts that opted out of culling.
      if (!this.managed.has(object) && object.frustumCulled) return;
      if (!this.managed.has(object)) {
        this.managed.add(object);
        object.boundingSphere = new THREE.Sphere();
        object.frustumCulled = true;
      }
      let group = bySkeleton.get(object.skeleton);
      if (!group) {
        group = { skeleton: object.skeleton, parts: [], sphere: new THREE.Sphere() };
        bySkeleton.set(object.skeleton, group);
      }
      group.parts.push(object);
      this.worldSpheres.set(object, group.sphere);
    });
    this.groups = [...bySkeleton.values()];
  }

  update() {
    if (!this.enabled) return;
    for (const group of this.groups) {
      _box.makeEmpty();
      for (const bone of group.skeleton.bones) {
        const e = bone.matrixWorld.elements;
        _box.expandByPoint(_point.set(e[12], e[13], e[14]));
      }
      if (_box.isEmpty()) continue;
      const sphere = group.sphere;
      _box.getCenter(sphere.center);
      const halfDiagonal = _box.getSize(_point).length() * 0.5;
      sphere.radius = halfDiagonal + Math.max(this.minMargin, halfDiagonal * 2 * this.marginRatio);
      for (const part of group.parts) {
        const scale = part.matrixWorld.getMaxScaleOnAxis() || 1;
        part.boundingSphere.center.copy(sphere.center).applyMatrix4(_inverse.copy(part.matrixWorld).invert());
        part.boundingSphere.radius = sphere.radius / scale;
      }
    }
  }

  sphereFor(part) {
    return this.worldSpheres.get(part) ?? null;
  }

  // Hand culling back to the original "always draw" behaviour.
  restore(root) {
    root.traverse((object) => {
      if (!this.managed.has(object)) return;
      object.frustumCulled = false;
      object.boundingSphere = null;
      this.managed.delete(object);
    });
    this.groups = [];
  }
}
