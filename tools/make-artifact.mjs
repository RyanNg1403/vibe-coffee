import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, weld, simplify, resample } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { MODEL_MANIFEST } from '../src/modelManifest.js';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = join(root, '.artifact-cache');
const buildDir = join(cache, 'dist');
const modelDir = join(cache, 'models');
const musicDir = join(cache, 'music');
const textureDir = join(cache, 'textures');
const soundDir = join(cache, 'sounds');
const output = join(root, 'artifact', 'vibe-coffee.html');
const MAX_BYTES = 15.5 * 1024 * 1024;

const tracks = {
  goldenhour: [
    ['airport-lounge', 'Airport Lounge', 'Kevin MacLeod'],
    ['everything', 'Everything You Ever Dreamed.', 'HoliznaCC0'],
  ],
  roastery: [
    ['bossa-antigua', 'Bossa Antigua', 'Kevin MacLeod'],
    ['busted-jazz', 'Busted Jazz', 'HoliznaCC0'],
  ],
  midnight: [
    ['beyond-piano', 'Beyond (Piano Edit)', 'Pablo Perez'],
    ['jazz-one', '1 (jazz)', 'HoliznaCC0'],
  ],
  terrace: [
    ['airport-lounge', 'Airport Lounge', 'Kevin MacLeod'],
    ['everything', 'Everything You Ever Dreamed.', 'HoliznaCC0'],
  ],
};

const artifactModels = Object.keys(MODEL_MANIFEST);
const artifactModelManifest = `export const MODEL_MANIFEST = {
${artifactModels.map((name) => `  ${name}: { url: '/models/${name}.glb' },`).join('\n')}
};`;

const artifactSoundManifest = `export const SOUND_MANIFEST = {
  chair_scrape: { url: '/sounds/chair_scrape.mp3', loop: false },
  chatter: { url: '/sounds/chatter.mp3', loop: true },
  chatter_quiet: { url: '/sounds/chatter_quiet.mp3', loop: true },
  cup_clinks: { url: '/sounds/cup_clinks.mp3', loop: false },
  door_bell: { url: '/sounds/door_bell.mp3', loop: false },
  espresso: { url: '/sounds/espresso.mp3', loop: false },
  footsteps: { url: '/sounds/footsteps.mp3', loop: false },
  rain_steady: { url: '/sounds/rain_steady.mp3', loop: true, lazy: true },
  traffic_day: { url: '/sounds/traffic_day.mp3', loop: true },
  traffic_night: { url: '/sounds/traffic_night.mp3', loop: true },
  typing: { url: '/sounds/typing.mp3', loop: false },
};`;

const artifactMusicManifest = `export const MUSIC_MANIFEST = ${JSON.stringify(
  Object.fromEntries(Object.entries(tracks).map(([theme, list]) => [theme, list.map(([id, title, artist]) => ({
    id, title, artist, url: `/music/${id}.ogg`, duration: 45,
  }))])),
)};`;

await rm(cache, { recursive: true, force: true });
await mkdir(modelDir, { recursive: true });
await mkdir(musicDir, { recursive: true });
await mkdir(textureDir, { recursive: true });
await mkdir(soundDir, { recursive: true });

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

const compactImages = new Map();
for (const name of artifactModels) {
  const document = await io.read(join(root, 'public', 'models', `${name}.glb`));
  // Keep facial detail while reducing the transfer cost of the portable edition.
  // The full application and editable Blender sources retain larger maps.
  for (const texture of document.getRoot().listTextures()) {
    const pixels = texture.getImage();
    const resolution = name.startsWith('char_atelier_') ? 384 : 256;
    const key = createHash('sha256').update(pixels).update(String(resolution)).digest('hex');
    if (!compactImages.has(key)) {
      const input = join(textureDir, `${key}.input`);
      const output = join(textureDir, `${key}.jpg`);
      await writeFile(input, pixels);
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
        '-vf', `scale=${resolution}:${resolution}:force_original_aspect_ratio=decrease`,
        '-frames:v', '1', '-q:v', '3', output,
      ]);
      compactImages.set(key, await readFile(output));
    }
    const bytes = compactImages.get(key);
    texture.setImage(bytes).setMimeType('image/jpeg')
      .setName('asset-texture-' + createHash('sha256').update(bytes).digest('hex'));
  }
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }
  await document.transform(
    // The standalone edition keeps every model, with a small silhouette error
    // budget and redundant animation keys removed. Editable/full app assets
    // are unchanged by this export-only optimization.
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: name.startsWith('char_atelier_') ? 0.28 : 0.55,
      error: name.startsWith('char_atelier_') ? 0.008 : 0.002,
      lockBorder: !name.startsWith('char_atelier_'),
    }),
    resample({ tolerance: 0.0001 }),
    meshopt({
      encoder: MeshoptEncoder,
      level: 'high',
      quantizePosition: 13,
      quantizeNormal: 8,
      quantizeTexcoord: 10,
      quantizeWeight: 8,
    }),
  );
  await io.write(join(modelDir, `${name}.glb`), document);
}

