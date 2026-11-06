// Screen-space-error LOD selection. Pure math so it is unit-testable in Node.

// Rendered pixels covered by one world unit at `distance` along the view axis.
export function pixelsPerUnit(distance, fovYRadians, viewportHeightPx) {
  return viewportHeightPx / (2 * Math.tan(fovYRadians / 2) * Math.max(distance, 1e-3));
}

/**
 * Picks the coarsest level whose geometric error stays under `maxErrorPx`.
 *
 * @param levels      [{ error }] where error is meshopt's relative error
 *                    (fraction of the mesh extent); level 0 is the source.
 * @param extent      mesh extent in world units (meshopt scale × world scale)
 * @param pxPerUnit   from pixelsPerUnit()
 * @param maxErrorPx  allowed silhouette deviation in rendered pixels
 * @param current     currently displayed level (for hysteresis)
 * @param hysteresis  fractional dead band that keeps a mesh from flickering
 *                    between two levels at a threshold distance
 */
export function selectLodLevel(levels, extent, pxPerUnit, maxErrorPx, current = 0, hysteresis = 0.2) {
  let best = 0;
  const unitPx = extent * pxPerUnit;
  for (let index = 1; index < levels.length; index += 1) {
    const errorPx = levels[index].error * unitPx;
    // Staying at (or returning to) a level already shown is easier than
    // stepping down to a coarser one.
    const limit = index <= current ? maxErrorPx * (1 + hysteresis) : maxErrorPx * (1 - hysteresis);
    if (errorPx <= limit) best = index;
    else break;
  }
  return best;
}

// Target index-count ratios for generated levels. Each level is simplified
// from the source mesh, never from the previous level, so errors stay exact.
export const DEFAULT_LOD_RATIOS = [0.5, 0.25, 0.12];

// Drop levels that barely reduce work: they would only cost index memory.
export function usefulLevels(sourceIndexCount, generated, minGain = 0.15) {
  const kept = [];
  let previous = sourceIndexCount;
  for (const level of generated) {
    if (level.indexCount > previous * (1 - minGain)) continue;
    kept.push(level);
    previous = level.indexCount;
  }
  return kept;
}
