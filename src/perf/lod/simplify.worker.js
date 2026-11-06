// Generates index-only LOD levels off the main thread. Every level reuses the
// source vertex buffer (skin weights, UVs and morph targets stay valid), so
// only a smaller index buffer reaches the GPU.
import { MeshoptSimplifier } from 'meshoptimizer';

// Normal deviation counts toward the error budget, so a level never trades
// silhouette accuracy for visible shading swim across larger triangles.
const NORMAL_WEIGHT = 0.5;

self.onmessage = async ({ data }) => {
  const { id, positions, normals, indices, ratios, maxError } = data;
  try {
    await MeshoptSimplifier.ready;
    MeshoptSimplifier.useExperimentalFeatures = true;
    const scale = MeshoptSimplifier.getScale(positions, 3);
    const levels = [];
    for (const ratio of ratios) {
      const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
      // LockBorder keeps open edges fixed so separately skinned parts (body,
      // garments, hair) and UV islands never open cracks against each other.
      const [result, error] = normals
        ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, normals, 3,
          [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT], null, target, maxError, ['LockBorder'])
        : MeshoptSimplifier.simplify(indices, positions, 3, target, maxError, ['LockBorder']);
      levels.push({ indices: result, indexCount: result.length, error });
    }
    self.postMessage({ id, scale, levels }, levels.map((level) => level.indices.buffer));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
