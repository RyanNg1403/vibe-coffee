import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldInteractions, resolveRegisteredHit } from '../src/interactions/worldInteractions.js';

function node(parent = null) {
  return { parent };
}

function fakeRaycaster(hits) {
  return {
    intersectObjects(roots, recursive, target) {
      for (const hit of hits) target.push(hit);
      return target;
    },
  };
}

test('pick resolves the nearest hit through the parent chain', () => {
  const interactions = new WorldInteractions();
  const laptop = node();
  const lid = node(laptop);
  const screen = node(lid);
  interactions.register(laptop, { onClick: () => {} });

  const hit = interactions.pick(fakeRaycaster([
    { object: screen, distance: 1.2, point: { x: 0, y: 0, z: 0 } },
    { object: laptop, distance: 1.5, point: { x: 0, y: 0, z: 0 } },
  ]));
  assert.ok(hit);
  assert.equal(hit.entry.root, laptop);
  assert.equal(hit.distance, 1.2);
});

test('pick returns null when nothing is registered', () => {
  const interactions = new WorldInteractions();
  assert.equal(interactions.pick(fakeRaycaster([])), null);
});

test('resolveRegisteredHit keeps raycaster nearest-first ordering', () => {
  const near = node();
  const far = node();
  const entries = new Map([[far, { root: far }], [near, { root: near }]]);
  const hit = resolveRegisteredHit(
    [
      { object: near, distance: 0.8 },
      { object: far, distance: 2.0 },
    ],
    (object) => entries.get(object) ?? null,
  );
  assert.equal(hit.entry.root, near);
});

test('click honours the per-target cooldown but still consumes the click', () => {
  const interactions = new WorldInteractions();
  const pet = node();
  let clicks = 0;
  interactions.register(pet, { onClick: () => { clicks += 1; }, cooldownMs: 1500 });
  const hit = interactions.pick(fakeRaycaster([{ object: pet, distance: 1 }]));

  assert.equal(interactions.click(hit, 1000), true);
  assert.equal(interactions.click(hit, 1100), true); // consumed, not re-fired
  assert.equal(clicks, 1);
  assert.equal(interactions.click(hit, 2600), true);
  assert.equal(clicks, 2);
});

test('click on a target unregistered after picking falls through', () => {
  const interactions = new WorldInteractions();
  const pet = node();
  interactions.register(pet, { onClick: () => { throw new Error('should not fire'); } });
  const hit = interactions.pick(fakeRaycaster([{ object: pet, distance: 1 }]));
  interactions.clear();
  assert.equal(interactions.click(hit, 1000), false);
});

test('hover reports enter/leave transitions and the cursor to show', () => {
  const interactions = new WorldInteractions();
  const pet = node();
  const transitions = [];
  interactions.register(pet, { onHover: (over) => transitions.push(over), cursor: 'pointer' });
  const hit = interactions.pick(fakeRaycaster([{ object: pet, distance: 1 }]));

  assert.equal(interactions.hover(hit), 'pointer');
  assert.equal(interactions.hover(hit), 'pointer'); // no duplicate enter
  assert.equal(interactions.hover(null), null);
  assert.deepEqual(transitions, [true, false]);
});

test('unregister clears hover state on the removed target', () => {
  const interactions = new WorldInteractions();
  const pet = node();
  const transitions = [];
  interactions.register(pet, { onHover: (over) => transitions.push(over) });
  interactions.hover(interactions.pick(fakeRaycaster([{ object: pet, distance: 1 }])));
  interactions.unregister(pet);
  assert.deepEqual(transitions, [true, false]);
  assert.equal(interactions.size, 0);
});
