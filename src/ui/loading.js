// Real loading progress for the title screen. Asset requests (models, HDR
// lighting, textures, decoders) are counted by observing fetch, so progress
// follows whatever the loaders actually request, then the café build and the
// first rendered frames close out the bar.

const TRACKED = /\/(models|environment|textures|draco|sounds|music)\//;

export const LOADING_STAGES = Object.freeze([
  { id: 'boot', label: 'Opening the doors', until: 0.08 },
  { id: 'assets', label: 'Bringing in furniture & regulars', until: 0.84 },
  { id: 'build', label: 'Arranging the room', until: 0.96 },
  { id: 'warmup', label: 'Lighting the lamps', until: 1 },
]);

// Pure progress model: `state` is { started, finished, built, warmFrames,
// elapsed } and the result is 0..1 plus the active stage. While no request
// has been observed (single-file builds inline every asset), time eases the
// bar forward so it never looks stalled.
export function computeProgress(state) {
  const { started = 0, finished = 0, built = false, warmFrames = 0, elapsed = 0 } = state;
  if (built) {
    const warm = Math.min(1, warmFrames / 3);
    if (warm >= 1) return { value: 1, stage: LOADING_STAGES[3] };
    return { value: 0.96 + warm * 0.04, stage: LOADING_STAGES[3] };
  }
  const creep = Math.min(0.78, 0.08 + 0.7 * (1 - Math.exp(-elapsed / 6)));
  if (started > 0) {
    const ratio = Math.min(1, finished / started);
    if (ratio >= 1) return { value: 0.84 + Math.min(0.1, elapsed * 0.004), stage: LOADING_STAGES[2] };
    return { value: Math.max(0.08 + ratio * 0.76, creep), stage: LOADING_STAGES[1] };
  }
  return { value: creep, stage: elapsed < 0.6 ? LOADING_STAGES[0] : LOADING_STAGES[1] };
}

const counters = { started: 0, finished: 0, bytes: 0 };

function instrumentFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || window.fetch.__vibeTracked) return;
  const nativeFetch = window.fetch.bind(window);
  const tracked = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (!TRACKED.test(url) || url.startsWith('data:')) return nativeFetch(input, init);
    counters.started += 1;
    const settle = (response) => {
      counters.finished += 1;
      const length = Number(response?.headers?.get?.('content-length'));
      if (Number.isFinite(length)) counters.bytes += length;
      return response;
    };
    return nativeFetch(input, init).then(settle, (error) => {
      settle(null);
      throw error;
    });
  };
  tracked.__vibeTracked = true;
  window.fetch = tracked;
}

instrumentFetch();

// Watches the app until a café exists and has rendered, reporting progress
// through `onProgress({ value, stage, detail })`. Resolves when ready.
export function trackLoading({ isBuilt, onProgress }) {
  const startedAt = performance.now();
  let warmFrames = 0;
  let shown = 0;
  return new Promise((resolve) => {
    const tick = () => {
      const built = Boolean(isBuilt());
      if (built) warmFrames += 1;
      // Sound and music are fetched after the visitor steps in; only the
      // requests made so far describe the café that is being prepared.
      const { value, stage } = computeProgress({
        started: counters.started,
        finished: counters.finished,
        built,
        warmFrames,
        elapsed: (performance.now() - startedAt) / 1000,
      });
      // Ease toward the measured target and never move backwards.
      shown = Math.max(shown, value >= 1 ? 1 : shown + (value - shown) * 0.18);
      const detail = stage.id === 'assets' && counters.started > 0
        ? `${counters.finished} / ${counters.started} assets`
        : '';
      onProgress({ value: shown, stage, detail });
      if (value >= 1 && shown >= 1) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function loadingCounters() {
  return { ...counters };
}
