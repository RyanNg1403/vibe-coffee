# vibe coffee — Product Requirements: Performance & Experience Round

**Status:** complete · **Last updated:** 2026-07-10
**Owners:** `Claude` (agent) and `Team` (human teammates). The Owner column is
the source of truth for who picks up each item — claim before starting so we
don't step on each other. Update Status as you go
(`todo → in-progress → review → done`).

---

## P0 — Runtime efficiency: the app must run light (RAM first)

> **This is the most important item of the round.** Everything else lands on
> top of it. The app is a long-running ambience tool — people leave it open
> for hours next to real work, so its memory and CPU footprint matters more
> than any single feature.

| | |
|---|---|
| **Owner** | **Claude** ✅ (self-assigned, starting immediately) |
| **Status** | **done** — see Results at the bottom of this file |

**Problem.** Known/suspected costs today:
- **Decoded audio is the likely RAM heavyweight.** Ambience beds (chatter ×4,
  traffic ×2, rain, long one-shots) are decoded into `AudioBuffer`s at
  44.1 kHz stereo float32 — a 60 s stereo bed ≈ 21 MB of PCM. Total decoded
  audio is likely well north of 100 MB.
- **Draw calls / geometry duplication.** Chairs (~40+/café), counter slats,
  shelf jars, books are individual meshes; every theme switch rebuilds them.
- **Rebuild churn.** Café switches tear down and rebuild the entire room;
  disposal must be airtight or every switch leaks geometry/texture/material
  references (10 switches should not grow the heap).
- **Render targets.** Composer + GTAO + bloom targets scale with DPI; the
  adaptive-quality system caps pixel ratio but target counts should be
  audited.

**Deliverables.**
1. A measured baseline: JS heap, `renderer.info.memory`
   (geometries/textures), `renderer.info.render` (calls/triangles) per café,
   plus deltas across 10 consecutive theme switches.
2. Audio memory diet: ambience beds decoded to **mono** and resampled to
   ≤ 24 kHz where perceptually safe (beds sit under LP filters anyway);
   long one-shots trimmed/streamed. Target: ≥ 60 % reduction in decoded PCM
   bytes with no audible regression at normal listening levels.
3. Instancing for repeated static geometry (chairs, slats, jars, books) —
   target: meaningful draw-call reduction per café (measure, then commit).
4. Zero-leak theme switching: heap and renderer counts flat (± noise) across
   10 switches.
5. Results table checked into this file when done.

**Acceptance criteria.**
- Decoded-audio PCM bytes reduced ≥ 60 % vs baseline.
- Draw calls per frame reduced ≥ 30 % in the busiest café.
- 10 café switches: `renderer.info.memory.geometries/textures` return to
  (± 5) the post-first-load values; JS heap growth < 10 MB.
- No visual or audible regression (screenshot + RMS spot-checks).

---

## Feature list & ownership

| # | Feature | Owner | Status | Priority |
|---|---------|-------|--------|----------|
| P0 | Runtime efficiency (RAM/draw calls/leaks) | **Claude** ✅ | done | P0 |
| 1 | Preference persistence (localStorage) | **Claude** ✅ | done | P1 |
| 2 | Mobile / touch support | Team | todo | P1 |
| 3 | Clickable world (cat, radio, chalkboard) | Team | todo | P1 |
| 4 | MacBook typing sounds during focus | **Claude** ✅ | done | P2 |
| 5 | Barista table service & bussing | Team | todo | P1 |
| 6 | NPC–environment interactions | Team | todo | P2 |
| 7 | Dogs leave with their owners | **Claude** ✅ | done | P3 |
| 8 | Seasonal particles (leaves / snow) | Team | todo | P2 |
| 9 | Night lamp shadows (budgeted) | Team | todo | P3 |
| 10 | Artifact: restore hero patrons | **Claude** ✅ | done | P2 |
| 11 | Artifact: second music track per café | **Claude** ✅ | done | P3 |
| 12 | Focus stats (pomodoro history) | Team | todo | P3 |

> Note: #8 (instancing) from the original suggestion list is folded into P0
> as deliverable 3, since it's a performance task at heart.

---

## Feature specs

### 1. Preference persistence — **Claude** — done
Volume sliders (music/café/voices), music on/off, selected café, variant
(time-of-day), quality mode, and laptop-out state survive a reload via
`localStorage`. **AC:** reload restores all eight values; a fresh profile
gets today's defaults; no errors when storage is unavailable (private mode).
_Verified 2026-07-10: all eight restore across reload (incl. laptop back on
the table); fresh context gets defaults; a page whose `localStorage` getter
throws boots with zero errors._

### 2. Mobile / touch support — Team
Touch drag to look; an on-screen joystick (or tap-to-walk) replacing WASD;
HUD reflows below 720 px width; buttons are ≥ 40 px touch targets; pinch does
not zoom the page. **AC:** the app is fully usable on a phone in portrait and
landscape; no dead controls; HUD never overlaps the timer.

### 3. Clickable world — Team
Three playful interactions: click the cat → stretch + purr one-shot; click
the radio (golden hour) → skips to the next playlist track with a tune-dial
crackle; click the chalkboard → cycles today's special text. **AC:** hover
cursor feedback on each; interactions work seated and walking; no
interference with seat-picking raycasts.

### 4. MacBook typing sounds during focus — **Claude** — done
When the player's MacBook is out **and** the pomodoro is in a focus block,
play soft intermittent typing bursts from the laptop's position (reuse the
NPC `_typeBurst` pipeline, quieter). Pauses during breaks. **AC:** audible
only when both conditions hold; stops immediately when the laptop is packed
or the timer stops; volume sits under the ambience bed.
_Verified 2026-07-10: state-machine walk (boot / laptop-only / focus /
pause / resume / pack-away / reset) gates exactly as specified; bursts at
0.45× NPC volume every 2.6–7.5 s from the laptop's panner position._

