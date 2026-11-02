import { Box3 } from 'three';

// Retain placement, not material membership: a material batch can contain the
// leaves from several planters while their pots and legs enter other batches.
export function capturePlacementBounds(group, animatedRoots = []) {
  group.updateMatrixWorld(true);
  const moving = new Set();
  for (const root of animatedRoots) root?.traverse(object => moving.add(object));
  return group.children.map(object => {
    const dynamicRoots = [];
    object.traverse(child => {
      if (animatedRoots.includes(child)) dynamicRoots.push(child);
    });
    let bounds = null;
    if (!moving.has(object)) {
      bounds = new Box3();
      if (!dynamicRoots.length) bounds.setFromObject(object);
      else object.traverse(part => {
        // Keep only fixed geometry in this snapshot. Animated descendants
        // contribute their current bounds when an audit runs.
        if (moving.has(part) || !part.geometry) return;
        let ownBounds;
        if (part.isInstancedMesh || part.isSkinnedMesh) {
          part.computeBoundingBox();
          ownBounds = part.boundingBox;
        } else {
          if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
          ownBounds = part.geometry.boundingBox;
        }
        if (ownBounds) bounds.union(ownBounds.clone().applyMatrix4(part.matrixWorld));
      });
    }
    return {
      uuid: object.uuid,
      name: object.name || object.userData.surfaceName || object.type,
      visible: object.visible,
      isInstancedMesh: object.isInstancedMesh,
      children: { length: object.children.length },
      userData: {},
      bounds,
      dynamicIds: dynamicRoots.map(root => root.uuid),
      batched: false,
    };
  });
}

// Mark the original top-level owner before a mesh is removed by batching.
export function recordBatchedPlacement(group, mesh, placementsById) {
  let owner = mesh;
  while (owner.parent && owner.parent !== group) owner = owner.parent;
  const placement = placementsById.get(owner.uuid);
  if (placement) placement.batched = true;
}

export function groundingAuditObjects(group, ignoredObjects = []) {
  const ignoredIds = new Set(ignoredObjects.map(object => object.uuid));
  const represented = new Set();
  const result = [];
  for (const placement of group.userData.placedUnits ?? []) {
    if (!placement.batched || !placement.bounds || ignoredIds.has(placement.uuid)) continue;
    const bounds = placement.bounds.clone();
    for (const id of placement.dynamicIds) {
      const live = group.getObjectByProperty('uuid', id);
      if (!live?.visible) continue;
      live.updateWorldMatrix(true, true);
      bounds.union(new Box3().setFromObject(live));
    }
    const owner = group.children.find(object => object.uuid === placement.uuid);
    result.push({ ...placement, bounds, visible: owner?.visible ?? placement.visible });
    represented.add(placement.uuid);
  }
  // Unmerged objects, actors and newly placed props keep their live bounds.
  // The caller explicitly excludes only nonphysical interaction overlays.
  result.push(...group.children.filter(object => !represented.has(object.uuid)
    && !ignoredIds.has(object.uuid) && !object.userData.decorBatch));
  return result;
}
