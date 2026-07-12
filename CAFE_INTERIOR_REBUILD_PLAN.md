# Café interior rebuild implementation plan

**Status:** implementation handoff  
**Implementation baseline:** `origin/main` at `eb0c045` or a newer `origin/main` after rebasing  
**Delivery model:** small feature branches and reviewable PRs into `main`  
**Primary constraint:** four genuinely different, polished cafés without sacrificing browser thermals, CPU efficiency, or memory stability

## 1. Objective

Rebuild the four café interiors as deliberately authored hospitality spaces rather than palette variants of one shared room.

The final experience must include:

- one café with at least two fully usable floors;
- one café organized around tables and social seating;
- one clearly modern café;
- one clearly classic, vintage, and cozy café;
- four distinct floor plans, circulation patterns, furniture families, focal points, material palettes, and lighting compositions;
- high-quality close-range graphics with no floating, intersecting, unsupported, or inexplicably placed objects;
- credible NPC use of every public floor and functional zone;
- stable CPU, GPU-adjacent rendering cost, RAM, audio memory, and resource lifecycles.

Warm semi-realism is the target. Strong proportions, silhouettes, materials, contact, lighting, and composition matter more than indiscriminately increasing polygon count.

## 2. Non-negotiable product rules

1. **The architecture is authoritative.** Tables, chairs, décor, navigation, colliders, NPC zones, lighting, and audit cameras must all consume the same venue-specific layout data.
2. **No geometry may be decorative-only when the player expects it to be physical.** Walls, guards, fences, stair rails, counters, large planters, and floor edges need matching collision behavior.
3. **Every object needs a reason and a support.** Props must rest on a known shelf, wall, counter, floor, or tabletop support plane.
4. **Do not solve collisions by hiding objects.** Reposition, reserve space, or reject a placement. In particular, the player's laptop must never make an NPC laptop disappear.
5. **Successful existing features are protected.** Golden Hour's two window-facing counters, one on each side of the entrance, must remain.
6. **A second floor must be a real destination.** It needs safe traversal, NPC traffic, seating, lighting, décor, and a reason to visit.
7. **Ordinary patrons cannot impersonate performers or staff.** Stage performers and service workers need dedicated roles, anchors, poses, and behaviors.
8. **Passing automated checks is not visual approval.** Every authored screenshot must be manually reviewed at normal size and close range.
9. **Performance is an acceptance criterion, not cleanup work.** Each venue PR must include before/after measurements from the same machine and browser session.

## 3. Current system the implementer inherits

The implementation starts from `origin/main`, not from any separate interior branch.

- `src/cafe.js` owns the procedural architecture, shared `theme.tables` furniture loop, counters, walls, décor, plants, window counters, seats, colliders, and surface-prop registration.
- `src/main.js` owns player walking, seating, camera placement, laptop/cup placement, table-clearance behavior, preferences, and the render loop.
- `src/npc.js` owns indoor patrons, outdoor pedestrians, seated activities, NPC laptops/books/phones, service states, and movement.
- `src/tableClearance.js` owns the existing laptop-adjacent displacement slots.
- `src/frameScheduler.js` owns the thermal frame-rate contract.
- `tools/visual-audit.mjs` captures generic views and interaction transitions.
- `tools/decor-audit.mjs` sweeps fixed surface props, but it does not currently prove that the complete player laptop footprint is supported or that simultaneous player/NPC workstations remain visible.
- `tools/memory-audit.mjs` and `tools/perf-baseline.mjs` are the existing lifecycle and performance gates.

### Architectural prerequisite

Do not keep growing the shared `theme.tables` loop with more conditionals. Introduce a renderer-independent venue blueprint layer first:

```text
src/cafe/
  interiorLayouts.js          # immutable per-venue blueprint data
  interiorArchitecture.js     # venue-specific architecture builders
  layoutValidation.js         # bounds, support, overlap, collider, and archetype validation
  levelNavigation.js          # floor-aware route graph and stair links
  tableSupport.js             # rotated tabletop footprint and placement math
```

Each venue blueprint should own:

```js
{
  id,
  style,
  levels,
  rooms,
  walkSurfaces,
  verticalLinks,
  tables,
  seats,
  serviceZones,
  npcDestinations,
  npcForbiddenZones,
  colliders,
  decor,
  lighting,
  auditViews
}
```

The blueprint must **replace** the shared venue furniture in its authored zones. It must not place a new room around a second, independently generated table grid.

## 4. Research references and transferable design patterns

These references are for proportion, zoning, material, circulation, and hospitality patterns. Do not copy a project wholesale.

### Multi-level circulation and spatial identity

