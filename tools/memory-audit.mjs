import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?memory-audit=1';
const LOCATION_NAMES = [
  'Golden Hour Café',
  'Downtown Roastery',
  'Midnight Jazz Corner',
  'Garden Terrace',
];

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

async function retry(task, label, attempts = 100) {
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
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }

  close() {
    this.socket.close();
  }
}

function summarize(metrics) {
  return {
    theme: metrics.theme,
    heapMB: Number((metrics.heapBytes / 1_000_000).toFixed(2)),
    decodedAudioMB: Number((metrics.decodedAudioBytes / 1_000_000).toFixed(2)),
    geometries: metrics.geometries,
    textures: metrics.textures,
    activeGeometries: metrics.activeGeometries,
    activeTextures: metrics.activeTextures,
    calls: metrics.calls,
  };
}

if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH to run the memory audit');
const profile = await mkdtemp(join(tmpdir(), 'vibe-memory-audit-'));
const PORT = process.env.CHROME_DEBUG_PORT
  ? Number(process.env.CHROME_DEBUG_PORT)
  : await freePort();
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-extensions',
  '--disable-gpu-sandbox',
  '--enable-precise-memory-info',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));

let client;
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'Chrome DevTools');

  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
      method: 'PUT',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'audit tab');

  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('application is not ready');
    return ready;
  }, 'application startup', 300);

  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0.5,
    ambienceVolume: 0.7,
    voicesVolume: 1,
    musicOn: false,
    cafeIndex: 0,
    variantOn: false,
    qualityMode: 'smooth',
    laptopOn: false
  })); location.reload()`);
  await retry(async () => {
    const ready = await client.evaluate(`document.readyState === 'complete'
      && performance.getEntriesByType('navigation')[0]?.type === 'reload'
      && window.__vibe?.metrics().qualityMode === 'smooth'`);
    if (!ready) throw new Error('application is not ready');
    return ready;
  }, 'configured application startup', 300);
  await client.evaluate("document.querySelector('#enter-btn').click()");

  async function switchTo(index) {
    await client.evaluate(`document.querySelectorAll('.loc-btn:not(#variant-btn)')[${index}].click()`);
    await retry(async () => {
      const metrics = await client.evaluate('window.__vibe.metrics()');
      const expected = ['goldenhour', 'roastery', 'midnight', 'terrace'][index];
      if (metrics.theme !== expected || metrics.calls === 0) throw new Error('scene is still loading');
      return metrics;
    }, LOCATION_NAMES[index], 300);
    await delay(1250);
    await client.send('HeapProfiler.collectGarbage');
    await delay(250);
    return client.evaluate('window.__vibe.metrics()');
  }

  // Warm every unique scene twice. The first pass fills procedural texture and
  // model caches; the second makes the baseline equivalent to later rebuilds.
  for (const index of [0, 1, 2, 3, 0, 1, 2, 3, 0]) await switchTo(index);
  const start = await switchTo(0);
  const samples = [];
  const sequence = [1, 2, 3, 0, 1, 2, 3, 0, 1, 0];
  for (const index of sequence) samples.push(await switchTo(index));
  const end = samples.at(-1);
  const delta = {
    heapMB: Number(((end.heapBytes - start.heapBytes) / 1_000_000).toFixed(2)),
    geometries: end.geometries - start.geometries,
    textures: end.textures - start.textures,
  };
  const passed = Math.abs(delta.geometries) <= 5
    && Math.abs(delta.textures) <= 5
    && delta.heapMB < 10;

  console.table(samples.map(summarize));
  console.log(JSON.stringify({ start: summarize(start), end: summarize(end), delta, passed }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(5000)]);
  await rm(profile, { recursive: true, force: true });
}
