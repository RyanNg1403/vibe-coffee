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
