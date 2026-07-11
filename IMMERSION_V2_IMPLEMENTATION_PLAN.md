# Immersion V2 implementation plan

**Status:** implementation handoff

**Target branch:** feature branches into `main`

**Scope:** pet audio and interaction, higher-fidelity greenery and décor, a precise local-time clock, service-counter and waiter improvements, direct MacBook interaction, and smarter/more human NPCs
**Primary constraint:** increase immersion without giving back the CPU, GPU, and memory improvements already merged

## 1. Product goal

The next pass should make the café feel deliberately authored rather than merely populated. A user looking closely at a plant, shelf, counter, table, pet, or patron should see a plausible object or behavior with a reason to exist. Audio should be tied to visible events and physical locations instead of becoming another continuous noise bed.

The target is warm semi-realism, not photorealism. The work should improve silhouettes, materials, placement, timing, and behavioral context before increasing polygon count. The experience must remain suitable for a browser tab that stays open for hours.

### Success looks like this

- Pets feel alive and respond to the player, but do not add constant barking or meowing.
- Greenery reads as recognizable plant species in believable pots rather than primitive stems and blobs.
- The wall clock visibly agrees with the user's operating-system timezone and current time.
- The counter looks like a functioning café service area, with readable displays and credible work zones.
- Clicking the player's MacBook produces an immediate, spatially located MacBook-style typing response.
- Small décor survives close inspection without turning every object into a separate draw call.
- NPCs choose actions for contextual reasons, move with anticipation, and coordinate with service staff and each other.
- Auto quality remains thermally efficient; Detail mode remains available for users who prefer richer effects.

## 2. Non-goals

- Do not replace Three.js, Web Audio, or the current scene lifecycle.
- Do not add online AI/LLM conversations, networking, accounts, or runtime asset downloads.
- Do not build full rigid-body physics for patrons or props.
- Do not make every prop interactive. Interaction should be reserved for objects with clear feedback.
- Do not increase the default crowd size to make the room feel busier; improve behavior and staging instead.
- Do not merge all work in one unreviewable branch. Each workstream below should have its own branch and PR.

## 3. Current system the implementer is inheriting

### 3.1 Application and rendering

- `src/main.js` owns application state, café switching, player camera/seating/walking, raycasting, the HUD, preferences, the render loop, audio-listener updates, the focus timer, and player laptop/cup placement.
- `src/frameScheduler.js` is the thermal contract. Auto currently targets 24 FPS while ambient, 45 FPS during interaction, and 2 FPS while hidden. Auto/Smooth render directly; Detail retains the composer.
- Auto defaults to effect level 0, an 8 Hz shadow cadence, pixel ratio 1, and the low-power WebGL preference. GTAO and bloom are half-resolution when enabled.
- `buildCafe()` returns the café group, seats, collision data, navigation anchors, dynamic animation hook, quality hook, entrance controller, surface-prop registry, and disposal hook.
- `mergeStaticDecor()` in `src/cafe.js` already folds compatible static décor into material batches. Dynamic, transparent, skinned, clickable, and clock/door objects must remain outside that merge.

### 3.2 Assets and scene construction

- `src/cafe.js` is still a large procedural scene builder. It creates architecture, tables, chairs, counter areas, lighting, table vignettes, plants, clock, menu, shelves, outdoor scenery, steam, and theme-specific decorations.
- `src/modelManifest.js` is generated. Do not hand-edit it; add assets through the existing manifest-generation workflow.
- `src/modelLoader.js` normalizes model height, marks shared geometry/materials/textures, supports Draco and Meshopt, and supplies plain clones, skeleton-safe character clones, and pet clones.
- Current reusable plant assets are `plant`, `plant_small`, and `cactus_pot`. Some vases, leaves, flowers, trees, shelves, lights, books, and counter pieces remain procedural primitives.
- `src/tableClearance.js`, `registerTableProp()`, and the café's `surfaceProps` are the authoritative mechanism for moving fixed table décor away from the player's laptop and drink. Every new tabletop item must register with this system.

### 3.3 Audio

- `src/audio.js` owns one `CafeAudio` graph with music, ambience, voices, foley, machinery, exterior, convolution reverb, HRTF panners, recorded assets, and synthesized fallbacks.
- Recorded assets live in `public/sounds/`; `src/soundManifest.js` is generated and must not be edited manually.
- `src/soundLoader.js` controls decode rate, mono/stereo memory cost, normalization, and buffer loading. Current decoded audio is about 35.13 MB in the runtime audit.
- The sound popover in `index.html` currently exposes music, café ambience, and voices. Values persist through `src/preferences.js` and are wired in `src/main.js`.
- The current `typing.mp3` serves NPC and player typing. Player typing is scheduled only when the focus timer is running, the laptop is visible, and the timer is in a focus block. Clicking the laptop itself has no audio behavior.

