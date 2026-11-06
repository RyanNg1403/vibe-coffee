// Build-time GPU texture compression for the deployed app.
//
//   npm run build            # vite build, then this step on dist/models
//   node tools/compress-textures.mjs [--in=public/models] [--out=dist/models]
//
// Every texture inside every GLB is re-encoded as KTX2 / Basis Universal with
// a full mip chain and tagged KHR_texture_basisu, chosen by role:
//   colour (base colour, emissive, sheen/specular colour): ETC1S, sRGB
//   normal maps: UASTC, linear (ETC1S block artefacts read as shading noise)
//   occlusion/roughness/metalness (ORM) and other data: ETC1S, linear
// At runtime they transcode to the GPU's native block format (BC1/BC7, ETC,
// ASTC), so a 1024² atlas occupies ~0.7-1.4 MB of video memory instead of
// ~5.6 MB as RGBA8 with mips. A texture used in two roles stays as it is.
// MSFT_lod chains (PR #26's baked LODs) are read and written back intact.
//
// This is the only KTX2 path: source GLBs in public/models are never modified, so Blender re-exports do
// not conflict with this step. Requires `toktx` (KhronosGroup/KTX-Software
// v4.x) on PATH or in $TOKTX, plus ffmpeg; without them the build keeps the
// original textures and prints a warning.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { MODEL_MANIFEST } from '../src/modelManifest.js';
import { MSFTLod } from './msft-lod.mjs';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Map(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, value] = arg.slice(2).split('=');
  return [key, value ?? true];
}));
const inputDir = resolve(root, String(args.get('in') ?? 'public/models'));
const outputDir = resolve(root, String(args.get('out') ?? 'dist/models'));
const cacheDir = join(root, '.texture-cache');
// Encoder settings are part of the cache key: changing them re-encodes.
const ETC1S = ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '255', '--genmipmap'];
const ENCODINGS = {
  color: [...ETC1S, '--assign_oetf', 'srgb'],
  data: [...ETC1S, '--assign_oetf', 'linear'],
  // RDO trades imperceptible error for much better zstd compression.
  normal: ['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.5', '--zcmp', '19',
    '--genmipmap', '--assign_oetf', 'linear'],
};

async function findTool(command, versionFlag) {
  if (!command) return null;
  try {
    await run(command, [versionFlag]);
    return command;
  } catch {
    return null;
  }
}

const EXTENSION_SLOTS = {
  color: ['getSheenColorTexture', 'getSpecularColorTexture'],
  normal: ['getClearcoatNormalTexture'],
  data: ['getSheenRoughnessTexture', 'getSpecularTexture', 'getClearcoatTexture', 'getClearcoatRoughnessTexture',
    'getTransmissionTexture', 'getThicknessTexture', 'getIridescenceTexture', 'getIridescenceThicknessTexture'],
};

// texture -> 'color' | 'normal' | 'data'; textures with mixed roles are left out.
function textureRoles(document) {
  const roles = new Map();
  const mixed = new Set();
  const record = (texture, role) => {
    if (!texture) return;
    if (roles.has(texture) && roles.get(texture) !== role) mixed.add(texture);
    roles.set(texture, role);
  };
  for (const material of document.getRoot().listMaterials()) {
    record(material.getBaseColorTexture(), 'color');
    record(material.getEmissiveTexture(), 'color');
    record(material.getNormalTexture(), 'normal');
    record(material.getOcclusionTexture(), 'data');
    record(material.getMetallicRoughnessTexture(), 'data');
    for (const extension of material.listExtensions?.() ?? []) {
      for (const [role, getters] of Object.entries(EXTENSION_SLOTS)) {
        for (const getter of getters) if (typeof extension[getter] === 'function') record(extension[getter](), role);
      }
    }
  }
  for (const texture of mixed) roles.delete(texture);
  for (const texture of [...roles.keys()]) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(texture.getMimeType())) roles.delete(texture);
  }
  return roles;
}

