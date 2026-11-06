# Performance baselines

## Performance workstream (2026-11-06)

Before = `main` at `b683ef9`; after = this branch (`src/perf/`). Same
machine, same session, measured back to back.

- **Machine class:** headless Linux container, 8 threads, Chromium with
  SwiftShader software GL (no GPU). Rendering is fragment-bound here (a
  1440×900 frame costs ~0.7 s; at 0.1× resolution ~0.09 s), so absolute
  numbers are far below real hardware. The relative changes are what matter.
- **Commands:** `npm run perf:baseline` (Auto quality, 45 s ambient CPU
  sample), `npm run audit:memory` (ten switches), and the new
  `npm run perf:bench` (fixed 1× resolution, `?adaptive=0`, every render
  refreshes the shadow map, run against both builds). Bench render time is
  the median of three synchronous renders with a JPEG readback.

### Auto quality, CPU sample (Golden Hour, 45 s ambient)

| Metric | Before | After |
| --- | --- | --- |
| Frames rendered in 45 s | 59 | 148 |
| Observed FPS | 1.4 | 3.3 |
| CPU seconds per rendered frame | **5.60** | **2.24** (−60 %) |
| Combined process-tree CPU | 733 % | 736 % (saturated either way) |
| Render scale chosen by Auto | 1.0 (never adapted) | 0.5 within 10–16 s |

The old Auto loop treated any frame over 100 ms as a stall and ignored it,
so it never adapted on slow devices. The new controller only ignores
isolated multi-second frames.

### Fixed 1× resolution, per café (dev server, seeded crowd)

| Café | Render ms (before → after) | Triangles (before → after) | Pet hover pick ms | Switch-in longest task ms |
| --- | --- | --- | --- | --- |
| goldenhour | 949 → 752 (−21 %) | 2,410,098 → 1,583,378 (−34 %) | 10.5 → 2.3 | (initial café) |
| roastery | 807 → 605 (−25 %) | 1,930,168 → 1,048,500 (−46 %) | 7.9 → 1.7 | 3,340 → 1,827 |
| midnight | 799 → 630 (−21 %) | 1,830,665 → 1,109,520 (−39 %) | 7.6 → 1.6 | 2,479 → 3,052 |
| terrace | 995 → 855 (−14 %) | 3,846,306 → 2,931,980 (−24 %) | 7.6 → 1.6 | 2,925 → 2,628 |

Draw calls are unchanged within noise (shadow refreshes dominate). Theme
switch blocking is noisy run to run: across three paired runs the branch's
longest task was lower in 8 of 9 café switches, and terrace's total blocking
time fell from 4.4–4.9 s to 2.3–2.6 s every time. On this machine the switch is
bounded by synchronous shader linking: SwiftShader has no
`KHR_parallel_shader_compile`, so `compileAsync` cannot overlap it. On GPUs
that do, the warm-up hold removes that stall from the main thread.

### Startup, memory and bundle

| Metric | Before | After |
| --- | --- | --- |
| First café frame (dev) | 6,472 ms | 5,741 ms |
| Longest startup task (dev) | 3,501 ms | 2,703 ms |
| First café frame (production build) | 5,959 ms | 5,771 ms |
| Downloaded before first café frame (production) | 29.57 MB | 27.51 MB |
| Live scene texture memory, production (GH / RO / MI / TE) | 220.5 / 200.9 / 194.3 / 211.8 MB | 130.5 / 110.9 / 107.0 / 122.6 MB (−41 to −45 %) |
| Colour textures, all models (GPU estimate) | 187 MB as RGBA8 + mips | ≤ 47 MB as KTX2 (BC7/ASTC class) |
| JS heap, production, Golden Hour | 120.6 MB | 129.6 MB (LOD index buffers, BVHs) |
| Ten-switch memory audit | heap +1.32 MB, geometries 0, textures 0 | heap +1.29 MB, geometries 0, textures 0 (passed) |
| GPU leak per seat change with laptop open | +5 geometries, +2 textures | 0 |
| Initial JS (production) | 1,050 kB (292 kB gzip), one chunk | 1,086 kB (304 kB gzip) in two chunks: app 506 kB + cached `three` core 580 kB |
| Lazy chunks | — | BVH 73 kB, KTX2 loader 56 kB, LOD worker 78 kB, HUD 3 kB |
| Single-file artifact | 15.44 MB | 15.46 MB (limit 15.5 MB) |

### First load: room first, cast streamed (2026-11-06, later)

