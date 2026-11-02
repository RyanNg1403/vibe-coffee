export function isFemalePortrait(key = '') {
  const design = Number(key.match(/^char_atelier_(\d+)$/)?.[1]);
  return key === 'char_atelier_server' || design % 2 === 1;
}

// The two source anatomies have different lumbar depths. Both stay over the
// cushion; the broader male jacket needs forward clearance from the bentwood.
export function seatForwardOffset(avatar) {
  if (!avatar?.hasSitClip) return 0;
  if (!avatar.isAtelier) return -0.02;
  return isFemalePortrait(avatar.key) ? 0 : 0.06;
}
