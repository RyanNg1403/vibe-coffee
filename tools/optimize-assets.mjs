// Runtime packaging for the model library: embedded LOD chains, meshopt
// geometry and JPEG (PNG with alpha) textures in public/models/<key>.glb.
// GPU texture compression (KTX2) happens at build time, into dist/ only.
//
// LOD chains use MSFT_lod: lower-detail nodes sit outside the scene graph and
// share LOD0's vertex buffers, materials and textures, so a loader without the
// extension renders LOD0 only. Each chain is mirrored into node extras
// (`vibeLodId` / `vibeLodOf`) because tools that read the GLB without this
// extension registered drop MSFT_lod but keep extras and the LOD nodes.
// Raw Blender exports (PNG maps) are compressed once; previously packed JPEGs
// are kept byte-identical.
//
//   node tools/optimize-assets.mjs [--keys=a,b] [--report=path]
// `--keys=` (empty) only re-measures the library into the budget report.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { MODEL_MANIFEST } from '../src/modelManifest.js';
import { MSFTLod, MSFT_LOD } from './msft-lod.mjs';

const run = promisify(execFile);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, MSFTLod]).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});

const argv = process.argv.slice(2);
const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const selected = option('keys') !== undefined ? new Set(option('keys').split(',').filter(Boolean)) : null;
const REPORT = option('report') ?? 'assets/blender/asset-budget.json';
if (selected) for (const key of selected) if (!MODEL_MANIFEST[key]) throw new Error(`Unknown model: ${key}`);

const CACHE = '/tmp/vibe-asset-textures';
await mkdir(CACHE, { recursive: true });

// Hero props and characters keep 1024 color/normal maps; ORM data and every
// other model pack to 512 as before.
const HERO_1024 = new Set(['studio_espresso', 'cat', 'pet_cat', 'pet_dog']);
const textureLimit = (key, slot) => (key.startsWith('char_atelier_') || HERO_1024.has(key)) && slot !== 'data' ? 1024 : 512;

// Meshopt error is relative to mesh extent. LOD1 is visually lossless at
// mid-range; LOD2 keeps the silhouette for far tables, the street and the deck.
const LOD_LEVELS = [
  { ratio: 0.5, error: 0.01 },
  { ratio: 0.2, error: 0.03 },
];
// LOD switch distances (metres), from the bounding radius with floors so small
// props never pop at arm's length. Matches a 50-60 degree first-person FOV.
const lodDistances = (radius) => [Math.max(4, radius * 12), Math.max(10, radius * 30)];
const screenCoverage = [0.25, 0.1];

const hash = (...parts) => {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest('hex');
};

function triangles(mesh) {
  return mesh ? mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0) : 0;
}

function sceneMeshNodes(doc) {
  const out = [];
  for (const scene of doc.getRoot().listScenes()) scene.traverse((node) => { if (node.getMesh()) out.push(node); });
  return out;
}

function stripLods(doc) {
  for (const node of doc.getRoot().listNodes()) {
    const lod = node.getExtension(MSFT_LOD);
    if (!lod) continue;
    for (const lodNode of lod.listLods()) {
      const mesh = lodNode.getMesh();
      lodNode.dispose();
      if (mesh && !mesh.listParents().some((p) => p.propertyType === 'Node')) {
        for (const prim of mesh.listPrimitives()) prim.dispose();
        mesh.dispose();
      }
    }
    lod.dispose();
    const extras = { ...node.getExtras() };
    delete extras.MSFT_screencoverage;
    delete extras.vibeLodDistances;
    delete extras.vibeLodId;
    node.setExtras(extras);
  }
}

// Runtime heights come from the loader's normalization table so LOD distances
// are in world metres after placement (sources range from armature centimetres
// to authored metres).
const loaderSource = await readFile('src/modelLoader.js', 'utf8');
function runtimeHeight(key) {
  if (key.startsWith('char_')) return 1.7;
  const match = loaderSource.match(new RegExp(`\\b${key}: \\{ height: ([0-9.]+)`));
  return match ? Number(match[1]) : 0.5;
}

