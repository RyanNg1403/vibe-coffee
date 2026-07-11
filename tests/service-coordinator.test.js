import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceCoordinator } from '../src/npc/serviceCoordinator.js';

test('delivery outranks clearing outranks wiping outranks restocking', () => {
  const service = new ServiceCoordinator(0);
  service.addTask('restock', {});
  service.addTask('wipe', {});
  service.addTask('clear', { dedupeKey: 't1' });
  service.addTask('deliver', { dedupeKey: 'p1' });
  const order = [];
  for (let i = 0; i < 4; i++) {
    const task = service.claim('waiter');
    order.push(task.kind);
    service.complete(task);
    service.update(i + 1);
  }
  assert.deepEqual(order, ['deliver', 'clear', 'wipe', 'restock']);
});

test('equal priority resolves oldest-first', () => {
  const service = new ServiceCoordinator(0);
  service.update(1); const a = service.addTask('clear', { dedupeKey: 'a' });
  service.update(2); service.addTask('clear', { dedupeKey: 'b' });
  assert.equal(service.claim('w'), a);
});

test('a table can only have one open clear task', () => {
  const service = new ServiceCoordinator(0);
  assert.ok(service.addTask('clear', { dedupeKey: 'table-3' }));
  assert.equal(service.addTask('clear', { dedupeKey: 'table-3' }), null);
  assert.equal(service.taskCount, 1);
});

test('unclaimed tasks expire and fire their fallback exactly once', () => {
  const service = new ServiceCoordinator(0);
  let fallbacks = 0;
  service.addTask('deliver', { dedupeKey: 'p9', ttl: 10, onExpire: () => { fallbacks += 1; } });
  service.update(5);
  assert.equal(service.taskCount, 1);
  service.update(11);
  assert.equal(fallbacks, 1, 'fallback fired');
  assert.equal(service.taskCount, 0, 'expired task removed');
  service.update(12);
  assert.equal(fallbacks, 1, 'never re-fired');
});

test('claimed tasks do not expire mid-work', () => {
  const service = new ServiceCoordinator(0);
  let fallbacks = 0;
  const task = service.addTask('deliver', { ttl: 10, onExpire: () => { fallbacks += 1; } });
  assert.equal(service.claim('waiter'), task);
  service.update(50);
  assert.equal(fallbacks, 0);
  assert.equal(service.taskCount, 1);
});

test('claim filters by worker capability', () => {
  const service = new ServiceCoordinator(0);
  service.addTask('deliver', {});
  assert.equal(service.claim('barista', ['restock']), null);
  assert.ok(service.claim('waiter', ['deliver', 'clear']));
});

test('stations are exclusive between workers and re-entrant for the holder', () => {
  const service = new ServiceCoordinator(0);
  assert.equal(service.reserve('pickup', 'waiter'), true);
  assert.equal(service.reserve('pickup', 'barista'), false, 'second worker refused');
  assert.equal(service.reserve('pickup', 'waiter'), true, 'holder may re-reserve');
  service.releaseStation('pickup', 'barista');
  assert.equal(service.reservationCount, 1, 'non-holder release ignored');
  service.releaseStation('pickup', 'waiter');
  assert.equal(service.reserve('pickup', 'barista'), true);
});

test('cafe teardown cancels every task and reservation', () => {
  const service = new ServiceCoordinator(0);
  service.addTask('deliver', {});
  service.addTask('clear', {});
  service.reserve('pickup', 'waiter');
  service.reserve('dish', 'waiter');
  service.cancelAll();
  assert.equal(service.taskCount, 0);
  assert.equal(service.reservationCount, 0);
  assert.equal(service.claim('waiter'), null);
});

test('released tasks return to the pool', () => {
  const service = new ServiceCoordinator(0);
  const task = service.addTask('clear', {});
  assert.equal(service.claim('w1'), task);
  service.release(task);
  assert.equal(service.claim('w2'), task);
});