### 3.4 NPCs, service, doors, and pets

- `src/npc.js` contains the main patron state machine, imported/procedural avatar adapters, animation LOD, personal-space steering, furniture avoidance, activities, queueing, ordering, pickup, seating, pairs, greetings, exterior pedestrians, umbrellas, and the barista.
- `DoorCoordinator` in `src/doorFlow.js` owns exclusive doorway reservations and FIFO waiting positions. New service or crowd logic must use it rather than bypassing the door.
- `CrowdSim` owns patrons, seats, order queue, `brewFor`, the barista, outside actor ownership, quality tiers, player collision, and audio activity spots.
- `Barista` is currently reactive: register when `ordering` exists, machine when `brewFor` exists, otherwise a small idle/tidying wander. There is no general waiter task queue.
- `src/pets.js` already gives rigged cats and dogs autonomous states. Cats wander, nap, groom, and watch the nearby player. Dogs attach to a seated owner, settle beside them, and leave when the owner leaves. Pets currently receive no `CafeAudio` instance, expose no click target, and make no sound.

### 3.5 Existing verification

- `npm test` covers preferences, rendering layout, audio asset budgets, doorway serialization, umbrella behavior, table clearance, environment rules, and frame scheduling.
- `npm run audit:visual` captures all cafés, seats, walls, doorway transitions, umbrella transitions, a congested doorway, and the Auto efficiency overview.
- `npm run audit:memory` cycles cafés repeatedly and fails on heap or renderer-resource lifecycle regressions.
- `window.__vibe.metrics()` exposes quality, cadence, heap, decoded audio, active geometry/textures, draw calls, triangles, crowd counts, and doorway state.

## 4. Architecture changes before feature density

Do not continue growing `buildCafe()` and the monolithic NPC update with unrelated blocks. The first implementation PR that touches each area should establish these small modules while preserving existing public behavior:

```text
src/
  decor/
    decorManifest.js          # per-theme authored placements and variants
    plantFactory.js           # shared pots, foliage, trees, and LOD policy
    serviceCounter.js         # case, menu, POS, machine, shelves, work anchors
    tabletopFactory.js        # curated fixed tabletop clusters and steam pool
  interactions/
    worldInteractions.js      # raycast registry and hover/click arbitration
  npc/
    behaviorPlanner.js        # low-frequency context/utility decisions
    serviceCoordinator.js     # barista/waiter task queue and reservations
    navigationReservations.js # POI, counter, pickup, aisle, and service slots
  clock.js                    # pure local-time-to-hand-angle conversion
```

This is a target decomposition, not a requirement to move all of `src/npc.js` or `src/cafe.js` at once. Extract only the code needed by the active workstream, keep commits reviewable, and retain `buildCafe()` and `CrowdSim` as integration owners.

### 4.1 Asset sourcing and production rules

- Use real café, hospitality, botanical, and MacBook references before modeling. Match proportions and construction, not a single copyrighted design wholesale.
- Prefer CC0 and clearly compatible CC-BY assets. Record source URL, creator, license, edits, and retrieval date before the asset enters the repository.
- Add model and sound attribution through the existing `CREDITS.md` and tool metadata paths. Do not ship an asset first and attempt to recover its provenance later.
- Keep all runtime assets local. The application must remain offline-capable and must not fetch models, textures, or sounds from third-party hosts while running.
- Clean models before import: remove hidden geometry, join compatible material slots, deduplicate vertices, correct normals/tangents, apply transforms, and remove unused animation tracks.
- Use Meshopt/Draco and compact WebP atlases through the existing loader/artifact flow. Prefer one 1K atlas shared by a prop family to several unique 2K textures.
- Trim silence and unrelated ambience from one-shots before encoding. Normalize by category and true peak; do not make a pet voice or keyboard sample loud merely because its source file was quiet.
- Every acquired asset needs a procedural or safe-omission fallback. A failed decorative model must not prevent the café from loading.

## 5. Workstream A — pet interaction, spatial sound, and sound-menu control

**Suggested branch:** `feat/pet-interaction-audio`

### Behavior