- [Blue Bottle Coffee Shibuya / Keiji Ashizawa Design](https://www.archdaily.com/975342/blue-bottle-coffee-shibuya-cafe-keiji-ashizawa-design): ground and upper floors serve different seating purposes rather than duplicating each other.
- [Expat Roasters / WHAstudio](https://www.archdaily.com/1008770/expat-roasters-whastudio): a vertical void, daylight, and visible circulation give a narrow multi-level café a coherent center.
- [502 Coffee Roasters / stof](https://stof.kr/press/project-502-coffee-roasters-pont-coffee): repeated vertical structure ties storage, light, and multiple levels together.
- [US Access Board stair guidance](https://www.access-board.gov/ada/guides/chapter-5-stairways/): use uniform risers/treads, real landings, continuous guards, and continuous handrails as the geometric reference even though the app is not an accessibility certification tool.

### Window seating and classic hospitality

- [Landry Smith Coffee Shop](https://www.landrysmith.com/projects/coffee-shop/): front seating wraps the shopfront with a clear centerline and repeated, grounded furniture.
- [Capsule Café](https://www.theradicalproject.com/interiors/the-capsule-cafe): prime window seats flank an inviting entrance without obstructing the arrival route.
- [Claridge's ArtSpace Café](https://benwhistler.com/project/claridges-artspace-cafe/): pale timber, caramel leather, plaster, stone, and brass create a refined classic palette.
- [Café Slatkine / FdMP](https://fdmp.ch/en/projects/cafe-slatkine): a literary café uses dense, proportioned, illuminated shelving rather than isolated book props.

### Modern roasting and process display

- [Bosgaurus Coffee Roasters / NU Architecture & Design](https://www.archdaily.com/1006768/bosgaurus-coffee-roasters-nu-architecture-and-design): roasting and service processes are architectural focal points.
- [Coutume Café / CUT Architectures](https://www.archdaily.com/145926/coutume-cafe-47-rue-de-babylone-cut-architectures): laboratory-like coffee production can coexist with warm communal seating.
- [Chernyi Cooperative Coffee Roasters / Freya Architects](https://www.archdaily.com/1014429/chernyi-cooperative-coffee-roasters-freya-architects): material restraint and visible production establish a modern identity without excess décor.

### Jazz and listening-room composition

- [JAÇ HiFi Café / Isern Serra](https://www.isernserra.com/es/projects/jac-hifi-cafe): seats orient toward sound and speakers; record storage and acoustic furniture are functional architecture.
- [Sayers Club / Kelly Architects](https://www.kelly-architects.com/projects/sayers-club-hollywood): audience proximity makes a small performance venue feel intentional and alive.
- [Blue Llama Jazz Club / Hobbs+Black](https://www.hobbs-black.com/blue-llama-jazz-club): varied seating maintains stage sightlines and acoustic focus.
- [Upstairs at Ronnie's](https://www.wallpaper.com/travel/bars/upstairs-at-ronnies-london-review): a shallow stage and close cabaret seating avoid an empty gap between performers and guests.

## 5. Venue A — Golden Hour Café

### Identity

Classic European salon, table-centric and warm: cream plaster, oak, oxblood or olive upholstery, aged brass, restrained artwork, and carefully pooled light.

### Protected elements

- Preserve **two long window-facing counters**, one on each side of the front door.
- Keep the entrance centered and unobstructed.
- The counters must remain usable laptop seats and retain a clear street view.

### Layout requirements

- Use the central room for a varied salon of round bistro tables, one oval group table, and one quieter writing table.
- Keep a 1.4–1.6 m clear arrival lane from the door to the service counter.
- Each window counter should be approximately 1.8–2.2 m long and 0.42–0.48 m deep, with two stools, a continuous foot rail, visible brackets/legs, and at least 0.9 m circulation behind occupied stools.
- Do not mirror every table perfectly. Small rotations and differentiated furniture groupings should feel authored while retaining clear aisles.

### Library requirements

The library must be fitted architecture, not a large empty frame with loose world-space objects.

- Build four or five proportioned bays with a backing, plinth, side stiles, crown trim, and exact shelf support planes.
- Target 65–80% occupied shelf width, distributed across the full unit.
- Mix upright books, occasional horizontal stacks, bookends, ceramics, framed photographs, and at most two small plants.
- Use restrained burgundy, olive, ochre, cream, and ink spines rather than repetitive saturated stripes.
- Parent every book and object to the library group in shelf-local coordinates.
- Place every item 30–50 mm behind the shelf edge and exactly on its support plane.
- Use shared/instanced book geometries and one compact material atlas.
- Reserve separate wall bays for mirror, clock, and artwork; none may sit behind or intersect the library.
- Plants must not grow through shelves, books, chairs, or wall art. Use explicit vegetation footprints.

### NPC requirements

- Patrons near the counter must visibly queue, order, wait for pickup, collect a drink, or leave.
- No NPC may stand indefinitely in a neutral pose in the service aisle.
- Idle salon patrons may browse the library, read, converse, or look through the window, but each state needs a destination, animation, and timeout.

### Required audit views

- full salon from entrance;
- both window counters together;
- left and right window counters close-up with laptop and cup active;
- library straight-on, oblique, top-shelf, and lower-shelf views;
- wall décor/library boundary;
- service queue at low and high occupancy;
- every table from every usable seat.

## 6. Venue B — Downtown Roastery

### Identity

Modern working roastery: concrete, blackened steel, pale ash, fluted or wired glass, precise linear lighting, restrained greenery, and visible coffee production.

### Layout requirements

- Organize the room around one or two substantial communal worktables rather than a repeated bistro grid.
- Put the roaster, bean bins, cooling tray, scales, and process shelves in a dedicated production zone separated by a clear partition or level change.
- The production area must be visible but inaccessible to ordinary patrons.
- Add a tasting/cupping rail and a small focused project table so the room supports more than one activity.
- Maintain a clear route from entrance to order queue, pickup, communal seating, and exit.
- The window zone should use a modern rail or standing counter distinct from Golden Hour's classic twin counters.

### Graphic requirements

- The roaster should have a readable drum, hopper, sight glass, cooling tray, exhaust, controls, and supported pipework.
- Glass partitions need a minimal mullion rhythm; avoid a forest of repeated bars.
- Use contact shadows and material roughness variation to prevent equipment from looking like disconnected primitives.
- Use ceiling services, ducts, track lights, and linear luminaires sparingly and with plausible attachment points.
- Shelving should display beans, brewing equipment, and labeled containers rather than generic books copied from another café.

### Required audit views

- complete process wall;
- partition depth and mullion spacing;
- communal table from both ends and all seats;
- tasting rail with laptop/cup support checks;
- service queue and pickup route;
- window/street view;
- ceiling services from seated eye height.

## 7. Venue C — Midnight Jazz Corner

### Identity

Intimate vintage jazz/listening lounge: walnut, burgundy curtain and upholstery, aged brass, low-sheen dark floor, acoustic panels, record storage, table lamps, and focused stage light.

### Stage requirements

- Use a compact corner stage approximately 3.0–3.4 m wide, 2.2–2.5 m deep, and only 0.16–0.22 m high.
- Give the platform a visible edge/nosing and contact shadow so it never reads as a floating slab.
- Compose three permanent performance anchors: piano/keyboard, vocal microphone and stool, and compact percussion/bass position.
- Add believable cables, monitor wedges, instrument stands, speaker towers, curtain returns, and acoustic treatment.
- Keep instruments visible when nobody is performing so the stage never becomes an unexplained empty platform.
- The stage must have an explicit `npcForbiddenZone` for ordinary patrons, pets, chairs, and table décor.

### Performer requirements

- Do not place a generic idle patron on stage.
- Use a dedicated performer entity with a named role, stage anchor, entrance/exit route, instrument-aware pose or animation, and rest behavior between sets.
- A vocalist should hold or approach the microphone naturally; a pianist must align with the instrument; a percussionist must align with the kit.
- If no credible performer animation is available, leave the instruments staged and the platform unoccupied rather than showing a mannequin pose.

### Audience and density requirements

- Pull the nearest two-top tables to 1.5–1.8 m from the stage edge.
- Arrange two or three staggered arcs/fans of cabaret tables oriented toward the performance, not a rectangular grid.
- Use a banquette or booth run along one wall and preserve a 0.9–1.0 m service aisle.
- Fill dead zones with functional jazz architecture: record library, listening booth, speaker, instrument storage, acoustic screen, or lounge seating—not random plants.
- From the entrance, the stage, audience, and bar should form one continuous composition without a large undecorated floor rectangle.
- Keep the stage the brightest local zone while retaining readable guests, tables, and circulation.

### Required audit views

- stage from audience center and both sides;
- close-up of stage edge, cables, instruments, and performer alignment;
- entrance-to-stage composition;
- all cabaret tables and booth seats;
- record/library wall;
- bar and service aisle;
- stage captured twice at least 15 simulated seconds apart, failing if an ordinary NPC enters it.

## 8. Venue D — Garden Terrace

### Identity

Two-level biophilic courtyard café: warm timber, terracotta, limewash, weathered bronze, stone pavers, layered planting, filtered daylight, shade structures, and subtle night lighting.

### Level program

- **Ground floor:** service counter, social courtyard tables, water/plant focal point, pergola seating, and direct outdoor circulation.
- **Upper floor:** quieter study/overlook seating, integrated bench, planters, shade canopy, and a reason to remain upstairs.
- The upper floor cannot be a broad empty slab with a few disconnected tables.

### Stair specification

Use one shared stair specification as the source for rendered geometry, walk surfaces, navigation, colliders, and tests.

- Compact U/switchback stair in approximately a 2.25 m × 4.0 m envelope.
- Two flights around 1.05 m wide.
- For a 3.25 m rise, use 20 equal risers of approximately 162.5 mm.
- Treads approximately 280 mm deep.
- Intermediate landing at half-height with clear depth at least equal to stair width; prefer approximately 1.15 m for camera and NPC turning.
- Continuous guards and handrails on exposed sides; clear bottom, landing, and top holding zones.
- Use warm timber treads, slim dark-bronze stringers/rails, a textured landing wall, and one efficient continuous light treatment rather than a dynamic light per step.

### Player traversal contract

- Persist an explicit `walkLevelId`; never infer the active floor from camera or player height alone.
- Level changes may occur only through authored stair portals/links.
- A movement candidate outside a valid walk surface is blocked or projected back to the last valid point. It must never fall through to the ground-floor fallback.
- Resolve collision and walk-surface height atomically. If collision changes X/Z, resample the final position before committing it.
- Landing bounds must be epsilon-inclusive and share the exact geometry used by the rendered landing.
- Walking laterally off a tread must be blocked by a stringer/guard or retained on the tread, not snap the player vertically.
- At the top, every open mezzanine edge requires a continuous physical guard collider; only the stair opening is traversable.
- Guard colliders need level and vertical-range data (`levelId`, `minY`, `maxY`) rather than a ground-only radius.
- Standing up from an upper seat must preserve the upper `walkLevelId`.

### Upper-floor NPC contract

- Upper seats and POIs must be valid NPC destinations.
- Indoor patrons should probabilistically choose a floor based on availability, crowd density, activity, and accessibility.
- NPCs must route through bottom, landing, and top nodes and visibly use both flights.
- Use reservations for the stair and landing so opposing actors do not overlap, spin, or pass through each other.
- A waiting actor holds in a marked zone until the previous actor clears the flight/landing.
- NPCs upstairs can sit, work, talk, admire the view, or descend; they must not teleport between floors.
- Maintain a believable population mix. When the café has enough patrons, the upper floor should not remain permanently empty.

### Graphic requirements

- Use a compact material kit: teak albedo/normal/roughness, terracotta variation, limewash, weathered bronze, and stone/paver texture.
- Bevel deck edges and stair nosing; add contact shadows where posts, planters, and furniture meet surfaces.
- Use a shared higher-quality trunk/branch mesh and three or four instanced leaf-cluster shapes rather than raw cones or spheres.
- Planters need rims, inner cavities, soil surfaces, drainage/base detail, and supported plant roots.
- Layer canopy, hanging vines, railing planters, floor pots, and distant landscaping without blocking circulation or principal views.
- Use a seamless horizon/skydome. Do not expose room-like sky seams or flat white gaps.
- Night mode needs low-energy step/rail guidance, planter uplight, and warm exterior pools without reintroducing sunlight.

### Required audit routes and views

- walk the full stair up and down at slow, normal, and diagonal input speeds;
- stop and turn at every tread, landing seam, and top/bottom portal;
- push against every upper guard segment and stair-side rail;
- upper floor from stair top, outer edge, study tables, planters, and canopy;
- ground floor from every corner and beneath/alongside the stair;
- every upper and lower seat with laptop on/off;
- at least two NPCs ascending and two descending, including an opposing-direction queue.

## 9. Tabletop, laptop, and fixed-décor contract

### Authoritative support geometry

Every table must expose:

```js
{
  id,
  levelId,
  shape,             // rectangle | circle | ellipse
  center,
  rotation,
  width,
  depth,
  radius,
  surfaceY,
  supportMargin,
  seats,
  surfaceProps
}
```

Do not use `seat.pos.y > 0.05` as a proxy for “window bar,” “high table,” or “upper floor.” Store explicit `isBar`, `tableId`, and `levelId` metadata.

### Laptop containment

- Treat the laptop base as a rotated rectangle/OBB, not a point or circular radius.
- Project its half-extents into table-local axes and clamp the center so all four base corners remain inside the support polygon plus a safety margin.
- For circular and elliptical tops, test all four rotated corners and move inward until every corner is supported.
- Narrow counters and end seats need an authored inward normal; do not derive it solely from table center when the seat sits near a rail end.
- The laptop screen may extend vertically, but no part of the base may overhang the table edge.
- Apply the same rules to every table shape, every rotation, every level, and every seat.

### Player and NPC laptops together

- Never set an NPC laptop invisible because the player opens theirs.
- Reserve workstation slots per tabletop. If a player claims one, reflow NPC laptops and fixed props to remaining valid slots.
- If the table cannot support both laptops with required clearance, prevent that combination through seat/activity selection or move the NPC to another believable activity; do not delete the prop mid-scene.
- An NPC laptop must remain associated with its owner and preserve typing state after relocation.
- Packing or moving the player's laptop restores displaced props to valid, non-overlapping home slots.

### Other table objects

- Cups, books, flowers, candles, sugar, magazines, food, and laptops all use explicit footprints.
- Every footprint must remain inside its table and must not overlap another footprint, the laptop, or the player's cup.
- Every fixed prop bottom must match `surfaceY` within a tight tolerance.
- Steam belongs to a cup and follows it when the cup moves.
- A flower arrangement must not intersect a laptop screen or block the player's entire view.
- Clearance failure must return a diagnostic and skip/replan the placement; it must not silently hide an object.

### Required tests

- Generate every authored seat and assert all four player-laptop base corners lie within its rotated support.
- Repeat with one NPC laptop, player laptop, cup, and the table's largest fixed vignette.
- Test rectangles, circles, ellipses, narrow bars, end seats, long tables, rotated tables, lounge tables, and upper-floor tables.
- Extend the décor audit to include transient player/NPC props; do not limit it to `surfaceProps` that existed at build time.

## 10. NPC behavior and purpose

### Purposeful standing

Every standing NPC needs a visible reason and a bounded state:

- queueing;
- reading the menu;
- ordering;
- waiting at pickup;
- carrying or collecting a drink;
- greeting another patron;
- browsing a shelf/display;
- watching the stage;
- transitioning to a seat, stair, door, or exit;
- staff work at a named station.

Each state needs a destination anchor, facing target, animation/pose, minimum/maximum duration, and deterministic next transition. A neutral standing pose in a counter aisle cannot persist indefinitely.

### Navigation reservations

- Reserve order, pickup, menu, browsing, stage-view, stair, landing, and doorway slots.
- Actors waiting for a slot must use distinct holding positions outside the active route.
- Maintain FIFO fairness at doors and stairs.
- Avoid local steering that causes spinning; when progress stalls, release/replan the route rather than repeatedly rotating in place.

### Role-specific actors

- Baristas, waiters, performers, and patrons use separate role planners and valid zones.
- Ordinary patrons cannot enter staff-only counters, production areas, stage footprints, or unsafe floor edges.
- Staff idle behaviors should still look functional: wipe, restock, inspect machine, arrange cups, or wait at a home station.

## 11. General graphical-quality rules

- Prefer a small coherent material kit per café over many flat one-color materials.
- Use bevels and edge highlights on furniture, steps, shelves, counters, and stage edges where silhouette matters.
- Use normal/roughness variation before increasing geometry density.
- Use contact shadows or restrained ambient occlusion to ground objects, but avoid flickering coplanar surfaces.
- Never place two visible surfaces on the same depth plane. Artwork, pastry trays, labels, glass, shelf backs, and wall panels require explicit separation.
- Parent compound objects and their contents to one local coordinate system.
- Give furniture plausible construction: legs, brackets, plinths, rails, supports, joints, and attachment points.
- Avoid large primitive slabs without edge treatment, material texture, or structural explanation.
- Avoid repeated identical books, plant leaves, chairs, and décor transforms in adjacent positions.
- Preserve clear sightlines from entrance to service, from audience to stage, and from upper seating to the Garden Terrace focal point.
- Decorative density must be curated. Empty dead zones and indiscriminate clutter are both failures.

## 12. Browser QA and visual sign-off

The implementation is not complete until these checks run against a production build in a real browser.

### Capture coverage

For each café, capture:

- entrance and exit directions;
- all four room corners;
- complete service counter and queue;
- every wall elevation;
- each major architectural focal point;
- every table from at least one standing view;
- **every usable seat** with laptop off and laptop on;
- every shared table with an NPC laptop plus the player's laptop;
- player cup ordered, delivered, and cleared;
- day and night;
- clear and rainy exterior where applicable;
- close-range views of shelves, plants, machines, stage, stairs, railings, lamps, menus, and tabletop vignettes.

### Interactive routes

- Walk the full perimeter of every café and press into all walls/counters/large planters.
- Enter and leave through every door while NPC traffic is active.
- Sit in every chair and stand again.
- Move between at least five different seats while the laptop and cup are active.
- Test tables already occupied by laptop-using NPCs.
- Traverse the Garden Terrace stairs both ways and test every guard segment.
- Observe each NPC zone for at least 60 simulated seconds to catch purposeless idling, spinning, teleportation, and forbidden-zone entry.

### Manual review checklist

Every screenshot must be reviewed at full size for:

- floating or sunken objects;
- tabletop overhang;
- object-object intersection;
- wall/decor occlusion;
- z-fighting or movement-dependent dark flicker;
- missing supports;
- inconsistent scale;
- primitive placeholder silhouettes;
- empty/dead composition;
- blocked entrances, aisles, stairs, or views;
- NPC pose/role mismatch;
- camera clipping and near-plane disappearance;
- light leaks, daytime sun at night, and overexposure.

Automated capture success proves only that images exist. It does not approve their contents.

### Required audit-tool changes

- Add stable venue-specific audit viewpoints to authoritative layout data.
- Capture every seat, not only middle and last.
- Add table IDs, level IDs, and active prop footprints to `window.__vibe` audit output.
- Add stair/guard probes that report blocked/allowed movement and resolved floor ID.
- Add an NPC state dwell report and fail on unbounded neutral standing in service/circulation zones.
- Produce contact sheets grouped by café and surface so manual omissions are obvious.

## 13. Dedicated CPU, GPU, RAM, and asset-efficiency plan

### 13.1 Measured `origin/main` reference

Captured on 2026-07-12 with `npm run perf:baseline`, 1440×900@1x, Auto quality, seeded crowd, volumes muted, and the laptop enabled:

| Café | Heap MB | Draw calls | Triangles | Geometries | Textures | Instanced meshes / instances |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Golden Hour | 112.09 | 516 | 238,960 | 231 | 48 | 11 / 470 |
| Downtown Roastery | 113.51 | 768 | 308,248 | 308 | 63 | 12 / 565 |
| Midnight Jazz | 118.24 | 616 | 249,248 | 315 | 60 | 12 / 459 |
| Garden Terrace | 115.72 | 689 | 251,368 | 309 | 65 | 6 / 241 |

The current scheduler held approximately 24–25 observed FPS in ambient Auto mode. A separate ten-switch memory audit ended with:

- heap delta: **-0.19 MB**;
- geometry lifecycle delta: **0**;
- texture lifecycle delta: **0**;
- decoded audio after all active variants: **40.06 MB**.

Re-run the baseline immediately before each implementation PR because crowd timing and browser processes can change absolute draw-call and heap samples.

### 13.2 Hard regression gates

- **Ambient Auto cadence:** target 24 FPS and never run hotter than 26 FPS while idle.
- **Interactive cadence:** retain the current interaction target; do not raise ambient cadence merely to hide expensive frames.
- **CPU:** on the same hardware/browser, combined browser-process CPU may not grow by more than 10% relative to the pre-PR baseline. On the established hardware-GL reference, target ≤45% combined CPU during ambient Auto.
- **Draw calls:** no more than +5% per café relative to the same-session baseline unless a reviewer approves a documented visual tradeoff.
- **Triangles:** no more than +20% per café in the standard overview.
- **Unique geometries:** no more than +12 active additions per café.
- **Active textures:** no more than +8 per café; prefer shared atlases.
- **Heap while switching cafés:** target <5 MB growth and hard fail at 10 MB after ten switches.
- **Renderer resources after ten switches:** geometry and texture deltas should be 0; hard tolerance ±5 only for browser nondeterminism that is documented and reproducible.
- **Decoded audio:** this interior project should not increase the 40.06 MB decoded library unless a separately approved venue-audio workstream exists.
- **Main artifact:** retain the current repository artifact budget; new models/textures must be compressed, attributed, and measured.

### 13.3 GPU-adjacent gates

JavaScript cannot reliably read GPU utilization across browsers, so use measurable proxies plus OS/browser tools:

- record renderer draw calls, triangles, active textures, render targets, pixel ratio, and compositor effects from `window.__vibe.metrics()`;
- record Chrome Task Manager's GPU Process and tab CPU on the reference Mac;
- record macOS Activity Monitor Energy Impact and GPU history for a five-minute idle run and a two-minute walking run;
- compare before/after on the same display scale, viewport, quality profile, café, weather, and crowd seed;
- fail any PR that causes sustained fan/heat regression without a documented, user-approved visual benefit.

### 13.4 Required optimization patterns

- Instance or merge repeated books, leaves, pots, chair parts, rail balusters, shelf components, and stage acoustic slats.
- Use two or three shared book geometries and a small palette/atlas, not unique meshes/materials for every book.
- Use a small shared PBR material kit per venue. Do not create a unique texture set per prop.
- Keep plants static or use shader/group-level motion. Do not update every leaf matrix in JavaScript.
- Use one continuous stair/rail emissive treatment or a small number of baked lights; never one dynamic light per step.
- Limit shadow casters in Auto to structural objects and important silhouettes. Small books, leaves, table props, and distant exterior details should not all cast shadows.
- Keep transparent materials rare and sorted; prefer opaque or alpha-tested foliage when possible.
- Pool steam, particles, and temporary effects.
- Keep context planning at a low fixed budget and round-robin actors; adding a second floor must not double per-frame NPC evaluation.
- Dispose venue-owned geometry, material, texture, interaction, audio, and animation resources on every café switch.
- Lazy-load venue-specific heavy assets and release unshared assets when leaving that venue.

### 13.5 Performance test matrix

Run all of the following before approval:

```bash
npm test
npm run build
npm run audit:decor
npm run audit:visual
npm run audit:memory
npm run perf:baseline
npm run artifact
```

Additionally profile:

- each café idle for five minutes in Auto;
- continuous walking for two minutes;
- Garden Terrace with actors on both floors and simultaneous stair use;
- Midnight during a performance with stage lighting;
- maximum expected table-laptop activity;
- ten rapid café switches;
- hidden-tab and restored-tab behavior.

## 14. Implementation sequence

Each phase should start from the latest `main`, use its own branch, and merge only after its acceptance criteria pass.

### Phase 0 — authoritative layout and validation foundation

- Add venue blueprints, stable IDs, level metadata, support shapes, exclusion zones, colliders, navigation graphs, and audit views.
- Add renderer-independent validation for bounds, overlaps, supports, archetype uniqueness, and reachability.
- Preserve the current rendered experience while the data layer is introduced.

### Phase 1 — Golden Hour preservation and library polish

- Lock the two window counters into the Golden layout contract.
- Replace the generic library arrangement with fitted local-coordinate cabinetry.
- Add service-zone NPC purpose/timeout rules.
- Pass every Golden table/laptop and library close-up check.

### Phase 2 — Downtown Roastery modern process hall

- Replace the repeated table grid with communal, tasting, production, and window zones.
- Build the production partition/equipment and staff-only navigation.
- Pass equipment grounding, glass-depth, ceiling-service, and communal-table checks.

### Phase 3 — Midnight Jazz performance lounge

- Add authoritative stage exclusion, performer anchors, audience arcs, booth/record wall, and service aisle.
- Add dedicated performer behavior or intentionally leave the staged instruments unoccupied.
- Pass density, sightline, forbidden-zone, stage-close-up, and night-light checks.

### Phase 4 — Garden Terrace architecture and traversal

- Build the two-level courtyard, upper program, stair, landing, deck, guards, and walk-surface resolver from one specification.
- Pass exhaustive player up/down and perimeter collision tests before adding upper-floor NPCs.

### Phase 5 — Garden Terrace NPC circulation

- Add level-aware destinations, stair reservations, opposing traffic behavior, and upper-floor activities.
- Pass population, no-teleport, no-spin, and queue-clearance tests.

### Phase 6 — tabletop support and coexistence

- Generalize tabletop support to rectangles, circles, ellipses, rotations, bars, and multiple levels.
- Replace NPC-laptop hiding with slot reservation and relocation.
- Extend audits to transient player/NPC props at every seat.

### Phase 7 — integrated polish and performance recovery

- Manually review all contact sheets and interactive routes.
- Resolve every overlap, support, lighting, scale, role, and dead-zone issue.
- Recover any budget overages through instancing, batching, LOD, material reuse, shadow policy, and asset cleanup.
- Do not merge until the full definition of done below passes.

## 15. Caveats and warnings for implementation

- Do not use a generic height threshold to decide whether a seat is a bar seat or which floor the player occupies.
- Do not allow a walk-surface function to fall back to ground height when the player steps outside an upper polygon.
- Do not render rails without matching colliders.
- Do not model stairs separately from their navigation and walk-surface specification.
- Do not treat the laptop as a point or rely on a table radius for rectangular/elliptical supports.
- Do not hide an NPC laptop or fixed décor to clear the player's workstation.
- Do not place shelf contents in world coordinates independent of the shelf.
- Do not place wall art, clocks, mirrors, neon, or menus behind shelves/panels.
- Do not place ordinary patrons on the stage or in staff/production zones.
- Do not fill a visually empty area with random props; give it a functional zone and circulation purpose.
- Do not copy the same sofa, lamp, bookshelf, artwork, table grid, and counter dressing into all four cafés.
- Do not add large flat-color primitive slabs without edge, support, texture, and contact treatment.
- Do not consider a screenshot suite complete if it captures only two seats or one overview per café.
- Do not approve visual work from machine-readable pass flags without opening the images.
- Do not merge a venue whose same-session CPU, memory, renderer-resource, or asset-size budget is unexplained.

## 16. Caveat-to-test traceability matrix

| Caveat / insight | Required implementation response | Proof required before merge |
| --- | --- | --- |
| Garden Terrace stairs feel ambiguous and can appear to drop the player | Persistent floor identity, portal-only level changes, authoritative stair surfaces, atomic collision/height resolution | Slow/normal/diagonal up-and-down traversal video or screenshot sequence; monotonic surface tests; no vertical snap |
| Upper-floor fences can be crossed | Continuous level-aware guard colliders with only the stair opening traversable | Automated perimeter probes plus manual push test against every segment |
| Upper floor has no NPCs | Upper POIs/seats, floor-aware routing, stair/landing reservations, probabilistic floor selection | Seeded run showing stable upstairs population and real ascent/descent without teleporting |
| Player laptop overhangs some tables | Rotated rectangular footprint containment against the true support shape | All four laptop-base corners inside every table for every seat |
| NPC laptop disappears when player opens theirs | Slot reservation and visible relocation; never toggle visibility as a clearance mechanism | Shared-table scenario with both laptops continuously visible and non-overlapping |
| Golden Hour's window counters must remain | Encode both counters as required Golden architecture flanking the entrance | Wide entrance capture plus close-ups from every counter seat |
| Golden library looks crude or overlaps books/plants/wall décor | Fitted local-coordinate library, exact shelf planes, distributed density, reserved wall bays, vegetation footprints | Straight-on/oblique/top/lower captures; support and overlap audit returns zero |
| Midnight stage looks like a placeholder and the performer looks like a mannequin | Coherent stage construction, permanent instruments, dedicated performer role/animation or intentionally empty stage | Stage close-ups and timed behavior capture; no ordinary patron enters stage zone |
| Midnight has large empty areas | Audience arcs, booth/banquette, record/acoustic architecture, clear service aisle, entrance-to-stage composition | Whole-room contact sheet shows no unexplained dead rectangle and retains circulation |
| Counter NPC stands without purpose | Bounded named states with anchors, pose, timeout, and next transition | State dwell audit; no neutral service-zone idle exceeds its limit |
| Graphics are inconsistent with the existing polished assets | Venue material kits, beveled silhouettes, supports, contact treatment, instancing/atlases, close-range art review | Full-size manual review of every focal object plus budget comparison |
| Automated screenshots previously missed close-range issues | Venue-authored close views, every-seat capture, contact sheets, mandatory manual sign-off | Reviewer checklist attached to PR; every image opened and approved |
| New fidelity may increase heat or memory | Per-PR CPU, draw-call, triangle, heap, texture, geometry, audio, and artifact gates | Same-session before/after reports and passing lifecycle audit |

## 17. Definition of done

The rebuild is complete only when all statements below are proven with current browser evidence:

- The four layout/style fingerprints are visibly distinct without reading the café name.
- Golden Hour retains two usable long window counters flanking the door.
- Golden Hour's library is dense, polished, fully supported, and free of plant/wall-decor overlap.
- Downtown Roastery reads as a modern working roastery with credible process zoning.
- Midnight Jazz has a credible stage, dedicated performer logic or deliberately unoccupied instruments, close audience composition, and no large dead zone.
- Garden Terrace has two complete usable floors, reliable stairs in both directions, physical guards, and NPCs that use the upper floor.
- The player cannot fall through a stair, landing seam, deck edge, or fence.
- Every table, shelf, wall object, plant, light, machine, chair, and prop is supported and non-overlapping.
- Every player laptop is fully on its table.
- A player and NPC can keep separate visible laptops at a shared table when space permits.
- No counter-area NPC stands indefinitely without a purpose.
- Every seat and required route has been captured and manually reviewed.
- Production build, unit tests, décor audit, visual audit, memory audit, performance baseline, and artifact budget all pass.
- CPU, GPU-adjacent metrics, RAM, decoded audio, geometry, texture, draw-call, and triangle changes are documented against the same-session `main` baseline.
