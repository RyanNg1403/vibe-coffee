# Deployment (GitHub Pages)

The site is a static Vite build deployed by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to
`main` and served from `https://<owner>.github.io/vibe-coffee/`. Pull requests
run the same build, tests, size budget and smoke test without deploying.

**One-time setup:** Settings → Pages → Build and deployment → Source:
**GitHub Actions**. A custom domain needs no code change: the workflow reads the
base path from the Pages settings.

## Rules for every PR

1. **Never request a root-relative path directly.** Keep manifest entries
   root-relative (`'/models/cup.glb'`), but pass every URL that reaches
   `fetch`, a three.js loader, `new Worker`, an `<audio>`/`<img>` `src`, or a
   decoder path through `assetUrl()` from `src/assetUrl.js`. It adds the base
   path and, in production, the content-hashed file name.
   `tests/asset-url.test.js` catches the obvious cases; the smoke test catches
   the rest as 404s.
2. **Put long-lived assets in `public/models`, `textures`, `sounds`, `music`
   or `environment`.** The build renames them to `<name>.<hash>.<ext>` and the
   service worker caches them forever. Other `public/` folders keep their names
   (for example `draco/`, whose decoder files are requested by name).
   Modules and assets imported from `src/` are hashed by Vite automatically.
3. **Transform public assets before hashing, never after the build.** A
   build-time asset step (for example the KTX2 texture step) belongs in
   `pagesDeploy({ preprocess })` in `vite.config.js`. Each run reads
   `public/<dir>` and writes to a fresh temporary folder, and the plugin hashes
   what it writes. A step that rewrites `dist/models/<name>.glb` afterwards
   produces files nothing requests, and `npm run pages:size` fails on them.
4. **Stay inside the download budgets.** CI enforces three:
   - **30 MB downloaded before the first café frame** (decimal MB of response
     bodies, measured in headless Chrome by `npm run pages:smoke`). This is the
     measured 27.5 MB with startup waiting only for the opening venue, plus
     about 9 % headroom. Override it with `BUDGET_FIRST_FRAME_MB`.
   - **400 KB** for the initial code (HTML, entry script, modulepreloads and
     CSS, gzip). Lazy-load heavy code with `import()`.
   - **2.5 MB** for the initial code plus `<link rel="preload">` assets.
5. **No SharedArrayBuffer or threaded WASM.** Pages cannot send COOP/COEP
   headers, so the page is never cross-origin isolated. For Rapier, use
   `@dimforge/rapier3d-compat` (single-threaded, WASM embedded) behind a
   dynamic `import()`, or the non-compat build with its `.wasm` loaded via
   `new URL('…/rapier_wasm3d_bg.wasm', import.meta.url)` so Vite hashes it.
6. **Stay within the Pages limits:** under 100 MB per file (GitHub warns above
   50 MB), under 1 GB per site, and no Git LFS, because Pages serves the LFS
   pointer file instead of the content. The size report enforces all three.
7. **Don't rely on server features.** There are no custom headers, redirects or
   rewrites. Every response gets `Cache-Control: max-age=600` and text types are
   gzip-compressed (never brotli), so don't ship pre-compressed `.br` or `.gz`
   files. There are no client-side routes: unknown paths get `404.html`, which
   links back to the café.

## How caching works

- Vite emits content-hashed JS/CSS chunks. Three.js has its own chunk, so it
  stays cached when only app code changes.
- `tools/pages/vite-plugin.mjs` hashes the public assets, defines the path map
  used by `assetUrl()`, preloads the HDR environment, and writes `sw.js`,
  `404.html` and `.nojekyll`.
- `sw.js` precaches the app shell for each deploy and serves hashed assets
  cache-first (with HTTP Range support for music). Navigations are network-first
  with a 3.5 s fallback to the cached shell, so repeat and offline visits load
  without the network. On the first visit the page reports what it downloaded
  so the worker can cache those files from the still-fresh HTTP cache. Add
  `?no-sw` to a URL to unregister the worker while debugging.
- CI installs ffmpeg and KTX-Software (`toktx`), pinned by version and SHA-256
  in the workflow and cached between runs. It also caches `.texture-cache`, so
  only changed textures are re-encoded. Without these tools a build quietly
  keeps the original JPEG textures, so the workflow fails early if either tool
  is missing. To get KTX2 locally, put `toktx` 4.4.x and ffmpeg on `PATH`.
- `tools/make-artifact.mjs` builds with `--mode artifact`, which uses the root
  base and no chunk splitting, asset hashing or service worker.

## Local commands

| Command | Purpose |
| --- | --- |
| `npm start` | Dev server at `/` (no service worker) |
| `npm run build` | Pages build with base `/vibe-coffee/` (`VITE_BASE=/` for root hosting) |
| `npm run pages:serve` | Serve `dist/` like Pages at `http://127.0.0.1:4321/vibe-coffee/` |
| `npm run pages:size` | Size report and budget check |
| `npm run pages:smoke` | Headless Chrome check: first, repeat and offline visits plus 404; screenshots go to `.pages-smoke/` |
