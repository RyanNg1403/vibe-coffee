import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterAllocator, countCharacterAssets, PROCEDURAL_CHARACTER_ASSET,
} from '../src/sim/characterAllocator.js';

test('all designs appear before duplicates across staff, patrons, and street pools', () => {
  const allocator = new CharacterAllocator(['a', 'b', 'c', 'd'], () => 0);
  const performer = allocator.reserve(['a', 'b']);
  const walker = allocator.reserve(['a', 'b', 'c']);
  const patron = allocator.reserve(['a', 'b', 'c', 'd']);
  const waiter = allocator.reserve(['a', 'b', 'c', 'd']);
  assert.equal(new Set([performer, walker, patron, waiter].map(lease => lease.key)).size, 4);
  assert.deepEqual(allocator.snapshot(), { a: 1, b: 1, c: 1, d: 1 });
});

test('a shared asset never exceeds two even through overlapping role pools', () => {
  const allocator = new CharacterAllocator(['shared', 'other'], () => 0);
  const staff = allocator.reserve(['shared']);
  const street = allocator.reserve(['shared']);
  assert.equal(allocator.reserve(['shared']), null);
  assert.equal(allocator.reserve(['missing', 'shared', 'other']).key, 'other');
  allocator.reserve(['other']);
  assert.equal(allocator.reserve(), null);
  assert.equal(allocator.available(), 0);
  assert.deepEqual(allocator.snapshot(), { shared: 2, other: 2 });
  assert.equal(allocator.release(street), true);
  assert.equal(allocator.release(street), false, 'repeat disposal cannot free a live actor slot');
  assert.equal(allocator.release({ key: staff.key }), false, 'forged leases cannot free slots');
  assert.equal(allocator.reserve(['shared']).key, 'shared');
  assert.equal(allocator.reserve(['shared']), null);
});

test('missing assets and duplicate candidate keys never inflate capacity', () => {
  const allocator = new CharacterAllocator(['a', 'a'], () => 0);
  assert.equal(allocator.available(['a', 'a', 'missing']), 2);
  assert.equal(allocator.reserve(['missing']), null);
  assert.equal(allocator.reserve([]), null);
  assert.equal(new CharacterAllocator([]).reserve(), null);
  assert.deepEqual(allocator.snapshot(), {});
});

test('pairs reserve atomically when the remaining cast cannot supply two people', () => {
  const allocator = new CharacterAllocator(['a', 'b'], () => 0);
  allocator.reserve(['a']);
  const pair = allocator.reserveMany(['a', 'b'], 2);
  assert.equal(pair.length, 2);
  assert.equal(allocator.available(), 1);
  const before = allocator.snapshot();
  assert.equal(allocator.reserveMany(['a', 'b'], 2), null);
  assert.deepEqual(allocator.snapshot(), before, 'failed pair leaves every slot untouched');
});

test('the no-model fallback is one bounded asset, not unlimited wardrobe variants', () => {
  const allocator = new CharacterAllocator([PROCEDURAL_CHARACTER_ASSET]);
  assert.ok(allocator.reserve());
  assert.ok(allocator.reserve());
  assert.equal(allocator.reserve(), null);
});

test('doorway handoffs count the same mesh once and keep its allocation', () => {
  const allocator = new CharacterAllocator(['a']);
  const lease = allocator.reserve();
  const mesh = { userData: { characterLease: lease } };
  const outsideWalker = { mesh, avatar: { key: 'a' } };
  const indoorGuest = { mesh, avatar: outsideWalker.avatar };
  assert.deepEqual(countCharacterAssets([outsideWalker, indoorGuest, null]), { a: 1 });
  assert.deepEqual(allocator.snapshot(), { a: 1 });
  assert.deepEqual(countCharacterAssets([indoorGuest]), { a: 1 });
  allocator.release(lease);
  assert.deepEqual(allocator.snapshot(), {});
});

test('actual displayed art identifies duplicates even if their lease labels differ', () => {
  const actors = Array.from({ length: 3 }, (_, i) => ({
    mesh: { userData: { characterLease: { key: `outfit-${i}` } } },
    avatar: { key: 'same-model' },
  }));
  assert.deepEqual(countCharacterAssets(actors), { 'same-model': 3 });
});

test('the expanded roster supports a busy café without triples during churn', () => {
  const keys = Array.from({ length: 18 }, (_, i) => `char_atelier_${i + 1}`);
  const allocator = new CharacterAllocator([...keys, 'barista', 'server'], () => 0.43);
  const leases = [allocator.reserve(['barista']), allocator.reserve(['server'])];
  for (let i = 0; i < 25; i++) leases.push(allocator.reserve(keys));
  assert.equal(Object.keys(allocator.snapshot()).length, 20);
  for (let tick = 0; tick < 500; tick++) {
    const index = 2 + tick % 25;
    allocator.release(leases[index]);
    leases[index] = allocator.reserve(keys);
    assert.ok(leases[index]);
    assert.ok(Math.max(...Object.values(allocator.snapshot())) <= 2);
  }
  leases.forEach(lease => allocator.release(lease));
  assert.deepEqual(allocator.snapshot(), {});
});