- Add short, credited recordings for cat meow/chirp/purr and dog huff/whine/soft bark. Favor subtle domestic sounds; do not use dramatic stock barks.
- Spontaneous pet voices may occur only when the listener is close and the pet is in a matching state:
  - cat `watchPlayer` or `nudge`: chirp/meow;
  - cat `nap` after deliberate petting: short purr;
  - dog `alert`: huff/quiet whine;
  - dog greeting after a player interaction: one soft bark or excited breath.
- Proximity must be checked before allocating an `AudioBufferSourceNode`. Recommended spontaneous range is 2.5–3 m, with a 20–60 second semantic cooldown and no more than one spontaneous pet event at a time.
- Clicking a visible pet is an intentional interaction. It should trigger an existing compatible animation (`nudge`, `alert`, or a short groom/sniff response), face the player when appropriate, and play one spatial sound. Apply a click cooldown of at least 1.5 seconds.
- Pet interaction should not interfere with chair selection. `worldInteractions.js` should resolve clickable world targets before seat raycasts only when the nearest hit is a registered interactive object.
- Add hover cursor/outline feedback, but do not add a persistent floating label.

### Audio API

Add an independently controllable pet bus so the new slider is meaningful:

```js
audio.setPetVolume(value)
audio.playPetVoice(kind, event, worldPosition, { intentional })
```

- `petBus` should connect to `master` and a restrained reverb send. It should not be routed through `voicesBus`, because the existing voices slider controls crowd speech.
- All pet sounds remain positional with HRTF. Use short-lived panners and sources; do not create one permanent graph per pet.
- `intentional: false` must enforce the close-distance policy before node creation. `intentional: true` may use a wider audible range but must remain spatial.
- Recorded sound failure must fall back to a very soft synthesized chirp/huff, or silence if a credible fallback cannot be made. Never substitute white noise.

### UI and persistence

- Add a `pets` slider to `#mixer-pop` in `index.html`.
- Add `petVolume` to `DEFAULT_PREFERENCES`, load sanitization, saving, boot wiring, and preference tests.
- Suggested default: `0.65`, range `0–1`.
- Muting café ambience must not silently disable a nonzero pet slider; the user explicitly asked for a separate control.

### Asset and memory rules

- Use mono 24 or 32 kHz assets unless stereo content is essential.
- Prefer several onset-trimmed clips totaling under 45 seconds rather than long source recordings.
- Pet audio may add at most 3 MB decoded PCM and 600 KB compressed to the default bundle.
- Add credits to `CREDITS.md` and the source metadata used by `tools/gen-manifest.mjs`.

### Acceptance criteria

- No pet sound is produced outside the proximity rule unless the player deliberately clicks the pet.
- Clicking a cat or dog produces one matching animation/sound response with correct 3D position.
- Rapid clicks cannot stack sources or produce clipping.
- The pets slider persists across reload and does not change crowd voices.
- Café switching disposes active pet sources and interaction registrations.

## 6. Workstream B — recognizable plants, pots, and exterior trees

**Suggested branch:** `feat/greenery-fidelity`

### Visual system

Replace one-off primitive construction with a small kit of reusable authored parts:

- Pots: glazed ceramic, ribbed terracotta, matte concrete, and a small tabletop bud vase.
- Indoor plants: monstera, snake plant, pothos, fern, and a compact succulent/cactus family.
- Outdoor greenery: two trunk/branch silhouettes, three canopy clusters, planter shrubs, and terrace vines.
- Flowers: one restrained stem/leaf/petal kit with 3–4 palette variants. Avoid spherical flower heads on straight sticks.

Use seeded combinations of pot, plant species, scale, leaf rotation, and healthy/dry color variation. Each café should have a curated species palette rather than sampling all plants everywhere.

### Rendering strategy

- Share one foliage atlas and one pot-material atlas where possible.
- Reuse geometry. Repeated leaves, pots, tree trunks, canopy clusters, and shelf plants should be `InstancedMesh` or merged static batches.
- Near indoor floor plant target: 800–2,000 triangles. Mid-distance version: 200–600 triangles. Exterior trees should switch to a low-detail cluster or camera-facing canopy beyond the close window view.
- Only the pot or trunk receives shadows in Auto. Individual leaves may cast shadows in Detail only if profiling proves the value.
- Wind is optional and must be shader-based or group-level. Do not update every leaf matrix in JavaScript each frame.
- Large pots and trunks receive simple colliders; leaves and tabletop plants do not.

### Placement and art direction

- Move placements into `decorManifest.js` with stable seed, transform, variant, and collider data.
- Golden Hour: warm ceramics, hanging pothos, monstera, a few imperfect leaves.
- Roastery: architectural snake plants, concrete planters, restrained greenery.
- Midnight: darker foliage, one or two sculptural plants, no bright tropical overload.
- Terrace: the richest plant set, with believable planter groupings and layered tree silhouettes outside the immediate seating zone.

