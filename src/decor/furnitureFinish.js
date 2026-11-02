import { Color } from 'three';

// Linear RGB values match the Blender collection's neutral timber atlas.
export const FURNITURE_FINISHES = {
  goldenhour: { timber: [0.76, 0.55, 0.35], linen: [0.84, 0.87, 0.90], roughness: 0.97 },
  roastery: { timber: [0.52, 0.43, 0.34], linen: [0.18, 0.22, 0.24], roughness: 0.93 },
  midnight: { timber: [0.25, 0.19, 0.15], linen: [0.25, 0.055, 0.065], roughness: 0.90 },
  terrace: { timber: [0.82, 0.83, 0.72], linen: [0.48, 0.60, 0.46], roughness: 1 },
};

// A venue owns its recolored materials; the library still owns their textures.
// Reuse one variant per source material so matching furniture can batch together.
export function applyFurnitureFinish(root, finish, cache) {
  root.traverse(object => {
    if (!object.isMesh) return;
    const recolor = source => {
      const name = source.name.toLowerCase();
      const tint = name.includes('linen') ? finish.linen
        : name.startsWith('collection /') && /timber|walnut/.test(name) ? finish.timber : null;
      if (!tint) return source;
      const key = `${source.uuid}:${tint.join(',')}`;
      if (!cache.has(key)) {
        const material = source.clone();
        material.color.copy(new Color(...tint));
        if (tint === finish.timber) material.roughness = finish.roughness;
        delete material.userData.vibeShared;
        delete material.userData.shared;
        cache.set(key, material);
      }
      return cache.get(key);
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(recolor) : recolor(object.material);
  });
  return root;
}
