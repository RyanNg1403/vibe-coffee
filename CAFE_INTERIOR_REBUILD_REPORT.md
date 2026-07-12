# Café Interior Rebuild — Final Report

Execution report for `CAFE_INTERIOR_REBUILD_PLAN.md`. All eight phases (0–7) are
implemented, verified, and merged to `main`. Every venue was rebuilt on a single
authoritative blueprint layer; laptops, props, and NPCs are placed against exact
rotated support geometry; the two‑level Terrace has real floors joined by a
reliable stair; and a whole‑venue world‑grounding audit confirms nothing floats.

## Branches & PRs

| Phase | Work | Branch | PR |
|---|---|---|---|
| 0 | Authoritative venue blueprint + renderer‑independent validation (`src/cafe/`) | `feat/venue-blueprints` | #13 |
| 1 | Golden Hour rebuilt as a classic salon with a fitted library | `feat/goldenhour-salon` | #14 |
| 2 | Downtown Roastery rebuilt as a modern process hall (roasting lab) | `feat/roastery-process-hall` | #15 |
| 3 | Midnight Jazz performance lounge (stage, performer, cabaret, booths) | `feat/midnight-stage` | #16 |
| 4 | Garden Terrace two‑level architecture + switchback stair + guards | `feat/terrace-two-level` | #17 |
| 5 | Terrace level‑aware NPC circulation (NPCs climb/descend the stair) | `feat/terrace-npc-circulation` | #18 |
| 6 | Exact tabletop support for laptops + visible NPC‑prop coexistence | `feat/tabletop-obb` | #19 |
| 7 | World‑grounding audit + integrated verification + this report | `feat/phase7-polish` | (this PR) |

Key merge commits: `e8f7cc3` (P0), `5ba6433` (P1), `257af0c` (P2), `ea15b6d`
merge (P3), `21a24f2`/`4388688` (P4), `1ab9e2d` (P5), `9719f06` (P6).

## Architecture

- **Blueprints are authoritative.** `src/cafe/interiorLayouts.js` describes every
  venue — levels, walk surfaces, vertical links, tables, seats (with explicit
  `levelId`/`isBar`), service zones, NPC destinations & forbidden zones,
  colliders, decor, lighting, audit views, and a per‑venue contract. `buildCafe`
  consumes the blueprint; nothing about geometry is inferred at render time.
- **Persistent floor identity + stair portals.** Players and NPCs carry a
  `walkLevelId`/`walkLevel` and change floors only by crossing a stair portal in
  the direction of travel — height is never inferred from position
  (`levelNavigation.js`, `main.js` `commitWalkMove`, `npc.js` stair traversal).
- **True rotated support footprints (OBB).** `src/cafe/tableSupport.js` treats a
  laptop as its four base corners, never a point. `placeFootprintForSeat` solves
  placement against each seat's real rotated shape (rect/circle/ellipse, window
  bars included) — one rule for every tabletop.

## Product requirements — status

- **Golden Hour** keeps its two window counters flanking the entrance; salon +
  fitted library read as authored. ✅
- **Roastery** is a genuine process hall: glass‑partitioned roasting lab, two
  communal work tables, a standing tasting rail. ✅
- **Midnight** has a credible raised stage (piano, mic, upright bass, monitors,
  speakers, velvet curtain), a walked performer, close cabaret two‑tops and wall
  booths, and no dead zones. ✅
- **Terrace** has two real usable floors joined by a switchback stair with a
  landing and guard rails; NPCs genuinely walk between floors (verified: ≥2 up /
  ≥2 down over a 9‑minute observation, 89% upper‑floor occupancy, 0 violations). ✅
- **Laptops.** Every player seat fully supports the MacBook by its true tabletop;
  a player laptop and an NPC laptop are simultaneously visible and non‑overlapping
  at a shared table — the NPC laptop is **never hidden** as a clearance
  workaround (Phase 6). ✅
- **Service NPCs** are purposeful and bounded; waiter/pair/delivery roles stay on
  the ground floor. ✅
- **No floating / sunken / overlapping / unsupported objects** — confirmed by the
  world‑grounding audit and a full‑size screenshot review of every venue. ✅

## Verification

**Automated gate matrix (all green):**

- `npm test` — **147/147** unit tests (blueprint validation, table‑support math
  incl. the OBB solvers, level navigation against the real terrace blueprint,
  venue contracts).
- `npm run build` — clean.
- `npm run audit:layout` — 4 venues, 4 distinct table plans, **0 errors**.
- `npm run audit:decor` — **0 decor + 0 grounding violations** across all four
  venues × every seat × laptop on/off (163/115/168/137 placed objects swept per
  venue for grounding).