### Acceptance criteria

- At conversational distance, plants have identifiable leaf silhouettes, credible pot rims/bases, and no obvious intersecting stems.
- No two adjacent plants use the exact same transform/leaf rotation.
- Exterior trees read in both day and lit night conditions.
- Added greenery remains within the geometry, texture, and draw-call budgets in Section 14.

## 7. Workstream C — precise local-time wall clock

**Suggested branch:** `feat/local-time-clock`

The current clock already calls `new Date()` and therefore uses the browser's local timezone. It continuously positions the minute and hour hands, but it lacks a second hand, explicit dial marks, and a testable time model.

### Implementation

- Add a pure exported function in `src/clock.js`:

```js
clockAngles(date) -> { hour, minute, second }
```

- Derive all hands from one `Date` instance. Include milliseconds for a smooth second hand, or step at exact second boundaries if the visual design favors a mechanical clock.
- Add twelve readable hour marks, a center pin, a slim second hand, improved rim/back depth, and glass only if it does not create reflection artifacts.
- Continue using the user's browser/OS timezone. Do not infer timezone from café location, selected environment time, IP address, or a server.
- The environment's morning/night selector remains independent. A user may intentionally view a night café while their real local time is daytime; the clock must still show real time.
- Update from wall time, not accumulated simulation `dt`, so background throttling or a paused tab cannot make the clock drift.

### Acceptance criteria

- For injected dates at 00:00:00, 03:15:30, 12:30:45, and 23:59:59, all three hand angles are correct within one visual degree.
- Returning from a background tab immediately shows current local time.
- The clock remains separated from the wall mirror/art and has no depth flicker.

## 8. Workstream D — MacBook click interaction and authentic typing

**Suggested branch:** `feat/macbook-click-typing`

### Current gap

The existing player typing pipeline is good spatially but is gated by the focus timer. It uses the general `typing.mp3` asset and schedules bursts while focus is active. The laptop mesh is not registered as a world interaction target.

### Implementation

- Acquire or author a close, dry recording of a modern low-profile MacBook scissor keyboard. Avoid mechanical-keyboard clicks, room echo, voices, and desk bumps.
- Add a dedicated `macbook_typing` sound key. NPC typing may keep its existing asset; player typing should use the MacBook recording.
- Register the player's laptop root with `worldInteractions.js` when it is placed and unregister it when packed or moved to another seat.
- A click on the laptop should immediately call `audio.playPlayerTyping(playerLaptopWorld, { intentional: true })` and play a 1.2–2.5 second randomized slice.
- Existing focus-mode typing may continue, but use the new asset, a lower gain, and one-source replacement so an intentional click never overlaps an old scheduled burst.
- Apply a 250–400 ms click debounce. Repeated deliberate clicks may restart or vary the burst without creating parallel sources.

### Acceptance criteria

- Clicking the visible laptop produces an immediate MacBook-like typing burst at its world position.
- Clicking chairs, décor, or empty table space does not trigger typing.
- Packing the laptop stops active player typing and removes the interaction target.
- Focus-mode pause, break, reset, café switch, and laptop movement still stop the previous source cleanly.

## 9. Workstream E — reception, drink displays, machines, and waiter intelligence

**Suggested branches:** `feat/service-counter-visuals`, then `feat/waiter-service-ai`

### Counter and display visuals

Extract the reception/service area into `decor/serviceCounter.js`. Give each café a themed configuration while keeping shared functional zones:

- front register/POS with card reader, receipt slot, small customer-facing display, and hidden cable route;
- readable menu board generated from data rather than hand-positioned letter fragments;
- glass pastry case with 2–3 shelves, trays, labels, and 4–6 instanced pastry types;
- cup/lid stack, takeaway sleeves, napkin station, stirrers, sugar containers, and pickup marker;
- espresso machine with credible group-head, portafilter, drip tray, steam wand, hopper, milk pitcher, tamp mat, and knock box;
- cashier drawer or compact register integrated into the counter rather than floating nearby;
- back shelves with cups, beans, syrups, books/records where theme-appropriate, and intentional negative space;
- dirty-dish return and bin placed where staff can plausibly reach them.

Use inexpensive standard transparent glass for the display case; do not introduce real-time transmission/refraction in Auto. Light the case with an emissive strip or one shared light, not a point light per shelf.

### Semantic work anchors

The visual module must return named anchors/reservations with the café:

