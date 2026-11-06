# Rendering pipeline and quality tiers

Everything that decides how the café is lit and finished lives in
`src/rendering/`. `main.js` creates one rendering system, hands it each new
café, and calls `rendering.render(dt)` once per frame.

| Module | Role |
| --- | --- |
| `qualityTiers.js` | Tier table, GPU auto-detection, `?quality=` override, shared `renderQuality` state. No Three.js import. |
| `renderingSystem.js` | Entry point used by `main.js`: wires tiers to the post stack, shadows, probes and material upgrades. |
| `postStack.js` | One scene draw into an HDR target + depth texture; GTAO, bloom, sun shafts, DOF, composite, FXAA/SMAA. |
| `colorGrade.js` | Time-of-day / weather grades baked into a 32³ LUT (pure, unit tested). |
| `lightingRig.js` | PCSS soft shadows, per-tier shadow budgets, HDR sky + per-café interior reflection probe. |
| `materialUpgrades.js` | Steam wisps, glossy rippling coffee, HDR practical bulbs. |
| `thinGlass.js` | Premultiplied Schlick-Fresnel window glass. |

## Tiers

| | low | medium | high | ultra |
| --- | --- | --- | --- | --- |
| Path | direct to canvas | HDR target + composite | HDR target + composite | HDR target + composite |
| Anti-aliasing | — | FXAA | SMAA | 4× MSAA + SMAA |
| Ambient occlusion | — | GTAO ½-res, 6 samples | GTAO ½-res, 12 samples | GTAO full-res, 16 samples |
| Bloom | — | 4 mips | 5 mips | 6 mips |
| Sun shafts | — | — | ¼-res, 40 taps | ½-res, 64 taps |
| Depth of field | — | — | autofocus, gentle | autofocus |
| Sun shadows | PCF 1024² @ 8 Hz | PCF 2048² @ 8 Hz | PCSS 2048² @ 12 Hz | PCSS 4096² @ 20 Hz |
| Interior probe | — (HDR sky only) | 96² | 128² | 192² |
| Grade, vignette | renderer AgX only | LUT + static grain | LUT + grain + CA | LUT + grain + CA |
| Café/crowd `setQuality` level | 0 | 0 | 1 | 2 |

**Auto** picks a starting tier from the GPU (software GL and low-memory
mobile → low, integrated GPUs → medium, discrete/Apple silicon → high) and the
adaptive loop in `main.js` steps whole tiers down when frame time misses its
budget, then back up to (never past) the detected tier. Ultra is always an
explicit choice.

Saved `qualityMode` values keep the settings ids: `smooth` → low,
`balanced` → medium, `detail` → high, `ultra` → ultra (`resolveTierName`).
Append `?quality=low|medium|high|ultra` (or an id) to pin a tier for audits.

## Reading the active budget from other systems

```js
import { renderQuality } from './rendering/qualityTiers.js';

renderQuality.tier;              // 'medium'
renderQuality.config.shadows;    // { mapSize, filter, radius, updateHz }
const stop = renderQuality.subscribe((config) => { /* tier changed */ });
```

At runtime the same object is on `window.__vibe.rendering.quality`, and
`window.__vibe.metrics().rendering` reports the active effects. Anything may
change the tier (settings UI, a frame-time controller); `main.js` subscribes
and re-applies the café/crowd budgets and shadow cadence on every change.
Frame-time controllers can drive tiers by index through
`rendering.qualityTarget` (`{ tierCount, getTier(), setTier(i) }`).

## Design notes

- **Nothing re-renders the scene.** AO reconstructs normals from the main
  pass's depth texture; shafts and DOF read the same depth. Cost scales with
  pixels, not geometry, which is what keeps medium within the ambient budget.
- **Interior probe.** A cube capture from the room's central aisle (characters
  and particles hidden) becomes the PMREM environment, so metals, glass and
  satin wood reflect the café they are in. Its level is normalised (via the
  spherical-harmonic mean) to the sky photograph each theme was art-directed
  against, so exposure is unchanged while colour and direction become local.
  Three r166 keeps a material's program when `scene.environment` switches to
  a PMREM of a different size; `EnvironmentLighting.setEnvironment` forces the
  recompile.
- **PCSS** replaces Three's PCF-soft shader branch, so a tier opts in simply
  by selecting `PCFSoftShadowMap`.
- **Bloom** is energy conserving (a fraction of the blurred HDR image, no hard
  threshold), so practical bulbs carry real HDR radiance instead of a 1.0 cap.
- **Assets.** The pipeline loads no files: the LUT is generated, SMAA's lookup
  textures are embedded, probes are rendered. The sky HDR is fetched relative
  to Vite's `base`, so subpath hosting (GitHub Pages) works.

## Measuring

```sh
npm run dev &
node tools/render-shots.mjs --quality=medium --out=.render-shots    # fixed views per café
node tools/perf-baseline.mjs --quality=medium                        # CPU s/frame gate
```