- `npm run audit:memory` — stable resources, stable heap, correct rain/umbrella
  mix. **pass**.
- `npm run audit:visual` — identity continuity, actor‑count stability, door
  serialization. **pass**.

**Live behavioural probes (headless Chromium):**

- Golden Hour library browse/dwell — pass.
- Midnight stage occupancy + performer (290 s, 0 stage intrusions) — pass.
- Terrace player traversal — ascent, descent, slow pulsed climb, diagonal
  approach, and 7 guard pushes — pass.
- Terrace NPC circulation (567 s) — 2 ascents / 3 descents, 89% upper occupancy,
  0 teleports, 0 out‑of‑band floor changes — pass.
- Laptop coexistence — player + NPC laptop both visible and OBB‑non‑overlapping at
  a shared table in all four venues — pass.

**Manual review:** every authored view and every first‑person seat capture with a
deployed laptop was opened at full size (205 captures across the four venues for
the Phase 6 coexistence pass, plus per‑venue hero views for the final pass). Zero
floating, sunken, overlapping, or dislocated objects were found; the Roastery
communal‑slab and Terrace `te‑t04` cases — where two laptops previously
converged — were confirmed fixed in the flesh.

## Performance — before/after vs the pre‑rebuild `main` baseline

`baseline-main-rebuild.json` (pre‑rebuild `main`) → final. Resource‑pool metrics
(geometries/textures/instances) are the reliable fingerprint; per‑frame
call/triangle counts flip between two stable values with shadow‑pass parity, so
compare like‑for‑like.

| Venue | draw calls | triangles | geometries | textures | heap MB |
|---|---|---|---|---|---|
| Golden Hour | 1130 → 1048 (−82) | 461k → 472k (+2.5%) | 333 → 298 (−35) | 58 → 58 | 115.2 → 117.4 |
| Roastery | 1116 → 404 (−64%) | 442k → 192k (−57%) | 337 → 227 (−110) | 65 → 56 | 115.7 → 116.9 |
| Midnight | 499 → 767 (+268) | 225k → 380k (+69%) | 283 → 278 (−5) | 58 → 57 | 119.5 → 122.6 |
| Terrace | 943 → 1007 (+6.8%) | 406k → 462k (+14%) | 297 → 306 (+9) | 63 → 61 | 118.0 → 122.0 |

- **CPU: 9.445 → 8.448 s/frame (−10.5%)** on the software‑GL reference machine.
- **Decoded audio unchanged** at ≤ 40.06 MB (budget ≤ 40.06 MB).
- **Heap** rose ≤ 3.3% per venue (within the < 5 MB budget).
- **GPU footprint net down:** the suite ends with **fewer geometries** and
  **fewer‑or‑equal textures** than the pre‑rebuild baseline in every venue,
  despite adding a fitted library, a roasting lab, a full performance stage, and
  a second Terrace floor.
- **Where content grew, it is accounted for:** Midnight's higher per‑frame
  triangle count is the required performance stage (piano, bass, monitors,
  speakers, curtain) plus cabaret/booth furniture; the Terrace's +6.8% calls / +9
  geometries are the upper deck, stair, and guards. Both are offset at the suite
  level by the Roastery's large reduction (−64% calls, −57% triangles, −110
  geometries), so the venue suite as a whole improved on CPU, geometry, and
  texture footprint while holding heap and audio.

Phase 7 itself is audit‑only: the world‑grounding sweep changes no runtime
geometry, and the post‑Phase‑7 resource metrics are identical to Phase 6 in every
venue.

## Remaining limitations

- The reference performance numbers come from a headless SwiftShader (software
  GL) environment (~0.4 fps at 1440×900); absolute frame rates are not
  representative of GPU hardware, so CPU‑seconds‑per‑frame is used as the stable
  comparator rather than fps.
- The world‑grounding audit skips imported plant/tree models: their grouped GLTF
  foliage reports an inflated rest‑pose bounding box (a `Box3.setFromObject`
  quirk) that does not reflect the visibly‑grounded geometry. Plant grounding is
  therefore confirmed by the screenshot review rather than by the box sweep.
- The audit exempts a decor band within ~1.7 m of each wall (window‑bar counters,
  wall shelves, wall booths, mounted art) and the curated stage/roasting‑lab/
  side‑table daises; it is calibrated as a regression tripwire for open‑air
  floaters in the room interior, complementing — not replacing — the manual
  screenshot review.
