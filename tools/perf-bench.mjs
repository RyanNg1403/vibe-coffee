// A/B performance bench that complements tools/perf-baseline.mjs (CPU per
// frame, per-café renderer counts). It works against any build that exposes
// window.__vibe, so the same command measures main and a branch:
//
//   npm run dev &                                    # branch on :5173
//   node tools/perf-bench.mjs --url=http://127.0.0.1:5173 --out=after.json
//   node tools/perf-bench.mjs --url=http://127.0.0.1:5174 --out=before.json
//
// Measures, at a fixed 1440x900@1x viewport with the seeded crowd:
// - startup: navigation to the first rendered café frame, bytes fetched
// - theme switch: main-thread blocking (long tasks) per café change
// - render cost: synchronous full renders (shadow refresh included) with a
//   JPEG readback, median of several; plus draw calls and triangles
// - picking: one pointer pick aimed at each pet (skinned raycast)
// - memory: JS heap and live GPU geometries/textures after GC
// Branch-only features are disabled where they would skew the comparison:
// ?adaptive=0 keeps the render resolution at 1x on both builds.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Map(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, value] = arg.slice(2).split('=');
  return [key, value ?? true];
}));
const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const BASE = String(args.get('url') ?? process.env.VIBE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const QUERY = String(args.get('query') ?? 'visual-audit=1&adaptive=0');
const APP_URL = `${BASE}/?${QUERY}`;
const RENDER_SAMPLES = Number(args.get('render-samples') ?? 3);
const OUT_FILE = args.get('out');
const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function retry(task, label, attempts = 1200) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (cause) {
      error = cause;
      await delay(100);
    }
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: error });
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  close() { this.socket.close(); }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};
const round = (value, digits = 1) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));

if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH');
const profile = await mkdtemp(join(tmpdir(), 'vibe-perf-bench-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--disable-gpu-sandbox', '--enable-precise-memory-info',
  '--hide-scrollbars', '--window-size=1440,900', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));

