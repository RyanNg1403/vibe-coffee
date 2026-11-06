// Video-memory accounting from the WebGL call stream.
//
// Three's renderer.info.memory only counts objects. This tracker wraps the
// context's allocation entry points (texStorage*, texImage*, compressed*,
// bufferData, renderbufferStorage*) and their deletes, so every resource the
// page owns is measured at its real size, including render targets, shadow
// maps, PMREM cubes, skeleton bone textures and anything uploaded outside the
// current scene. Sizes follow the internal format (block-compressed formats by
// block), which is what drivers allocate before padding.
//
// The wrappers only do Map bookkeeping, so they stay installed in production:
// the memory governor budgets with these numbers.

const UNCOMPRESSED_BYTES = new Map([
  [0x8058, 4], [0x8c43, 4], [0x8051, 4], [0x8c41, 4], // RGBA8 SRGB8_ALPHA8 RGB8 SRGB8 (RGB padded)
  [0x881a, 8], [0x881b, 8], [0x8814, 16], [0x8815, 16], // RGBA16F RGB16F RGBA32F RGB32F
  [0x8229, 1], [0x822b, 2], [0x822d, 2], [0x822f, 4], [0x822e, 4], [0x8230, 8], // R8 RG8 R16F RG16F R32F RG32F
  [0x8c3a, 4], [0x8c3d, 4], [0x8059, 4], [0x8056, 2], [0x8d62, 2], [0x8057, 2], // R11G11B10F RGB9E5 RGB10A2 RGBA4 RGB565 RGB5A1
  [0x8232, 1], [0x8231, 1], [0x8234, 2], [0x8233, 2], [0x8236, 4], [0x8235, 4], // R8UI R8I R16UI R16I R32UI R32I
  [0x8238, 2], [0x8237, 2], [0x823c, 8], [0x823b, 8], [0x8d7c, 4], [0x8d8e, 4], [0x8d70, 16], [0x8d82, 16],
  [0x81a5, 2], [0x81a6, 4], [0x8cac, 4], [0x88f0, 4], [0x8cad, 8], [0x8d48, 1], // depth / stencil
]);
const UNSIZED_CHANNELS = new Map([
  [0x1908, 4], [0x1907, 3], [0x1909, 1], [0x190a, 2], [0x1906, 1], [0x1903, 1], [0x8227, 2],
  [0x1902, 1], [0x84f9, 1],
]);
const TYPE_BYTES = new Map([
  [0x1401, 1], [0x1400, 1], [0x1403, 2], [0x1402, 2], [0x1405, 4], [0x1404, 4], [0x1406, 4], [0x140b, 2], [0x8d61, 2],
  [0x8363, 2], [0x8033, 2], [0x8034, 2], [0x84fa, 4], [0x8368, 4], [0x8c3b, 4], [0x8c3e, 4], [0x8dad, 8],
]);
// [blockWidth, blockHeight, bytesPerBlock]
const BLOCK_FORMATS = new Map([
  [0x83f0, [4, 4, 8]], [0x83f1, [4, 4, 8]], [0x83f2, [4, 4, 16]], [0x83f3, [4, 4, 16]],
  [0x8c4c, [4, 4, 8]], [0x8c4d, [4, 4, 8]], [0x8c4e, [4, 4, 16]], [0x8c4f, [4, 4, 16]],
  [0x8d64, [4, 4, 8]],
  [0x9270, [4, 4, 8]], [0x9271, [4, 4, 8]], [0x9272, [4, 4, 16]], [0x9273, [4, 4, 16]],
  [0x9274, [4, 4, 8]], [0x9275, [4, 4, 8]], [0x9276, [4, 4, 8]], [0x9277, [4, 4, 8]],
  [0x9278, [4, 4, 16]], [0x9279, [4, 4, 16]],
  [0x8e8c, [4, 4, 16]], [0x8e8d, [4, 4, 16]], [0x8e8e, [4, 4, 16]], [0x8e8f, [4, 4, 16]],
  [0x8dbb, [4, 4, 8]], [0x8dbc, [4, 4, 8]], [0x8dbd, [4, 4, 16]], [0x8dbe, [4, 4, 16]],
]);
const ASTC_BLOCKS = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8],
  [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];
