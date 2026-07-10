import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder } from 'meshoptimizer';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = join(root, '.artifact-cache');
const buildDir = join(cache, 'dist');
const modelDir = join(cache, 'models');
const musicDir = join(cache, 'music');
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

const artifactModelManifest = `export const MODEL_MANIFEST = {
  char_hero_female: { url: '/models/char_hero_female.glb' },
  char_hero_male: { url: '/models/char_hero_male.glb' },
};`;

const artifactSoundManifest = `export const SOUND_MANIFEST = {
  chair_scrape: { url: '/sounds/chair_scrape.mp3', loop: false },
  chatter: { url: '/sounds/chatter.mp3', loop: true },
  chatter_quiet: { url: '/sounds/chatter_quiet.mp3', loop: true },
  cup_clinks: { url: '/sounds/cup_clinks.mp3', loop: false },
  door_bell: { url: '/sounds/door_bell.mp3', loop: false },
  espresso: { url: '/sounds/espresso.mp3', loop: false },
  footsteps: { url: '/sounds/footsteps.mp3', loop: false },
  rain_window: { url: '/sounds/rain_window.mp3', loop: true },
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

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
  });

for (const name of ['char_hero_female', 'char_hero_male']) {
  const document = await io.read(join(root, 'public', 'models', `${name}.glb`));
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }
  await document.transform(
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
    '-t', '45', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k',
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
  const bytes = await readFile(source);
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
console.log(`Inlined assets: ${assetUrls.length}; hero geometry uses Meshopt (no Draco fetch).`);