```js
serviceAnchors = {
  register,
  espresso,
  pickup,
  pastryCase,
  restock,
  dirtyDish,
  waiterStandby,
  deliveryApproachByTable
}
```

Audio anchors for POS, grinder, steam, pour, dishes, and pickup bell should derive from the same data so sound and visible action cannot drift apart.

### Smarter service roles

Replace the barista's direct `if (ordering) / else if (brewFor)` behavior with a small `ServiceCoordinator` and explicit work reservations. Keep the existing `CrowdSim.ordering`, queue, and brew flow compatible during migration.

Recommended task model:

```js
ServiceTask {
  id,
  kind: 'takeOrder' | 'brew' | 'deliver' | 'clear' | 'wipe' | 'restock',
  priority,
  target,
  patronId,
  createdAt,
  expiresAt
}
```

- Barista priority: take order > brew > urgent pickup > restock/tidy.
- Waiter priority: deliver prepared drink > clear departed table > wipe > restock > standby.
- The register must never starve because the barista is performing a low-priority idle task.
- Use one waiter only in cafés/crowd levels that justify it. A low-crowd café may have the barista perform delivery when the register is empty.
- Reserve workstations, tray pickup, table approach, and narrow service-lane positions before walking to them. Reuse the doorway coordinator's ownership principle; two workers must not target the same spot.
- A waiter carrying a tray needs lower speed, reduced arm swing, wider turn radius, and an upper-body carry pose/IK constraint.
- If a route remains blocked, replan to a safe standby point rather than spinning or walking through patrons.
- On café disposal, cancel all tasks and reservations before disposing workers.

### Player and patron order flow

- A completed drink should become a real service object at pickup.
- Delivery should transfer ownership of that same object from pickup/tray to the table; do not clone a second cup.
- If no waiter is available within a bounded time, fall back to counter pickup or current direct placement so orders cannot deadlock.
- After departure, create at most one clear/wipe task for the table. Removal must cooperate with `surfaceProps` and laptop-clearance ownership.

### Acceptance criteria

- The counter reads as a functioning service area from seated and walking views in all four themes.
- Menu, case, register, and machine do not overlap staff or navigation paths.
- At least three simultaneous service tasks resolve without two workers occupying one station.
- Register service remains responsive while delivery/clearing work exists.
- Cups transfer once, tables clear once, and no service prop leaks after café switching.

## 10. Workstream F — small décor and fixed tabletop fidelity

**Suggested branches:** `feat/microdecor-fidelity` and `feat/tabletop-fidelity`

### Architectural and shelf details

Improve the close-view silhouettes and materials of:

- ceiling pendants, cords, canopies, bulbs, floor/table lamps, and sconces;
- menu frame, backing, typography, dividers, prices, and today's-special area;
- wall shelves, brackets, ceramic cups, jars, books, records, and bookend clusters;
- bins, liners/lids, recycling cues, and placement beside rather than in front of work zones;
- espresso machine, grinder, POS/cashier equipment, and cable/pipe connections;
- coat hooks, condiment stations, napkin holders, trays, and pickup signage.

Do not solve detail by adding a unique model/material for every instance. Build 8–12 reusable clusters from shared atlases and seed their placement per café.

### Tabletop system

Replace primitive vignettes with deterministic curated clusters such as:

- MacBook clearance setting: empty work zone, coaster, pen, drink offset;
- book + reading glasses + tea;
- conversation setting for two with water and small shared pastry;
- flower vase + table card;
- finished drink + napkin + spoon;
- reserved/cleared table;
- dirty cup/saucer state waiting for service.

Every fixed object must:

1. register through `registerTableProp()`;
2. carry a footprint/clearance radius used by `tableClearance.js`;
3. move as a group when the laptop arrives;
4. be included in visual seat sweeps;
5. be transferred or removed exactly once during waiter clearing.

### Cups, flowers, and steam

- Improve mug lip thickness, handle attachment, saucer, coffee surface, crema/foam, and material roughness.
- Replace the current minimal bud-vase construction with a proper vessel neck/rim/base and a small authored stem/leaf/petal kit.
- Steam should use one pooled instanced/points system rather than one material/source per cup. Cap visible steam emitters, fade by distance, and disable or halve update rate in Smooth/Auto as needed.
- Steam follows the cup's world transform and stops when the cup is cleared or cold. No floating remnants after table changes.

### Lighting rules

- Prefer emissive bulb/strip materials and existing shared lights.
- A new visible fixture does not automatically justify a new `PointLight`.
- Any added shadow-casting light must be Detail-only, tightly ranged, and measured independently.