ASTC_BLOCKS.forEach(([w, h], index) => {
  BLOCK_FORMATS.set(0x93b0 + index, [w, h, 16]);
  BLOCK_FORMATS.set(0x93d0 + index, [w, h, 16]);
});

const TEXTURE_CUBE_MAP = 0x8513;
const CUBE_FACE_FIRST = 0x8515;
const CUBE_FACE_LAST = 0x851a;
const TEXTURE_3D = 0x806f;
const TEXTURE0 = 0x84c0;

export function levelBytes(internalFormat, width, height, depth = 1, type = 0x1401) {
  width = Math.max(1, width | 0);
  height = Math.max(1, height | 0);
  const block = BLOCK_FORMATS.get(internalFormat);
  if (block) return Math.ceil(width / block[0]) * Math.ceil(height / block[1]) * block[2] * depth;
  if (internalFormat === 0x8c00 || internalFormat === 0x8c02) return (Math.max(width, 8) * Math.max(height, 8) * depth) / 2;
  if (internalFormat === 0x8c01 || internalFormat === 0x8c03) return (Math.max(width, 16) * Math.max(height, 8) * depth) / 4;
  const sized = UNCOMPRESSED_BYTES.get(internalFormat);
  const texel = sized ?? (UNSIZED_CHANNELS.get(internalFormat) ?? 4) * (TYPE_BYTES.get(type) ?? 1);
  return width * height * depth * texel;
}

export function storageBytes(internalFormat, levels, width, height, depth = 1, { cube = false, volume = false } = {}) {
  let total = 0;
  for (let level = 0; level < levels; level += 1) {
    total += levelBytes(internalFormat, width >> level, height >> level, volume ? Math.max(1, depth >> level) : depth);
  }
  return total * (cube ? 6 : 1);
}

function sourceSize(source) {
  if (!source) return [0, 0];
  return [source.videoWidth || source.naturalWidth || source.displayWidth || source.width || 0,
    source.videoHeight || source.naturalHeight || source.displayHeight || source.height || 0];
}

