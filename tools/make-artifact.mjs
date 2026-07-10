import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = fileURLToPath(new URL('./.artifact-cache/', import.meta.url));


const src = readFileSync(`${ROOT}index.html`, 'utf8');
const style = src.match(/<style>[\s\S]*?<\/style>/)[0];
const body = src.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/\s*<script type="module"[^>]*><\/script>/, '');

const asset = readdirSync(`${ROOT}dist/assets`).find(f => f.endsWith('.js'));
let js = readFileSync(`${ROOT}dist/assets/` + asset, 'utf8');

// inline recorded sounds as data URIs (the artifact CSP blocks real fetches).
// Re-encode them for the bundle: the sources are ~107 kbps stereo mp3, far
// more than looped ambience under low-pass filters needs. Ambience beds keep
// stereo at 64 kbps; every one-shot goes mono 48 kbps. Cached in sounds-lite/.
const soundsDir = `${ROOT}public/sounds`;
const soundsLite = `${CACHE}sounds-lite`;
const STEREO_BEDS = /^(chatter|rain_window)/;
mkdirSync(soundsLite, { recursive: true });
let soundBytes = 0;
try {
  for (const f of readdirSync(soundsDir)) {
    if (!/\.(mp3|ogg)$/.test(f)) continue;
    const lite = `${soundsLite}/${f.replace(/\.ogg$/, '.mp3')}`;
    if (!existsSync(lite)) {
      const stereo = STEREO_BEDS.test(f);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${soundsDir}/${f}`,
        '-ac', stereo ? '2' : '1', '-ar', '22050', '-b:a', stereo ? '64k' : '48k', lite]);
    }
    const data = readFileSync(lite);
    soundBytes += data.length;
    const uri = `data:audio/mpeg;base64,${data.toString('base64')}`;
    js = js.split(`/sounds/${f}`).join(uri);
  }
} catch (e) { console.error('sound re-encode failed:', e.message); }
// inline 3D models the same way
const modelsDir = `${ROOT}public/models`;
let modelBytes = 0;
try {
  for (const f of readdirSync(modelsDir)) {
    if (!f.endsWith('.glb')) continue;
    let data = readFileSync(modelsDir + '/' + f);
    // Draco-compressed models need the wasm decoder, which the artifact CSP
    // can't fetch. dedraco.mjs pre-builds decoder-free copies (decoded,
    // simplified, re-quantized) into artifact-models/ — inline those instead.
    const jsonLen = data.readUInt32LE(12);
    const gltfJson = data.subarray(20, 20 + jsonLen).toString();
    if (gltfJson.includes('KHR_draco_mesh_compression')) {
      const lite = `${CACHE}artifact-models/${f}`;
      if (!existsSync(lite)) {
        console.log('skipping draco model (no artifact-models copy):', f);
        continue;
      }
      data = readFileSync(lite);
      console.log('inlining de-draco copy:', f, data.length, 'bytes');
    }
    modelBytes += data.length;
    const uri = `data:model/gltf-binary;base64,${data.toString('base64')}`;
    js = js.split(`/models/${f}`).join(uri);
  }
} catch {}
// inline surface textures
const texDir = `${ROOT}public/textures`;
let texBytes = 0;
try {
  for (const f of readdirSync(texDir)) {
    if (!/\.(jpg|png|webp)$/.test(f)) continue;
    const data = readFileSync(texDir + '/' + f);
    texBytes += data.length;
    const mime = f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const uri = `data:${mime};base64,${data.toString('base64')}`;
    js = js.split(`/textures/${f}`).join(uri);
  }
} catch {}
// music: two tracks per café, re-encoded to ~64 kbps vorbis (they sit under
// the ambience bed); the remaining entries are pruned from the manifest
const musicDir = `${ROOT}public/music`;
const KEEP_TRACKS = ['airport-lounge', 'warm-fuzz', 'bossa-antigua', 'cellar-door', 'lobby-time', 'jazz-two'];
const musicLite = `${CACHE}music-lite`;
mkdirSync(musicLite, { recursive: true });
let musicBytes = 0;
try {
  for (const f of readdirSync(musicDir)) {
    if (!/\.(ogg|mp3)$/.test(f)) continue;
    const id = f.replace(/\.(ogg|mp3)$/, '');
    if (!KEEP_TRACKS.includes(id)) {
      // drop this entry from the minified MUSIC_MANIFEST array
      js = js.replace(new RegExp('\\{id:"' + id + '"[^}]*\\},?', 'g'), '');
      continue;
    }
    const lite = `${musicLite}/${id}.ogg`;
    if (!existsSync(lite)) {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${musicDir}/${f}`, '-c:a', 'libvorbis', '-b:a', '64k', lite]);
    }
    const data = readFileSync(lite);
    musicBytes += data.length;
    js = js.split(`/music/${f}`).join(`data:audio/ogg;base64,${data.toString('base64')}`);
  }
} catch (e) { console.error('music re-encode failed:', e.message); }
console.log('inlined sound bytes:', soundBytes, '| model bytes:', modelBytes, '| texture bytes:', texBytes, '| music bytes:', musicBytes);

// encoding-proof: HTML gets numeric entities, JS gets \u escapes (code units,
// so emoji surrogate pairs survive inside string literals)
const nonAscii = /[\u0080-\uffff]/g;
// full code points \u2014 encoding surrogate halves as separate entities renders
// as mojibake (the \ud83d\udcbb on the laptop button was the first astral char here)
const escHtml = (s) => s.replace(/[\u0080-\uffff]|[\u{10000}-\u{10ffff}]/gu, (c) => `&#${c.codePointAt(0)};`);
const escJs = (s) => s.replace(nonAscii, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const out = `<meta charset="utf-8" />
<title>vibe coffee</title>
${escHtml(style)}
${escHtml(body)}
<script type="module">
${escJs(js)}
</script>
`;
const outPath = process.argv[2] ?? `${CACHE}vibe-coffee.html`;
writeFileSync(outPath, out);
console.log('wrote', outPath);
console.log('bytes:', out.length, '| non-ascii left:', nonAscii.test(out));
