// vibe coffee service worker. Generated into dist/sw.js by
// tools/pages/vite-plugin.mjs, which prepends self.__VIBE_MANIFEST__:
//   shell  - build output + index.html, precached per deploy version
//   assets - content-hashed public files: immutable, cache-first, kept across
//            deploys until a build stops referencing them
//   files  - other public files (unhashed), stale-while-revalidate per version
const { version, base, shell, assets, files } = self.__VIBE_MANIFEST__;
const SHELL_CACHE = `vibe-shell-${version}`;
const ASSET_CACHE = 'vibe-assets';
const scope = new URL(base, self.location.href).href;
const absolute = (path) => new URL(path, scope).href;
const SHELL = new Set(shell.map(absolute));
const ASSETS = new Set(assets.map(absolute));
const FILES = new Set(files.map(absolute));
const INDEX = absolute('index.html');
const NAVIGATION_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // index.html must not come from a stale HTTP cache entry: it names the
    // hashed chunks of exactly this deploy.
    await cache.addAll([...SHELL].map((url) => new Request(url, { cache: url === INDEX ? 'no-cache' : 'default' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('vibe-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    }
    const assetCache = await caches.open(ASSET_CACHE);
    for (const request of await assetCache.keys()) {
      if (!ASSETS.has(request.url)) await assetCache.delete(request);
    }
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(backfill(event.data.urls));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = request.url.split('#')[0];
  if (request.mode === 'navigate') {
    if (url.startsWith(scope)) event.respondWith(navigate(event));
    return;
  }
  if (ASSETS.has(url)) event.respondWith(cacheFirst(event, ASSET_CACHE));
  else if (SHELL.has(url)) event.respondWith(cacheFirst(event, SHELL_CACHE));
  else if (FILES.has(url)) event.respondWith(staleWhileRevalidate(event));
});

async function navigate(event) {
  const network = (async () => (await event.preloadResponse) ?? fetch(event.request))();
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch {
    // offline: fall through to the precached page
  }
  const cached = await caches.match(INDEX, { cacheName: SHELL_CACHE });
  return cached ?? network;
}

async function cacheFirst(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request.url);
  const range = request.headers.get('range');
  if (cached) return range ? slice(cached, range) : cached;
  if (range) {
    // Media elements stream with Range requests; cache the whole file once.
    event.waitUntil(store(cache, request.url));
    return fetch(request);
  }
  const response = await fetch(request);
  if (response.status === 200) event.waitUntil(cache.put(request.url, response.clone()));
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request.url);
  const update = fetch(event.request).then((response) => {
    if (response.status === 200) return cache.put(event.request.url, response.clone()).then(() => response);
    return response;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update;
}

async function store(cache, url) {
  if (await cache.match(url)) return;
  const response = await fetch(url);
  if (response.status === 200) await cache.put(url, response);
}

async function backfill(urls) {
  const queue = [...new Set(urls.map((url) => url.split('#')[0]))]
    .filter((url) => ASSETS.has(url) || FILES.has(url));
  const assetCache = await caches.open(ASSET_CACHE);
  const shellCache = await caches.open(SHELL_CACHE);
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        await store(ASSETS.has(url) ? assetCache : shellCache, url);
      } catch {
        // offline or evicted: the next visit fetches it through the worker
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function slice(response, header) {
  const blob = await response.blob();
  const size = blob.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  let start = match?.[1] ? Number(match[1]) : NaN;
  let end = match?.[2] ? Number(match[2]) : NaN;
  if (Number.isNaN(start)) {
    start = Math.max(0, size - (Number.isNaN(end) ? size : end));
    end = size - 1;
  } else if (Number.isNaN(end) || end >= size) {
    end = size - 1;
  }
  if (!match || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
    },
  });
}
