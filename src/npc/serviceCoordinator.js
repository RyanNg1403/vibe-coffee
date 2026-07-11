// Task queue and station reservations for café staff. Pure logic (no Three.js,
// no DOM) so priorities, expiry, and reservation exclusivity are unit-tested.
// The barista's reactive register/brew flow stays untouched during migration;
// the coordinator owns everything the waiter does, and both report through
// window.__vibe.metrics() (serviceTasks / serviceReservations).

// Lower number wins. Waiter priority per the plan: deliver prepared drinks
// before clearing departed tables, before wiping, before restocking.
const TASK_PRIORITY = {
  deliver: 0,
  clear: 1,
  wipe: 2,
  restock: 3,
};

export class ServiceCoordinator {
  constructor(now = 0) {
    this.tasks = [];
    this.reservations = new Map(); // stationKey -> workerId
    this.nextId = 1;
    this.now = now;
  }

  update(now) {
    this.now = now;
    for (const task of this.tasks) {
      if (task.expiresAt !== null && !task.claimedBy && now >= task.expiresAt && !task.expired) {
        task.expired = true;
        task.onExpire?.(task);
      }
    }
    this.tasks = this.tasks.filter((task) => !task.expired && !task.done);
  }

  // One open task per (kind, dedupeKey): a table can only be cleared once,
  // a patron only delivered to once.
  addTask(kind, { dedupeKey = null, target = null, patronId = null, data = null, ttl = null, onExpire = null } = {}) {
    if (dedupeKey !== null && this.tasks.some((t) => t.kind === kind && t.dedupeKey === dedupeKey)) {
      return null;
    }
    const task = {
      id: this.nextId++,
      kind,
      priority: TASK_PRIORITY[kind] ?? 9,
      dedupeKey,
      target,
      patronId,
      data,
      createdAt: this.now,
      expiresAt: ttl === null ? null : this.now + ttl,
      onExpire,
      claimedBy: null,
      expired: false,
      done: false,
    };
    this.tasks.push(task);
    return task;
  }

  // Highest-priority unclaimed task this worker may take; claims it.
  claim(workerId, kinds = null) {
    let best = null;
    for (const task of this.tasks) {
      if (task.claimedBy || task.expired || task.done) continue;
      if (kinds && !kinds.includes(task.kind)) continue;
      if (!best
        || task.priority < best.priority
        || (task.priority === best.priority && task.createdAt < best.createdAt)) {
        best = task;
      }
    }
    if (best) best.claimedBy = workerId;
    return best;
  }

  release(task) {
    if (task) task.claimedBy = null;
  }

  complete(task) {
    if (task) task.done = true;
  }

  cancelAll() {
    for (const task of this.tasks) {
      task.expired = true;
      task.claimedBy = null;
    }
    this.tasks = [];
    this.reservations.clear();
  }

  // Exclusive work-station ownership (pickup shelf, a table approach, the
  // dish return). Reserving a station another worker holds fails.
  reserve(stationKey, workerId) {
    const holder = this.reservations.get(stationKey);
    if (holder !== undefined && holder !== workerId) return false;
    this.reservations.set(stationKey, workerId);
    return true;
  }

  releaseStation(stationKey, workerId) {
    if (this.reservations.get(stationKey) === workerId) {
      this.reservations.delete(stationKey);
    }
  }

  releaseAllFor(workerId) {
    for (const [key, holder] of this.reservations) {
      if (holder === workerId) this.reservations.delete(key);
    }
  }

  get taskCount() { return this.tasks.length; }
  get reservationCount() { return this.reservations.size; }
}
