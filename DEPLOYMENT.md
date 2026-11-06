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
   decoder path through `assetUrl()` from `src/assetUrl.js`. It prefixes
   `import.meta.env.BASE_URL` and is safe to apply twice. `data:`, `blob:` and
   absolute URLs pass through. `tests/asset-url.test.js` catches the obvious
   cases; the smoke test catches the rest as 404s.
2. **Prefer Vite imports for code-adjacent binaries** (decoders, WASM,
   workers): `new URL('…', import.meta.url)` or `?url` imports get
   content-hashed names. Files in `public/` keep fixed names. The service
   worker tracks a content revision for each one, so changing a file in place
   is safe.
3. **Transform public assets inside the build.** A build-time asset step (for
   example the KTX2 texture step) belongs in `pagesDeploy({ preprocess })` in
   `vite.config.js`. Each run reads `public/<dir>` and writes to a fresh
   temporary folder; the output ships under the same names, and the service
   worker revisions describe it. If a later step changes a file in `dist/`,
   `npm run pages:size` fails, because the worker would never cache it.
4. **Stay inside the download budgets.** CI enforces three:
   - **9 MB downloaded before the first café frame** (decimal MB of response
     bodies, measured in headless Chrome by `npm run pages:smoke`). The room
     renders first at about 6.5 MB; the cast, the other venues and the sky
     stream in afterwards. Override it with `BUDGET_FIRST_FRAME_MB`.
   - **400 KB** for the initial code (HTML, entry script, modulepreloads and
     CSS, gzip). Lazy-load heavy code with `import()`.
   - **1 MB** for the initial code plus any `<link rel="preload">` assets.
     Don't preload anything the first frame doesn't need.
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
- `tools/pages/vite-plugin.mjs` records a SHA-256 revision for every
  `public/` file (after preprocess steps such as KTX2 have run), and writes
  `sw.js`, `404.html` and `.nojekyll`.
- `sw.js` works like this:
  - It registers only when the page is idle after `load`, and precaches just
    the shell: index.html, the entry chunk, its static imports and its CSS.
    The page has already downloaded all of these. Lazy chunks, workers and
    WASM are cached on first use. Models and audio are cached only when the
    page requests them, so the worker never downloads anything ahead of the
    first frame.
  - It serves fixed-name `public/` files from its cache only while the stored
    copy's revision matches the current deploy, with HTTP Range support for
    music.
  - When a new deploy activates, it evicts copies whose revision changed. A
    miss is revalidated with the server (`no-cache`, usually a cheap 304), and
    a download is cached only after its SHA-256 matches. A stale HTTP or CDN
    copy is therefore never stored, even though URLs don't change.
  - Navigations are network-first with a 3.5 s fallback to the cached shell,
    so repeat and offline visits load without the network.
  - On the first visit the page reports what it downloaded, so the worker can
    cache those files from the still-fresh HTTP cache.
  - Add `?no-sw` to a URL to unregister the worker while debugging.
- CI installs ffmpeg and KTX-Software (`toktx`), pinned by version and SHA-256
  in the workflow and cached between runs. It also caches `.texture-cache`, so
  only changed textures are re-encoded. Without these tools a build quietly
  keeps the original JPEG textures, so the workflow fails early if either tool
  is missing. To get KTX2 locally, put `toktx` 4.4.x and ffmpeg on `PATH`.
- `tools/make-artifact.mjs` builds with `--mode artifact`, which uses the root
  base and no chunk splitting or service worker.

## Local commands

| Command | Purpose |
| --- | --- |
| `npm start` | Dev server at `/` (no service worker) |
| `npm run build` | Pages build with base `/vibe-coffee/` (`VITE_BASE=/` for root hosting) |
| `npm run pages:serve` | Serve `dist/` like Pages at `http://127.0.0.1:4321/vibe-coffee/` |
| `npm run pages:size` | Size report and budget check |
| `npm run pages:smoke` | Headless Chrome check: first visit (with first-frame budget), repeat visit, a simulated redeploy of one file, an offline reload, and 404; screenshots go to `.pages-smoke/` |
