// Decides when to write a checkpoint: on a steady interval, shortly after key
// events (debounced so a dragged slider is one write), and immediately when
// the page is hidden, frozen or unloaded. Nothing is written until enabled,
// so a visit that never leaves the title screen keeps the previous checkpoint.

export function createAutosave({
  capture,
  store,
  intervalMs = 15000,
  debounceMs = 700,
  win = globalThis.window,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  let enabled = false;
  let interval = 0;
  let debounce = 0;
  let saving = Promise.resolve();

  function save(reason, { sync = false } = {}) {
    clearTimeout(debounce);
    debounce = 0;
    if (!enabled) return Promise.resolve(null);
    let snapshot;
    try {
      snapshot = capture(reason);
    } catch (error) {
      console.warn('[checkpoint] capture failed:', error);
      return Promise.resolve(null);
    }
    if (!snapshot) return Promise.resolve(null);
    const result = Promise.resolve(store.save(snapshot, { sync })).then((outcome) => {
      onResult(outcome, reason);
      return outcome;
    }, (error) => {
      console.warn('[checkpoint] save failed:', error);
      return null;
    });
    saving = result;
    return result;
  }

  const onHidden = () => {
    if (doc?.visibilityState === 'hidden') save('hidden', { sync: true });
  };
  const onPageHide = () => save('pagehide', { sync: true });
  const onFreeze = () => save('freeze', { sync: true });

  doc?.addEventListener?.('visibilitychange', onHidden);
  doc?.addEventListener?.('freeze', onFreeze);
  win?.addEventListener?.('pagehide', onPageHide);

  return {
    get enabled() { return enabled; },
    enable() {
      if (enabled) return;
      enabled = true;
      interval = setInterval(() => {
        if (doc?.visibilityState !== 'hidden') save('interval');
      }, intervalMs);
    },
    disable() {
      enabled = false;
      clearInterval(interval);
      clearTimeout(debounce);
      interval = 0;
      debounce = 0;
    },
    // A key event happened (sat down, changed café, started focusing...).
    touch(reason = 'change') {
      if (!enabled) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => save(reason), debounceMs);
    },
    saveNow: (reason = 'manual', options) => save(reason, options),
    idle: () => saving,
    dispose() {
      this.disable();
      doc?.removeEventListener?.('visibilitychange', onHidden);
      doc?.removeEventListener?.('freeze', onFreeze);
      win?.removeEventListener?.('pagehide', onPageHide);
    },
  };
}