export function trackGpuMemory(gl) {
  if (!gl || gl.__vibeGpuMemory) return gl?.__vibeGpuMemory ?? null;
  const textures = new Map(); // WebGLTexture -> { bytes, levels: Map, renderTarget }
  const buffers = new Map(); // WebGLBuffer -> bytes
  const renderbuffers = new Map(); // WebGLRenderbuffer -> bytes
  const units = [new Map()];
  let activeUnit = 0;
  const boundBuffers = new Map();
  let boundRenderbuffer = null;
  const totals = { textures: 0, renderTargets: 0, buffers: 0, renderbuffers: 0 };
  let peakTotal = 0;

  const bound = (target) => units[activeUnit]?.get(
    target >= CUBE_FACE_FIRST && target <= CUBE_FACE_LAST ? TEXTURE_CUBE_MAP : target,
  ) ?? null;
  const record = (texture) => {
    let entry = textures.get(texture);
    if (!entry) {
      entry = { bytes: 0, levels: null, renderTarget: false, immutable: false };
      textures.set(texture, entry);
    }
    return entry;
  };
  const addTexture = (entry, delta) => {
    entry.bytes += delta;
    totals[entry.renderTarget ? 'renderTargets' : 'textures'] += delta;
    notePeak();
  };
  const notePeak = () => {
    const total = totals.textures + totals.renderTargets + totals.buffers + totals.renderbuffers;
    if (total > peakTotal) peakTotal = total;
  };
  const setLevel = (target, level, bytes) => {
    const texture = bound(target);
    if (!texture) return;
    const entry = record(texture);
    if (entry.immutable) return; // texStorage already counted every level
    entry.levels ??= new Map();
    const key = target * 64 + level;
    const previous = entry.levels.get(key) ?? 0;
    entry.levels.set(key, bytes);
    addTexture(entry, bytes - previous);
  };

  const wrap = (name, after) => {
    const original = gl[name];
    if (typeof original !== 'function') return;
    gl[name] = function wrapped(...args) {
      const result = original.apply(gl, args);
      after(args, result);
      return result;
    };
  };

  wrap('activeTexture', ([unit]) => {
    activeUnit = unit - TEXTURE0;
    units[activeUnit] ??= new Map();
  });
  wrap('bindTexture', ([target, texture]) => { units[activeUnit].set(target, texture); });
  wrap('texStorage2D', ([target, levels, format, width, height]) => {
    const texture = bound(target);
    if (!texture) return;
    const entry = record(texture);
    addTexture(entry, -entry.bytes);
    entry.immutable = true;
    entry.levels = null;
    entry.shape = `${width}x${height}${target === TEXTURE_CUBE_MAP ? 'x6' : ''} fmt 0x${format.toString(16)} L${levels}`;
    addTexture(entry, storageBytes(format, levels, width, height, 1, { cube: target === TEXTURE_CUBE_MAP }));
  });
  wrap('texStorage3D', ([target, levels, format, width, height, depth]) => {
    const texture = bound(target);
    if (!texture) return;
    const entry = record(texture);
    addTexture(entry, -entry.bytes);
    entry.immutable = true;
    entry.levels = null;
    addTexture(entry, storageBytes(format, levels, width, height, depth, { volume: target === TEXTURE_3D }));
  });
  wrap('texImage2D', (args) => {
    const [target, level, format] = args;
    let width; let height; let type;
    if (args.length >= 8) [, , , width, height, , , type] = args;
    else {
      [width, height] = sourceSize(args[5]);
      type = args[4];
    }
    setLevel(target, level, levelBytes(format, width, height, 1, type));
  });
  wrap('texImage3D', ([target, level, format, width, height, depth, , , type]) => {
    setLevel(target, level, levelBytes(format, width, height, depth, type));
  });
  wrap('compressedTexImage2D', ([target, level, format, width, height]) => {
    setLevel(target, level, levelBytes(format, width, height));
  });
  wrap('compressedTexImage3D', ([target, level, format, width, height, depth]) => {
    setLevel(target, level, levelBytes(format, width, height, depth));
  });
  wrap('generateMipmap', ([target]) => {
    const texture = bound(target);
    const entry = texture && textures.get(texture);
    if (!entry || entry.immutable || !entry.levels) return;
    const base = entry.levels.get(target * 64) ?? 0;
    addTexture(entry, Math.round(base / 3));
    entry.levels.set(target * 64 + 63, (entry.levels.get(target * 64 + 63) ?? 0) + Math.round(base / 3));
  });
  wrap('deleteTexture', ([texture]) => {
    const entry = textures.get(texture);
    if (!entry) return;
    addTexture(entry, -entry.bytes);
    textures.delete(texture);
  });
  wrap('framebufferTexture2D', ([, , , texture]) => {
    const entry = texture && textures.get(texture);
    if (!entry || entry.renderTarget) return;
    totals.textures -= entry.bytes;
    totals.renderTargets += entry.bytes;
    entry.renderTarget = true;
  });
  wrap('framebufferTextureLayer', ([, , texture]) => {
    const entry = texture && textures.get(texture);
    if (!entry || entry.renderTarget) return;
    totals.textures -= entry.bytes;
    totals.renderTargets += entry.bytes;
    entry.renderTarget = true;
  });

  wrap('bindBuffer', ([target, buffer]) => { boundBuffers.set(target, buffer); });
  wrap('bindBufferBase', ([target, , buffer]) => { boundBuffers.set(target, buffer); });
  wrap('bindBufferRange', ([target, , buffer]) => { boundBuffers.set(target, buffer); });
  wrap('bufferData', ([target, data, , srcOffset, length]) => {
    const buffer = boundBuffers.get(target);
    if (!buffer) return;
    let bytes = typeof data === 'number' ? data : data?.byteLength ?? 0;
    if (length && data?.BYTES_PER_ELEMENT) bytes = length * data.BYTES_PER_ELEMENT;
    else if (srcOffset && data?.BYTES_PER_ELEMENT) bytes -= srcOffset * data.BYTES_PER_ELEMENT;
    totals.buffers += bytes - (buffers.get(buffer) ?? 0);
    buffers.set(buffer, bytes);
    notePeak();
  });
  wrap('deleteBuffer', ([buffer]) => {
    if (!buffers.has(buffer)) return;
    totals.buffers -= buffers.get(buffer);
    buffers.delete(buffer);
  });

  wrap('bindRenderbuffer', ([, renderbuffer]) => { boundRenderbuffer = renderbuffer; });
  const renderbufferShapes = new WeakMap();
  const storeRenderbuffer = (format, width, height, samples) => {
    if (!boundRenderbuffer) return;
    const bytes = levelBytes(format, width, height) * Math.max(1, samples);
    totals.renderbuffers += bytes - (renderbuffers.get(boundRenderbuffer) ?? 0);
    renderbuffers.set(boundRenderbuffer, bytes);
    renderbufferShapes.set(boundRenderbuffer, `${width}x${height} fmt 0x${format.toString(16)} x${Math.max(1, samples)}`);
    notePeak();
  };
  wrap('renderbufferStorage', ([, format, width, height]) => storeRenderbuffer(format, width, height, 1));
  wrap('renderbufferStorageMultisample', ([, samples, format, width, height]) => storeRenderbuffer(format, width, height, samples));
  wrap('deleteRenderbuffer', ([renderbuffer]) => {
    if (!renderbuffers.has(renderbuffer)) return;
    totals.renderbuffers -= renderbuffers.get(renderbuffer);
    renderbuffers.delete(renderbuffer);
  });

  const tracker = {
    // Default framebuffer: colour + depth, multisampled when antialiased.
    drawingBufferBytes() {
      const attributes = gl.getContextAttributes?.() ?? {};
      const samples = attributes.antialias ? 4 : 1;
      return gl.drawingBufferWidth * gl.drawingBufferHeight * (4 + (attributes.depth === false ? 0 : 4)) * samples;
    },
    snapshot() {
      const drawingBuffer = tracker.drawingBufferBytes();
      const total = totals.textures + totals.renderTargets + totals.buffers + totals.renderbuffers + drawingBuffer;
      return {
        textures: totals.textures,
        renderTargets: totals.renderTargets,
        buffers: totals.buffers,
        renderbuffers: totals.renderbuffers,
        drawingBuffer,
        total,
        peak: peakTotal + drawingBuffer,
        counts: { textures: textures.size, buffers: buffers.size, renderbuffers: renderbuffers.size },
      };
    },
    get totalBytes() {
      return totals.textures + totals.renderTargets + totals.buffers + totals.renderbuffers;
    },
    resetPeak() { peakTotal = tracker.totalBytes; },
    // Largest allocations, for diagnosis (window.__vibe.gpuAllocations()).
    largest(limit = 20) {
      const rows = [];
      for (const entry of textures.values()) {
        rows.push({ kind: entry.renderTarget ? 'render target' : 'texture', MB: entry.bytes / 1048576, shape: entry.shape ?? 'mutable' });
      }
      for (const [renderbuffer, bytes] of renderbuffers) {
        rows.push({ kind: 'renderbuffer', MB: bytes / 1048576, shape: renderbufferShapes.get(renderbuffer) });
      }
      return rows.sort((a, b) => b.MB - a.MB).slice(0, limit)
        .map((row) => ({ ...row, MB: Number(row.MB.toFixed(2)) }));
    },
    // Context loss frees everything at once.
    clear() {
      textures.clear();
      buffers.clear();
      renderbuffers.clear();
      for (const key of Object.keys(totals)) totals[key] = 0;
    },
  };
  Object.defineProperty(gl, '__vibeGpuMemory', { value: tracker });
  return tracker;
}
