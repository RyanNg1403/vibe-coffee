import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { normalizeModel } from '../src/modelLoader.js';

test('a hat does not shrink a character or shift its seated pelvis', () => {
  function person(withHat) {
    const scene = new Group();
    const body = new Mesh(new BoxGeometry(0.5, 1.7, 0.3), new MeshStandardMaterial());
    body.position.y = 0.85;
    body.userData.portrait_bounds = [-0.25, 0, -0.15, 0.25, 1.7, 0.15];
    scene.add(body);
    if (withHat) {
      const hat = new Mesh(new BoxGeometry(0.6, 0.15, 0.6), new MeshStandardMaterial());
      hat.position.set(0, 1.75, 0.12);
      scene.add(hat);
    }
    const wrapper = normalizeModel(scene, 'char_atelier_1');
    wrapper.updateMatrixWorld(true);
    return { wrapper, body, bounds: new Box3().setFromObject(body) };
  }
  const plain = person(false), accessorized = person(true);
  try {
    assert.ok(plain.bounds.min.distanceTo(accessorized.bounds.min) < 1e-7);
    assert.ok(plain.bounds.max.distanceTo(accessorized.bounds.max) < 1e-7);
    assert.ok(Math.abs(accessorized.bounds.min.y) < 1e-6);
    assert.ok(new Box3().setFromObject(accessorized.wrapper).max.y > 1.7);
  } finally {
    for (const { wrapper } of [plain, accessorized]) wrapper.traverse(object => {
      object.geometry?.dispose(); object.material?.dispose();
    });
  }
});