### Acceptance criteria

- All requested small objects withstand a 1–3 m inspection without obvious primitive overlap, floating, or impossible placement.
- Laptop placement clears every registered tabletop cluster at every seat.
- Menu text is readable and stable during camera movement.
- Steam remains grounded, pooled, and absent from cold/removed cups.

## 11. Workstream G — context-aware NPC behavior (broad design)

**Suggested branch:** `feat/context-aware-npcs`

Keep this layer intentionally small. It is not a life simulator; it is a low-frequency decision layer above the reliable state machines already in `src/npc.js`.

### Context inputs

- weather and time of day;
- queue length and pickup congestion;
- café occupancy and nearby free seats;
- relationship/group membership;
- carried object and current activity;
- nearby player, pet, art, bookcase, service worker, or point of interest;
- patience, sociability, and work/leisure traits assigned once at spawn.

### Example outcomes

- A worker prefers a quieter table with power/laptop space.
- A social pair prefers adjacent seats and continues conversation behavior.
- A rainy arrival closes an umbrella outside, pauses briefly, then joins the queue.
- A patron glances at the menu before ordering, waits to approach a congested pickup, or steps aside for a tray-carrying waiter.
- A nearby patron may look at a pet, browse a shelf, inspect art, or react to a loud grinder, with strict cooldowns.

### Planner contract

- Evaluate utility scores at 1–2 Hz, not every render or simulation step.
- The planner chooses an intent; the existing state machine executes it.
- An intent must define preconditions, reservation needs, timeout, interruption policy, and fallback.
- Keep deterministic seeded traits separate from transient context so people remain consistent without becoming repetitive.

## 12. Workstream H — more human movement, coordination, and NPC graphics

**Suggested branches:** `feat/human-npc-motion` and `feat/npc-visual-fidelity`

### Movement and coordination

Build on the existing path, separation, furniture avoidance, door queue, and stall rescue rather than replacing them with physics.

- Add a semantic navigation graph connecting door staging, main aisle, register queue, pickup fan, table approaches, service lane, shelves, art, pet spots, and exterior sidewalks.
- Use reservation zones for narrow aisles, points of interest, pickup slots, waiter delivery approaches, and service stations.
- Upgrade local avoidance from immediate repulsion toward short time-to-collision prediction. Keep a stable passing side and avoid per-frame left/right indecision.
- Look toward a turn or destination before rotating the whole body. Blend head, shoulders, then hips.
- Use bounded acceleration/deceleration and turn radius. Tray/umbrella/cup carriers receive slower acceleration and restricted arm motion.
- Preserve stride phase through small steering corrections; do not restart the walk clip on every path segment.
- Add subtle start/stop anticipation, weight shift, blink/gaze variation, listening/talking alternation, and object-aware hand targets.
- Groups should maintain loose cohesion without walking shoulder-to-shoulder through doors.
- Service workers get right-of-way only in the service lane; patrons should not be globally pushed aside.

### Animation and interaction fidelity

- Add or refine clips for sip, type, read, phone, talk, listen, tray carry, wipe, machine work, reach, and shelf browse.
- Use upper-body layering or simple IK for cup, phone, laptop, tray, portafilter, and door-handle contacts.
- Keep foot placement modest. Full terrain IK is unnecessary on flat café floors; correct authored root height and chair offsets first.
- Stagger loop phases and clip choices so nearby patrons do not synchronize.

### Character visuals

- Expand toward 6–10 mid-poly café patrons sharing one skeleton and animation vocabulary.
- Target roughly 8–15k triangles and one 1K compressed atlas per close indoor patron, with a lower-detail exterior form.
- Improve hair silhouettes, hands, shoes, fabric roughness, skin tone range, and restrained accessories before adding facial complexity.
- Keep hero casting limited and nonrepeating. Background/exterior patrons should remain lighter.
- Reuse skeletons, geometry, and material atlases. Do not allocate a unique material graph for every outfit color.
- Disable close-detail attachments, facial updates, and high-rate animation beyond their useful distance.

### Acceptance criteria

- No visible spinning, foot sliding, doorway/pickup knot, or repeated path oscillation in a five-minute busy-café run.
- Carried objects stay attached to credible hands and do not swing through the torso.
- Groups, workers, and solo patrons can share the room without deadlocking.
- Close indoor patrons look materially richer while exterior and distant LOD costs remain bounded.

## 13. Implementation order and dependency plan

Land the work in this order so each PR can be measured independently:

