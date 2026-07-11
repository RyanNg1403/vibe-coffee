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

  assert.equal(flow.request(arriving, 'in'), false);
  assert.equal(entrance.direction, 'in');
  entrance.openness = 0.9;
  assert.equal(flow.request(arriving, 'in'), true);
  assert.equal(flow.request(leaving, 'out'), false);
  assert.equal(flow.queueLength, 1);

  flow.release(arriving);
  assert.equal(entrance.direction, null);
  entrance.openness = 0.2;
  flow.update();
  assert.equal(flow.active, null);
  entrance.openness = 0;
  flow.update();
  assert.equal(flow.active, leaving);
  assert.equal(entrance.direction, 'out');
  assert.deepEqual(opened, [[arriving, 'in'], [leaving, 'out']]);
});

test('open-air cafés grant passage without allocating a queue', () => {
  const flow = new DoorCoordinator();
  assert.equal(flow.request({}, 'in'), true);
  assert.equal(flow.queueLength, 0);
});
