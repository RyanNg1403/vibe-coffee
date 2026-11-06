// Where the tab's memory goes: GPU (measured from the WebGL call stream), CPU
// copies of geometry and images still referenced by the scene or the model
// library, decoded audio and the JS heap. Used by the perf HUD, the memory
// governor and tools/memory-mobile-audit.mjs.

const MB = 1048576;

function imageBytes(texture) {
  if (texture.isCompressedTexture) {
    let bytes = 0;
    for (const mip of texture.mipmaps ?? []) bytes += mip?.data?.byteLength ?? 0;
    return bytes;
  }
  const image = texture.image;
  if (!image || image.released) return 0;
  if (image.data?.byteLength) return image.data.byteLength;
  if (Array.isArray(image)) return image.reduce((sum, face) => sum + (face?.width ?? 0) * (face?.height ?? 0) * 4, 0);
  return (image.width ?? 0) * (image.height ?? 0) * 4;
}

function arrayOf(attribute) {
  return attribute?.isInterleavedBufferAttribute ? attribute.data.array : attribute?.array;
}

// CPU-side bytes still referenced by objects under the given roots.
export function cpuResourceBytes(roots) {
  const arrays = new Set();
  const textures = new Set();
  const geometries = new Set();
  const visit = (object) => {
    const geometry = object.geometry;
    if (geometry && !geometries.has(geometry)) {
      geometries.add(geometry);
      for (const attribute of Object.values(geometry.attributes)) arrays.add(arrayOf(attribute));
      for (const list of Object.values(geometry.morphAttributes ?? {})) for (const attribute of list) arrays.add(arrayOf(attribute));
      if (geometry.index) arrays.add(geometry.index.array);
      if (geometry.boundsTree?._roots) for (const root of geometry.boundsTree._roots) arrays.add(root);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (object.skeleton?.boneTexture) textures.add(object.skeleton.boneTexture);
  };
  for (const root of roots) root?.traverse?.(visit);
  let geometryBytes = 0;
  for (const array of arrays) geometryBytes += array?.byteLength ?? 0;
  let imageTotal = 0;
  for (const texture of textures) imageTotal += imageBytes(texture);
  return { geometryBytes, imageBytes: imageTotal, geometries: geometries.size, textures: textures.size };
}

export function audioBytes(buffers) {
  let bytes = 0;
  for (const { buffer } of buffers?.values?.() ?? []) {
    if (buffer) bytes += buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  }
  return bytes;
}

export function jsHeap() {
  const memory = typeof performance !== 'undefined' ? performance.memory : null;
  return memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit } : null;
}

const toMB = (bytes) => (bytes === null || bytes === undefined ? null : Number((bytes / MB).toFixed(1)));

// One snapshot, in MB. `estimate` adds what lives outside the V8 heap
// (decoded images, audio, video memory) to the heap, so it tracks the tab's
// footprint on browsers without performance.memory too (heap reads null).
export function memoryReport({ gpu, roots = [], audio = null, library = null } = {}) {
  const heap = jsHeap();
  const cpu = cpuResourceBytes(roots);
  const gpuSnapshot = gpu?.snapshot() ?? null;
  const audioTotal = audioBytes(audio);
  const estimate = (heap?.used ?? 0) + cpu.imageBytes + audioTotal + (gpuSnapshot?.total ?? 0);
  return {
    heapMB: toMB(heap?.used),
    heapLimitMB: toMB(heap?.limit),
    gpu: gpuSnapshot && {
      texturesMB: toMB(gpuSnapshot.textures),
      renderTargetsMB: toMB(gpuSnapshot.renderTargets + gpuSnapshot.renderbuffers + gpuSnapshot.drawingBuffer),
      buffersMB: toMB(gpuSnapshot.buffers),
      totalMB: toMB(gpuSnapshot.total),
      peakMB: toMB(gpuSnapshot.peak),
      counts: gpuSnapshot.counts,
    },
    cpu: {
      geometryMB: toMB(cpu.geometryBytes),
      imagesMB: toMB(cpu.imageBytes),
      geometries: cpu.geometries,
      textures: cpu.textures,
    },
    audioMB: toMB(audioTotal),
    library,
    estimateMB: toMB(estimate),
  };
}