let client;
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, 'Chrome DevTools');
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'bench tab');
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // Long-task and first-frame probes must exist before any app script runs.
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__bench = { longTasks: [], firstCafeFrameAt: null };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__bench.longTasks.push([entry.startTime, entry.duration]);
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
        musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false, cafeIndex: 0,
        qualityMode: 'auto', laptopOn: true, envTime: 'auto', envSky: 'auto' }));
    `,
  });
  await client.send('Page.navigate', { url: APP_URL });

  // Startup: poll at 25 ms for the first frame with real café draw calls.
  const startup = await retry(async () => {
    const value = await client.evaluate(`(() => {
      const m = window.__vibe?.metrics?.();
      if (!m || m.calls < 50 || !window.__vibe.cafe) return null;
      const resources = performance.getEntriesByType('resource');
      return {
        firstCafeFrameMs: performance.now(),
        resources: resources.length,
        transferredMB: resources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0) / 1e6,
      };
    })()`);
    if (!value) throw new Error('no café frame yet');
    return value;
  }, 'first café frame', 4800);
  await client.evaluate("document.querySelector('#enter-btn').click()");

  async function settle(index) {
    const before = await client.evaluate('window.__vibe.metrics().renderedFrames');
    await retry(async () => {
      const m = await client.evaluate('JSON.stringify(window.__vibe.metrics())').then(JSON.parse);
      if (m.theme !== THEMES[index] || m.calls < 50 || m.renderedFrames < before + 3) throw new Error('settling');
    }, `${THEMES[index]} settled`);
    // Let async LOD generation and texture uploads finish when present.
    await retry(async () => {
      const pending = await client.evaluate('window.__vibe.metrics().perf?.lod?.pending ?? 0');
      if (pending > 0) throw new Error('lod pending');
    }, 'lod generation', 600);
    await delay(1500);
  }

  async function renderCost() {
    // One synchronous task: the first capture drains frames the app loop has
    // already queued on the GPU, and the app cannot queue more until the
    // timed captures finish.
    const samples = await client.evaluate(`(() => {
      window.__vibe.captureFrame(1, 'image/jpeg');
      const samples = [];
      for (let i = 0; i < ${RENDER_SAMPLES}; i += 1) {
        const t = performance.now();
        window.__vibe.captureFrame(1, 'image/jpeg');
        const ms = performance.now() - t;
        const m = window.__vibe.metrics();
        samples.push({ ms, calls: m.calls, triangles: m.triangles, actors: m.mobileActors });
      }
      return samples;
    })()`);
    return {
      renderMs: round(median(samples.map((s) => s.ms))),
      calls: median(samples.map((s) => s.calls)),
      triangles: median(samples.map((s) => s.triangles)),
      actors: samples[0].actors,
    };
  }

  async function petPick() {
    return client.evaluate(`(async () => {
      const three = await import('/node_modules/.vite/deps/three.js').catch(() => null);
      if (!three || !window.__vibe.pets?.pets?.length) return null;
      const camera = { position: new three.Vector3() };
      const raycaster = new three.Raycaster();
      const times = [];
      const eye = new three.Vector3();
      for (const pet of window.__vibe.pets.pets) {
        const root = pet.root ?? pet.mesh ?? pet.group;
        if (!root) continue;
        const target = new three.Vector3();
        root.getWorldPosition(target);
        target.y += 0.15;
        eye.copy(target).add(new three.Vector3(1.2, 1.1, 1.2));
        raycaster.ray.origin.copy(eye);
        raycaster.ray.direction.copy(target).sub(eye).normalize();
        window.__vibe.interactions.pick(raycaster); // warm (lazy BVH/LOD)
        const started = performance.now();
        for (let i = 0; i < 5; i += 1) window.__vibe.interactions.pick(raycaster);
        times.push((performance.now() - started) / 5);
      }
      return times.length ? Math.max(...times) : null;
    })()`);
  }

  async function memory() {
    await client.send('HeapProfiler.collectGarbage');
    await delay(300);
    // Same estimate as src/perf (block data as stored, images as RGBA8 with
    // mips), computed here so builds without the perf layer report it too.
    return client.evaluate(`(() => {
      const m = window.__vibe.metrics();
      const seen = new Set();
      let bytes = 0;
      let scene = window.__vibe.cafe.group;
      while (scene.parent) scene = scene.parent;
      scene.traverse((object) => {
        for (const material of [object.material].flat()) {
          for (const value of Object.values(material ?? {})) {
            if (!value?.isTexture || seen.has(value)) continue;
            seen.add(value);
            if (value.isCompressedTexture) bytes += value.userData.gpuBytes
              ?? (value.mipmaps ?? []).reduce((s, mip) => s + (mip.data?.byteLength ?? 0), 0);
            else bytes += (value.image?.width ?? 0) * (value.image?.height ?? 0)
              * (value.type === 1016 ? 8 : value.type === 1015 ? 16 : 4) * (value.generateMipmaps ? 4 / 3 : 1);
          }
        }
      });
      return { heapMB: m.heapBytes ? +(m.heapBytes / 1e6).toFixed(1) : null, geometries: m.geometries,
        textures: m.textures, textureMB: +(bytes / 1048576).toFixed(1) };
    })()`);
  }

  const perCafe = {};
  for (let index = 0; index < THEMES.length; index += 1) {
    const clickedAt = await client.evaluate(`(() => {
      const t = performance.now();
      ${index === 0 ? '' : `document.querySelectorAll('.loc-btn')[${index}].click();`}
      return t;
    })()`);
    await settle(index);
    const blocking = await client.evaluate(`(() => {
      const tasks = window.__bench.longTasks.filter(([start]) => start >= ${clickedAt});
      return { longestTaskMs: tasks.reduce((m, [, d]) => Math.max(m, d), 0),
        totalBlockingMs: tasks.reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0) };
    })()`);
    perCafe[THEMES[index]] = {
      ...(index === 0 ? {} : { switchLongestTaskMs: round(blocking.longestTaskMs), switchBlockingMs: round(blocking.totalBlockingMs) }),
      ...await renderCost(),
      petPickMs: round(await petPick(), 2),
      ...await memory(),
    };
    console.error(`${THEMES[index]}: ${JSON.stringify(perCafe[THEMES[index]])}`);
  }

  const startupBlocking = await client.evaluate(`(() => {
    const tasks = window.__bench.longTasks.filter(([start]) => start <= ${startup.firstCafeFrameMs});
    return { longestTaskMs: tasks.reduce((m, [, d]) => Math.max(m, d), 0),
      totalBlockingMs: tasks.reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0) };
  })()`);
  const report = {
    capturedAt: new Date().toISOString(),
    url: APP_URL,
    viewport: '1440x900@1x',
    startup: {
      firstCafeFrameMs: round(startup.firstCafeFrameMs, 0),
      resources: startup.resources,
      transferredMB: round(startup.transferredMB, 2),
      longestTaskMs: round(startupBlocking.longestTaskMs),
      totalBlockingMs: round(startupBlocking.totalBlockingMs),
    },
    perCafe,
  };
  const serialized = JSON.stringify(report, null, 2);
  console.log(serialized);
  if (OUT_FILE) await writeFile(OUT_FILE, `${serialized}\n`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(5000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