async function encode(pixels, role, { toktx, ffmpeg }) {
  const encoding = ENCODINGS[role];
  const key = createHash('sha256').update(pixels).update(encoding.join(' ')).digest('hex');
  const cached = join(cacheDir, `${key}.ktx2`);
  if (existsSync(cached)) return readFile(cached);
  const work = join(tmpdir(), `vibe-ktx-${key}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await writeFile(`${work}.src`, pixels);
  // toktx's JPEG reader rejects some chroma subsampling modes; PNG is exact.
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${work}.src`, '-pix_fmt', 'rgba', `${work}.png`]);
  await run(toktx, [...encoding, `${work}.ktx2`, `${work}.png`]);
  const bytes = await readFile(`${work}.ktx2`);
  await writeFile(cached, bytes);
  await Promise.all(['src', 'png', 'ktx2'].map((ext) => rm(`${work}.${ext}`, { force: true })));
  return bytes;
}

async function pool(items, limit, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

const toktx = await findTool(process.env.TOKTX ?? 'toktx', '--version');
const ffmpeg = await findTool(process.env.FFMPEG ?? 'ffmpeg', '-version');
if (!toktx || !ffmpeg) {
  console.warn(`[compress-textures] skipped: ${!toktx ? 'toktx (KTX-Software) ' : ''}${!ffmpeg ? 'ffmpeg ' : ''}not found. `
    + 'The build keeps its original JPEG/PNG textures.');
  process.exit(0);
}
if (!existsSync(inputDir)) throw new Error(`No models directory at ${inputDir}`);
await mkdir(outputDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, MSFTLod]).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

// Only models the app can fetch; files without textures stay byte-identical
// to the copies Vite already placed in the output.
const shipped = new Set(Object.values(MODEL_MANIFEST).map(({ url }) => url.split('/').pop()));
const files = (await readdir(inputDir)).filter((file) => file.endsWith('.glb') && shipped.has(file));
const totals = { files: 0, textures: 0, before: 0, after: 0, gpuBefore: 0, gpuAfter: 0, lodChains: 0,
  byRole: { color: [0, 0, 0], normal: [0, 0, 0], data: [0, 0, 0] } };
const startedAt = Date.now();
await pool(files, Math.max(1, cpus().length - 1), async (file) => {
  const source = join(inputDir, file);
  const document = await io.read(source);
  const roles = textureRoles(document);
  if (!roles.size) {
    if (inputDir !== outputDir) await writeFile(join(outputDir, file), await readFile(source));
    totals.files += 1;
    return;
  }
  {
    for (const [texture, role] of roles) {
      const original = texture.getImage();
      const [width, height] = texture.getSize() ?? [0, 0];
      const encoded = await encode(original, role, { toktx, ffmpeg });
      totals.textures += 1;
      totals.before += original.byteLength;
      totals.after += encoded.byteLength;
      totals.byRole[role][0] += 1;
      totals.byRole[role][1] += original.byteLength;
      totals.byRole[role][2] += encoded.byteLength;
      totals.gpuBefore += width * height * 4 * 4 / 3;
      totals.gpuAfter += width * height * 4 / 3; // 8 bpp class (BC7/ASTC); BC1/ETC halves this
      texture.setImage(encoded).setMimeType('image/ktx2');
    }
    document.createExtension(KHRTextureBasisu).setRequired(true);
    // Re-encode geometry the way tools/pack-atelier-models.mjs packed it
    // (already quantized; 'filter' matches meshopt level 'high').
    const meshopt = document.getRoot().listExtensionsUsed().find((extension) => extension.extensionName === 'EXT_meshopt_compression');
    meshopt?.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    totals.lodChains += document.getRoot().listNodes().filter((node) => node.getExtension('MSFT_lod')).length;
  }
  await io.write(join(outputDir, file), document);
  totals.files += 1;
});

const mb = (bytes) => (bytes / 1048576).toFixed(2);
console.log(`[compress-textures] ${totals.files} models, ${totals.textures} textures → KTX2 in ${((Date.now() - startedAt) / 1000).toFixed(1)} s; `
  + `${totals.lodChains} MSFT_lod chains preserved`);
for (const [role, [count, before, after]] of Object.entries(totals.byRole)) {
  if (count) console.log(`  ${role}: ${count} textures, ${mb(before)} MB → ${mb(after)} MB`);
}
console.log(`  texture download ${mb(totals.before)} MB → ${mb(totals.after)} MB; `
  + `GPU memory ${mb(totals.gpuBefore)} MB → ≤${mb(totals.gpuAfter)} MB`);
