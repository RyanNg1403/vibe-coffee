// Fades a freshly spawned crowd into an already visible room, nearest actor
// first. Shader variants for both the fading (transparent) and the final
// (opaque) materials are compiled before anything is shown, so the reveal
// itself never stalls on a program link.
import * as THREE from 'three';

const isShared = (material) => material.userData?.vibeShared || material.userData?.shared;
const smooth = (t) => t * t * (3 - 2 * t);

export class ActorReveal {
  constructor({ renderer, scene, camera, stagger = 0.09, duration = 0.6 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.stagger = stagger;
    this.duration = duration;
    this.actors = [];
    this.token = 0;
  }

  // Everything already in the scene; reveal() fades whatever is added later.
  snapshot() {
    const before = new WeakSet();
    this.scene.traverse((object) => before.add(object));
    return before;
  }

  get active() { return this.actors.length > 0; }

  async reveal(before) {
    this.finish();
    const token = ++this.token;
    const groups = new Map();
    this.scene.traverse((object) => {
      if (before.has(object) || !object.isMesh) return;
      let root = object;
      while (root.parent && !before.has(root.parent)) root = root.parent;
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(object);
    });
    if (!groups.size) return 0;

    const hidden = [];
    for (const meshes of groups.values()) {
      for (const mesh of meshes) {
        hidden.push([mesh, mesh.layers.mask]);
        mesh.layers.disableAll();
      }
    }
    const restoreLayers = () => { for (const [mesh, mask] of hidden) mesh.layers.mask = mask; };
    // Opaque programs first (the final state), then the fading variants.
    await this.compile();
    if (token !== this.token) {
      restoreLayers();
      return 0;
    }
    const materialState = new Map();
    const swapped = [];
    for (const meshes of groups.values()) {
      for (const mesh of meshes) {
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const next = list.map((material) => {
          if (!material) return material;
          // Library materials are shared with the rest of the room: fade a
          // private copy and hand the original back afterwards.
          const target = isShared(material) ? material.clone() : material;
          if (target !== material) swapped.push({ mesh, original: mesh.material });
          if (!materialState.has(target)) {
            materialState.set(target, { transparent: target.transparent, opacity: target.opacity, clone: target !== material });
            target.transparent = true;
            target.opacity = 0;
          }
          return target;
        });
        mesh.material = Array.isArray(mesh.material) ? next : next[0];
      }
    }
    this.materialState = materialState;
    this.swapped = swapped;
    await this.compile();
    restoreLayers();
    if (token !== this.token) return 0;

    const eye = this.camera.position;
    const position = new THREE.Vector3();
    const ordered = [...groups].map(([root, meshes]) => {
      root.getWorldPosition(position);
      return { root, meshes, distance: position.distanceTo(eye) };
    }).sort((a, b) => a.distance - b.distance);
    const now = performance.now() / 1000;
    this.actors = ordered.map((actor, rank) => ({
      ...actor,
      start: now + rank * this.stagger,
      materials: [...new Set(actor.meshes.flatMap((mesh) => [mesh.material].flat()).filter(Boolean))],
    }));
    return this.actors.length;
  }

  async compile() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      // Compilation falls back to the first draw.
    }
  }

  update(now = performance.now() / 1000) {
    if (!this.actors.length) return;
    let pending = 0;
    for (const actor of this.actors) {
      const t = Math.min(1, Math.max(0, (now - actor.start) / this.duration));
      if (t < 1) pending += 1;
      for (const material of actor.materials) {
        const state = this.materialState.get(material);
        if (state) material.opacity = state.opacity * smooth(t);
      }
    }
    if (!pending) this.finish();
  }

  // Abandon any reveal in progress (the room is being replaced).
  cancel() {
    this.token += 1;
    this.finish();
  }

  // Restore every material to its final state.
  finish() {
    if (!this.materialState) {
      this.actors = [];
      return;
    }
    for (const { mesh, original } of this.swapped) {
      const current = [mesh.material].flat();
      if (current.some((material) => this.materialState.get(material)?.clone)) mesh.material = original;
    }
    for (const [material, state] of this.materialState) {
      material.transparent = state.transparent;
      material.opacity = state.opacity;
      if (state.clone) material.dispose();
    }
    this.materialState = null;
    this.swapped = [];
    this.actors = [];
  }
}
