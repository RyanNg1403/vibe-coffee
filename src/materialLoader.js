import * as THREE from 'three';

const MATERIAL_SETS = {
  wood: 'wood_floor',
  plaster: 'white_plaster_02',
  concrete: 'concrete_floor_painted',
};

let libraryPromise = null;

export function loadMaterialLibrary() {
  if (libraryPromise) return libraryPromise;
  const loader = new THREE.TextureLoader();
  libraryPromise = Promise.all(Object.entries(MATERIAL_SETS).map(async ([key, file]) => {
    const [map, normalMap, roughnessMap] = await Promise.all([
      loader.loadAsync(`/textures/${file}_diff.jpg`),
      loader.loadAsync(`/textures/${file}_nor_gl.jpg`),
      loader.loadAsync(`/textures/${file}_rough.jpg`),
    ]);
    map.colorSpace = THREE.SRGBColorSpace;
    return [key, { map, normalMap, roughnessMap }];
  })).then((sets) => new Map(sets)).catch((error) => {
    console.warn(`[materials] PBR library unavailable (${error.message}) — using procedural textures`);
    return new Map();
  });
  return libraryPromise;
}
