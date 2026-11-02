import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3 } from 'three';
import { MODEL_MANIFEST } from '../src/modelManifest.js';
import { TEXTURE_MANIFEST } from '../src/textureManifest.js';
import { studioChairGeometry } from '../src/decor/chairKit.js';
import { createThinGlass } from '../src/rendering/thinGlass.js';
import { MeshoptDecoder } from 'meshoptimizer';

const budgets = {
  studio_cup: [2600, 2, 70_000],
  studio_espresso: [6500, 7, 200_000],
  studio_pendant: [2000, 3, 50_000],
  studio_chair: [2200, 2, 100_000],
};
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

test('Blender exports are self-contained, finite, and inside their geometry/download budgets', async () => {
  for (const [name, [maxTriangles, maxMaterials, maxBytes]] of Object.entries(budgets)) {
    assert.equal(MODEL_MANIFEST[name]?.url, `/models/${name}.glb`, `${name} is shipped`);
    const bytes = await readFile(new URL(`../public/models/${name}.glb`, import.meta.url));
    assert.ok(bytes.length <= maxBytes, `${name}: ${bytes.length} bytes`);
    const document = await io.readBinary(bytes);
    let triangles = 0;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const positions = primitive.getAttribute('POSITION');
        const normals = primitive.getAttribute('NORMAL');
        assert.ok(positions && normals, `${name}: positions and normals are present`);
        assert.ok(positions.getArray().every(Number.isFinite), `${name}: finite coordinates`);
        const indices = primitive.getIndices();
        assert.ok(indices, `${name}: indexed geometry`);
        assert.equal(indices.getCount() % 3, 0);
        assert.ok(indices.getArray().every((i) => i < positions.getCount()), `${name}: valid triangle indices`);
        triangles += indices.getCount() / 3;
      }
    }
    assert.ok(triangles > 100 && triangles <= maxTriangles, `${name}: ${triangles} triangles`);
    assert.ok(document.getRoot().listMaterials().length <= maxMaterials, `${name}: bounded materials`);
    for (const buffer of document.getRoot().listBuffers()) assert.equal(buffer.getURI(), '');
    for (const texture of document.getRoot().listTextures()) assert.equal(texture.getURI(), '');
  }
});

test('the instanced Blender chair keeps its seat height and owns disposable geometry', async () => {
  const bytes = await readFile(new URL('../public/models/studio_chair.glb', import.meta.url));
  // Geometry contract: image decoding belongs to the browser integration audit.
  const doc = await io.readBinary(bytes);
  for (const material of doc.getRoot().listMaterials()) {
    material.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null);
  }
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  const geometryBytes = await io.writeBinary(doc);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(geometryBytes.buffer.slice(geometryBytes.byteOffset, geometryBytes.byteOffset + geometryBytes.byteLength), '');
  const modelBounds = new Box3().setFromObject(gltf.scene);
  // Mirror the model library normalization, with the feet on y=0.
  const scale = 0.89 / (modelBounds.max.y - modelBounds.min.y);
  gltf.scene.scale.setScalar(scale);
  gltf.scene.position.y = -modelBounds.min.y * scale;
  let templateDisposals = 0;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.userData.vibeShared = true;
    o.geometry.addEventListener('dispose', () => templateDisposals++);
  });
  const models = new Map([['studio_chair', { template: gltf.scene }]]);
  const kit = studioChairGeometry(models);
  assert.ok(kit?.wood && kit?.cushion);
  kit.wood.computeBoundingBox();
  kit.cushion.computeBoundingBox();
  assert.ok(Math.abs(kit.wood.boundingBox.min.y) < 0.002, 'feet remain on the floor');
  assert.ok(kit.cushion.boundingBox.max.y > 0.48 && kit.cushion.boundingBox.max.y < 0.54,
    'cushion still meets the existing patron sitting pose');
  assert.ok(kit.wood.boundingBox.max.y <= 0.891, 'backrest has its normalized height');
  for (const geometry of Object.values(kit)) {
    assert.equal(geometry.userData.vibeShared, undefined);
    geometry.dispose();
  }
  assert.equal(templateDisposals, 0, 'room teardown must not dispose the model library');
  assert.equal(studioChairGeometry(new Map()), null, 'missing assets keep the procedural fallback');
});

test('architectural glazing keeps the refraction prepass disabled', () => {
  const glass = createThinGlass();
  assert.equal(glass.transmission, 0);
  assert.equal(glass.transparent, true);
  assert.equal(glass.depthWrite, false);
  assert.equal(glass.forceSinglePass, true);
  glass.dispose();
});

test('every studio surface ships color, normal and roughness maps within the texture budget', async () => {
  let bytes = 0;
  for (const surface of ['oak', 'limestone', 'linen']) {
    for (const channel of ['color', 'normal', 'roughness']) {
      const name = `studio_${surface}_${channel}.jpg`;
      assert.equal(TEXTURE_MANIFEST[name], `/textures/${name}`);
      const data = await readFile(new URL(`../public/textures/${name}`, import.meta.url));
      assert.equal(data.readUInt16BE(0), 0xffd8, `${name}: valid JPEG header`);
      bytes += data.length;
    }
  }
  assert.ok(bytes < 400_000, `the nine surface maps use ${bytes} bytes`);
});
