import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedTraits, scoreIntents, BehaviorPlanner, IDLE_THRESHOLD, INTENTS,
} from '../src/npc/behaviorPlanner.js';

const TRAITS = { patience: 0.5, sociability: 0.5, curiosity: 0.5 };
const base = (over = {}) => ({
  state: 'sitting', seated: true, walking: false, activity: 'laptop',
  queueLength: 0, occupancy: 0.5, petDistance: null, counterDistance: 10,
  grinderActive: false, waiterCarryingNearby: false,
  traits: TRAITS, cooldowns: {}, ...over,
});

test('traits are seeded within bounds and deterministic per rng', () => {
  let calls = 0;
  const rng = () => { calls += 1; return 0.5; };
  const traits = seedTraits(rng);
  assert.equal(calls, 3);
  for (const value of Object.values(traits)) assert.ok(value > 0 && value <= 1);
  assert.deepEqual(traits, seedTraits(() => 0.5));
});

test('doing nothing wins when nothing interesting is happening', () => {
  assert.equal(scoreIntents(base()), null);
});

test('a loaded waiter has right of way over every curiosity', () => {
  const decision = scoreIntents(base({
    walking: true, seated: false, state: 'entering',
    waiterCarryingNearby: true, petDistance: 1, grinderActive: true, counterDistance: 2,
  }));
  assert.equal(decision.intent, 'yieldToWaiter');
  assert.equal(decision.execute, 'yield');
});

test('queueing patrons glance at the menu, more so when impatient', () => {
  const patientScore = scoreIntents(base({ state: 'queueing', seated: false, traits: { ...TRAITS, patience: 1 } }));
  const impatient = scoreIntents(base({ state: 'queueing', seated: false, traits: { ...TRAITS, patience: 0 } }));
  assert.equal(patientScore.intent, 'glanceMenu');
  assert.ok(impatient.score > patientScore.score);
});

test('a nearby pet draws curious patrons, and cooldowns silence repeats', () => {
  const curious = scoreIntents(base({ petDistance: 1.5, traits: { ...TRAITS, curiosity: 1 } }));
  assert.equal(curious.intent, 'watchPet');
  const cooled = scoreIntents(base({
    petDistance: 1.5, traits: { ...TRAITS, curiosity: 1 }, cooldowns: { watchPet: 10 },
  }));
  assert.equal(cooled, null);
});

test('the grinder turns heads only near the counter', () => {
  const near = scoreIntents(base({ grinderActive: true, counterDistance: 3, traits: { ...TRAITS, curiosity: 0.8 } }));
  assert.equal(near.intent, 'reactGrinder');
  const far = scoreIntents(base({ grinderActive: true, counterDistance: 9, traits: { ...TRAITS, curiosity: 0.8 } }));
  assert.equal(far, null);
});

test('idle sociable patrons people-watch in a fuller room', () => {
  const decision = scoreIntents(base({
    activity: 'none', occupancy: 0.9, traits: { ...TRAITS, sociability: 1 },
  }));
  assert.equal(decision.intent, 'peopleWatch');
  assert.ok(decision.score >= IDLE_THRESHOLD);
});

test('every intent declares an execution mechanism and cooldown', () => {
  for (const [name, spec] of Object.entries(INTENTS)) {
    assert.ok(['gaze', 'yield'].includes(spec.execute), name);
    assert.ok(spec.cooldown >= 5, `${name} has a real cooldown`);
    assert.ok(spec.duration > 0.5 && spec.duration < 6, `${name} stays subtle`);
  }
});

test('the planner budget is fixed per tick regardless of crowd size', () => {
  const planner = new BehaviorPlanner({ hz: 2, batch: 3 });
  const npcs = Array.from({ length: 40 }, (_, i) => ({ id: i }));
  let contexts = 0;
  const applied = [];
  // one tick's worth of time evaluates exactly one batch
  const evaluated = planner.update(0.5, npcs, () => { contexts += 1; return base({ state: 'queueing', seated: false }); },
    (npc, decision) => applied.push([npc.id, decision.intent]), 10);
  assert.equal(evaluated, 3);
  assert.equal(contexts, 3);
  assert.equal(applied.length, 3);
  // sub-interval dt accumulates without evaluating
  assert.equal(planner.update(0.1, npcs, () => base(), () => {}, 10.1), 0);
});

test('round-robin revisits everyone instead of favouring the first patrons', () => {
  const planner = new BehaviorPlanner({ hz: 1, batch: 2 });
  const seen = new Set();
  const npcs = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
  for (let tick = 0; tick < 2; tick++) {
    planner.update(1, npcs, (npc) => { seen.add(npc.id); return null; }, () => {}, tick);
  }
  assert.equal(seen.size, 4);
});