// LOD primitives reuse LOD0's (already reordered and quantized) vertex
// accessors with their own index buffer: a level costs only its indices, and
// GLTFLoader shares one GPU vertex buffer across the chain.
function simplifyIndices(prim, level) {
  // Quantized positions differ from metres by one uniform scale, which leaves
  // meshopt's extent-relative error unchanged.
  const positions = Float32Array.from(prim.getAttribute('POSITION').getArray());
  const indices = new Uint32Array(prim.getIndices().getArray());
  const target = Math.floor((indices.length * level.ratio) / 3) * 3;
  let [out] = MeshoptSimplifier.simplify(indices, positions, 3, target, level.error, []);
  if (out.length > indices.length * Math.max(level.ratio * 1.6, 0.75)) {
    out = simplifyWelded(prim, positions, indices, target, level.error);
  }
  return cacheOrder(out);
}

// Vertex-cache (strip-friendly) triangle order without moving the shared
// vertices: meshopt's index codec compresses coherent order several times
// better than the simplifier's output order.
function cacheOrder(indices) {
  if (!indices.length) return indices;
  const working = Uint32Array.from(indices);
  const [remap] = MeshoptEncoder.reorderMesh(working, true, true);
  const original = new Uint32Array(remap.length);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) original[remap[i]] = i;
  return working.map((i) => original[i]);
}

// Hard-surface props split every vertex along sharp edges, so to meshopt the
// whole mesh is border and cannot collapse. Simplify a position-welded copy,
// then give each output corner the co-located source vertex whose normal best
// matches the new face: hard edges, UV sides and skin weights survive.
function simplifyWelded(prim, positions, indices, target, error) {
  const normals = prim.getAttribute('NORMAL')?.getArray();
  const count = positions.length / 3;
  const canonical = new Uint32Array(count);
  const groups = new Map();
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    if (!seen.has(key)) { seen.set(key, i); groups.set(i, []); }
    canonical[i] = seen.get(key);
    groups.get(canonical[i]).push(i);
  }
  // Simplify over unique positions only: meshopt classifies co-located vertices
  // (even unreferenced ones) as seams and would lock them.
  const roots = [...groups.keys()];
  const compact = new Map(roots.map((root, i) => [root, i]));
  const uniquePositions = new Float32Array(roots.length * 3);
  roots.forEach((root, i) => uniquePositions.set(positions.subarray(root * 3, root * 3 + 3), i * 3));
  const welded = indices.map((i) => compact.get(canonical[i]));
  const [simplified] = MeshoptSimplifier.simplify(welded, uniquePositions, 3, target, error, []);
  const out = simplified.map((i) => roots[i]);
  const result = [];
  const p = (i, axis) => positions[i * 3 + axis];
  for (let t = 0; t < out.length; t += 3) {
    const [a, b, c] = [out[t], out[t + 1], out[t + 2]];
    const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2);
    const vx = p(c, 0) - p(a, 0), vy = p(c, 1) - p(a, 1), vz = p(c, 2) - p(a, 2);
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx === 0 && fy === 0 && fz === 0) continue;
    for (const corner of [a, b, c]) {
      let best = corner, score = -Infinity;
      for (const v of groups.get(corner)) {
        const s = normals ? normals[v * 3] * fx + normals[v * 3 + 1] * fy + normals[v * 3 + 2] * fz : 0;
        if (s > score) { score = s; best = v; }
      }
      result.push(best);
    }
  }
  return Uint32Array.from(result);
}