const uniqueTracks = new Set(Object.values(tracks).flat().map(([id]) => id));
for (const id of uniqueTracks) {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', join(root, 'public', 'music', `${id}.ogg`),
    // Opus remains transparent enough for the deliberately soft café mix at
    // 48 kbps, while recovering the artifact headroom consumed by V2 code.
    // Runtime/full-quality assets are untouched; this only affects the
    // self-contained fallback artifact.
    '-t', '45', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k',
    join(musicDir, `${id}.ogg`),
  ]);
}

await build({
  root,
  publicDir: false,
  build: { outDir: buildDir, emptyOutDir: true, minify: true },
  plugins: [{
    name: 'artifact-manifests',
    enforce: 'pre',
    transform(_code, id) {
      if (id.endsWith('/src/modelManifest.js')) return artifactModelManifest;
      if (id.endsWith('/src/soundManifest.js')) return artifactSoundManifest;
      if (id.endsWith('/src/musicManifest.js')) return artifactMusicManifest;
      return null;
    },
  }],
});

let html = await readFile(join(buildDir, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
if (!scriptMatch) throw new Error('Unable to find the Vite entry script.');
let js = await readFile(join(buildDir, scriptMatch[1].replace(/^\//, '')), 'utf8');

const mime = {
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.hdr': 'application/octet-stream',
};
const assetUrls = [...new Set(js.match(/\/(?:models|sounds|music|textures|environment)\/[A-Za-z0-9_.-]+/g) ?? [])];
const inlineAssets = [];
const inlineAssetIndices = new Map();
for (const url of assetUrls) {
  const [, kind, filename] = url.split('/');
  const source = kind === 'models'
    ? join(modelDir, filename)
    : kind === 'music'
      ? join(musicDir, filename)
      : join(root, 'public', kind, filename);
  let bytes;
  let contentType = mime[extname(filename)];
  if (kind === 'sounds') {
    // Preserve the full sound durations in the portable edition. Opus reduces
    // ambience transfer cost while the full app retains its original files.
    const compact = join(soundDir, filename + '.ogg');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', compact,
    ]);
    bytes = await readFile(compact);
    contentType = 'audio/ogg';
  } else if (kind === 'environment') {
    bytes = await readFile(join(root, 'assets/blender/realism/courtyard-compact.hdr'));
  } else if (kind === 'textures') {
    // Preserve spatial detail in room-sized contact maps; use compact maps
    // for every tiled material, including the older floor/plaster scans, in
    // the standalone edition only. Full application textures stay intact.
    const resolution = filename.startsWith('realism_contact_') ? 512 : 256;
    const compact = join(textureDir, filename);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-vf', `scale=${resolution}:${resolution}:flags=lanczos`, '-frames:v', '1', '-q:v', '3', compact,
    ]);
    bytes = await readFile(compact);
  } else {
    bytes = await readFile(source);
  }
  const dataUri = `data:${contentType};base64,${bytes.toString('base64')}`;
  // Aliases such as cat/pet_cat must reuse one payload. The gzip window alone
  // cannot deduplicate large models that occur far apart in the asset table.
  let index = inlineAssetIndices.get(dataUri);
  if (index === undefined) {
    index = inlineAssets.length;
    inlineAssets.push(dataUri);
    inlineAssetIndices.set(dataUri, index);
  }
  // Vite emits these source URLs as string literals. Replace the complete
  // literal so every reference reuses one decoded data URI at startup.
  for (const quote of ['"', "'", '`']) {
    js = js.replaceAll(`${quote}${url}${quote}`, `__vibePortableAssets[${index}]`);
  }
}

const unresolved = js.match(/\/(?:models|sounds|music|textures|environment)\/[A-Za-z0-9_.-]+/g);
if (unresolved) throw new Error(`Unresolved artifact assets: ${[...new Set(unresolved)].join(', ')}`);
// Compress the asset table as one stream: GLB JSON, repeated material metadata,
// and base64 overhead otherwise waste several MiB. Native decompression is
// local, requires no fetch/worker, and leaves the decoded asset bytes intact.
const packedAssets = gzipSync(Buffer.from(JSON.stringify(inlineAssets)), { level: 9 }).toString('base64');
const assetBootstrap = `const __vibePortableAssets = JSON.parse(await new Response(
  new Blob([Uint8Array.from(atob('${packedAssets}'), c => c.charCodeAt(0))])
    .stream().pipeThrough(new DecompressionStream('gzip'))
).text());\n`;
html = html.replace(
  scriptMatch[0],
  () => `<script type="module">${assetBootstrap}${js.replaceAll('</script>', '<\\/script>')}</script>`,
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);

const { size } = await stat(output);
if (size > MAX_BYTES) {
  throw new Error(`Artifact is ${(size / 1024 / 1024).toFixed(2)} MB; limit is 15.50 MB.`);
}
console.log(`Artifact: ${output}`);
console.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Inlined assets: ${assetUrls.length} URLs, ${inlineAssets.length} unique payloads; all ${artifactModels.length} Blender models included with Meshopt.`);
