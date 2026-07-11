// Low-frequency context planner for patrons. This is NOT a life simulator:
// it scores a handful of small, observable intents (gazes, pauses, courtesy)
// at 1-2 Hz across the whole crowd, and the existing state machine executes
// them. Pure logic - no Three.js - so scoring is unit-tested.

// Per-NPC seeded traits, assigned once at spawn. Deterministic given the rng.
export function seedTraits(rng = Math.random) {
  return {
    patience: 0.25 + rng() * 0.75,   // tolerance for queues and waits
    sociability: 0.2 + rng() * 0.8,  // people-watching, glances at neighbours
    curiosity: 0.2 + rng() * 0.8,    // pets, art, shelves, loud machines
  };
}

// Intent catalogue. `execute` names the mechanism the state machine applies:
// 'gaze' turns the head toward a point; 'yield' briefly slows walking.
export const INTENTS = {
  yieldToWaiter: { execute: 'yield', cooldown: 6, duration: 1.4 },
  glanceMenu: { execute: 'gaze', cooldown: 18, duration: 2.6 },
  watchPet: { execute: 'gaze', cooldown: 24, duration: 3.2 },
  reactGrinder: { execute: 'gaze', cooldown: 45, duration: 2.2 },
  peopleWatch: { execute: 'gaze', cooldown: 30, duration: 2.8 },
};

// Utility scores from a context snapshot. Anything under IDLE_THRESHOLD loses
// to "do nothing", which keeps the layer restrained.
export const IDLE_THRESHOLD = 0.42;

export function scoreIntents(context) {
  const t = context.traits;
  const scores = [];
  const cooled = (name) => !(context.cooldowns?.[name] > 0);

  if (context.walking && context.waiterCarryingNearby && cooled('yieldToWaiter')) {
    // courtesy beats curiosity: a loaded tray has right of way
    scores.push(['yieldToWaiter', 0.95]);
  }
  if (context.state === 'queueing' && cooled('glanceMenu')) {
    scores.push(['glanceMenu', 0.5 + Math.min(0.25, (context.queueLength ?? 0) * 0.08) + (1 - t.patience) * 0.15]);
  }
  if (context.seated && context.petDistance !== null && context.petDistance < 4.5 && cooled('watchPet')) {
    scores.push(['watchPet', 0.35 + t.curiosity * 0.4 - context.petDistance * 0.04]);
  }
  if (context.seated && context.grinderActive && context.counterDistance < 6 && cooled('reactGrinder')) {
    scores.push(['reactGrinder', 0.45 + t.curiosity * 0.25]);
  }
  if (context.seated && context.activity === 'none' && cooled('peopleWatch')) {
    scores.push(['peopleWatch', 0.25 + t.sociability * 0.3 + (context.occupancy ?? 0) * 0.15]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const best = scores[0];
  if (!best || best[1] < IDLE_THRESHOLD) return null;
  return { intent: best[0], score: best[1], ...INTENTS[best[0]] };
}

// Round-robin scheduler: a fixed number of evaluations per planner tick, so
// planning cost is independent of render FPS and crowd size only stretches
// the revisit interval, never the per-tick work.
export class BehaviorPlanner {
  constructor({ hz = 1.5, batch = 4 } = {}) {
    this.interval = 1 / hz;
    this.batch = batch;
    this.accumulator = 0;
    this.cursor = 0;
    this._evalTimes = [];
  }

  // contextFor(npc) -> context snapshot | null (null = not plannable now)
  // apply(npc, decision) -> executes the chosen intent
  update(dt, npcs, contextFor, apply, now) {
    this.accumulator += dt;
    if (this.accumulator < this.interval) return 0;
    this.accumulator %= this.interval;
    let evaluated = 0;
    for (let i = 0; i < Math.min(this.batch, npcs.length); i++) {
      const npc = npcs[this.cursor % npcs.length];
      this.cursor = (this.cursor + 1) % Math.max(1, npcs.length);
      const context = contextFor(npc);
      if (!context) continue;
      evaluated += 1;
      const decision = scoreIntents(context);
      if (decision) apply(npc, decision);
    }
    this._evalTimes.push(now);
    while (this._evalTimes.length && now - this._evalTimes[0] > 1) this._evalTimes.shift();
    return evaluated;
  }

  get evalsPerSecond() { return this._evalTimes.length * this.batch; }
}
