import { Box3, Vector3 } from 'three';
import { cloneModel } from '../modelLoader.js';
import { pointSupported } from '../cafe/tableSupport.js';

// Collections are authored in metres, with their base on local Y=0. The
// existing cabinet remains the physical support and owns the room footprint.
export function placeVenueCollection({ group, parent, models, id, surface, scale = 1 }) {
  const key = `atelier_decor_${id}`;
  const object = cloneModel(models, key);
  if (!object) return null;
  object.name = `${id} Blender hospitality collection`;
  object.position.set(0, surface.y, 0);
  object.scale.setScalar(scale);
  parent.add(object);
  object.updateWorldMatrix(true, true);
  const center = parent.localToWorld(new Vector3(0, surface.y, 0));
  const forward = parent.getWorldDirection(new Vector3());
  const parentScale = parent.getWorldScale(new Vector3());
  const support = {
    y: center.y,
    shape: {
      kind: 'rect', center: { x: center.x, z: center.z },
      rotation: Math.atan2(forward.x, forward.z),
      width: surface.width * parentScale.x,
      depth: surface.depth * parentScale.z,
    },
  };
  object.userData.surfaceY = support.y;
  object.userData.surfaceName = object.name;
  object.userData.supportShape = support.shape;
  object.traverse(part => {
    if (part.userData.collectionGlass) part.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
    if (!part.isMesh) return;
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    for (const material of materials) {
      if (!material.transparent) continue;
      // glTF splits joined Blender objects by material. Recognize their glass
      // primitives even when they do not carry a separate object-level tag.
      part.castShadow = false;
      material.depthWrite = false;
      material.forceSinglePass = true;
    }
  });
  // Static batching may remove individual meshes. Retain the complete placed
  // assembly bounds so audits still check its true bottom and whole footprint.
  (group.userData.venueCollections ??= []).push({
    key, object, support, bounds: new Box3().setFromObject(object),
  });
  return object;
}

export function auditVenueCollections(group) {
  const violations = [];
  for (const { key, bounds, support } of group.userData.venueCollections ?? []) {
    if (bounds.isEmpty()) {
      violations.push({ kind: 'empty-collection', name: key });
      continue;
    }
    if (Math.abs(bounds.min.y - support.y) > 0.01) {
      violations.push({ kind: 'collection-off-surface', name: key, bottom: bounds.min.y, surface: support.y });
    }
    for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
      if (!pointSupported(support.shape, x, z, 0.005)) {
        violations.push({ kind: 'collection-overhang', name: key, x, z });
      }
    }
  }
  return violations;
}