1. **Baseline and contracts**
   - Record current per-café Auto metrics, decoded audio, artifact size, and controlled CPU sample.
   - Add missing metrics for active audio nodes, pet voices, planner evaluations, waiter tasks, steam emitters, and instanced décor.
2. **Clock and interaction registry**
   - Add `clock.js` and `worldInteractions.js` with tests, without new assets.
3. **MacBook click typing**
   - Prove interaction arbitration and audio-source replacement on one object.
4. **Pet audio and interaction**
   - Reuse the interaction/audio contracts and add the pets slider/preference migration.
5. **Greenery system**
   - Establish the atlas, instancing, seeding, LOD, and décor manifest conventions.
6. **Service-counter visuals**
   - Return semantic anchors and audio positions before waiter logic consumes them.
7. **Tabletop and micro-décor fidelity**
   - Extend the same manifest/atlas conventions and preserve clearance ownership.
8. **Service coordinator and waiter**
   - Add task/reservation logic after counter/table anchors are stable.
9. **Context-aware planner**
   - Introduce low-frequency intent selection using the new POIs and reservations.
10. **NPC motion and character fidelity**
    - Improve movement/animation after semantic destinations and service traffic exist.
11. **Integrated polish and performance recovery**
    - Remove redundant meshes/materials, tune LODs, and repeat all audits.

Each numbered feature branch should begin from the latest `origin/main`, contain its own tests and measurements, and merge before the dependent branch is rebased. Do not stack several unreviewed branches and attempt one final conflict-heavy merge.

## 14. Dedicated performance and RAM efficiency contract

This section is a release gate, not a suggestion. The application is an ambient productivity tool and may stay open for hours.

### 14.1 Preserve the thermal scheduler

- Auto: 24 FPS ambient, 45 FPS during interaction, 2 FPS hidden.
- Auto/Smooth: direct PBR render path unless a measured alternative is equally efficient.
- Detail: composer allowed, with half-resolution GTAO and bloom.
- Auto shadow cadence: 8 Hz unless a test proves a higher rate is necessary.
- Context planning, pet decisions, waiter scheduling, and POI selection must run at low fixed frequencies independent of render FPS.
- No new feature may call `requestAnimationFrame()` independently of the main scheduler.

### 14.2 CPU/GPU budget

The controlled Codex-browser comparison after the thermal pass measured roughly 40% combined café renderer and shared GPU-service CPU, down from about 88% before optimization. Process percentages are machine-specific, so enforce both absolute and relative gates:

- Same-machine Auto ambient benchmark: no more than 45% combined steady CPU.
- Per-PR regression: no more than +10% relative CPU versus that branch's pre-change baseline.
- Interaction may temporarily exceed ambient, but must settle within two seconds after input stops.
- If a visual feature exceeds the budget, first reduce update frequency, light count, transparency, material count, or LOD before reducing the global crowd or removing core behavior.

### 14.3 Memory and asset budget

- Decoded sound library baseline: about 35.13 MB. All work in this plan may add at most 6 MB decoded total without explicit re-baselining.
- Pet audio allocation: at most 3 MB decoded. MacBook typing should replace/reuse the current typing budget rather than add a long second recording.
- Ten-switch memory audit: JS heap growth under 10 MB; target under 5 MB. Geometry and texture lifecycle delta remains within ±5 and ideally 0.
- New active textures per café: maximum +8, preferably fewer through atlases.
- New unique geometries per café: maximum +12 after instancing/merging.
- Per-café Auto draw calls: no more than +5% from the recorded pre-work baseline. New décor should usually reduce or hold calls through batching.
- Auto overview triangles: no more than +20%. Spend triangles in the close interior, not invisible backs or distant exterior detail.
- Preserve the single-file artifact's existing size requirement where applicable. If richer assets cannot fit, propose an optional asset pack or approved budget change rather than silently breaking the artifact.

### 14.4 Runtime allocation rules

- No `new Vector3`, materials, textures, geometries, arrays, or audio nodes in hot per-frame loops unless pooled and proven insignificant.
- Pet and interaction sounds create short-lived nodes only when an event passes distance/cooldown gating.
- One decoded buffer can serve many randomized slices; do not duplicate buffers for variety.
- Shared GLB templates remain owned by the model library and must never be disposed by café clones.
- Café teardown must cancel worker tasks, pet sounds, interaction targets, timers, reservations, steam emitters, animation mixers, and shadow maps before removing the scene.
- Static décor should be merged or instanced after placement. Dynamic/clickable objects stay separate only when interaction actually requires it.

### 14.5 Quality tiers

