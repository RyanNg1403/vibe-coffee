// glTF-Transform support for MSFT_lod: a node lists lower-detail nodes that
// replace it at a distance. LOD nodes live outside the scene graph, so loaders
// without the extension render only the full-detail hierarchy.
import { Extension, ExtensionProperty, PropertyType, RefList } from '@gltf-transform/core';

export const MSFT_LOD = 'MSFT_lod';

export class Lod extends ExtensionProperty {
  static EXTENSION_NAME = MSFT_LOD;
  init() {
    this.extensionName = MSFT_LOD;
    this.propertyType = 'Lod';
    this.parentTypes = [PropertyType.NODE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { lods: new RefList() });
  }
  addLod(node) { return this.addRef('lods', node); }
  listLods() { return this.listRefs('lods'); }
}

export class MSFTLod extends Extension {
  static EXTENSION_NAME = MSFT_LOD;
  extensionName = MSFT_LOD;
  createLod() { return new Lod(this.document.getGraph()); }
  read(context) {
    const nodeDefs = context.jsonDoc.json.nodes ?? [];
    nodeDefs.forEach((nodeDef, index) => {
      const ids = nodeDef.extensions?.[MSFT_LOD]?.ids;
      if (!ids) return;
      const lod = this.createLod();
      for (const id of ids) lod.addLod(context.nodes[id]);
      context.nodes[index].setExtension(MSFT_LOD, lod);
    });
    return this;
  }
  write(context) {
    const json = context.jsonDoc.json;
    for (const node of this.document.getRoot().listNodes()) {
      const lod = node.getExtension(MSFT_LOD);
      if (!lod) continue;
      const nodeDef = json.nodes[context.nodeIndexMap.get(node)];
      nodeDef.extensions = nodeDef.extensions ?? {};
      nodeDef.extensions[MSFT_LOD] = { ids: lod.listLods().map((n) => context.nodeIndexMap.get(n)) };
    }
    return this;
  }
}
