import { Float32BufferAttribute } from 'three';

// Meshopt stores normalized integer attributes. Decode them before baking a
// world transform, otherwise transformed positions clamp to the integer range.
// The returned geometry belongs to the scene; library buffers stay untouched.
export function floatGeometry(source) {
  const geometry = source.clone();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!attribute.normalized && !attribute.isInterleavedBufferAttribute && attribute.array instanceof Float32Array) continue;
    const values = new Float32Array(attribute.count * attribute.itemSize);
    const getters = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < attribute.count; i++) {
      for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute[getters[c]](i);
    }
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
  }
  geometry.userData = {};
  return geometry;
}
