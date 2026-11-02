import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Group, Vector3 } from 'three';
import { normalizeModel } from '../src/modelLoader.js';
import { placeVenueCollection, auditVenueCollections } from '../src/decor/venueCollection.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

async function geometryOnly(key) {
  const document = await io.read(new URL(`../public/models/${key}.glb`, import.meta.url).pathname);
  for (const texture of document.getRoot().listTextures()) texture.dispose();
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  const bytes = await io.writeBinary(document);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return normalizeModel(gltf.scene, key);
}

function dispose(root) {
  root.traverse(object => {
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose();
  });
}

test('all four Blender displays fit the actual retained cabinet tops and clear their plaques', async () => {
  const placements = [
    ['goldenhour', 5.25, -6.15, .8175, 2.15, .54, 0, 1, 1.81],
    ['roastery', 5.25, -6.15, .8225, 2.18, .54, 0, 1, 1.74],
    ['midnight', 8.18, 5.65, .75, 1.5, .5, -Math.PI / 2, .8, Infinity],
    ['terrace', 5.2, -6.15, .87, 2.25, .62, 0, 1, 1.77],
  ];
  for (const [id, x, z, y, width, depth, yaw, scale, plaqueBottom] of placements) {
    const key = `atelier_decor_${id}`, model = await geometryOnly(key);
    try {
      const source = new Box3().setFromObject(model);
      assert.ok(Math.abs(source.min.y) < .002, `${id}: authored base at zero`);
      assert.ok(source.max.y < .851, `${id}: bounded display height`);
      const group = new Group(), cabinet = new Group();
      cabinet.position.set(x, 0, z); cabinet.rotation.y = yaw; group.add(cabinet);
      placeVenueCollection({ group, parent: cabinet, models: new Map([[key, { template: model }]]), id, scale,
        surface: { y, width, depth } });
      assert.deepEqual(auditVenueCollections(group), [], id);
      const placed = group.userData.venueCollections[0].bounds;
      assert.ok(placed.max.y < plaqueBottom - .04, `${id}: plaque remains clear of the display`);
    } finally { dispose(model); }
  }
});

test('the new Midnight record rotates flat around its center and its glass keeps the lightweight render path', async () => {
  const model = await geometryOnly('atelier_decor_midnight');
  try {
    const group = new Group(), cabinet = new Group(); group.add(cabinet);
    const object = placeVenueCollection({ group, parent: cabinet,
      models: new Map([['atelier_decor_midnight', { template: model }]]), id: 'midnight', scale: .8,
      surface: { y: .75, width: 1.5, depth: .5 } });
    let disc, glasses = 0;
    object.traverse(part => {
      if (part.userData.collectionSpin) disc = part;
      if (part.userData.collectionGlass && part.isMesh) {
        glasses++;
        assert.equal(part.castShadow, false);
        assert.equal(part.material.depthWrite, false);
        assert.equal(part.material.transmission ?? 0, 0);
      }
    });
    assert.ok(disc && glasses > 0);
    const before = new Box3().setFromObject(disc);
    disc.rotation.y += .7;
    const after = new Box3().setFromObject(disc);
    assert.ok(before.getCenter(new Vector3()).distanceTo(after.getCenter(new Vector3())) < .001);
    assert.ok(Math.abs(before.min.y - after.min.y) < 1e-6);
    assert.ok(Math.abs(before.max.y - after.max.y) < 1e-6);
    assert.ok(after.max.y - after.min.y < .005, 'record stays horizontal');
  } finally { dispose(model); }
});

test('all eight botanical upgrades retain their floor anchors and stay within the previous circulation envelopes', async () => {
  const report = JSON.parse(await readFile(new URL('../assets/blender/collection/botanical-report.json', import.meta.url)));
  const heights = { plant_monstera: 1.15, plant_fern: .5, plant_pothos: .6, plant_pothos_vine: .55,
    plant_snake: .72, plant_succulent: .3, plant_small: .35, plant: 1 };
  for (const [key, height] of Object.entries(heights)) {
    const model = await geometryOnly(key);
    try {
      const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
      const limit = report[key].before_normalized;
      assert.ok(Math.abs(bounds.min.y) < .001, `${key}: original floor anchor`);
      assert.ok(Math.abs(size.y - height) < .001, `${key}: original normalized height`);
      assert.ok(size.x <= limit.width + .003, `${key}: width cannot expand into the existing routes`);
      assert.ok(size.z <= limit.depth + .003, `${key}: depth cannot expand into the existing routes`);
    } finally { dispose(model); }
  }
});

test('Roastery glass stays clear and shadow-free after Blender material splitting', async () => {
  const model = await geometryOnly('atelier_decor_roastery');
  try {
    const group = new Group(), cabinet = new Group(); group.add(cabinet);
    const collection = placeVenueCollection({ group, parent: cabinet,
      models: new Map([['atelier_decor_roastery', { template: model }]]), id: 'roastery',
      surface: { y: .8225, width: 2.18, depth: .54 } });
    let glasses = 0;
    collection.traverse(part => {
      if (!part.isMesh || !part.material.transparent) return;
      glasses++;
      assert.equal(part.material.side, 0, 'closed glass walls use front faces only');
      assert.ok(part.material.opacity <= .121, 'stacked walls must not wash out the coffee');
      assert.ok(part.material.roughness <= .081);
      assert.equal(part.material.transmission ?? 0, 0);
      assert.equal(part.material.forceSinglePass, true);
      assert.equal(part.material.depthWrite, false);
      assert.equal(part.castShadow, false, 'clear glass must not cast an opaque shadow over its contents');
    });
    assert.ok(glasses > 0);
  } finally { dispose(model); }
});
