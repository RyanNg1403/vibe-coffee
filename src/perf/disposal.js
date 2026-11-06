// GPU resource release for objects discarded at runtime (outside a café
// rebuild, whose own dispose() covers its group). Library assets are shared
// by every clone and flagged `vibeShared`/`shared`; they are never freed here.
const isShared = (resource) => resource.userData?.vibeShared || resource.userData?.shared;

export function disposeObject3D(root) {
  if (!root) return;
  root.removeFromParent();
  root.traverse((object) => {
    if (object.geometry && !isShared(object.geometry)) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture && !isShared(value)) value.dispose();
      }
      if (!isShared(material)) material.dispose();
    }
  });
}
