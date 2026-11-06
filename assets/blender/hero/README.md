# Hero assets and runtime packaging

This pass raises the fidelity of the most-viewed props and repackages the whole
model library for distance-based detail. Models with enough geometry ship
three levels of detail (LODs) inside their GLB. Textures stay JPEG/PNG in the
repository; KTX2 is produced at build time into `dist/` only, which keeps the
repository and the GitHub Pages site small.

## What changed

| Asset | Change |
| --- | --- |
| `studio_espresso` | Remodeled two-group machine: beveled stainless chassis, oiled-walnut side panels, E61-style group heads with portafilters and walnut handles, enamel pressure gauges, steam wands and valves, slotted drip tray, perforated cup warmer. Ten procedural materials are baked into one atlas: 1024 px base color and normal maps, plus a 512 px ORM map (ambient occlusion, roughness, metalness) |
| `studio_cup` | Wheel-thrown tulip cup and saucer: foot ring, rolled lip, saucer well, strap handle. Speckled porcelain glaze and an unglazed foot, baked to a 512 px atlas |
| `mug`, `latte` | Dipped stoneware mug with a modeled coffee surface; latte bowl with an iron-glaze rim band and an original wing-heart pour in microfoam |
| `studio_chair`, `armchair`, `bar_stool`, `sofa`, `side_table` | Chamfered joinery with hardened normals. Cycles contact occlusion is multiplied into the existing `Finish variation` vertex color (COLOR_0), which every runtime path already uses, including the instanced chair. Material names, metre UVs, seat heights and cushion geometry are unchanged |
| Counter top (`realism_stone_*.jpg`) | Seamless honed Carrara-style marble (color, normal, roughness). Replaces a near-flat beige field; the venue tint still applies |
| Every model | LOD1/LOD2 through `MSFT_lod` (75 of 81 models), filtered meshopt geometry |
| Removed | `espresso_machine` and `cup`: byte-identical duplicates of `studio_espresso` and `studio_cup`, reachable only when those fail to load. `src/cafe.js` already falls back to procedural props |

Characters and pets keep their approved geometry, rigs, animations and
texture atlases. They gain LOD chains only.

## Runtime contracts kept

- `src/cafe.js` stages three cups on the machine's top. The cup-warmer plate is
  the highest surface.
- The app adds a 4.15 cm latte-art disc at 8.37 cm inside `studio_cup`. The
  handle stays inside the saucer radius, so the bounds stay centered on the cup
  axis, and the inner wall meets the disc (4.10 cm inner radius vs a 4.06 cm
  disc in source units).
- `mug` and `latte` are decor that never receive a runtime liquid, so the
  coffee is modeled.
- Hero material names avoid `metal` and `carpetwhite`, so the old espresso
  retint in `src/cafe.js` leaves the baked atlas alone.

## Manifest and LOD chains

`tools/gen-manifest.mjs` writes `src/modelManifest.js` (and the texture, sound
and music manifests) with no absolute paths. Every URL resolves against Vite's
base, so the same build works under GitHub Pages' `/vibe-coffee/`:

```js
const BASE = import.meta.env?.BASE_URL ?? '/';
studio_espresso: { url: `${BASE}models/studio_espresso.glb`, lods: 3 },
```

Outside Vite (node tests and tools) `BASE` is `/`. The portable artifact
substitutes literal root paths so it can inline every file.

`lods` counts the levels in the model's embedded `MSFT_lod` chains:

- LOD nodes sit outside the scene graph, so a loader without the plugin renders
  LOD0 only.
- LOD primitives reuse LOD0's vertex accessors and materials, so a chain costs
  index buffers only and no extra GPU vertex memory. Skinned levels bind the
  same skeleton.
- Each chain is mirrored into node extras: `vibeLodId` on LOD0, and
  `vibeLodOf` plus `lodLevel` on each level. Tools that rewrite a GLB without
  `MSFT_lod` registered drop the extension but keep nodes and extras. The
  build-time KTX2 step does exactly this, and `src/gltfLodPlugin.js` recovers
  every chain from the mirror. `tests/asset-variants.test.js` guards this.

`src/gltfLodPlugin.js` turns each chain into a `THREE.LOD`. Nothing imports it
yet; loader integration belongs to the performance workstream:

```js
loader.register((parser) => new GLTFLodPlugin(parser));
```

Switch distances are stored per node in `extras.vibeLodDistances` as world
metres after library normalization: `max(4, 12r)` and `max(10, 30r)`, where r
is the runtime bounding radius. Spec-style `MSFT_screencoverage` is stored as
well. Static batching and chair instancing must merge level 0 only
(`lodLevelZero`); otherwise every level would draw.

Assemblies spanning a whole room (`atelier_tables_*`,
`atelier_streetscape`) have no single viewing distance and keep LOD0 until
they are split per table cluster. `sandwich` (40 triangles) needs no LOD.

## Texture roles for build-time KTX2

The build step should encode each map by role:

| Role | glTF slot | Encoding | Models |
| --- | --- | --- | --- |
| color | `baseColorTexture` (opaque; no emissive maps) | sRGB, ETC1S | all 65 textured models |
| normal | `normalTexture` (tangent space, OpenGL +Y) | linear; UASTC for the four hero bakes, high-quality ETC1S is acceptable for tiling and fur normals | 44 models |
| ORM | one map in both `occlusionTexture` (R) and `metallicRoughnessTexture` (G roughness, B metalness) | linear, ETC1S or UASTC | `studio_espresso`, `studio_cup`, `mug`, `latte` |
| metallicRoughness | `metallicRoughnessTexture` only (G roughness, B metalness) | linear, ETC1S | 26 furniture, prop and assembly models |

