import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationMixer, Box3, BoxGeometry, Group, LoopOnce, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { normalizeModel } from '../src/modelLoader.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const requiredClips = ['death', 'eating', 'headbutt', 'idle', 'idle_2', 'idle_2_headlow', 'idle_eating', 'walk'];

async function loadPet(key) {
  const document = await io.read(new URL(`../public/models/${key}.glb`, import.meta.url).pathname);
  for (const texture of document.getRoot().listTextures()) texture.dispose();
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  const bytes = await io.writeBinary(document);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const model = normalizeModel(gltf.scene, key);
  let metadata;
  model.traverse(object => { if (object.userData.pet_bounds) metadata = object.userData; });
  return { model, clips: gltf.animations, metadata };
}

function dispose(model) {
  const skeletons = new Set();
  model.traverse(object => {
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose();
    if (object.skeleton) skeletons.add(object.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
}

function geometryHeight(model, include = () => true) {
  model.updateMatrixWorld(true);
  const point = new Vector3();
  let min = Infinity, max = -Infinity;
  model.traverse(object => {
    if (!object.isMesh || !include(object)) return;
    for (let i = 0; i < object.geometry.attributes.position.count; i++) {
      object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld);
      min = Math.min(min, point.y); max = Math.max(max, point.y);
    }
  });
  return { min, max };
}

test('a raised tail cannot shrink or offset either live pet or the legacy cat', () => {
  for (const [key, height] of [['pet_cat', .34], ['pet_dog', .55], ['cat', .32]]) {
    const scene = new Group();
    const body = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial());
    body.position.y = 1;
    body.userData.pet_bounds = [-.5, 0, -.5, .5, 2, .5];
    scene.add(body);
    const tail = new Mesh(new BoxGeometry(.1, 2, 3), new MeshStandardMaterial());
    tail.position.set(0, 2.5, -1.5); scene.add(tail);
    const model = normalizeModel(scene, key);
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(body);
    assert.ok(Math.abs(bounds.min.y) < 1e-7);
    assert.ok(Math.abs(bounds.max.y - height) < 1e-7);
    assert.ok(bounds.getCenter(new Vector3()).setY(0).length() < 1e-7);
    assert.ok(new Box3().setFromObject(model).max.y > height, 'tail stays taller without changing body scale');
    dispose(model);
  }
});

for (const [key, height, speed] of [['pet_cat', .34, .5], ['pet_dog', .55, .62]]) {
  test(`${key} preserves its anatomical height, complete rig and normalized skin`, async () => {
    const { model, clips, metadata } = await loadPet(key);
    try {
      assert.ok(metadata?.realism_pet && metadata?.pet_bounds, 'Blender anatomical metadata is embedded');
      assert.equal(metadata.pet_walk_speed, speed);
      assert.deepEqual(clips.map(clip => clip.name).sort(), requiredClips);
      const bones = new Set();
      model.traverse(object => {
        if (object.isBone) bones.add(object.name);
        if (!object.isSkinnedMesh) return;
        const weights = object.geometry.attributes.skinWeight;
        for (let vertex = 0; vertex < weights.count; vertex++) {
          const values = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)];
          assert.ok(values.every(value => Number.isFinite(value) && value >= 0));
          assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < .003);
        }
      });
      assert.equal(bones.size, 22);
      for (const name of ['Root', 'Spine', 'Neck', 'Head', 'Tail', 'TailTip', 'EyeL', 'EyeR',
        'FrontL', 'FrontR', 'RearL', 'RearR', 'FrontPawL', 'FrontPawR', 'RearPawL', 'RearPawR']) assert.ok(bones.has(name), name);
      const bounds = geometryHeight(model);
      assert.ok(Math.abs(bounds.min) < .001, 'standing paws are on the floor');
      assert.ok(Math.abs(bounds.max - height) < .002, 'body height does not include the tail');
    } finally { dispose(model); }
  });

  test(`${key} loops continuously at its authored cadence and plants every stance paw`, async () => {
    const { model, clips, metadata } = await loadPet(key);
    const mixer = new AnimationMixer(model);
    try {
      for (const clip of clips) for (const track of clip.tracks) {
        assert.ok(Math.abs(track.times[0]) < 1e-6, `${clip.name}: no held first frame before the authored loop`);
        assert.ok(Array.from(track.values).every(Number.isFinite));
        if (clip.name === 'death') continue; // a one-shot settling motion, deliberately not a loop
        const size = track.getValueSize(), first = Array.from(track.values.slice(0, size)), last = Array.from(track.values.slice(-size));
        const sign = track.name.endsWith('.quaternion') && first.reduce((sum, value, i) => sum + value * last[i], 0) < 0 ? -1 : 1;
        assert.ok(first.every((value, i) => Math.abs(value - sign * last[i]) < .0001), `${clip.name}/${track.name}: seamless loop endpoint`);
      }
      const walk = clips.find(clip => clip.name === 'walk');
      assert.ok(Math.abs(walk.duration - metadata.pet_walk_duration) < 1e-6, 'runtime stride duration matches authored foot travel');
      model.updateMatrixWorld(true);
      const paws = new Map();
      model.traverse(object => { if (object.isBone && object.name.includes('Paw')) paws.set(object.name, { bone: object, height: object.getWorldPosition(new Vector3()).y }); });
      const phaseOffset = { FrontPawL: 0, RearPawR: .25, FrontPawR: .5, RearPawL: .75 };
      mixer.clipAction(walk).play();
      for (let sample = 0; sample <= 120; sample++) {
        const phase = sample / 120;
        mixer.setTime(walk.duration * phase); model.updateMatrixWorld(true);
        for (const [name, { bone, height: standingHeight }] of paws) {
          const footPhase = (phase + phaseOffset[name]) % 1;
          if (footPhase <= .01 || footPhase >= .59) continue;
          const error = bone.getWorldPosition(new Vector3()).y - standingHeight;
          assert.ok(error > -.003 && error < .005, `${name}: planted paw height error ${error}m at phase ${footPhase}`);
        }
      }
      mixer.stopAllAction();
      for (const clip of clips) {
        const name = clip.name;
        const action = mixer.clipAction(clip).setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
        for (let sample = 0; sample <= 12; sample++) {
          mixer.setTime(clip.duration * sample / 12);
          const bounds = geometryHeight(model);
          assert.ok(bounds.min > -.005 && bounds.min < .005, `${name}: actual skinned geometry stays grounded (${bounds.min}m)`);
          if (['eating', 'idle_eating', 'idle_2_headlow'].includes(name)) {
            const nose = geometryHeight(model, object => object.material?.name.includes('nose'));
            assert.ok(nose.min > .005 && nose.min < height, `${name}: muzzle remains above the floor (${nose.min}m)`);
          }
        }
        mixer.stopAllAction();
      }
    } finally { mixer.stopAllAction(); mixer.uncacheRoot(model); dispose(model); }
  });
}
