import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloneModel } from '../modelLoader.js';
import { floatGeometry } from '../rendering/floatGeometry.js';

// Bake the library wrapper's normalization into two scene-owned geometries.
// Every ordinary chair then shares two instanced draws, including shadows.
export function studioChairGeometry(models) {
  const model = cloneModel(models, 'studio_chair');
  if (!model) return null;
  model.updateMatrixWorld(true);
  const parts = { wood: [], cushion: [] };
  model.traverse((object) => {
    if (!object.isMesh) return;
    const slot = object.material.name.includes('linen') ? 'cushion' : 'wood';
    const geometry = floatGeometry(object.geometry).applyMatrix4(object.matrixWorld);
    parts[slot].push(geometry);
  });
  const result = {};
  for (const [slot, geometries] of Object.entries(parts)) {
    if (!geometries.length) {
      Object.values(parts).flat().forEach((g) => g.dispose());
      Object.values(result).forEach((g) => g.dispose());
      return null;
    }
    result[slot] = mergeGeometries(geometries, false);
    if (result[slot]) result[slot].userData = {};
  }
  Object.values(parts).flat().forEach((g) => g.dispose());
  if (!result.wood || !result.cushion) {
    Object.values(result).forEach((g) => g?.dispose());
    return null;
  }
  return result;
}