function buildLods(doc, ext, key) {
  const sceneBounds = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  const size = sceneBounds.max.map((v, i) => v - sceneBounds.min[i]);
  const worldSpace = key.startsWith('atelier_');
  const scale = worldSpace ? 1 : runtimeHeight(key) / Math.max(1e-6, size[1]);
  const radius = (Math.max(...size) * scale) / 2;
  const perLevel = [0, 0, 0];
  // Room-wide assemblies (every table in a venue, the whole street) have no
  // single viewing distance; they keep LOD0 until they are split per cluster.
  const lodEnabled = !(worldSpace && Math.max(...size) > 6);
  let chainId = 0;
  for (const node of sceneMeshNodes(doc)) {
    const mesh = node.getMesh();
    const base = triangles(mesh);
    perLevel[0] += base;
    const chain = [];
    let previous = base;
    for (const [index, level] of LOD_LEVELS.entries()) {
      // tiny trims and screws are not worth a second draw path
      if (!lodEnabled || base < 64) break;
      const lodMesh = doc.createMesh(`${mesh.getName()} LOD${index + 1}`);
      for (const prim of mesh.listPrimitives()) {
        const lodIndices = simplifyIndices(prim, level);
        if (lodIndices.length < 3) continue;
        const source = prim.getIndices();
        const vertexCount = prim.getAttribute('POSITION').getCount();
        const indices = doc.createAccessor(`${source.getName()} LOD${index + 1}`)
          .setType('SCALAR')
          .setBuffer(source.getBuffer())
          .setArray(vertexCount <= 65535 ? new Uint16Array(lodIndices) : lodIndices);
        lodMesh.addPrimitive(prim.clone().setIndices(indices));
      }
      const count = triangles(lodMesh);
      if (count > previous * 0.85) {
        for (const prim of lodMesh.listPrimitives()) {
          const indices = prim.getIndices();
          prim.dispose();
          indices.dispose();
        }
        lodMesh.dispose();
        break;
      }
      const lodNode = doc.createNode(`${node.getName()} LOD${index + 1}`)
        .setMesh(lodMesh)
        .setTranslation(node.getTranslation())
        .setRotation(node.getRotation())
        .setScale(node.getScale())
        .setExtras({ atelier: true, lodLevel: index + 1, vibeLodOf: chainId });
      if (node.getSkin()) lodNode.setSkin(node.getSkin());
      chain.push(lodNode);
      previous = count;
    }
    for (let i = 0; i < LOD_LEVELS.length; i++) perLevel[i + 1] += i < chain.length ? triangles(chain[i].getMesh()) : previous;
    if (!chain.length) continue;
    chainId++;
    const lod = ext.createLod();
    for (const lodNode of chain) lod.addLod(lodNode);
    node.setExtension(MSFT_LOD, lod);
    node.setExtras({
      ...node.getExtras(),
      MSFT_screencoverage: screenCoverage.slice(0, chain.length + 1),
      vibeLodDistances: lodDistances(radius).slice(0, chain.length).map((d) => Number(d.toFixed(2))),
      vibeLodId: chainId - 1,
    });
  }
  return { triangles: perLevel.map(Math.round), radius: Number(radius.toFixed(3)) };
}

function textureSlots(doc) {
  const slots = new Map();
  const mark = (texture, slot) => { if (texture && !slots.has(texture)) slots.set(texture, slot); };
  for (const material of doc.getRoot().listMaterials()) {
    mark(material.getNormalTexture(), 'normal');
    mark(material.getBaseColorTexture(), material.getAlphaMode() === 'OPAQUE' ? 'color' : 'color-alpha');
    mark(material.getEmissiveTexture(), 'color');
    mark(material.getMetallicRoughnessTexture(), 'data');
    mark(material.getOcclusionTexture(), 'data');
  }
  return slots;
}

// ffmpeg qscale: color keeps near-lossless quality; normal and ORM data
// tolerate slightly more quantization at 1024px.
const JPEG_QUALITY = { color: '2', 'color-alpha': '2', normal: '3', data: '4' };

async function toJpeg(data, limit, slot) {
  const key = hash(data, `jpeg${limit}-${slot}`);
  const output = `${CACHE}/${key}.jpg`;
  try { return await readFile(output); } catch {}
  const input = `${CACHE}/${key}.in`;
  await writeFile(input, data);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', `scale='min(${limit},iw)':'min(${limit},ih)':force_original_aspect_ratio=decrease`, '-q:v', JPEG_QUALITY[slot], output]);
  return readFile(output);
}

async function toPng(data, limit) {
  const key = hash(data, `png${limit}`);
  const output = `${CACHE}/${key}.png`;
  try { return await readFile(output); } catch {}
  const input = `${CACHE}/${key}.in`;
  await writeFile(input, data);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', `scale='min(${limit},iw)':'min(${limit},ih)':force_original_aspect_ratio=decrease`, output]);
  return readFile(output);
}

async function packTextures(doc, key) {
  const slots = textureSlots(doc);
  for (const texture of doc.getRoot().listTextures()) {
    const slot = slots.get(texture) ?? 'color';
    // occlusion/roughness/metalness are low-frequency: 512 px is plenty
    const limit = textureLimit(key, slot);
    const data = texture.getImage();
    let out, mime;
    if (texture.getMimeType() === 'image/jpeg' && Math.max(...(texture.getSize() ?? [0])) <= limit) {
      out = data;
      mime = 'image/jpeg';
    } else if (slot === 'color-alpha') {
      out = await toPng(data, limit);
      mime = 'image/png';
    } else {
      out = await toJpeg(data, limit, slot);
      mime = 'image/jpeg';
    }
    texture.setImage(out).setMimeType(mime).setURI('').setName(`asset-texture-${hash(out)}`);
  }
}

