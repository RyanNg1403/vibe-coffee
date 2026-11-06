import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_MANIFEST } from '../src/modelManifest.js';
import { GLTFLodPlugin, lodLevelZero } from '../src/gltfLodPlugin.js';
import { MSFTLod, MSFT_LOD } from '../tools/msft-lod.mjs';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, MSFTLod]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const read = async (url) => io.readBinary(await readFile(new URL(`../public${url}`, import.meta.url)));
const triangles = (mesh) => mesh.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0);

test('manifests resolve every asset against the deploy base, never an absolute path', async () => {
  for (const name of ['modelManifest', 'textureManifest', 'soundManifest', 'musicManifest']) {
    const source = await readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
    assert.match(source, /const BASE = import\.meta\.env\?\.BASE_URL \?\? '\/';/, `${name}: BASE_URL`);
    assert.doesNotMatch(source, /['"]\/(?:models|textures|sounds|music)\//, `${name}: no root-relative literals`);
  }
  for (const entry of Object.values(MODEL_MANIFEST)) assert.equal(entry.ktx2, undefined, 'KTX2 is a build-time output');
});

test('LOD chains reuse LOD0 vertex buffers and get progressively lighter', async () => {
  let chains = 0;
  for (const [key, entry] of Object.entries(MODEL_MANIFEST)) {
    const doc = await read(entry.url);
    const levels = 1 + Math.max(0, ...doc.getRoot().listNodes().map((n) => n.getExtension(MSFT_LOD)?.listLods().length ?? 0));
    assert.equal(levels, entry.lods ?? 1, `${key}: manifest LOD count`);
    for (const node of doc.getRoot().listNodes()) {
      const lod = node.getExtension(MSFT_LOD);
      if (!lod) continue;
      chains++;
      const base = node.getMesh().listPrimitives();
      let previous = triangles(node.getMesh());
      const distances = node.getExtras().vibeLodDistances;
      assert.equal(distances.length, lod.listLods().length, `${key}: one switch distance per level`);
      assert.ok(distances.every((d, i) => d > (distances[i - 1] ?? 0)), `${key}: ascending distances`);
      for (const level of lod.listLods()) {
        assert.ok(!level.listParents().some((p) => p.propertyType === 'Node' || p.propertyType === 'Scene'),
          `${key}: LOD nodes stay outside the scene graph`);
        assert.equal(level.getSkin(), node.getSkin(), `${key}: skinned levels bind the same skeleton`);
        const count = triangles(level.getMesh());
        assert.ok(count > 0 && count < previous, `${key}: ${count} < ${previous}`);
        previous = count;
        for (const prim of level.getMesh().listPrimitives()) {
          assert.ok(base.some((b) => b.getAttribute('POSITION') === prim.getAttribute('POSITION')), `${key}: shared vertices`);
          const vertexCount = prim.getAttribute('POSITION').getCount();
          assert.ok(prim.getIndices().getArray().every((i) => i < vertexCount), `${key}: valid LOD indices`);
        }
      }
    }
  }
  assert.ok(chains > 200, `${chains} LOD chains`);
});

async function geometryOnly(url, reader = io) {
  const doc = await reader.readBinary(await readFile(new URL(`../public${url}`, import.meta.url)));
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  const bytes = await io.writeBinary(doc);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('without the plugin GLTFLoader renders LOD0 only; with it each chain becomes a THREE.LOD', async () => {
  for (const key of ['studio_espresso', 'char_atelier_1', 'pet_dog']) {
    const buffer = await geometryOnly(MODEL_MANIFEST[key].url);
    const plain = await new GLTFLoader().parseAsync(buffer.slice(0), '');
    let plainMeshes = 0;
    plain.scene.traverse((o) => { if (o.isMesh) plainMeshes++; });

    const loader = new GLTFLoader().register((parser) => new GLTFLodPlugin(parser));
    const gltf = await loader.parseAsync(buffer.slice(0), '');
    const lods = [];
    gltf.scene.traverse((o) => { if (o.isLOD) lods.push(o); });
    assert.ok(lods.length > 0, `${key}: LOD objects`);
    let levelZeroMeshes = 0;
    for (const lod of lods) {
      assert.ok(lod.levels.length >= 2, `${key}: at least two levels`);
      lodLevelZero(lod).traverse((o) => { if (o.isMesh) levelZeroMeshes++; });
      const zero = [];
      lodLevelZero(lod).traverse((o) => { if (o.isMesh) zero.push(o); });
      for (const { object } of lod.levels.slice(1)) {
        object.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const twin = zero.find((z) => z.material === mesh.material);
          assert.ok(twin, `${key}: level shares LOD0 material`);
          assert.equal(mesh.geometry.attributes.position, twin.geometry.attributes.position, `${key}: shared GPU vertex buffer`);
          if (mesh.isSkinnedMesh) assert.deepEqual(mesh.skeleton.bones, twin.skeleton.bones, `${key}: same bones`);
        });
      }
    }
    assert.ok(levelZeroMeshes > 0 && levelZeroMeshes <= plainMeshes, `${key}: level 0 is the original hierarchy`);
  }
});

// Build-time KTX2 compression rewrites each GLB with stock extensions only: it
// drops MSFT_lod but keeps the LOD nodes and extras, from which the plugin
// recovers every chain.
test('LOD chains survive a rewrite by tools that do not know MSFT_lod', async () => {
  const stock = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const key of ['studio_espresso', 'studio_chair', 'char_atelier_1', 'pet_cat']) {
    const buffer = await geometryOnly(MODEL_MANIFEST[key].url, stock);
    assert.ok(!Buffer.from(buffer).toString('latin1').includes('"MSFT_lod"'), `${key}: extension dropped`);
    const gltf = await new GLTFLoader().register((parser) => new GLTFLodPlugin(parser)).parseAsync(buffer, '');
    const lods = [];
    gltf.scene.traverse((o) => { if (o.isLOD) lods.push(o); });
    assert.ok(lods.length > 0, `${key}: chains recovered from extras`);
    for (const lod of lods) {
      assert.equal(lod.levels.length, MODEL_MANIFEST[key].lods, `${key}: all levels`);
      assert.ok(lod.levels.every((l, i) => i === 0 || l.distance > lod.levels[i - 1].distance), `${key}: ordered levels`);
    }
  }
});
