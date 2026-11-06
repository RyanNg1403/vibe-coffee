// Blender-baked LOD chains (MSFT_lod, written by tools/optimize-assets.mjs)
// take precedence over runtime simplification.
//
// Instead of restructuring the scene into THREE.LOD objects, the chain is
// recorded against LOD0's geometry: the scene graph keeps only level 0 (so
// static batching, instancing and cloning see full detail and nothing else),
// and LodManager swaps the index-only level geometries in at render time.
// Levels share LOD0's vertex attributes (GLTFLoader caches accessors), so a
// chain costs only index buffers.
export const MSFT_LOD = 'MSFT_lod';

// LOD0 geometry -> [{ geometry, distance }] (distance in world metres at the
// reference resolution, from the node's `vibeLodDistances` extras).
export const bakedLevels = new WeakMap();

function meshesOf(object) {
  if (object.isMesh) return [object];
  return object.children.filter((child) => child.isMesh);
}

export class BakedLodPlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = MSFT_LOD;
  }

  async afterRoot(gltf) {
    const { parser } = this;
    const nodeDefs = parser.json.nodes ?? [];
    // Tools that rewrite a GLB without MSFT_lod registered drop the extension
    // but keep nodes and extras; PR #26 mirrors each chain there
    // (`vibeLodId` on LOD0, `vibeLodOf` + `lodLevel` on its levels).
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
      const base = meshesOf(object);
      base.forEach((mesh, primitive) => {
        const chain = [];
        levels.forEach((level, i) => {
          const levelMesh = meshesOf(level)[primitive];
          const geometry = levelMesh?.geometry;
          // Only index-only levels over the same vertices can be swapped in.
          if (!geometry?.index || geometry.attributes.position !== mesh.geometry.attributes.position) return;
          geometry.userData.lodLevel = i + 1;
          chain.push({ geometry, distance: distances[i] });
        });
        if (chain.length) bakedLevels.set(mesh.geometry, chain);
      });
    }));
  }
}

// Picks a baked level by distance; thresholds scale with rendered height so
// a lower render resolution switches earlier, like the screen-space path.
export function selectBakedLevel(chain, distance, viewportHeightPx, current = 0, hysteresis = 0.1, referenceHeightPx = 900) {
  const scaled = distance * (referenceHeightPx / Math.max(1, viewportHeightPx));
  let level = 0;
  for (let index = 0; index < chain.length; index += 1) {
    const threshold = chain[index].distance * (index + 1 <= current ? 1 - hysteresis : 1 + hysteresis);
    if (scaled >= threshold) level = index + 1;
    else break;
  }
  return level;
}
