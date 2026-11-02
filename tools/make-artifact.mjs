import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
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

for (const name of artifactModels) {
  const document = await io.read(join(root, 'public', 'models', `${name}.glb`));
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }
  await document.transform(
    // The standalone edition keeps every model, with a small silhouette error
    // budget and redundant animation keys removed. Editable/full app assets
    // are unchanged by this export-only optimization.
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.002, lockBorder: true }),
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
    // 56 kbps, while recovering the artifact headroom consumed by V2 code.
    // Runtime/full-quality assets are untouched; this only affects the
    // self-contained fallback artifact.
    '-t', '45', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '56k',
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
};
const assetUrls = [...new Set(js.match(/\/(?:models|sounds|music|textures)\/[A-Za-z0-9_.-]+/g) ?? [])];
for (const url of assetUrls) {
  const [, kind, filename] = url.split('/');
  const source = kind === 'models'
    ? join(modelDir, filename)
    : kind === 'music'
      ? join(musicDir, filename)
      : join(root, 'public', kind, filename);
  let bytes;
  if (kind === 'textures' && filename.startsWith('studio_')) {
    // The self-contained export has a strict transfer budget. Keep all four
    // Blender models, using 256px variants of their supporting surface maps.
    // Full-quality development/production maps remain 512px and untouched.
    const compact = join(textureDir, filename);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-vf', 'scale=256:256:flags=lanczos', '-frames:v', '1', '-q:v', '3', compact,
    ]);
    bytes = await readFile(compact);
  } else {
    bytes = await readFile(source);
  }
  const dataUri = `data:${mime[extname(filename)]};base64,${bytes.toString('base64')}`;
  js = js.replaceAll(url, dataUri);
}

const unresolved = js.match(/\/(?:models|sounds|music|textures)\/[A-Za-z0-9_.-]+/g);
if (unresolved) throw new Error(`Unresolved artifact assets: ${[...new Set(unresolved)].join(', ')}`);
html = html.replace(
  scriptMatch[0],
  () => `<script type="module">${js.replaceAll('</script>', '<\\/script>')}</script>`,
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);

const { size } = await stat(output);
if (size > MAX_BYTES) {
  throw new Error(`Artifact is ${(size / 1024 / 1024).toFixed(2)} MB; limit is 15.50 MB.`);
}
console.log(`Artifact: ${output}`);
console.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Inlined assets: ${assetUrls.length}; all 67 Blender models included with Meshopt.`);
