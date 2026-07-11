import test from 'node:test';
import assert from 'node:assert/strict';
import { DoorCoordinator } from '../src/doorFlow.js';

test('door traffic is serialized and closes before reversing direction', () => {
  const entrance = {
    openness: 0,
    direction: null,
    setDirection(direction) { this.direction = direction; },
  };
  const opened = [];
  const flow = new DoorCoordinator(entrance, (actor, direction) => opened.push([actor, direction]));
  const arriving = { id: 'arriving' };
  const leaving = { id: 'leaving' };

  flow.join(arriving, 'in');
  flow.join(leaving, 'out');
  assert.equal(flow.isActive(arriving), true);
  assert.equal(flow.queueIndex(leaving), 0);
  assert.equal(entrance.direction, null);
  assert.equal(flow.request(arriving, 'in'), false);
  assert.equal(entrance.direction, 'in');
  entrance.openness = 0.9;
  assert.equal(flow.request(arriving, 'in'), true);
  assert.equal(flow.queueLength, 1);

  flow.release(arriving);
  assert.equal(entrance.direction, null);
  entrance.openness = 0.2;
  flow.update();
  assert.equal(flow.active, null);
  entrance.openness = 0;
  flow.update();
  assert.equal(flow.active, leaving);
  assert.equal(entrance.direction, null);
  assert.equal(flow.request(leaving, 'out'), false);
  assert.equal(entrance.direction, 'out');
  assert.deepEqual(opened, [[arriving, 'in'], [leaving, 'out']]);
});

test('only the reserved actor can approach and queued actors retain FIFO positions', () => {
  const entrance = {
    openness: 0,
    direction: null,
    setDirection(direction) { this.direction = direction; },
  };
  const flow = new DoorCoordinator(entrance);
  const first = { id: 'first' };
  const second = { id: 'second' };
  const third = { id: 'third' };

  flow.join(first, 'out');
  flow.join(second, 'in');
  flow.join(third, 'out');

  assert.equal(flow.isActive(first), true);
  assert.equal(flow.isActive(second), false);
  assert.equal(flow.queueIndex(second), 0);
  assert.equal(flow.queueIndex(third), 1);
  assert.equal(flow.request(second, 'in'), false);
  assert.equal(entrance.direction, null);

  flow.cancel(second);
  assert.equal(flow.queueIndex(third), 0);
  assert.equal(flow.totalWaiting, 2);
});

test('open-air cafés grant passage without allocating a queue', () => {
  const flow = new DoorCoordinator();
  assert.equal(flow.request({}, 'in'), true);
  assert.equal(flow.queueLength, 0);
});
