# Immersion V2 performance baseline

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

## CPU sample (Golden Hour, Auto, ambient, 45 s)

| Metric | Value |
| --- | --- |
| Combined process-tree CPU | 354.5 % (software-GL saturated) |
| Frames rendered in window | 22 |
| CPU seconds per rendered frame | **7.26** |
| Target FPS (scheduler) | 24 |

Per-PR relative gate on this machine class: `cpuSecondsPerFrame` may not grow
more than +10 % versus the pre-change run of the same command.

## Per-café Auto metrics (seeded crowd, GC'd before sampling)

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

## Audio and asset sizes

| Metric | Baseline | Budget |
| --- | --- | --- |
| Decoded sound library | **35.13 MB** | ≤ 41.13 MB total for all V2 work (+6 MB); pets ≤ +3 MB decoded |
| Single-file artifact (`npm run artifact`) | **15.31 MB** | must stay ≤ 16 MB or ship an approved asset pack |
| dist/ total | 18.89 MB | informational |
| Main JS bundle | 915 kB (248 kB gzip) | informational |

## Instrumentation added with this baseline

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
npm run artifact                   # prints single-file artifact size
```

On machines where Chromium needs extra flags (root containers, software GL),
point `CHROME_PATH` at a wrapper script that adds them, e.g.
`--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