By model group:

- Hero assets (`studio_espresso`, `studio_cup`, `mug`, `latte`): color,
  normal, ORM.
- Furniture, shelving, lamps, trees, table assemblies and the streetscape
  (26 models): color, normal, metallicRoughness.
- Plants, the four venue displays and the pets (14 models): color, normal.
- The 20 characters and `atelier_decor_midnight`: color only.
- 16 small props (food, lantern, cacti, car, pendant, bin): no textures.

The furniture's timber and linen maps are tiling materials shared across
files (the loader de-duplicates them by `asset-texture-<hash>` name). The
per-model role list is in `textures` in
[../asset-budget.json](../asset-budget.json). Measured sizes for these
settings on this library:

- UASTC hero normals: about 210 KB at 512 px and 150 KB at 1024 px after RDO
  and zstd.
- ETC1S normals: about 80 KB at 512 px.
- Color maps: ETC1S is usually smaller than the JPEG it replaces.

## Budgets

| | Before | After |
| --- | ---: | ---: |
| Models in the manifest | 83 | 81 (two duplicates removed) |
| Model library (`public/models`) | 25.76 MiB | 27.95 MiB (guard: < 28 MiB, `tests/atelier-assets.test.js`) |
| LOD0 / LOD1 / LOD2 triangles, whole library | 1,353,380 | 1,361,504 / 743,169 / 390,404 |
| 20 characters, LOD0 / LOD1 / LOD2 | 787,238 | 787,238 / 393,685 / 159,354 |
| Counter-top maps | 237 KiB | 75 KiB |

Per hero, the LOD triangles and file sizes (KiB) are:

| Model | Triangles before | LOD0 / LOD1 / LOD2 | KiB before | KiB after |
| --- | ---: | --- | ---: | ---: |
| studio_espresso | 6,096 | 19,300 / 9,649 / 3,936 | 184 | 598 |
| studio_cup | 2,992 | 2,996 / 1,498 / 598 | 30 | 110 |
| mug | 2,340 | 2,236 / 1,117 / 446 | 24 | 90 |
| latte | 3,056 | 3,196 / 1,598 / 638 | 33 | 125 |
| studio_chair (instanced ×64) | 1,868 | 2,828 / 1,818 / 1,266 | 97 | 132 |
| armchair | 2,684 | 3,916 / 2,361 / 1,447 | 117 | 175 |
| bar_stool | 2,520 | 3,480 / 2,170 / 1,532 | 106 | 145 |
| sofa | 3,778 | 4,226 / 2,432 / 1,754 | 112 | 162 |
| side_table | 856 | 1,224 / 847 / 763 | 56 | 58 |
| char_atelier_1 (typical cast) | 36,620 | 36,620 / 18,307 / 7,515 | 824 | 865 |
| pet_dog | 22,210 | 22,210 / 11,105 / 4,433 | 546 | 564 |

Texture policy:

- Hero color and normal maps: 1024 px for the espresso machine, 512 px for
  ceramics.
- ORM maps: 512 px.
- Characters and pets: the existing 1024 px atlases.
- Everything else: 512 px.
- No 4K maps; nothing needs lazy high-resolution streaming.
- Every map is power-of-two, so build-time KTX2 gets full mip chains.

`tests/studio-assets.test.js` holds the hero LOD0 budgets. The complete
per-model report is [../asset-budget.json](../asset-budget.json).

## Reproduction

Run from the repository root with Blender 4.3 and ffmpeg.
Start from the models on `main`; the Blender scripts write raw PNG-textured
GLBs that the optimizer compresses once.

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/build_hero_espresso.py
blender -b -t 8 --python-exit-code 1 --python tools/blender/build_hero_cups.py      # VIBE_HERO_CUP=<key> limits
blender -b -t 8 --python-exit-code 1 --python tools/blender/refine_hero_furniture.py # VIBE_HERO_FURNITURE=a,b limits
blender -b -t 8 --python-exit-code 1 --python tools/blender/build_hero_surfaces.py
node tools/gen-manifest.mjs
node tools/optimize-assets.mjs            # --keys=a,b repacks a subset; --keys= re-measures only
node tools/gen-manifest.mjs               # records lods fields
```

The optimizer is idempotent. It strips and rebuilds LOD chains, keeps
already-packed JPEGs byte-identical, and always rewrites
`assets/blender/asset-budget.json` for the whole library.

To inspect assets:

- `blender -b --python tools/blender/render_hero_preview.py -- <raw.glb> <out.png>`
  renders a studio preview of a raw (pre-meshopt) export.
- `node tools/lod-preview.mjs --keys=a,b` loads models in a real browser
  through `GLTFLodPlugin`, and captures LOD0, LOD1 and LOD2 side by side. It
  needs `npm run dev`.
- `node tools/asset-shots.mjs --venue=<id> --out=<dir>` captures close-ups of
  the counter, espresso machine, table, furniture, patron, barista and pet
  through the app's own post-processing path. It needs `npm run dev`.

## Sources

`studio_espresso.blend`, `studio_cup.blend`, `mug.blend` and `latte.blend`
keep the procedural source materials (fake users) beside the baked atlas
material. Each furniture `.blend` is the refined collection source.
`counter-stone.blend` holds the marble graph. All geometry and textures in
this pass are original project artwork with no third-party inputs. The
furniture keeps the CC0 ambientCG Wood067-derived timber maps credited in
[CREDITS.md](../../../CREDITS.md).
