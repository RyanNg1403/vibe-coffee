(() => {
  const base = __VIBE_BASE__;
  // A deploy replaces every hashed chunk; a tab opened before it reloads once
  // instead of failing on a lazy import that no longer exists.
  addEventListener('vite:preloadError', (event) => {
    if (sessionStorage.getItem('vibe-preload-reload')) return;
    sessionStorage.setItem('vibe-preload-reload', '1');
    event.preventDefault();
    location.reload();
  });
  if (!('serviceWorker' in navigator)) return;
  if (/[?&]no-sw\b/.test(location.search)) {
    navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister()));
    return;
  }
  // The first visit downloads before the worker controls the page. Report what
  // it fetched so the worker can cache it from the HTTP cache (still fresh).
  performance.setResourceTimingBufferSize(1000);
  const scope = new URL(base, location.href).href;
  addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error) => {
      console.warn('[sw] registration failed:', error.message);
    });
    navigator.serviceWorker.ready.then((registration) => {
      let pending = [];
      let timer = 0;
      const flush = () => {
        timer = 0;
        registration.active?.postMessage({ type: 'cache-urls', urls: pending });
        pending = [];
      };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.startsWith(scope)) pending.push(entry.name);
        }
        if (pending.length && !timer) timer = setTimeout(flush, 1500);
      }).observe({ type: 'resource', buffered: true });
    });
  });
})();
