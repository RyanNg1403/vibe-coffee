// Build-time GPU texture compression for the deployed app.
//
//   npm run build            # vite build, then this step on dist/models
//   node tools/compress-textures.mjs [--in=public/models] [--out=dist/models]
//
// Colour textures (base colour, emissive, sheen/specular colour) inside every
// GLB are re-encoded as KTX2 / Basis ETC1S with a full mip chain and tagged
// KHR_texture_basisu. At runtime they transcode to the GPU's native block
// format (BC1/BC7, ETC, ASTC), so a 1024² atlas occupies ~0.7-1.4 MB of video
// memory instead of ~5.6 MB as RGBA8 with mips, and usually downloads smaller
// than the JPEG it replaces. Data textures (normal, roughness/metalness,
// occlusion) are left untouched: ETC1S block artefacts read as shading noise.
//
// Source GLBs in public/models are never modified, so Blender re-exports do
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
const ETC1S_ARGS = ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '255', '--genmipmap'];
const COLOR_SLOTS = ['baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture'];

async function findTool(command, versionFlag) {
  if (!command) return null;
  try {
    await run(command, [versionFlag]);
    return command;
  } catch {
    return null;
  }
}

function colorTextures(document) {
  const color = new Set();
  const data = new Set();
  for (const material of document.getRoot().listMaterials()) {
    const used = new Map();
    const record = (texture, isColor) => {
      if (!texture) return;
      (isColor ? color : data).add(texture);
      used.set(texture, isColor);
    };
    record(material.getBaseColorTexture(), true);
    record(material.getEmissiveTexture(), true);
    record(material.getNormalTexture(), false);
    record(material.getOcclusionTexture(), false);
    record(material.getMetallicRoughnessTexture(), false);
    for (const extension of material.listExtensions?.() ?? []) {
      for (const slot of COLOR_SLOTS) {
        const getter = `get${slot[0].toUpperCase()}${slot.slice(1)}`;
        if (typeof extension[getter] === 'function') record(extension[getter](), true);
      }
      for (const getter of ['getSheenRoughnessTexture', 'getSpecularTexture', 'getClearcoatTexture',
        'getClearcoatRoughnessTexture', 'getClearcoatNormalTexture', 'getTransmissionTexture',
        'getThicknessTexture', 'getIridescenceTexture', 'getIridescenceThicknessTexture']) {
        if (typeof extension[getter] === 'function') record(extension[getter](), false);
      }
    }
  }
  // A texture shared by a colour and a data slot stays uncompressed.
  return [...color].filter((texture) => !data.has(texture)
    && ['image/jpeg', 'image/png', 'image/webp'].includes(texture.getMimeType()));
}

async function encode(pixels, { toktx, ffmpeg }) {
  const key = createHash('sha256').update(pixels).update(ETC1S_ARGS.join(' ')).digest('hex');
  const cached = join(cacheDir, `${key}.ktx2`);
  if (existsSync(cached)) return readFile(cached);
  const work = join(tmpdir(), `vibe-ktx-${key}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await writeFile(`${work}.src`, pixels);
  // toktx's JPEG reader rejects some chroma subsampling modes; PNG is exact.
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${work}.src`, '-pix_fmt', 'rgba', `${work}.png`]);
  await run(toktx, [...ETC1S_ARGS, '--assign_oetf', 'srgb', `${work}.ktx2`, `${work}.png`]);
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
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

// Only models the app can fetch; files without colour textures stay
// byte-identical to the copies Vite already placed in the output.
const shipped = new Set(Object.values(MODEL_MANIFEST).map(({ url }) => url.split('/').pop()));
const files = (await readdir(inputDir)).filter((file) => file.endsWith('.glb') && shipped.has(file));
const totals = { files: 0, textures: 0, before: 0, after: 0, gpuBefore: 0, gpuAfter: 0 };
const startedAt = Date.now();
await pool(files, Math.max(1, cpus().length - 1), async (file) => {
  const source = join(inputDir, file);
  const document = await io.read(source);
  const textures = colorTextures(document);
  if (!textures.length) {
    if (inputDir !== outputDir) await writeFile(join(outputDir, file), await readFile(source));
    totals.files += 1;
    return;
  }
  {
    for (const texture of textures) {
      const original = texture.getImage();
      const [width, height] = texture.getSize() ?? [0, 0];
      const encoded = await encode(original, { toktx, ffmpeg });
      totals.textures += 1;
      totals.before += original.byteLength;
      totals.after += encoded.byteLength;
      totals.gpuBefore += width * height * 4 * 4 / 3;
      totals.gpuAfter += width * height * 4 / 3; // 8 bpp class (BC7/ASTC); BC1/ETC halves this
      texture.setImage(encoded).setMimeType('image/ktx2');
    }
    document.createExtension(KHRTextureBasisu).setRequired(true);
    // Re-encode geometry the way tools/pack-atelier-models.mjs packed it
    // (already quantized; 'filter' matches meshopt level 'high').
    const meshopt = document.getRoot().listExtensionsUsed().find((extension) => extension.extensionName === 'EXT_meshopt_compression');
    meshopt?.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  }
  await io.write(join(outputDir, file), document);
  totals.files += 1;
});

const mb = (bytes) => (bytes / 1048576).toFixed(2);
console.log(`[compress-textures] ${totals.files} models, ${totals.textures} colour textures → KTX2/ETC1S in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
console.log(`  texture download ${mb(totals.before)} MB → ${mb(totals.after)} MB; `
  + `GPU memory ${mb(totals.gpuBefore)} MB → ≤${mb(totals.gpuAfter)} MB`);