Method: PR #23's first-frame probe (`tools/pages/smoke.mjs`: response bytes
summed at the first frame after `window.__vibe.cafe`, 1280×720, quality
`smooth`, no click). Both production builds were served by PR #23's
`tools/pages/serve.mjs` (GitHub Pages emulation, gzip for text only) under
`/vibe-coffee/`, with KTX2 textures. A second run throttled Chrome to
10 Mbit/s, 40 ms latency, and clicked "step inside" at once, which also
starts the ambience sound library.

| | Before (PR head `9fadba1`) | After |
| --- | --- | --- |
| Bytes at first café frame (PR #23 probe) | 24.98 MB (characters 14.95, pets 1.04, other models 8.44, code 0.62) | **6.07 MB** (models 5.46, code 0.62) |
| ...with normal maps also KTX2 (UASTC, commit `854c5c4`) | | **6.51 MB** (models 5.89, code 0.62) |
| 10 Mbit/s with click: first café frame | 28.3 s, 31.3 MB (crowd already in) | **11.7 s**, 10.95 MB (room; sounds load alongside) |
| 10 Mbit/s with click: crowd visible | 28.3 s (same frame) | 26.8 s, fading in nearest-first |
| Character models downloaded for Golden Hour | 20 | 15 (the café's peak population needs no more) |
| Bytes once the crowd is in (PR #23 probe) | 26.8 MB | 17.9 MB; 23.1 MB after idle background streaming |

Ambience audio on "step inside" (same 10 Mbit/s click probe, measured at
the exact first café frame, two runs each):

| | Before (`dd0a349`) | After |
| --- | --- | --- |
| First café frame, 10 Mbit/s, click at once | 9.7 s, 10.2 MB (3.7 MB of it audio) | **7.0 s, 6.6 MB** (no ambience requested before it) |
| PR #23 probe (no click) | 6.51 MB | 6.51 MB |

The click still starts audio inside the user gesture. The synthesized beds
(room tone, murmur, vinyl) play immediately and cost no bytes, but the
recorded library now waits for the room's first frame (`audio.libraryGate`,
released by `main.js`). It then loads the six bed recordings first (~1.5 MB;
they replace the synth stand-ins as one mix) and the one-shots after.
Trade-off: after the first frame, ambience shares bandwidth with the cast, so
the crowd starts fading in a few seconds later at 10 Mbit/s (single runs:
25.0 s before, 28.5 s after). Streaming long beds through media elements
(less decoded PCM in RAM) is left to the memory/mobile follow-up.

How:

- The first café frame needs only the room. Patrons, staff and the dog
  (`planCast`) download after that frame and are spawned together. The crowd
  is told the player's seat, so nobody is pre-seated in it. The crowd then
  fades in nearest actor first (`actorReveal.js`); both the opaque and the
  fading shader variants compile before anything shows.
- Each café downloads only enough patrons to cover its room crowd plus street
  walkers under the two-copies-per-asset rule (13–14 of 18). Models already
  downloaded are preferred, so a revisit or café switch reuses them.
- Per-café first-frame sets (`modelLoader.js`): park trees are terrace-only,
  the piano midnight-only, the roaster roastery-only, and the street set is
  unused on the terrace. Spares never cloned at build (`bookcase`, `crate`,
  `espresso_machine`, `cup`, `plant`, ...) stream later. `pet_cat` loads with
  the room because the room swaps its décor cat for a live one when the pet
  exists. Development builds warn if a deferred model is requested early.
- Byte-identical models are fetched once (`models/aliases.json` from the
  build step; today only `pet_cat` = `cat`).
- The photographic HDR sky starts after the first frame; the room-light
  fallback covers the gap.
- Remaining non-cast models stream at idle only after the crowd is in, so
  they never compete with it.
- Audit modes (`?visual-audit`, `?memory-audit`) keep the synchronous path,
  so seeded crowds and renderer counts stay comparable with earlier runs.



LOD levels are index-only (they share the source vertex buffers) and are
chosen so the simplification error, including normal deviation, projects to
under 1 rendered pixel. A/B renders of the same frozen frame with LOD and
culling on vs. off differ by more than 8/255 on at most 0.10 % of pixels (mean
absolute difference 0.05/255), while triangles in the walking views drop
45–51 %.
In Golden Hour, 88 library meshes are managed: 925 K source triangles, about
183 K drawn at Auto's 0.5× scale. Skinned actors outside the view are now
culled (6–14 of ~15 in typical seated and walking views).

### What changed and what was ruled out

Applied (all in `src/perf/` unless noted):

- **LODs** (`lod/`): Blender-baked chains win where a GLB has them
  (`MSFT_lod`, or the `vibeLodId`/`vibeLodOf` extras mirror). `bakedLods.js`
  records each chain against LOD0's geometry and switches by the baked
  `vibeLodDistances`, scaled with render height. Only models without a chain
  fall back to meshoptimizer simplification in a Web Worker: three levels per
  heavy library mesh (≥ 3 K triangles), chosen from screen-space error with
  hysteresis. The scene graph only ever holds level 0 (no `THREE.LOD`), so
  `cafe.js` static merging and instancing see full detail only. Skinned
  meshes work unchanged. With PR #26's models: 284 of 287 managed meshes use
  baked chains, 3 use the worker; drawn library triangles 1.09M → 0.57M at
  Auto; 0.13 % of pixels differ by more than 8/255 at fixed 1×.
- **Pose-following actor culling** (`skinnedCulling.js`): one bone-derived
  sphere per skeleton, mapped into each part's local space. This replaces
  "always draw" for indoor patrons; main and shadow passes cull independently.
- **Adaptive quality** (`qualityController.js`): see the tier interface below.
- **Picking**: lazy `three-mesh-bvh` trees for static meshes (instanced
  chairs share one); skinned picks use a coarse LOD instead of CPU-skinning
  every vertex.
- **Shader pre-warm**: `compileAsync` for the new room plus every patron and
  pet template against its lights, holding the frame (≤ 2.5 s) meanwhile.
  Compressed library textures are then uploaded one per frame, so a patron
  walking in later causes no upload hitch.
- **KTX2 textures** (`tools/compress-textures.mjs`, part of `npm run build`;
  the only KTX2 path): every GLB texture is re-encoded with mipmaps into
  `dist/`, chosen by role. Colour is ETC1S sRGB, normal maps UASTC linear
  (RDO + zstd), occlusion/roughness/metalness and other data ETC1S linear.
  Across the library that is 158 textures: download 7.76 → 7.74 MB (normals
  0.31 → 1.03 MB, colour 7.07 → 6.25 MB), GPU estimate 301 → ≤ 75 MB. PR #26's
  `MSFT_lod` chains are read and written back intact (registered from
  `tools/msft-lod.mjs`; 179 chains verified on #26's models). Source GLBs in
  `public/` are untouched, so Blender re-exports never conflict. The
  transcoded data is released from the JS heap after upload.
  Requires [KTX-Software](https://github.com/KhronosGroup/KTX-Software)
  `toktx` on `PATH` (or `$TOKTX`) plus ffmpeg; the build skips this step
  with a warning when they are missing.
- **Progressive streaming** (`modelLoader.js`): the first café waits only for
  its own venue set; the other venues stream in during idle time.
- **Hidden-tab pause**: no simulation or rendering while `document.hidden`
  (ambience audio keeps playing).
- **Bundle splitting** (`vite.config.js`): `three` core is a cached vendor
  chunk; BVH, KTX2 loader, HUD and worker load on demand. The artifact build
  stays single-file and stubs BVH/KTX2.
- **Disposal hygiene** (`disposal.js`): the MacBook and drinks rebuilt on
  every seat change or order are now freed.
- **Perf HUD** (`perfOverlay.js`): FPS, frame/CPU/GPU time (timer queries),
  draw calls, triangles, geometries/textures/programs, heap, quality step,
  LOD histogram, culled actors. On by default with `?perf`; Shift+P toggles
  it in dev builds.

Measured and not pursued:

- **NPC planning/pathfinding in a worker**: a full 30 Hz crowd + pets + café
  step costs 0.27 ms and the scene matrix update 0.21 ms. Message passing and
  state sync would cost more than they save.
- **More static merging**: `cafe.js` already merges static décor per
  material at build time.
- **Meshopt/Draco geometry compression**: every shipped model is already
  meshopt-compressed and quantized. Meshopt decoding takes about 22 ms of
  main-thread time at startup, so decoder workers were not worth their
  failure modes in the sandboxed artifact.
- **Atlasing**: each character already uses one atlas, and venue sets share
  512² material maps.
- **Occlusion queries**: the rooms are open-plan with glass frontages. Pose
  culling plus LODs remove most of the off-screen cost without asynchronous
  query latency.

### Quality-tier interface (for the rendering pipeline)

The controller walks an ordered ladder of `{ tier, scale }` steps and drives
any object implementing:

```js
const target = {
  tierCount: 3,                 // tiers 0 (cheapest) .. tierCount - 1
  getTier: () => tier,
  setTier: (next) => { /* switch post-processing / shadows / lights */ },
  getRenderScale: () => pixelRatio,              // optional
  setRenderScale: (scale) => { /* resize targets */ },
};
installPerformance({ renderer, scene, camera, quality: target,
  ladder: buildQualityLadder({ tierCount: 3, maxTier, scales: [1, 0.9, 0.8, 0.7, 0.6, 0.5] }) });
```

Resolution is trimmed first near the top of the ladder; tiers only change
when a resolution band is exhausted. Frame time is judged relative to the
scheduler's current budget (24 or 45 fps); GPU timer headroom is required
before upgrading when available. A step that fails right after an upgrade
is blocked for an exponentially growing penalty. `main.js` currently adapts
`autoQualityTarget` (effect levels plus pixel ratio); a richer tier system
can replace its `getTier`/`setTier`.

A/B switches: `?lod=0`, `?cull=0`, `?bvh=0`, `?warmup=0`, `?adaptive=0`.

### Merge order with PR #23 (Pages deploy) and PR #26 (hero assets, baked LODs)

Any order works; these are the resolutions to apply.

- **#26 and this PR:**
  - `tools/msft-lod.mjs` is byte-identical in both, so the add/add is clean.
  - #26's `src/gltfLodPlugin.js` (which builds `THREE.LOD`) must stay
    unregistered: `BakedLodPlugin` here reads the same chains without
    restructuring the scene. Registering both would wrap meshes in
    `THREE.LOD` and have two systems switch the same mesh.
  - #26 regenerates `src/modelManifest.js` (base-prefixed URLs, `lods`
    fields, `espresso_machine`/`cup` removed). This PR does not edit it, and
    the first-frame lists in `modelLoader.js` ignore keys missing from the
    manifest.
  - #26 drops its committed `ktx2/` copies; `tools/compress-textures.mjs` is
    the KTX2 path.
  - Merging this PR first makes #26's LODs and textures effective as soon as
    #26 lands. Merging #26 first leaves its chains dormant until this lands.
- **#23 and this PR:**
  - `src/assetUrl.js` is byte-identical.
  - `package.json` `build`: keep #23's `vite build`. Its `pagesDeploy`
    preprocess already runs `tools/compress-textures.mjs` into the Pages
    output. Drop this PR's `&& node tools/compress-textures.mjs`, or the step
    would rewrite `dist/models` after the service worker revisioned it.
    `models/aliases.json` is written by that same step.
  - `src/modelLoader.js`: take this PR's version, which uses hashed
    Draco/Basis assets instead of `assetUrl('/draco/')`. `public/draco` is
    removed here.
  - `vite.config.js`: keep #23's config and add this PR's `bvh` chunk group.
    #23 already keeps `three/examples` out of the vendor chunk.
  - Drop #23's `CRITICAL_PRELOADS` entry for `environment/courtyard.hdr`.
    `main.js` now requests the HDR after the first café frame, so the preload
    would put its 1.4 MB back in front of first paint.

### Deployment notes (GitHub Pages under a sub-path)

Everything this layer loads resolves relative to the build's base and is
content-hashed: the LOD worker (`new URL(..., import.meta.url)`), the BVH,
KTX2-loader and HUD chunks, and the Basis transcoder and Draco decoder (Vite
assets mapped onto the loaders' fixed file names via a `LoadingManager` URL
modifier; `public/basis` and `public/draco` are gone). Model URLs go through
`src/assetUrl.js` (`import.meta.env.BASE_URL`, idempotent). The decoders are
single-threaded WASM. No `SharedArrayBuffer` is used (three-mesh-bvh only
touches it behind an opt-in flag that is never set), so no COOP/COEP headers
are needed. Verified with `vite build --base=/vibe-coffee/` + `vite preview`:
models, worker, BVH, KTX2 and transcoder all load from `/vibe-coffee/assets/`.
GLBs keep their fixed `models/<name>.glb` names (they come from `public/`).


---

## Immersion V2 baseline (2026-07-11)

Recorded before any Immersion V2 feature work, per Section 14 of
`IMMERSION_V2_IMPLEMENTATION_PLAN.md`. Every Immersion V2 PR compares its
before/after numbers against the same method described here — on the same
machine, in the same session where possible.

- **Commit:** `cd48ca6` (main) + baseline instrumentation
- **Date:** 2026-07-11
- **Method:** `npm run perf:baseline` (tools/perf-baseline.mjs), viewport
  1440×900@1x, Auto quality, seeded crowd (`?visual-audit=1`), volumes at
  zero, music off, laptop on. CPU is sampled from the browser's whole process
  tree over 45 s of ambient (no-interaction) Golden Hour.
- **Machine class:** headless Linux container, Chromium with SwiftShader
  software GL (no GPU). On this class the renderer saturates: absolute CPU
  percent pegs near the thread count and **`cpuSecondsPerFrame` is the
  regression gate**. On hardware-GL machines, `combinedCpuPercent` applies
  directly (Section 14.2: ≤45 % combined on the reference machine, and no
  more than +10 % relative per PR on any machine).

### CPU sample (Golden Hour, Auto, ambient, 45 s)

| Metric | Value |
| --- | --- |
| Combined process-tree CPU | 354.5 % (software-GL saturated) |
| Frames rendered in window | 22 |
| CPU seconds per rendered frame | **7.26** |
| Target FPS (scheduler) | 24 |

Per-PR relative gate on this machine class: `cpuSecondsPerFrame` may not grow
more than +10 % versus the pre-change run of the same command.

### Per-café Auto metrics (seeded crowd, GC'd before sampling)

| Café | Draw calls | Triangles | Geometries | Textures | Active geo | Active tex | Instanced meshes (instances) | Steam sprites | Heap MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| goldenhour | 922 | 335,267 | 247 | 49 | 424 | 38 | 11 (500) | 24 | 109.8 |
| roastery | 806 | 283,486 | 331 | 58 | 414 | 35 | 12 (631) | 18 | 111.4 |
| midnight | 841 | 306,293 | 293 | 55 | 355 | 33 | 12 (459) | 18 | 111.4 |
| terrace | 620 | 222,956 | 271 | 58 | 318 | 26 | 6 (241) | 9 | 109.8 |

Budgets derived from Section 14.3 against these numbers:

- Draw calls per café: **≤ +5 %** (goldenhour ≤ 968, roastery ≤ 846,
  midnight ≤ 883, terrace ≤ 651).
- Auto overview triangles: **≤ +20 %** per café.
- New active textures per café: **≤ +8**; new unique geometries: **≤ +12**.
- Ten-switch memory audit: heap growth < 10 MB (target < 5 MB); geometry and
  texture lifecycle delta within ±5 (ideally 0). Baseline run:
  heap Δ **+0.22 MB**, geometries Δ **0**, textures Δ **0** — passed.

### Audio and asset sizes

| Metric | Baseline | Budget |
| --- | --- | --- |
| Decoded sound library | **35.13 MB** | ≤ 41.13 MB total for all V2 work (+6 MB); pets ≤ +3 MB decoded |
| Single-file artifact (`npm run artifact`) | **15.31 MB** | must stay ≤ 16 MB or ship an approved asset pack |
| dist/ total | 18.89 MB | informational |
| Main JS bundle | 915 kB (248 kB gzip) | informational |

### Instrumentation added with this baseline

`window.__vibe.metrics()` now also reports, so later PRs can audit their
budgets from the first commit (systems that do not exist yet read zero):

- `activeOneShotSources` — live non-looping recorded audio sources
- `activePetVoices` — pet voice events currently sounding (workstream A)
- `plannerEvalsPerSecond` — context-planner evaluation rate (workstream G)
- `serviceTasks`, `serviceReservations` — service coordinator load (workstream E)
- `steamEmitters` — steam sprites/emitters owned by the current café
- `instancedMeshes`, `instancedInstances` — instanced-décor coverage

## Reproducing

```sh
npm run dev &                      # vite on 127.0.0.1:5173
npm run perf:baseline              # per-café Auto metrics + 45 s CPU sample
npm run audit:memory               # ten-switch lifecycle audit
npm run perf:bench -- --url=http://127.0.0.1:5173 --out=after.json
                                   # fixed-1x A/B bench; point --url at a
                                   # second checkout (e.g. main on :5174)
npm run build && npx vite preview  # production build incl. KTX2 textures
npm run artifact                   # prints single-file artifact size
```

`perf:baseline`'s per-café `calls`/`triangles` are read from whichever frame
was last rendered, so they swing by about 2× depending on whether that frame
refreshed the shadow map. Use `perf:bench` (which always refreshes shadows)
when comparing renderer counts.

On machines where Chromium needs extra flags (root containers, software GL),
point `CHROME_PATH` at a wrapper script that adds them, e.g.
`--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
