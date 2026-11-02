import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BufferGeometry, Int16BufferAttribute, Matrix4 } from 'three';
import { MODEL_MANIFEST } from '../src/modelManifest.js';
import { floatGeometry } from '../src/rendering/floatGeometry.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

test('the entire runtime library uses self-contained Blender exports with finite indexed geometry', async () => {
  let total = 0;
  for (const [key, { url }] of Object.entries(MODEL_MANIFEST)) {
    const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
    total += bytes.length;
    const doc = await io.readBinary(bytes);
    const root = doc.getRoot();
    assert.ok(root.listNodes().some(n => n.getExtras().atelier), `${key}: Blender provenance`);
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      assert.ok(pos.getArray().every(Number.isFinite), `${key}: finite positions`);
      assert.ok(p.getIndices().getArray().every(i => i < pos.getCount()), `${key}: valid indices`);
    }
    for (const buffer of root.listBuffers()) assert.equal(buffer.getURI(), '');
    for (const texture of root.listTextures()) assert.equal(texture.getURI(), '');
    if (key.startsWith('char_atelier_')) {
      assert.deepEqual(root.listAnimations().map(a => a.getName()).sort(), ['Idle', 'Sitting', 'Walk', 'Wave', 'Working']);
      assert.equal(root.listSkins().length, 1);
      const bounds = root.listNodes().map(node => node.getExtras().portrait_bounds).find(Boolean);
      assert.ok(bounds?.length === 6 && bounds.every(Number.isFinite), `${key}: anatomical bounds keep accessories from changing seat alignment`);
      assert.ok(bounds[4] - bounds[1] > 1.5 && bounds[4] - bounds[1] < 2, `${key}: human source scale`);
      const joints = new Set(root.listSkins()[0].listJoints().map(joint => joint.getName()));
      for (const bone of ['Hips', 'Head', 'neck', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftHand', 'RightHand']) {
        assert.ok(joints.has(bone), `${key}: ${bone} supports café actions`);
      }
      assert.ok(root.listSkins()[0].listJoints().length <= 24);
      for (const animation of root.listAnimations()) for (const channel of animation.listChannels()) {
        const sampler = channel.getSampler();
        const times = sampler.getInput().getArray();
        assert.ok(times.every((v,i) => i === 0 || v > times[i-1]), `${key}: ordered clip keys`);
        const output = sampler.getOutput();
        const values = output.getArray(), size = output.getElementSize();
        for (let c=0;c<size;c++) assert.ok(Math.abs(values[c]-values[values.length-size+c]) < 0.001, `${key}: seamless ${animation.getName()} loop`);
      }
    }
  }
  assert.ok(total < 28 * 1024 * 1024, `photo-textured runtime library: ${total} bytes`);
  assert.equal(Object.keys(MODEL_MANIFEST).filter(k => k.startsWith('char_')).length, 20);
});

test('compressed geometry can be baked beyond unit bounds without clamping or mutating the shared source', () => {
  const source = new BufferGeometry();
  source.userData.vibeShared = true;
  source.setAttribute('position', new Int16BufferAttribute([32767,0,-32767],3,true));
  const baked = floatGeometry(source).applyMatrix4(new Matrix4().makeTranslation(5,2,8));
  assert.deepEqual(Array.from(baked.attributes.position.array), [6,2,7]);
  assert.deepEqual(Array.from(source.attributes.position.array), [32767,0,-32767]);
  assert.equal(baked.userData.vibeShared, undefined);
  source.dispose(); baked.dispose();
});
