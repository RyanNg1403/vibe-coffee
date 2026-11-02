# NPC movement

NPC positions and facing now interpolate between the fixed 30 Hz simulation
steps. Each render restores the authoritative simulation pose, including the
original Euler angles, so steering does not inherit a quaternion decomposition
or an interpolated position. Sidewalk wraps and changes of parent reset the
interpolation interval. Pose records use weak references and reuse their vectors.

Walking cadence follows actual travel speed. Waiters ease into movement and slow
near their destinations; patrons advance past stalled waypoints without snapping
to them. Baristas, seated patrons and the jazz performer take the shortest turn
with bounded angular speed. Head pitch eases into activity changes. Sitting and
standing use a continuous position/facing transition, with enough time for a
longer approach or half-turn; fallback rigs fold their legs progressively. Stair
height follows horizontal progress without an early arrival snap.

The 30 Hz simulation and distance-based skeletal animation budgets remain in
place. Root interpolation adds one simulation tick (about 33 ms) of visual delay
for NPCs. Low-quality sidewalk movement now updates every simulation tick while
its distant skeletal animation retains its reduced rate.

## Validation

- 159 tests pass, including six motion regressions for cadence, angle wrapping,
  frame-rate independence, render interpolation, exact simulation restoration,
  spawning, wrapping and reparenting.
- Production build and standalone HTML export pass; the export is 15.36 MiB.
- A Chromium/SwiftShader audit advances each of the four cafés through 180 seconds
  at 30 Hz, exercising entry, queueing, ordering, pickup, seating and departures.
  Terrace stair traversal and the jazz performer's complete stage/rest cycle are
  also exercised. All four runs pass without runtime, shader or model-load errors.
- Raw results are saved in [audit-results.json](audit-results.json). These record
  per-tick travel, turn limits and pose restoration error, rather than hardware
  frame-rate claims.

With the dev server running, reproduce an audit using:

```sh
CHROME_PATH=/path/to/chromium npm run audit:motion -- --venue=goldenhour
```

Repeat with `roastery`, `midnight` and `terrace`. Each run writes its measurements,
runtime report and final scene screenshot under `.motion-audit/<venue>/`.
