// Pure layout helpers shared by the runtime and regression tests. The player's
// drink owns the positive side of the laptop; all pre-existing table props use
// a compact grid on the opposite side, so a single fixed cup can never be
// centred on the keyboard again.
export function laptopPropOffset(index, elevatedBar = false) {
  const column = index % 2;
  const row = Math.floor(index / 2);
  return elevatedBar
    ? { side: -(0.3 + column * 0.17), forward: 0.03 + row * 0.1 }
    : { side: -(0.28 + column * 0.13), forward: 0.16 + row * 0.13 };
}

export function laptopCupOffset(elevatedBar = false) {
  return { side: 0.32, forward: elevatedBar ? 0.04 : 0.09 };
}

// Footprint-aware clearance: places fixed props (sorted large-first by the
// caller) on the laptop's negative edge with spacing derived from each prop's
// footprint radius, so a wide book and a tiny card no longer share one fixed
// grid pitch. Returns one {side, forward} per footprint.
export function clearanceSlots(footprints, elevatedBar = false) {
  const baseSide = elevatedBar ? -0.3 : -0.28;
  const baseForward = elevatedBar ? 0.03 : 0.16;
  const gap = 0.05;
  const slots = [];
  let columnSide = baseSide;
  for (let start = 0; start < footprints.length;) {
    // fill a column of two, spaced by the props' own footprints
    const first = footprints[start] ?? 0.08;
    const second = footprints[start + 1] ?? 0.08;
    slots.push({ side: columnSide - first, forward: baseForward + first });
    if (start + 1 < footprints.length) {
      slots.push({
        side: columnSide - second,
        forward: baseForward + first * 2 + gap + second,
      });
    }
    const widest = Math.max(first, footprints[start + 1] ?? 0);
    columnSide -= widest * 2 + gap;
    start += 2;
  }
  return slots;
}
