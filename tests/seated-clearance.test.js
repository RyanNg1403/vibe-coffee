import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationMixer, Vector3 } from 'three';
import { normalizeModel } from '../src/modelLoader.js';
import { isFemalePortrait, seatForwardOffset } from '../src/npc/seatFit.js';
import { MODEL_MANIFEST } from '../src/modelManifest.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

async function geometryOnly(key) {
  const document = await io.read(new URL(`../public/models/${key}.glb`, import.meta.url).pathname);
  for (const texture of document.getRoot().listTextures()) texture.dispose();
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  const bytes = await io.writeBinary(document);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return { model: normalizeModel(gltf.scene, key), clips: gltf.animations };
}

function lumbarRange(model) {
  model.updateMatrixWorld(true);
  const point = new Vector3();
  let rear = Infinity, front = -Infinity;
  model.traverse(object => {
    if (!object.isMesh) return;
    for (let i = 0; i < object.geometry.attributes.position.count; i++) {
      object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld);
      if (Math.abs(point.x) < 0.13 && point.y > 0.66 && point.y < 0.86) {
        rear = Math.min(rear, point.z); front = Math.max(front, point.z);
      }
    }
  });
  return { rear, front };
}

function dispose(model) {
  model.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); object.skeleton?.dispose(); });
}

test('every seated portrait clears the curved chair back, including depth variation', async () => {
  const chair = await geometryOnly('studio_chair');
  const innerBack = lumbarRange(chair.model).front;
  assert.ok(Number.isFinite(innerBack));
  dispose(chair.model);
  for (const key of Object.keys(MODEL_MANIFEST).filter(key => key.startsWith('char_atelier_'))) {
    const { model, clips } = await geometryOnly(key);
    const mixer = new AnimationMixer(model);
    mixer.clipAction(clips.find(clip => clip.name === 'Sitting')).play();
    mixer.update(1);
    model.scale.z = 1.05; // deepest permitted patron proportion
    model.position.set(0, isFemalePortrait(key) ? 0.02 : 0.04,
      seatForwardOffset({ key, isAtelier: true, hasSitClip: true }));
    const { rear } = lumbarRange(model);
    assert.ok(rear > innerBack + 0.005, `${key}: jacket rear ${rear}, chair front ${innerBack}`);
    mixer.stopAllAction(); mixer.uncacheRoot(model); dispose(model);
  }
});
