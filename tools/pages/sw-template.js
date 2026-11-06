// vibe coffee service worker. Generated into dist/sw.js by
// tools/pages/vite-plugin.mjs, which prepends self.__VIBE_MANIFEST__:
//   shell     - index.html and bundle JS/CSS, precached per deploy version
//   immutable - other content-hashed bundle files (WASM...), cache-first
//   files     - fixed-name public/ files with their content revision
//
// Fixed names never change when content does, so each cached copy carries its
// revision. A copy is served only while that revision matches this deploy;
// activation evicts the rest, and a download is cached only after its SHA-256
// matches, so a stale HTTP or CDN copy is never stored.
const { version, base, shell, immutable, files } = self.__VIBE_MANIFEST__;
const SHELL_CACHE = `vibe-shell-${version}`;
const ASSET_CACHE = 'vibe-assets';
const REVISION = 'X-Vibe-Revision';
const scope = new URL(base, self.location.href).href;
const absolute = (path) => new URL(path, scope).href;
const SHELL = new Set(shell.map(absolute));
const IMMUTABLE = new Set(immutable.map(absolute));
const FILES = new Map(Object.entries(files).map(([path, revision]) => [absolute(path), revision]));
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
      if (IMMUTABLE.has(request.url)) continue;
      const cached = await assetCache.match(request);
      if (!FILES.has(request.url) || cached?.headers.get(REVISION) !== FILES.get(request.url)) {
        await assetCache.delete(request);
      }
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
  if (FILES.has(url)) event.respondWith(revisioned(event, url, FILES.get(url)));
  else if (IMMUTABLE.has(url)) event.respondWith(cacheFirst(event, ASSET_CACHE));
  else if (SHELL.has(url)) event.respondWith(cacheFirst(event, SHELL_CACHE));
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
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) event.waitUntil(cache.put(request.url, response.clone()));
  return response;
}

async function revisioned(event, url, revision) {
  const { request } = event;
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(url);
  const range = request.headers.get('range');
  if (cached?.headers.get(REVISION) === revision) return range ? slice(cached, range) : cached;
  if (range) {
    // Media elements stream with Range requests; cache the whole file once.
    event.waitUntil(store(cache, url, revision));
    return fetch(request);
  }
  // Revalidate with the server (a 304 is cheap): the HTTP cache may still
  // hold the previous deploy's bytes under the same name for ten minutes.
  const response = await fetch(new Request(request, { cache: 'no-cache' }));
  if (response.status === 200) event.waitUntil(verifyAndPut(cache, url, revision, response.clone()));
  return response;
}

async function verifyAndPut(cache, url, revision, response) {
  const body = await response.arrayBuffer();
  if (await digest(body) !== revision) return false;
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');
  headers.set('Content-Length', String(body.byteLength));
  headers.set(REVISION, revision);
  await cache.put(url, new Response(body, { status: 200, statusText: response.statusText, headers }));
  return true;
}

async function store(cache, url, revision) {
  if (FILES.has(url)) {
    if ((await cache.match(url))?.headers.get(REVISION) === revision) return;
    // Usually still fresh in the HTTP cache from the page's own download.
    const response = await fetch(url);
    if (response.status === 200 && await verifyAndPut(cache, url, revision, response)) return;
    const fresh = await fetch(url, { cache: 'no-cache' });
    if (fresh.status === 200) await verifyAndPut(cache, url, revision, fresh);
    return;
  }
  if (await cache.match(url)) return;
  const response = await fetch(url);
  if (response.status === 200) await cache.put(url, response);
}

// Same digest as revision() in tools/pages/vite-plugin.mjs.
async function digest(buffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function backfill(urls) {
  const queue = [...new Set(urls.map((url) => url.split('#')[0]))]
    .filter((url) => FILES.has(url) || IMMUTABLE.has(url));
  const cache = await caches.open(ASSET_CACHE);
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        await store(cache, url, FILES.get(url));
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