### 5. Barista table service & bussing — Team
After a customer sits, the barista occasionally walks the drink to the table
(instead of counter pickup); after a customer leaves, the barista walks out,
wipes the table (existing `work` clip), and removes leftover props.
**AC:** barista returns to the counter when the queue is non-empty (service
never starves the register); one bussing trip at most per departure; no
pathing deadlocks (stall-rescue applies).

### 6. NPC–environment interactions — Team
Wandering NPCs occasionally stop at the bookcase (browse, 5–10 s), the wall
art (look, head tilt), or the cat (crouch + pet if the cat is napping).
**AC:** at most one NPC per point of interest at a time; interactions abort
cleanly if the café switches; no collision regressions.

### 7. Dogs leave with their owners — **Claude** — done (folded into the pets system)
The dog prop becomes a companion: walks in beside its owner to the seat,
lies down, gets up and follows the owner out on departure. **AC:** dog never
blocks other walkers (no collider, purely visual); despawns with owner; ≤ 1
dog per café concurrently.

### 8. Seasonal particles — Team
Terrace: drifting leaves (a few dozen quads, wind sway). Midnight "clear
night" variant: optional slow snow. Reuse the dust-mote pattern (soft round
sprites, additive-free). **AC:** ≤ 300 particles; no measurable frame cost
at quality=auto; particles respect the variant system.

### 9. Night lamp shadows — Team
In Midnight, promote 1–2 lounge lamps to shadow-casting point lights
(512 px maps, tight radius). **AC:** stays within the quality budget (off at
low quality); no shadow acne on the rug; measure frame-time before/after.

### 10. Artifact: restore hero patrons — **Claude** — done
The two Draco-compressed hero GLBs fail under the artifact CSP (decoder
fetch blocked) and silently fall back. Decompress them at bundle time in
`make-artifact.mjs` (gltf-transform in Node), re-quantize without Draco, and
inline if the total stays ≤ 15.5 MB. **AC:** heroes appear in the published
artifact; bundle ≤ 16 MB; no decoder fetches at runtime.
_Verified 2026-07-10 after branch merge: the artifact build decodes both hero
models offline, converts their geometry to Meshopt, and inlines them. Heroes
appear without a Draco/network fetch; the final single-file bundle is 15.25 MB._

### 11. Artifact: second music track per café — **Claude** — done
Re-encode the OGG playlist at a lower bitrate (~64 kbps, they sit under
ambience) so two tracks per café fit the artifact. **AC:** playlist rotation
audible in the artifact; bundle ≤ 16 MB; titles in the HUD match the audio.
_Verified 2026-07-10 after branch merge: every café has two playlist entries;
the six unique tracks are 45-second, 64 kbps Opus encodes with matching HUD
metadata, keeping the final single-file bundle at 15.25 MB._

### 12. Focus stats — Team
Track completed pomodoro blocks per day in `localStorage`; a small tooltip on
the timer shows today's count and a 7-day streak. **AC:** counts survive
reload; no server calls; resets cleanly at midnight local time.

---

## Working agreement
- Claim = set Owner + Status here, push to `main`, then build.
- Every feature lands with an in-browser verification (screenshot or
  measurement) before its Status flips to `done`.
- P0 measurements get committed into this file under "Results".

## Results (P0) — post-merge audit, 2026-07-10, Chromium headless

| Metric | Baseline | Final merged branch | Result / AC |
|---|---:|---:|---:|
| Decoded sound-library PCM | 105.35 MiB | 30.06 MiB | **−71.5%**; ≥ 60% ✅ |
| Controlled Roastery draw calls | 1,387 | 420 | **−69.7%**; ≥ 30% ✅ |
| Golden / Roastery / Midnight / Terrace calls | — | 465 / 420 / 502 / 446 | pass |
| 10-switch renderer geometries | 228 | 228 | **Δ 0**; ±5 ✅ |
| 10-switch renderer textures | 66 | 66 | **Δ 0**; ±5 ✅ |
| 10-switch active geometries / textures | 415 / 45 | 415 / 45 | **Δ 0 / 0** ✅ |
| 10-switch JS heap | 101.83 MB | 101.73 MB | **−0.10 MB**; <10 MB ✅ |
| Single-file artifact | heroes unavailable | 15.25 MB | heroes visible; no Draco fetch ✅ |

**Final merged implementation.**
1. **Audio diet:** source assets are mono and lower-rate where perceptually
   safe; `soundLoader.js` decodes through a rate-specific
   `OfflineAudioContext`, preventing the output device from expanding every
   buffer back to 48 kHz. RMS normalization keeps perceived levels stable.
2. **Draw-call reduction:** standard chairs use four instanced batches, while
   the team's `mergeStaticDecor` pass folds remaining safe static décor into
   material-compatible meshes. Animated, transparent, clickable, skinned and
   quantized geometry stays separate.
3. **GPU lifecycle:** cloned character parts re-share equivalent skeletons;
   `SkinnedAvatar.dispose()` releases each unique skeleton/bone texture. Café
   teardown also disposes lights and their shadow maps, while shared model and
   generated textures are retained deliberately.
4. **Repeatable proof:** `npm run audit:memory` warms all procedural caches,
   rebuilds ten cafés with equivalent seeded scenes, forces collection between
   switches, and fails unless renderer counts return within ±5 and heap growth
   remains below 10 MB.
