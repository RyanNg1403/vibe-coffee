import test from 'node:test';
import assert from 'node:assert/strict';
import { planCast, STAFF_KEYS, PET_KEYS } from '../src/perf/castPlan.js';
import { ModelView, isCastModel } from '../src/modelLoader.js';
import { MAX_CHARACTER_COPIES } from '../src/sim/characterAllocator.js';

const patrons = Array.from({ length: 18 }, (_, i) => `char_atelier_${i + 1}`);
const catalog = (loaded = []) => [...patrons, ...STAFF_KEYS, ...PET_KEYS]
  .map((key) => ({ key, loaded: loaded.includes(key) }));

test('a café downloads only enough patrons to cover its peak population', () => {
  const keys = planCast(catalog(), { id: 'goldenhour', crowd: 16 });
  const chosen = keys.filter((key) => patrons.includes(key));
  assert.ok(chosen.length < patrons.length, 'not the whole cast');
  assert.ok(chosen.length * MAX_CHARACTER_COPIES >= 16 + 8, 'room crowd plus street walkers fit the copy limit');
  assert.deepEqual(keys.slice(0, 2), STAFF_KEYS, 'staff first');
  assert.deepEqual(keys.slice(-2), PET_KEYS);
});

test('cast plans are deterministic per café and prefer models already downloaded', () => {
  const theme = { id: 'roastery', crowd: 18 };
  assert.deepEqual(planCast(catalog(), theme), planCast(catalog(), theme));
  const resident = patrons.slice(10, 14);
  const keys = planCast(catalog(resident), theme);
  for (const key of resident) assert.ok(keys.includes(key), `${key} is reused`);
});

test('the crowd view hides unchosen cast members and follows later loads', () => {
  const source = new Map([['cup', { template: 1 }], ['char_atelier_1', { character: true }], ['char_atelier_2', { character: true }]]);
  const wanted = new Set(['char_atelier_1']);
  const view = new ModelView(source, (key) => !isCastModel(key) || wanted.has(key));
  assert.deepEqual([...view.keys()].sort(), ['char_atelier_1', 'cup']);
  assert.equal(view.get('char_atelier_2'), undefined);
  assert.equal(view.has('char_atelier_2'), false);
  source.set('iceCream', { template: 2 });
  assert.ok(view.has('iceCream'), 'props streamed in later become available');
  assert.equal(view.size, 3);
  let visited = 0;
  view.forEach(() => { visited += 1; });
  assert.equal(visited, 3);
});
