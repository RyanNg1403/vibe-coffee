// GLTFLoader plugin for the MSFT_lod chains embedded by tools/optimize-assets.mjs.
//
//   loader.register((parser) => new GLTFLodPlugin(parser));
//
// Each mesh node with MSFT_lod becomes a THREE.LOD holding the original node
// (level 0) and its lower-detail nodes. Levels reuse LOD0's vertex buffers,
// materials and textures (GLTFLoader caches accessors), and skinned levels bind
// the same skeleton, so a chain costs only index buffers. Switch distances come
// from the node's `vibeLodDistances` extras (world metres after the library's
// normalization). Without this plugin, GLTFLoader ignores the LOD nodes.
//
// Build steps that rewrite GLBs without MSFT_lod registered (for example
// build-time KTX2 compression) drop the extension but keep extras and nodes;
// chains are then recovered from the `vibeLodId` / `vibeLodOf` extras mirror.
//
// Static batching or instancing must use level 0 only (`lodLevelZero`), or the
// merged geometry would draw every level at once.
import { LOD } from 'three';

export const MSFT_LOD = 'MSFT_lod';

export class GLTFLodPlugin {
  constructor(parser, { distanceScale = 1, hysteresis = 0.1 } = {}) {
    this.parser = parser;
    this.name = MSFT_LOD;
    this.distanceScale = distanceScale;
    this.hysteresis = hysteresis;
  }

  async afterRoot(gltf) {
    const { parser } = this;
    const nodeDefs = parser.json.nodes ?? [];
    const mirrored = new Map();
    nodeDefs.forEach((def, index) => {
      const owner = def.extras?.vibeLodOf;
      if (owner === undefined) return;
      if (!mirrored.has(owner)) mirrored.set(owner, []);
      mirrored.get(owner).push({ index, level: def.extras.lodLevel ?? 0 });
    });
    const chainOf = (def) => def?.extensions?.[MSFT_LOD]?.ids
      ?? mirrored.get(def?.extras?.vibeLodId)?.sort((a, b) => a.level - b.level).map(({ index }) => index);
    const targets = [];
    for (const scene of gltf.scenes) {
      scene.traverse((object) => {
        const index = parser.associations.get(object)?.nodes;
        const ids = index === undefined ? null : chainOf(nodeDefs[index]);
        if (ids?.length) targets.push({ object, ids, def: nodeDefs[index] });
      });
    }
    await Promise.all(targets.map(async ({ object, ids, def }) => {
      const levels = await Promise.all(ids.map((id) => parser.getDependency('node', id)));
      const distances = def.extras?.vibeLodDistances ?? ids.map((_, i) => 8 * (i + 1));
      const lod = new LOD();
      lod.name = `${object.name} LOD`;
      lod.position.copy(object.position);
      lod.quaternion.copy(object.quaternion);
      lod.scale.copy(object.scale);
      const parent = object.parent;
      parent.children[parent.children.indexOf(object)] = lod;
      lod.parent = parent;
      object.parent = null;
      for (const level of [object, ...levels]) {
        level.position.set(0, 0, 0);
        level.quaternion.identity();
        level.scale.set(1, 1, 1);
      }
      lod.addLevel(object, 0, this.hysteresis);
      levels.forEach((level, i) => {
        level.userData.lodLevel = i + 1;
        lod.addLevel(level, distances[i] * this.distanceScale, this.hysteresis);
      });
    }));
  }
}

// The full-detail object of a LOD (or the object itself).
export function lodLevelZero(object) {
  return object.isLOD ? object.levels[0].object : object;
}