const compress = (doc) => doc.transform(meshopt({
  encoder: MeshoptEncoder, level: 'high',
  quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 10,
}));

for (const key of Object.keys(MODEL_MANIFEST)) {
  if (selected && !selected.has(key)) continue;
  const path = `public/models/${key}.glb`;
  const doc = await io.read(path);
  stripLods(doc);
  // Reorder and quantize LOD0 first; LOD index buffers then address its final
  // vertex layout. EXT_meshopt_compression encodes every buffer on write.
  await compress(doc);
  const ext = doc.createExtension(MSFTLod);
  const lods = buildLods(doc, ext, key);
  if (!doc.getRoot().listNodes().some((n) => n.getExtension(MSFT_LOD))) ext.dispose();
  const staged = await io.writeBinary(doc);

  // Reading drops the encoder options; restore filtered (octahedral normal,
  // quaternion, exponential) streams so rewrites never grow the file.
  const plain = await io.readBinary(staged);
  plain.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await packTextures(plain, key);
  const plainBytes = await io.writeBinary(plain);
  await writeFile(path, plainBytes);
  console.log(`${key}: ${(plainBytes.length / 1024).toFixed(1)} KiB; triangles ${lods.triangles.join(' / ')}`);
}

// The budget report always covers the whole library, measured from disk.
function lodTriangles(doc) {
  const levels = [0, 0, 0];
  for (const node of sceneMeshNodes(doc)) {
    const chain = node.getExtension(MSFT_LOD)?.listLods() ?? [];
    let last = triangles(node.getMesh());
    levels[0] += last;
    for (let i = 1; i < levels.length; i++) {
      if (chain[i - 1]) last = triangles(chain[i - 1].getMesh());
      levels[i] += last;
    }
  }
  return levels.map(Math.round);
}
// Texture roles for the build-time KTX2 step: `color` (base color/emissive,
// sRGB), `normal` (tangent space, OpenGL +Y, linear), `orm` (one linear map:
// R occlusion, G roughness, B metalness), `metallicRoughness` / `occlusion`
// (linear, separate maps).
function textureRoles(doc) {
  const roles = new Map();
  const add = (texture, role) => {
    if (!texture) return;
    roles.set(texture, [...new Set([...(roles.get(texture) ?? []), role])]);
  };
  for (const material of doc.getRoot().listMaterials()) {
    add(material.getBaseColorTexture(), 'color');
    add(material.getEmissiveTexture(), 'color');
    add(material.getNormalTexture(), 'normal');
    add(material.getMetallicRoughnessTexture(), 'metallicRoughness');
    add(material.getOcclusionTexture(), 'occlusion');
  }
  return doc.getRoot().listTextures().map((texture) => {
    const list = roles.get(texture) ?? [];
    const role = list.includes('metallicRoughness') && list.includes('occlusion') ? 'orm' : list.join('+');
    return `${role} ${texture.getSize()?.join('x')}`;
  });
}

const report = {};
for (const key of Object.keys(MODEL_MANIFEST)) {
  const bytes = await readFile(`public/models/${key}.glb`);
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  report[key] = {
    bytes: bytes.length,
    lodTriangles: lodTriangles(doc),
    lodLevels: 1 + Math.max(0, ...root.listNodes().map((n) => n.getExtension(MSFT_LOD)?.listLods().length ?? 0)),
    materials: root.listMaterials().length,
    textures: textureRoles(doc),
    animations: root.listAnimations().map((a) => a.getName()),
  };
}

const models = Object.values(report);
const sum = (pick) => models.reduce((n, m) => n + (pick(m) ?? 0), 0);
const totals = {
  models: models.length,
  bytes: sum((m) => m.bytes),
  lod0Triangles: sum((m) => m.lodTriangles[0]),
  lod1Triangles: sum((m) => m.lodTriangles[1]),
  lod2Triangles: sum((m) => m.lodTriangles[2]),
};
await writeFile(REPORT, JSON.stringify({ totals, models: report }, null, 2) + '\n');
console.log(`${totals.models} models; ${(totals.bytes / 1048576).toFixed(2)} MiB; LOD0 ${totals.lod0Triangles} triangles`);
