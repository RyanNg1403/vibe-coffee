# Café interior visual audit — findings

**Scope:** post-merge audit of all four rebuilt interiors on `main` (through PR #21) against
`CAFE_INTERIOR_REBUILD_PLAN.md` §12 (browser QA and visual sign-off).
**Method:** full re-capture of every authored audit view and every usable seat (player laptop on)
in all four venues, plus night and rain view passes and a new all-room-corners pass
(`tools/corner-shots.mjs`). Every image was reviewed at full size. Evidence lives in
`.venue-shots/<venue>[-night|-rain|-corners]/`.
**Machine checks:** `npm test` (147 pass), `npm run audit:layout` (0 errors) — the issues below
are visual/behavioral and sit outside what the automated gates measure.
**Inventory:** ~350 captures reviewed — 49 authored views × day/night/rain, ~160 first-person
seat views with the player laptop on, and 26 corner views. A handful of seats were skipped by
the capture tool because an NPC occupied them (`sit()` returns false); the prior same-commit
captures of those seats were kept in place so coverage stays complete.

Severity: **P1** — visibly broken, seen from normal play positions; **P2** — clearly wrong on
inspection, hurts the venue's read; **P3** — polish.

---

## 1. Cross-venue / systemic issues

These repeat in two or more venues, so they are asset/system fixes, not per-venue dressing.

### NPC embodiment and wardrobe

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S1 | P1 | NPC outfit palette can resolve to skin tone: one patron renders with a fully bare torso at Golden Hour's oval table; other NPCs (both venues) wear skin-tone tops/trousers and read as nude at a glance — including salmon "trousers" under a black jacket reading bare from behind. | `goldenhour/gh-salon-oval.png`, `goldenhour/seat-07`, `seat-14`; `roastery/ro-window-rail.png`, `roastery/seat-11`, `seat-14`, `seat-23` |
| S2 | P1 | NPCs standing embedded inside lounge armchairs — torso upright, thighs emerging through the cushion. Seen in both venues that have armchairs. | `goldenhour/seat-00-gh-t01-s1.png`, `roastery/seat-16-ro-t03-s1.png` |
| S3 | P2 | One recurring "elderly" model has a flat stone-grey/white head that reads as an untextured mannequin mask, worst under warm light; also head-vs-arms tone mismatch on the Midnight performer. | `goldenhour/seat-02`, `seat-12`, `seat-20/21`; `roastery/ro-communal-a/b`; `midnight/mi-stage-edge-closeup.png` |
| S4 | P2 | Baristas read sunken/undersized behind service counters — chin at register height, or mostly hidden behind the espresso machine. | `goldenhour/gh-service-queue.png`, `goldenhour/seat-33`; `roastery/seat-07`, `seat-18` |
| S5 | P2 | Idle NPC clusters stall in circulation lanes (salon center aisle, Roastery roadway pedestrians loitering between lane markings mid-street outside the windows). | `goldenhour/seat-12`, `seat-18`, `seat-31`; `roastery/seat-27`, `seat-28` |
| S6 | P3 | Identical NPC clones walking side by side (same dress, same hair). | `roastery/seat-13` |

### Pets

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S7 | P1 | Pets stand **on tabletops** next to the player's laptop and cup — cat on a bistro table, dog on the writing table. Violates the tabletop-footprint contract (§9). | `goldenhour/seat-25`, `seat-31` |
| S8 | P2 | Cat/dog meshes are blocky grey primitives (box body, cube head) that read as placeholders against the polished furniture, and they loiter in service aisles and mid-courtyard. | `goldenhour/seat-11`, `seat-23`, `seat-32`; `terrace/te-stair-bottom-portal.png`, `te-pergola-wide.png`, `te-terrace-from-entrance.png` |

### Plants and planters

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S9 | P2 | Plants sprout directly from floors with no pot/planter (neon-green flat ferns indoors in three venues, monsteras, mini pine trees). Plan §8 requires planters with rims/cavities/soil. | `goldenhour/gh-writing-desk.png`, `gh-library-oblique.png`; `roastery/ro-partition-mullions.png`; `terrace/te-terrace-from-entrance.png`, `te-pergola-wide.png`; `midnight/mi-record-wall.png` |
| S10 | P2 | Hanging planters float with no visible wire/hanger: white bowls suspended mid-air by windows and inside the Roastery lab; corkscrew vines dangle from pergola beams with unattached ends; loose sprigs float at Golden Hour mullions. | `goldenhour/gh-salon-oval.png`, `gh-writing-desk.png`, `gh-window-counter-left.png`; `roastery/ro-process-wall.png`; `terrace/te-stair-landing-turn.png`, `te-stair-bottom-portal.png` |
| S11 | P2 | Crumpled teal "plant masses" sit loose on tabletops (reads as shapeless blobs at establishing views); loose sprigs on chair cushions and on a floor-lamp base. | `goldenhour/gh-salon-from-entrance.png`, `seat-21`, `seat-28`, `seat-30`; `terrace/te-garden-edge.png`, `te-stair-bottom-portal.png` |
| S12 | P3 | Saturated bright-green plant material ignores venue lighting — glows in Midnight's dark room. | `midnight/mi-room-from-entrance.png`, `mi-record-wall.png` |

### Furniture / prop identity reuse across venues (blurs the four fingerprints)

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S13 | P2 | The same pink faceted stool tops appear in **all four venues** (Golden Hour window counters, Roastery tasting + window rails, Midnight window bar, Terrace overlook). In Golden Hour and Midnight they also clash with the stated palettes. | `goldenhour/gh-window-counters-wide.png`; `roastery/ro-window-rail.png`; `midnight/mi-window-bar-night.png`; `terrace/te-deck-overlook.png` |
| S14 | P2 | The window zone composition is the same motif in the three street-front venues: two straight rails flanking the door with stools. The plan explicitly required Roastery's window zone to be distinct from Golden Hour's twin counters. | `goldenhour/gh-window-counters-wide.png`; `roastery/ro-window-rail.png`; `midnight/mi-window-bar-night.png` |
| S15 | P2 | Midnight's "record wall" is the Golden Hour library asset re-tinted, filled with generic books; only two framed sleeves say "records". Plan §15: don't copy the same bookshelf into all cafés. | `midnight/mi-record-wall.png` vs `goldenhour/gh-library-straight.png` |
| S16 | P3 | Repeated identical decor across venues: trio of wooden spheres on service shelves (GH + RO + MI), striped barrel mug (GH, RO, TE), pink flower bowls, white cup cylinders shelved as filler, circle-motif artwork repeated within and across venues (4+ instances in Midnight alone). | service-queue views of GH/RO/MI; `midnight/mi-cabaret-arcs.png`; `terrace/te-deck-overlook.png` |
| S17 | P3 | Oversized coffee cups — soup-tureen scale relative to bistro tables and rails. | `goldenhour/seat-05`, `seat-25`; `roastery/seat-24`; `midnight/mi-cabaret-arcs.png`; `terrace/te-pergola-wide.png` |

### Service choreography

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S21 | P2 | No visible order/pickup queue at **any** venue's authored service-queue view — all four captured empty service zones, and Midnight's bar is additionally unstaffed. Either the queue choreography rarely fires or the seeded crowd never routes through it; plan §5/§10 requires visible queue → order → pickup states. | `goldenhour/gh-service-queue.png`, `roastery/ro-service-queue.png`, `midnight/mi-service-queue.png`, `terrace/te-service-queue.png` |

### Unidentified placeholder props (systemic)

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S22 | P2 | An untextured dark-grey cube (in the Terrace often paired with a flat green slab) appears in tabletop vignettes in all four venues — duplicated across at least six Terrace tables alone; it matches no prop in `tabletopFactory.js` and reads as a raw primitive. Related: a grey box appliance with a white sticker label ("printer" silhouette) recurs on side cabinets in Golden Hour and Terrace. | `goldenhour/gh-service-queue.png`, `seat-13`, `seat-19`; `midnight/seat-02`; `terrace/seat-05..07`, `seat-31`, `te-service-queue.png` |

### Exterior backdrop

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| S18 | P2 | A chesterfield sofa (with books/coffee cup on it) sits on the open sidewalk outside the windows of Golden Hour and Roastery — reads as furniture dumped on the street. | `roastery/ro-window-rail.png`; `goldenhour/seat-16`, `seat-35`, `gh-window-counters-wide.png` |
| S19 | P3 | Unexplained glowing yellow slab floats over the street horizon at Golden Hour's rear windows; halo bloom around it; one seat shows a faint duplicate "ghost sun". Front and rear windows can also disagree on time-of-day (rear golden hour, front near-night). | `goldenhour/gh-writing-desk.png`, `gh-salon-oval.png`, `seat-09`, `seat-38..41` |
| S20 | P3 | Exterior pedestrians overlap/intersect each other in clusters right outside the glass. | `goldenhour/seat-41`, `gh-window-counter-left.png` |

---

## 2. Golden Hour Café

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| G1 | P1 | Occupied window-counter seats swap the classic stool for a modern black pedestal swivel stool, and the seated NPC's pose clips through it (thigh/heels through seat and base). Systemic: the same black pedestal stool spawns under a seated NPC in the Roastery too. | `gh-window-counter-left.png`, `seat-04`, `seat-16`; `roastery-corners/ro-main-corner-sw.png` |
| G2 | P2 | Two of the four protected window-counter seats face the blank wall pier between windows — half the first-person view is beige wall instead of street. | `seat-39`, `seat-40` |
| G3 | P2 | Empty/undressed fixtures: white 3-shelf unit by the writing desk (off-palette white brackets, nothing on it), blank dark chalkboard panel on the left wall, additional bare bracket shelves. (The writing desk itself does carry a typewriter — but from the authored audit view it reads as a blank white box; consider rotating it or the view.) | `gh-writing-desk.png`, `goldenhour-corners/gh-main-corner-nw.png`, `seat-06`, `seat-08`, `seat-17`, `seat-28` |
| G4 | P3 | Framed pictures propped standing on a table and on the window bench (wall props resting on furniture). | `seat-19`, `seat-21` |
| G5 | P3 | Pendant shades hang low enough to occlude the menu board from several seats. | `seat-06`, `seat-14` |
| G6 | P3 | Pink-accent creep against the oxblood/olive/brass palette: pink stools, pink flower bowl inside the library, pink tulip counter bowls, pink-frosted cupcakes, a pastel-purple suit NPC. | library/counter views |
| G7 | P3 | Mirrors render as flat blue-grey discs (no reflection); one NPC sits point-blank facing the filter-bar cabinetry; small floating white line (glass shelf seen edge-on); floating pink sign against the rear window; stray plank overhangs a table edge (`seat-34`); miniature pine trees at lounge scale-off. | `gh-wall-decor-boundary.png`, `seat-29`, `seat-21`, `seat-31`, `seat-34`, `seat-30/36` |

**Passes:** all 39 captured seats hold the laptop fully on the table; both protected window
counters present with foot rails and clear arrival lane; library is fitted, dense, well
distributed, no plant/wall-decor overlap; menu board legible; no z-fighting or camera clipping
observed.

## 3. Downtown Roastery

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| R1 | P1 | Patron-looking NPC in a beige dress stands wedged between the tasting rail and the lab glass — on the staff side of the rail at the staff-only boundary. | `ro-process-wall.png`, `ro-tasting-rail-view.png`, `seat-14` |
| R2 | P1 | Menu board bottom row ("cortado") is clipped by the board edge and a black artifact band of outlined tiles renders beneath the board. Visible from multiple seats, not just the authored view. | `ro-service-queue.png`, `seat-11`, `seat-15` |
| R3 | P2 | Roaster overhead services unresolved: duct drop ends open in mid-air, a thin rod continues from its mouth and skewers the hanging planter bowl; a tan wooden plank floats beside the hopper. | `ro-roaster-closeup.png`, `ro-partition-mullions.png`, `seat-30`, `seat-31` |
| R4 | P2 | Striped barrel mug sits half off a table edge overhanging the floor (correctly placed on the same table in the neighbouring seat capture — placement, not model). | `seat-19` vs `seat-18` |
| R5 | P2 | Flat black panel leans diagonally across the project-table end chair, intersecting tabletop and seat. | `ro-project-table.png` |
| R6 | P2 | Off-style cottage furniture family inside the modern hall: white side table + candle lamp parked on the lab walkway rug, cream low coffee table, two cottage floor lamps. | `ro-communal-a.png`, `ro-partition-mullions.png`, `seat-04..07`, `seat-17` |
| R7 | P2 | Communal worktables largely bare (one mug + paper across 4 m) and the tasting rail carries no props along its length; wide centre floor is empty. Working-roastery activity doesn't read. | `ro-communal-a.png`, `ro-hall-from-entrance.png` |
| R8 | P3 | Process shelf is mechanical: 8 identical evenly spaced cans, 4 identical bags, blank labels. Empty bracket shelves in the lab. Palm plant wrapped in a translucent teal box volume (reads unmaterialed placeholder). | `ro-process-shelf.png`, `ro-process-wall.png`, `seat-09`, `seat-17` |
| R9 | P3 | Ceiling fan blades sit flush against the ceiling plane (no downrod/motor); tilted pink stool seat at the tasting rail; pink cake prop sitting on a stool seat; cup-with-plant prop on the tasting rail; `bar-r-s1` seat stares into a concrete pillar. | `ro-ceiling-services.png`, `ro-tasting-rail-view.png`, `seat-06/07`, `seat-26` |

**Passes:** modern identity lands (concrete/steel/tile/communal); glass partition mullion rhythm
good; roaster drum readable with brass sight glass; staff-only signage present; laptop
containment clean on captured seats. Note: `seat-10/21/25` were skipped (NPC-occupied) — the
capture tool skips occupied seats, so those need a manual pass or an unoccupied-crowd seed.

## 4. Midnight Jazz Corner

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| M1 | P1 | The vocalist reads as a mannequin: neutral straight-arm stance, not aligned to the microphone (mic sits behind/above his head from audience angles), head paler than arms. Plan §7 explicitly forbids a mannequin pose on stage. | `mi-stage-from-center.png`, `mi-stage-edge-closeup.png`, `mi-service-aisle.png`, `mi-stage-from-left.png` |
| M2 | P2 | A speaker tower stands at stage front-centre-left and occludes the performer from much of the left seating; monitor wedges sit scattered/tilted (one half off the platform edge). | `mi-stage-from-left.png`, `mi-stage-from-center.png` |
| M3 | P2 | Front-of-house darkness: entrance third of the room and the corner beyond the booth run are near-black voids; guests barely readable (plan: stage brightest but guests readable). | `mi-room-from-entrance.png`, `mi-booth-run.png` |
| M4 | P2 | Two large pure-black rectangles on the wall by the menu (acoustic panels?) read as missing content/holes; white clock face and white artwork ignore the dark lighting and glow. | `mi-service-queue.png`, `mi-cabaret-arcs.png`, `mi-record-wall.png` |
| M5 | P2 | Bar completely unstaffed at the authored service-queue view; NPC stands facing the wall by the booth run; orphaned NPC laptop glows blank white at an empty cabaret table (brightest object in the room). | `mi-service-queue.png`, `mi-room-from-entrance.png`, `mi-stage-from-center.png` |
| M6 | P1 | The piano is oriented with its keyboard toward the rear curtain and has no bench — a pianist could not play it — while its tall black back panel fully occludes stage centre from the right-side tables (t08 sees only a sliver of the vocalist). The white keyboard strip protrudes past the cabinet and reads as a detached floating plank from several seats. | `seat-19`, `seat-18`, `mi-stage-edge-closeup.png` |
| M7 | P1 | The vocalist is costumed in casual shorts and a tee with bare pale legs — reads as an ordinary patron who wandered on stage rather than a performer (compounds M1). | `mi-stage-edge-closeup.png`, `seat-17`, `seat-19`, `seat-23` |
| M8 | P2 | Three booth seats face the unlit banquette back: the player's first-person frame is ~80% featureless black with zero stage sightline. | `seat-30`, `seat-32`, `seat-34` |
| M9 | P2 | The beagle stands on a bench/table surface at table height directly behind the player's laptop (floor-based elsewhere); the player's cup renders tilted ~30° mid-spill at one seat; an NPC holds a 90°-bent pose over a lounge table; another stands inside the banquette-table gap. | `seat-04`, `seat-31`, `seat-15`, `seat-33`, `mi-booth-run.png` |
| M10 | P2 | Speaker/monitor occlusion is wider than the left seats: performer hidden from centre-rear t11 and bar-side t09 too; one seat's camera is part-filled by near-plane armchair/curtain polys; a street lamp post outside descends into the body of a parked car. | `seat-26`, `seat-22`, `seat-05`, `seat-46` |
| M11 | P2 | The double bass is a featureless brown ovoid — no strings, bridge, f-holes, or endpin readable from the audience — a placeholder silhouette at the venue's focal point. | `mi-stage-edge-closeup.png`, `seat-19`, `seat-23` |
| M12 | P3 | White kitchen pedal bin placed front-of-house near the bar/stage; stool-height pink seat at a dining-height round table; tip-box label garbled; wedge monitors tipped at odd angles, one part off the platform edge; salad bowl and paper cups shelved among the "records"; gold porthole frame reads as a wall hole with a crescent sprite; NPCs idle pressed against the player's table edge; a child-scaled adult figure walks at the bar; exterior rain renders as sparse frozen square dots; the staged set reads solo-vocal with abandoned instruments. | `mi-service-queue.png`, `mi-window-bar-night.png`, `mi-stage-from-left.png`, `mi-record-wall.png`, `seat-25`, `seat-21`, `seat-39..46` |

**Passes:** stage platform has visible nosing, contact shadow, cables, wedges and permanent
instruments; no ordinary patron entered the stage zone in any capture; audience arcs + booth
run + red rug compose well; menu and neon legible; candles on tables; a record crate exists at
the booth end; night street scene outside the window bar is lively.

## 5. Garden Terrace

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| T1 | P1 | Pergola/structure geometry bugs at the stair top: a pergola post floats — its lower end is capped in mid-air above the deck — while passing through the railing planter trough; a cluster of stray tread-like boxes hovers beside the stair head over the courtyard; and another pergola post passes straight **through a study tabletop** (terracotta collar sitting on the table surface). | `te-deck-guards-east.png`, `seat-35` |
| T2 | P2 | Unexplained freestanding thin pole rises from the upper deck near the study tables (plus a second short rod stuck in the deck nearby); landing view shows table/chair undersides overhanging the deck edge from below. | `te-deck-from-stair-top.png`, `te-stair-landing-turn.png` |
| T3 | P2 | NPC walk path runs along the **top of the raised perimeter planting bed** — torsos glide above the hedge wall with legs inside the bed, and one bench sits up on the bed. | `seat-15`, `seat-18`, `seat-28`, `seat-31`, `te-under-deck.png` |
| T3b | P2 | Seated NPCs rotated away from their own tables (laptop/book/drink behind their backs) in at least three spots; patron chair parked facing the service counter front; white band artifacts at NPC wrists/knees/ankles; fully desaturated stone-grey characters mixed into the crowd. | `te-under-deck.png`, `seat-26`, `te-deck-from-stair-top.png`, `te-pergola-wide.png`, `seat-12`, `seat-16`, `seat-32` |
| T3c | P2 | Placeholder prop kit duplicated across at least six tabletops (untextured grey cube + flat green slab — see S22); loose props sit on the courtyard floor in circulation (cup + striped tin, grinder appliance, green bag, grey cube); grey angular rubble piles read as debris in seating areas; a neon fern sprouts from a player tabletop clipping through the cup. | `seat-05..07`, `seat-16`, `seat-19`, `seat-24`, `seat-27`, `seat-28`, `seat-31`, `te-service-queue.png` |
| T4 | P3 | Open risers read as unsupported floating slabs from the head-on bottom view; deck plank grooves read as deep black gaps; tree canopies show banding stripes. | `te-stair-bottom-portal.png`, `te-deck-from-stair-top.png`, `te-stair-from-courtyard.png` |
| T5 | P3 | Under-stair lounge cushions read as stacked placeholder blocks; A-frame board stands mid-aisle between tables; visual gap under the overlook counter at the deck edge (guard reads open below counter height). | `te-stair-landing-turn.png`, `te-stair-bottom-portal.png`, `te-deck-overlook.png` |
| T6 | P2 | Sky seams visible from the upper deck: a hard vertical corner crease in the skydome, a mint band capping the blue sky, and floating pale-blue rectangle planes at frame corners — exactly the "room-like sky seams / flat gaps" §8 forbids. Dominant in the overlook-rail seat views (upper 40% of frame is flat pale-green void). Not visible from ground level. | `te-deck-study.png`, `te-stair-top-view.png`, `seat-31`, `seat-42..44` |
| T7 | P3 | Grey boulder prop sits on the upper deck boards next to a planter (garden rock indoors); corkscrew vines dangle unattached over the garden edge and from a pendant-lamp cord; sprig clusters float in front of the garden-edge fascia; an empty soil pot with no plant sits on the overlook rail; washed-out mannequin-pale NPC at the overlook rail reads ghost-like in daylight; second study chair jammed against the railing corner. | `te-deck-study.png`, `te-stair-top-view.png`, `seat-08`, `seat-20`, `seat-31`, `seat-42` |

**Passes:** the two-level program works — upper deck has study tables, integrated bench,
railing planters with real pots/rims/soil, canopy, and NPCs genuinely populate both floors and
the stair (walkers observed on flights and landing); switchback stair has continuous handrails
both sides and uniform treads; guards continuous at deck edges with no gaps found; under-deck
zone is furnished and used; real structural column under the deck; laptop containment clean on
**all** captured seats including the upper-deck study tables (t12–t14) and the three
overlook-rail seats; pets stayed on the floor in every Terrace capture. (Refuted on closer
seats: the suspected bent-over NPC pose from `te-deck-guards-east`; the suspected floating feet
in `te-deck-from-stair-top`.)

## 6. Night and rain passes

Dedicated `--time=night` and `--sky=rain` view passes were captured for all four venues
(`.venue-shots/<venue>-night/`, `<venue>-rain/`), via new flags added to
`tools/venue-shots.mjs`.

**Passes:** no daytime sun leaks at night in any venue; interiors keep warm pendant pools;
city windows light up; Golden Hour's library stays readable; the Terrace stair gets the
plan-specified continuous warm rail-light treatment and the courtyard pools read well; rain
mode dims to overcast and spawns umbrella pedestrians; Midnight's night pass matches its
native look.

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| N1 | P3 | Rain renders as sparse frozen square white specks rather than streaks — readable as dust, not rain; density very low. | `goldenhour-rain/gh-window-counters-wide.png`, `midnight/seat-39..46` |
| N2 | P3 | The Terrace backdrop changes identity between day and night: pastoral green hills by day, dense high-rise city lights by night. | `terrace-night/te-stair-from-courtyard.png`, `te-deck-from-stair-top.png` vs day equivalents |
| N3 | P3 | Saturated plant/prop colors ignore night lighting: purple tulips and neon ferns glow in the dark Terrace; white NPC limb-band artifacts become bright markers at night (see T3b). | `terrace-night/te-deck-from-stair-top.png`, `terrace-night/te-stair-from-courtyard.png` |
| N4 | P3 | Upper-deck study tables have no local light source at night — dim but readable; consider planter uplights per §8. | `terrace-night/te-deck-from-stair-top.png` |
| N5 | P3 | The sidewalk chesterfield sofa (S18) remains occupied in the rain — a pedestrian sits on an upholstered sofa in the rain with a cake beside her. | `goldenhour-rain/gh-window-counters-wide.png` |
| N6 | P3 | The Terrace is an open-air courtyard (open pergola), yet rain mode shows no rainfall inside — dry floor, dry patrons, partly bright sky; the venue reads unaffected by weather. Three near-identical teal-outfit NPCs also cluster in this frame. | `terrace-rain/te-pergola-wide.png` |

## 7. Corner passes

`tools/corner-shots.mjs` (new) places the player in all four corners of every blueprint room —
including the Terrace upper room and stair room — looking across the room at seated-head
height. Output in `.venue-shots/<venue>-corners/`.

**Passes:** ground-floor corners hold lounge zones, retail, counters, or window rails in every
venue that could be assessed; wall/ceiling junctions are clean; guard/planter lines at Terrace
ground corners read continuous.

| # | Sev | Issue | Evidence |
|---|-----|-------|----------|
| C1 | P3 | Golden Hour NW corner: cluster of 3–4 cream box pendant shades overlap each other at the ceiling near the counter. | `goldenhour-corners/gh-main-corner-nw.png` |
| C1b | P2 | Golden Hour SE corner: carried to-go cups render at knee/shin height beside standing NPCs (attachment offset) — one floats mid-air by a man's knee, another sits under a seated woman's chair edge. | `goldenhour-corners/gh-main-corner-se.png` |
| C2 | P2 | Roastery SW corner concentrates the misfit props: black pedestal stool under a seated NPC (see G1), pink cake sitting on a pink stool, and the white cottage bench — all in one sightline. | `roastery-corners/ro-main-corner-sw.png` |
| C3 | P3 | Roastery SE corner: pastry (croissant-like item) placed directly on the tabletop with no plate; mannequin-faced NPC in the lounge chair very prominent from this angle. | `roastery-corners/ro-main-corner-se.png` |
| C4 | P3 | Midnight SW corner camera is partially blocked by a large unlit dark mass at the corner (oversized plant/prop) — the corner itself reads as a black blob at close range; the white cottage bench also appears here (third venue with the same cottage furniture). | `midnight-corners/mi-main-corner-sw.png` |
| C5 | P1 | Terrace stair-head confirmation: two large tread-like slabs hover unsupported over a ground-floor table beside the stair head, **intersecting a chair back and a bamboo plant**, with thin posts piercing them (independent confirmation of T1 from a second angle). | `terrace-corners/te-stair-room-corner-nw.png` |
| C6 | P2 | Terrace deck-edge protection gap: the pink-stool bar ledge sits on the open deck edge with open air between/below its legs down to the courtyard — no continuous guard on that segment (confirms the T5 observation). | `terrace-corners/te-upper-room-corner-nw.png` |
| C7 | P2 | Skybox flat faces are visible from ground level too: flat pale-green band with a straight seam above the horizon in two ground corners, and a large pale rectangle with hard seams beside the parasol on the deck (extends T6). | `terrace-corners/te-main-corner-ne.png`, `te-main-corner-se.png`, `te-upper-room-corner-sw.png` |
| C8 | P2 | Terrace hedge-berm clutter from corner angles: NPCs walk/stand along the hedge top, a dark plank floats on it, grey debris boxes sit on the berm; the grey cat appears to hover at seat height beside a pergola post; grey-olive blocky lounge armchairs read placeholder-grade. | `terrace-corners/te-main-corner-ne.png`, `te-stair-room-corner-nw.png`, `te-main-corner-sw.png` |

| C9 | P2 | Golden Hour SW corner: woman in a seated pose with **no chair beneath her** — hovering at seat height beside the armchair (same family as the stool-spawn bug in G1); vine plant floats beside the counter with no pot, its twin clips into the ceiling edge. | `goldenhour-corners/gh-main-corner-sw.png` |
| C10 | P3 | Midnight NW corner: patio-style table umbrellas render indoors along the rear window bar, and a bright pine picnic bench sits out of palette against the burgundy furniture. | `midnight-corners/mi-main-corner-nw.png` |
| C11 | P3 | Roastery NE corner: the freestanding grey box-on-plinth reads as an untextured primitive mid-floor (same object family as the "printer" placeholder in S22). | `roastery-corners/ro-main-corner-ne.png` |

**Tool caveats:** four corner cameras placed badly and need re-shots or smarter placement
(respect the venue walk polygons and avoid furniture/equipment): `te-upper-room-corner-se`
(inside/behind furniture), `te-upper-room-corner-ne` (resolved to ground height),
`mi-main-corner-ne` (~95% black — inside a wall/pillar, or that corner is genuinely unlit and
dead: verify in-app), `ro-main-corner-nw` (half-occluded by the roaster drum).

---

## 8. Fixes applied on this branch (post-audit)

All P1 findings were fixed and re-verified with fresh captures reviewed against the
pre-fix baselines (`.venue-shots/verify-*`):

| Finding | Fix | Verification |
|---|---|---|
| S1 skin-tone clothing | Removed skin-adjacent tans from `SHIRT`/`IMPORTED_OUTFITS`, clamped HSL lighten drift | PASS — no nude-reading NPC in any verify capture |
| S2 embedded in armchair | Lounge seats approach/stand beside the chair (a first front-of-chair anchor landed inside the table collider and stalled a walker against the player's table — caught and corrected during verification); lounge-specific sit height | PASS — re-verified 4/4 at both lounge seats and wider views |
| S7 pets on tables | Pet wander targets validated against venue colliders (stale pre-rebuild spots dropped) | PASS — cat observed mid-floor |
| G1/C9 pedestal stool + poses | Retired the static patron whose asset baked in its own chair | PASS — venue stools only at all window counters |
| R1 staff-side patron | Root cause: the waiter reads her standby from `serviceCounter.js`'s semantic anchors, not blueprint destinations — that anchor is now venue-aware and the Roastery waiter holds by the pickup end; the rail-to-glass slot is also sealed by the rail collider | PASS — slot empty in all re-captured views and rail seats; waiter observed at the pickup end |
| M1/M6/M7 stage | Piano faces audience; mic boom at mouth height aimed at the singing spot; performer pinned to shirt-and-tie rig in charcoal; bass/stool clearances | PASS — all four confirmed vs baselines |
| R2 menu board | Board mounted on a backer proud of the subway-tile courses (root cause: tile faces stood 0.179 proud and buried the board's lower third — the "clipped rows" and "black band" were occlusion); dot leaders added to bind each price to its item | PASS — all rows + special line readable, no artifact band. A reported "price row shift" was adjudicated as perspective shear only (leaders trace to the correct prices; texture proven correct) |
| T1/T2 terrace structure | Pergola bears on the deck fascia (floating edge posts removed); over-stair slat ends terminate on beams; pendant cords hang from the pergola plane, not the absent indoor ceiling; canopy posts get base plates + heavier gauge | PASS — all four confirmed against baselines, including pixel-diff checks; stair/rails unchanged |

Remaining P2s noted during verification: bar-stool sit poses keep near-straight legs that
clip the stool footprint (visible up close at window counters); Roastery seats `bar-l-s1`
and `bar-r-s3` were NPC-occupied in the final capture run (laptop check covered by the
earlier run); one Terrace corner camera (`te-upper-room-corner-se`) still needs smarter
placement. Verification evidence: `.venue-shots/verify-midnight/`, `verify-goldenhour/`,
`verify3-gh/`, `verify-ro-full/`, `verify2-terrace/`, `verify2-terrace-corners/`.

## 8b. Recommended fix order

1. **S1/S2/S7 + G1 + R1 + M1/M6/M7 + T1 (P1s):** NPC wardrobe palette (exclude skin tones from
   clothing tints), seated/standing pose resolution vs furniture, pet destination filter (never
   a tabletop/bench surface), window-counter stool consistency, staff-side zone enforcement at
   the tasting rail, performer mic alignment + pose + stage wardrobe, turn the piano to face
   the audience with a bench, and fix the Terrace stair-top geometry (floating pergola post,
   post-through-table, stray tread boxes).
2. **R2 menu board overflow/artifact band** — likely text layout overflow + a coplanar tile
   strip; quick win, very visible.
3. **Grounding sweep (S9–S11, R3–R5, T1–T2):** planters/hangers for every plant, delete or
   anchor the floating plank/rod/pole/boxes, clamp props to support footprints (the barrel mug
   half off a table shows a placement-path gap for *fixed* props that the laptop OBB work
   doesn't cover).
4. **Identity pass (S13–S16, R6):** venue-specific stool tops/window-zone variants, real record
   storage for Midnight, evict cottage furniture from the Roastery or restyle it.
5. **Readability pass (M3–M5):** low fill light or candle pools at Midnight's entrance/booth
   corner, emissive-off for clock/artwork/plants in dark venues, staff the bar, adopt orphan
   laptops.
6. **Dressing pass (G3, R7–R8, S16–S17):** fill or remove empty fixtures, differentiate repeated
   props, rescale cups.

---

## 10. P2 polish batch — fixes applied and verified

All verified against fresh captures (`.venue-shots/p2-*`, `p2b-*`, `p2c-*`, `p2d-*`), with
before/after pixel-luminance measurements where lighting was involved.

| Finding | Fix | Verification |
|---|---|---|
| S22 placeholder props | The "grey cube" was the napkin holder (a bare `metalMat` box) — rebuilt as a white napkin stack between metal cheeks; the "green slab" was `foldedLinen` tinted with venue upholstery — now cream cloth with a fold line | PASS — reads as napkins/linen in all venues |
| S13 pink stools everywhere | Per-venue stool tints (oxblood/oak, charcoal/ash, burgundy/walnut, terracotta/teak) applied to the stock asset at both clone sites | PASS in all four venues |
| S21 empty service queues | One or two patrons pre-seed the order line at boot; seeding demands sit-capable models (`opts.willSit`) after a hero with no sit clip leaned broken in the line and later "sat" through furniture | PASS — every venue's queue view now shows barista + patrons, normal low-poly cast, upright |
| S18 sidewalk "sofa" | Adjudicated: it is the parked car — leather-brown paint plus chrome seam lines read as tufted upholstery; palette switched to automotive red/blue/silver | PASS — reads as cars |
| S8 "blocky grey" pets | Adjudicated: rigged, textured assets (2.4k tris) — the cat's atlas is authored flat grey; it now takes the venue's `theme.cat` warm tint | PASS — warm-coated cat |
| S3 mannequin heads | Palest skin tone deepened, neutral-grey hair warmed | Improved (spot-checked; full re-review pending) |
| S4 sunken barista | Works beside the espresso machine (+0.55 x) at 1.05 scale instead of eclipsed behind it | Improved (visible torso at queue views) |
| M4 void panels / glowing clock+art | Plum velvet + bronze frames; parchment clock face; art paper dimmed for the dark room; motifs vary per bay | PASS — panels read plum with frames at native exposure; clock parchment; art varied |
| M3 dark front-of-house | Entrance + booth warm pools. Root cause of two failed attempts: the quality system keeps only the 6 highest-importance point lights at the lowest tier and silently culled the new pools (probed live: `visible:false`). Midnight's tier-0 budget raised 6→8 (documented tradeoff) with stronger pools | Entrance PASS (+30–42% front-third luminance, guests readable, stage still brightest); booth corner re-check in `p2d` |
| M11 featureless bass | Bridge, four strings, endpin added | PASS at close range (occluded from some angles) |
| "Woman standing on cabaret table" (P2 regression report) | Adjudicated: perspective — with a near-horizontal camera, floor behind a low pedestal table projects above the tabletop edge, so a deterministic (seeded) walker's feet read as "on" the table; runtime probes at two timestamps show no elevated NPC | No defect |
| "Appliance on floor at rug edge" | Adjudicated: the vinyl record sideboard — intentional furniture; consider legs/records dressing so it reads furniture at a glance (P3) | No defect |

**Still open (P2/P3):** S5 idle clusters/roadway loiterers; S9–S11 plant grounding (pots,
hangers, tabletop sprigs); S14 window-zone motif shared across three venues; S15 Midnight
record wall reuse; G2 bar seats facing the wall pier; G3/R7–R8 empty-fixture dressing; M8
booth seats facing the banquette back; M10 speaker occlusion from rear seats; T3 hedge-top
walk path; T6/C7 skybox seams from the deck; S17 cup scale; bar-stool sit poses (straight
legs); corner-camera placement for four views.

---

## 11. Final sweep — remaining findings closed

Verified against `.venue-shots/final-*` and `final2-*` captures with per-venue review agents
and pixel-diff/luminance measurement; runtime probes used where captures and code disagreed.

| Finding | Outcome |
|---|---|
| S9/S10 plant grounding | FIXED — every library floor plant sits in a terracotta planter with soil (the fern asset had none; the potted models' bases read invisible); GH wall bowls rest on bracket shelves; procedural fallback plant reads as a shrub, not a spruce |
| S17 cup scale | FIXED — makeDrink, makeCup, and NPC delivered drinks share a 0.78 café-scale factor; verified across venues including the two foreground hero cups |
| G2 bar seats vs door pier | FIXED — GH counters moved outboard; both stools face glass, counter ends clear the pier |
| G3 display unit | FIXED — dressed on its exact surfaces (top books + plant); interior shelf planes are not exposed by the asset |
| M2/M10 speaker sightline | FIXED — left tower at the stage's back corner; singer visible head-to-toe from across the room |
| S15 record wall | FIXED — lower shelves hold packed LP sleeve rows with face-out sleeves and vinyl rings; books remain only up top |
| S14 window-zone identity | FIXED — Midnight runs two short walnut listening ledges with lamps (3 stools each); layout contract test updated |
| R7 communal dressing | ADJUDICATED — both ends carry authored clusters (runtime probe: 6/13/4 prop meshes near/mid/far); under occupancy the §9 clearance system relocates settings away from seated patrons, which is the coexistence contract working, not missing dressing |
| R8 jar labels | FIXED — printed product labels, hand-jittered spacing/rotation |
| T3 hedge-top walkers | FIXED — the terrace garden path moved past the hedge's deck sightline; full bodies visible from every deck view |
| T6/C7 sky seams | FIXED — colour-matched sky bands above all backdrop planes, corner-sealing side spans, and a zenith cap; all deck and corner views show continuous sky |
| M10 lamppost/car | FIXED — parked cars deepened half a metre; visual gap to the sidewalk pole |
| Corner cameras | FIXED — cameras slide off blueprint colliders AND npcForbiddenZones (roaster/stage); all previously unusable corners re-shot clean |
| M8 booth void | ADDRESSED by the M3 lighting + M4 panel fixes (booth run readable, sub-black pixels 93%→61%) |
| S5 roadway loiterers / "NPC on table" / "sofa on sidewalk" | ADJUDICATED as perspective artifacts (sidewalk walkers against the road backdrop; floor visible above low tabletop edges; car paint) — runtime probes found no elevated or off-path actors |

**Known-remaining (documented, deferred):**
- Two singleton plants whose builder could not be identified from captures alone (a lab-side
  fern near the roaster's bean crocks, a cropped-base plant at GH's salon-oval right edge) —
  need a `?no-merge` scene probe session to trace ownership.
- Bar-stool sit poses keep straight legs through the stool column — requires a perch
  animation asset, not a placement fix.
- S5 interior idle clusters — states are bounded per the behavior planner; remaining reads
  are snapshot timing. Behavioral cadence tuning left to a dedicated NPC pass.
- Midnight near-plane NPC walk-throughs in some captures — pre-existing crowd behavior,
  cosmetic, capture-timing dependent.