| Feature | Auto | Detail | Smooth |
| --- | --- | --- | --- |
| Plants | mid LOD, pot/trunk shadows | near LOD, optional leaf motion/shadows | low LOD/static |
| Steam | capped pooled emitters, reduced update | full pool/update | few or disabled |
| NPC animation | distance-tiered | closer/high-rate tiers | aggressive low-rate tiers |
| Context planner | 1–2 Hz | 1–2 Hz | 1 Hz |
| Lights | current capped practicals | limited extra case/lamp lights | emissive only where possible |
| Post-processing | direct render | half-resolution GTAO/bloom | direct render |
| Pet audio | event-driven | same | same |

Audio behavior should not degrade with graphics quality, except optional inaudible distance culling and node caps.

## 15. Testing and evidence required for every PR

### Automated tests

- `clockAngles()` timezone-local angle fixtures and background resync.
- Pet distance, click override, cooldown, concurrency, and volume preference tests.
- World-interaction nearest-hit arbitration versus chair raycasts.
- MacBook source replacement/debounce and stop-on-pack/reset behavior.
- Service task priority, expiry, cancellation, station reservation, and fallback delivery tests.
- Context utility scoring and reservation conflict tests.
- Tabletop footprint/clearance tests for every new vignette category.
- Asset-format tests for sample rate, channels, duration, and compressed/decoded budgets.

### Visual audit additions

- Near and overview greenery views in every café, including rainy/night exteriors.
- Reception close-up from customer and staff-side angles.
- Menu legibility and shelf/case overlap views.
- Every player seat with laptop on and off, covering all tabletop clusters.
- Clock screenshot at an injected known time.
- Waiter carrying/delivering/clearing sequences.
- Pet interaction pose and hover state.
- Auto and Detail comparison shots so performance mode does not become visually broken.

### Runtime audits

- Extend `window.__vibe.metrics()` with active pet sounds, audio nodes, context evaluations per second, service tasks/reservations, steam emitters, instanced décor counts, and character LOD counts.
- Run `npm run audit:memory` after every asset-bearing or lifecycle-bearing PR.
- Run `npm run audit:visual` after every graphics, interaction, movement, or layout PR.
- Repeat the controlled CPU sample after greenery, service visuals, waiter AI, and final NPC fidelity. Record pre/post figures in the PR body.
- Run at least one 15-minute busy-café soak at the end. Check heap trend, active audio nodes, stuck states, task queues, door queue, and renderer counts.

### Manual experience checks

- Listen on headphones for pet distance, panning, level, and click behavior.
- Walk every main aisle while barista, waiter, patrons, pets, and door traffic are active.
- Sit at window, lounge, bar, and standard tables in every café.
- Test laptop placement on every table family.
- Test Auto on battery and Detail while plugged in.
- Test time/environment mismatch intentionally: real daytime with café set to night and vice versa.

## 16. Definition of done

This plan is complete only when all requested product behaviors and all performance gates are proven:

- Cat and dog sounds are positional, proximity/click gated, and controlled by a persisted pets slider.
- Plants, vases, and exterior trees use the new high-fidelity shared system.
- The wall clock accurately shows local current time with hour, minute, and second indication.
- Reception, displays, menu, shelves, lights, books, bins, machines, and cashier area are visibly polished.
- A waiter/service coordinator performs bounded delivery, clearing, wiping, and restocking without starving orders or deadlocking paths.
- Clicking the player's laptop produces an authentic MacBook typing sound.
- Fixed tabletop items, cups, flowers, and steam are higher fidelity, clearance-aware, grounded, and lifecycle-safe.
- Context-aware NPC intent exists at low frequency and produces observable, sensible choices.
- NPC motion, coordination, carrying, animation, and close visual fidelity improve without regressing door, umbrella, seat, or crowd behavior.
- All tests, visual audits, memory audits, CPU gates, asset budgets, and soak checks pass.
- Every asset is credited and available offline; every failure path retains a credible fallback or safe omission.

## 17. Handoff checklist for the next agent

Before implementing a workstream:

1. Pull the latest `main` and create the dedicated branch listed above.
2. Capture the relevant baseline metrics and screenshots.
3. Read the current owner module completely; do not infer behavior from the README alone.
4. Preserve existing shared-resource ownership and disposal rules.
5. Add tests and audit coverage with the implementation, not after it.
6. Run `npm test`, `npm run build`, `npm run audit:visual`, and when relevant `npm run audit:memory`.
7. Include measured CPU, memory, draw-call, texture, geometry, triangle, decoded-audio, and bundle deltas in the PR description.
8. Merge only when the feature acceptance criteria and Section 14 budgets both pass.
