// Build-time GitHub Pages support (see DEPLOYMENT.md).
//
// Pages sends every file with a fixed `Cache-Control: max-age=600`, so the
// long-lived runtime assets in public/ (models, textures, audio, HDR) are
// copied to content-hashed names and resolved through src/assetUrl.js. A
// generated service worker then caches them cache-first, which is safe only
// because a changed file always gets a new URL.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Top-level public/ folders whose files are renamed `<name>.<hash><ext>`.
// draco/ keeps its names: DRACOLoader requests its decoder files by name.
export const HASHED_DIRS = ['models', 'textures', 'sounds', 'music', 'environment'];

// Fetched by main.js as soon as it runs; preloading starts the download in
// parallel with the JavaScript instead of after it.
const CRITICAL_PRELOADS = ['/environment/courtyard.hdr'];

const sha = (data) => createHash('sha256').update(data).digest('hex');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function pagesDeploy() {
  let disabled = false;
  let base = '/';
  let outDir = '';
  const assetMap = {};
  const publicFiles = [];

  return {
    name: 'vibe-pages-deploy',
    apply: 'build',

    config(userConfig) {
      if (userConfig.publicDir === false) {
        disabled = true;
        return;
      }
      const root = resolve(userConfig.root ?? process.cwd());
      const publicDir = resolve(root, userConfig.publicDir ?? 'public');
      for (const file of walk(publicDir).sort()) {
        const rel = relative(publicDir, file).split(sep).join('/');
        const bytes = readFileSync(file);
        const hash = sha(bytes).slice(0, 10);
        let out = rel;
        if (rel.includes('/') && HASHED_DIRS.includes(rel.split('/')[0])) {
          const ext = extname(rel);
          out = `${rel.slice(0, rel.length - ext.length)}.${hash}${ext}`;
          assetMap[`/${rel}`] = out;
        }
        publicFiles.push({ src: file, out, hash, hashed: out !== rel });
      }
      return {
        build: { copyPublicDir: false },
        define: { __VIBE_ASSET_MAP__: JSON.stringify(assetMap) },
      };
    },

    configResolved(config) {
      base = config.base;
      outDir = resolve(config.root, config.build.outDir);
    },

    transformIndexHtml() {
      if (disabled) return [];
      const preloads = CRITICAL_PRELOADS.filter((path) => assetMap[path]).map((path) => ({
        tag: 'link',
        attrs: { rel: 'preload', href: base + assetMap[path], as: 'fetch', crossorigin: '' },
        injectTo: 'head',
      }));
      const register = readFileSync(join(HERE, 'sw-register.js'), 'utf8')
        .replaceAll('__VIBE_BASE__', JSON.stringify(base));
      return [...preloads, { tag: 'script', children: register, injectTo: 'body' }];
    },

    writeBundle(_options, bundle) {
      if (disabled) return;
      for (const file of publicFiles) {
        const target = join(outDir, file.out);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(file.src, target);
      }
      writeFileSync(join(outDir, '.nojekyll'), '');
      writeFileSync(join(outDir, '404.html'), notFoundPage(base));

      const build = Object.values(bundle)
        .filter((item) => !item.fileName.endsWith('.map'))
        .map((item) => ({
          fileName: item.fileName,
          hash: sha(item.type === 'chunk' ? item.code : item.source).slice(0, 10),
        }));
      const manifest = {
        base,
        shell: build.map((item) => item.fileName).sort(),
        assets: publicFiles.filter((file) => file.hashed).map((file) => file.out),
        files: publicFiles.filter((file) => !file.hashed).map((file) => file.out),
      };
      manifest.version = sha(JSON.stringify([
        build.map((item) => item.hash).sort(),
        publicFiles.map((file) => file.hash),
      ])).slice(0, 12);
      const worker = readFileSync(join(HERE, 'sw-template.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), `self.__VIBE_MANIFEST__ = ${JSON.stringify(manifest)};\n${worker}`);
    },
  };
}

function notFoundPage(base) {
  // The app has no client-side routes (state lives in query strings and
  // localStorage), so any unknown page just points back at the café.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="3; url=${base}" />
  <title>vibe coffee ☕ · not found</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>☕</text></svg>" />
  <style>
    html, body { height: 100%; margin: 0; background: #17110b; color: #f0e6d4; }
    body { display: grid; place-items: center; font: italic 16px Georgia, serif; text-align: center; }
    a { color: #f2c27b; }
  </style>
</head>
<body>
  <p>this table doesn't exist.<br /><a href="${base}">back to the café ☕</a></p>
</body>
</html>
`;
}
