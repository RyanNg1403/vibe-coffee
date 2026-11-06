// Build-time GitHub Pages support (see DEPLOYMENT.md).
//
// Pages sends every file with a fixed `Cache-Control: max-age=600`. Vite
// already content-hashes the bundle (JS, CSS, imported WASM). Files in public/
// keep their fixed names, so this plugin records a content revision for each
// one; the generated service worker serves a cached copy only while its
// revision matches the deployed build, and re-downloads it otherwise.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The service worker computes the same digest to verify downloads.
export const revision = (data) => createHash('sha256').update(data).digest('hex').slice(0, 16);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// `preprocess` steps rewrite a public/ folder for the deployed build only,
// e.g. `{ dir: 'models', run: (input, output) => … }`. Each run gets a fresh
// empty output folder; files it writes replace their public/ counterparts in
// dist/ (same names) or ship as new files, and the service worker revisions
// describe those bytes. Files it does not write ship unchanged.
export function pagesDeploy({ preprocess = [] } = {}) {
  let disabled = false;
  let base = '/';
  let outDir = '';
  let publicDir = '';
  const scratch = [];
  const publicFiles = [];

  return {
    name: 'vibe-pages-deploy',
    apply: 'build',

    config(userConfig) {
      if (userConfig.publicDir === false) {
        disabled = true;
        return;
      }
      publicDir = resolve(userConfig.root ?? process.cwd(), userConfig.publicDir ?? 'public');
      return { build: { copyPublicDir: false } };
    },

    configResolved(config) {
      base = config.base;
      outDir = resolve(config.root, config.build.outDir);
    },

    async buildStart() {
      if (disabled) return;
      const replacements = new Map();
      for (const step of preprocess) {
        const output = mkdtempSync(join(tmpdir(), `vibe-pages-${step.dir}-`));
        scratch.push(output);
        await step.run(join(publicDir, step.dir), output);
        for (const file of walk(output)) {
          replacements.set(`${step.dir}/${relative(output, file).split(sep).join('/')}`, file);
        }
      }
      const sources = new Map(walk(publicDir).map((file) => [relative(publicDir, file).split(sep).join('/'), file]));
      for (const [rel, file] of replacements) sources.set(rel, file);
      for (const [rel, src] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
        publicFiles.push({ rel, src, revision: revision(readFileSync(src)) });
      }
      if (replacements.size) this.info(`preprocessed ${replacements.size} public files`);
    },

    closeBundle() {
      for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
    },

    transformIndexHtml() {
      if (disabled) return [];
      const register = readFileSync(join(HERE, 'sw-register.js'), 'utf8')
        .replaceAll('__VIBE_BASE__', JSON.stringify(base));
      return [{ tag: 'script', children: register, injectTo: 'body' }];
    },

    writeBundle(_options, bundle) {
      if (disabled) return;
      for (const file of publicFiles) {
        const target = join(outDir, file.rel);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(file.src, target);
      }
      writeFileSync(join(outDir, '.nojekyll'), '');
      writeFileSync(join(outDir, '404.html'), notFoundPage(base));

      const build = Object.values(bundle)
        .filter((item) => !item.fileName.endsWith('.map'))
        .map((item) => ({
          fileName: item.fileName,
          revision: revision(item.type === 'chunk' ? item.code : item.source),
        }));
      // Precache only what the page itself loads before it runs: index.html,
      // the entry chunk, its static imports and their CSS. Install then reads
      // them from the HTTP cache instead of competing with the first frame.
      // Lazy chunks, workers and WASM are content-hashed and cached on use.
      const items = new Map(Object.values(bundle).map((item) => [item.fileName, item]));
      const critical = new Set(['index.html']);
      const visit = (fileName) => {
        if (critical.has(fileName)) return;
        critical.add(fileName);
        const item = items.get(fileName);
        if (item?.type !== 'chunk') return;
        item.imports.forEach(visit);
        item.viteMetadata?.importedCss?.forEach((css) => critical.add(css));
      };
      Object.values(bundle).filter((item) => item.type === 'chunk' && item.isEntry).forEach((item) => visit(item.fileName));
      const manifest = {
        base,
        shell: build.filter((item) => critical.has(item.fileName)).map((item) => item.fileName).sort(),
        immutable: build.filter((item) => !critical.has(item.fileName)).map((item) => item.fileName).sort(),
        files: Object.fromEntries(publicFiles.map((file) => [file.rel, file.revision])),
      };
      manifest.version = revision(JSON.stringify([
        build.map((item) => item.revision).sort(),
        publicFiles.map((file) => file.revision),
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
