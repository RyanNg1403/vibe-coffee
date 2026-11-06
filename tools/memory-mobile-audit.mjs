// Per-café RAM and frame-pacing audit, optionally under low-end mobile
// emulation (Chrome DevTools protocol).
//
//   npm run audit:mobile -- [--url=http://127.0.0.1:5173] [--mobile]
//     [--throttle=4] [--device-memory=2] [--cores=4] [--quality=auto]
//     [--query=perf] [--sequence=0,1,2,3,0] [--sample=8] [--out=file.json]
//     [--shots=dir] [--shot-prefix=01-before] [--label=before]
//
// For each café it waits for the room and its streamed cast, samples frame
// pacing for --sample seconds, forces a GC, then records:
//   - the app's memoryReport() (JS heap, GPU bytes from the WebGL call
//     stream, CPU geometry/image copies, decoded audio),
//   - PSS of the renderer and GPU processes from /proc (Linux), i.e. what the
//     OS charges the tab; peak PSS is polled every second for the whole run.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Map(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, ...value] = arg.slice(2).split('=');
  return [key, value.length ? value.join('=') : true];
}));
const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const BASE = String(args.get('url') ?? process.env.VIBE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const QUERY = String(args.get('query') ?? 'perf');
const MOBILE = args.has('mobile');
const THROTTLE = Number(args.get('throttle') ?? (MOBILE ? 4 : 1));
const DEVICE_MEMORY = args.has('device-memory') ? Number(args.get('device-memory')) : (MOBILE ? 2 : null);
const CORES = args.has('cores') ? Number(args.get('cores')) : (MOBILE ? 4 : null);
const QUALITY = String(args.get('quality') ?? 'auto');
const SEQUENCE = String(args.get('sequence') ?? '0,1,2,3,0').split(',').map(Number);
const SAMPLE_SECONDS = Number(args.get('sample') ?? 8);
const SHOTS = args.get('shots') ?? null;
const SHOT_PREFIX = String(args.get('shot-prefix') ?? 'shot');
const LABEL = String(args.get('label') ?? (MOBILE ? 'mobile' : 'desktop'));
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE ?? 1) || 1);
const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];
const VIEWPORT = MOBILE
  ? { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true }
  : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 11; moto g(30)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  attempts = Math.round(attempts * RETRY_SCALE);
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
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  close() { this.socket.close(); }
}

// ---------- process memory (Linux /proc) ----------
async function processTree(rootPid) {
  const parents = new Map();
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile(`/proc/${name}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      parents.set(Number(name), ppid);
    } catch { /* exited */ }
  }
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of parents) {
      if (!tree.has(pid) && tree.has(ppid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return [...tree];
}

async function processMemory(rootPid) {
  if (process.platform !== 'linux') return null;
  const out = { rendererMB: 0, gpuMB: 0, browserMB: 0, otherMB: 0 };
  for (const pid of await processTree(rootPid)) {
    try {
      // Zygote children rewrite their title into one space-separated string.
      const cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split(/[\0 ]/);
      const rollup = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8');
      const pss = Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0) / 1024;
      const type = cmdline.find((part) => part.startsWith('--type='))?.slice(7) ?? 'browser';
      if (type === 'renderer') {
        // Extensions or spare renderers never load the app; count only the
        // largest renderer (the audited tab).
        out.rendererMB = Math.max(out.rendererMB, pss);
      } else if (type === 'gpu-process') out.gpuMB += pss;
      else if (type === 'browser') out.browserMB += pss;
      else out.otherMB += pss;
    } catch { /* exited or not readable */ }
  }
  const round = (value) => Number(value.toFixed(1));
  return {
    rendererMB: round(out.rendererMB),
    gpuMB: round(out.gpuMB),
    tabMB: round(out.rendererMB + out.gpuMB),
    browserMB: round(out.browserMB),
    otherMB: round(out.otherMB),
  };
}

// ---------- run ----------
if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH');
const profile = await mkdtemp(join(tmpdir(), 'vibe-mobile-audit-'));
const port = process.env.CHROME_DEBUG_PORT ? Number(process.env.CHROME_DEBUG_PORT) : await freePort();
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-extensions',
  '--disable-gpu-sandbox',
  '--enable-precise-memory-info',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));

let client;
let peakTab = null;
let pollTimer = null;
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, 'Chrome DevTools');
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'audit tab');
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  if (MOBILE) {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await client.send('Emulation.setUserAgentOverride', {
      userAgent: ANDROID_UA,
      platform: 'Linux armv8l',
      userAgentMetadata: {
        brands: [{ brand: 'Chromium', version: '131' }, { brand: 'Google Chrome', version: '131' }],
        fullVersion: '131.0.0.0',
        platform: 'Android',
        platformVersion: '11.0.0',
        architecture: 'arm',
        model: 'moto g(30)',
        mobile: true,
      },
    });
    await client.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  }
  if (THROTTLE > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  if (CORES) await client.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: CORES });
  if (DEVICE_MEMORY) {
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => ${DEVICE_MEMORY} });`,
    });
  }
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
      musicVolume: 0.5, ambienceVolume: 0.7, voicesVolume: 1, musicOn: false,
      cafeIndex: ${SEQUENCE[0]}, variantOn: false, qualityMode: ${JSON.stringify(QUALITY)}, laptopOn: false })); } catch {}`,
  });

  pollTimer = setInterval(async () => {
    const sample = await processMemory(chrome.pid).catch(() => null);
    if (sample && (!peakTab || sample.tabMB > peakTab.tabMB)) peakTab = sample;
  }, 1000);

  const url = `${BASE}/${QUERY ? `?${QUERY}` : ''}`;
  const startedAt = Date.now();
  await client.send('Page.navigate', { url });
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe?.memoryReport)');
    if (!ready) throw new Error('application is not ready');
  }, 'application startup', 1200);
  const firstFrame = await retry(async () => {
    const frames = await client.evaluate('window.__vibe.metrics().renderedFrames');
    if (!(frames > 1)) throw new Error('no frame yet');
    return Date.now() - startedAt;
  }, 'first frame', 1200);
  await client.evaluate("document.querySelector('#enter-btn')?.click()");

  async function sampleFrames(seconds) {
    const before = await client.evaluate('window.__vibe.metrics().renderedFrames');
    const t0 = Date.now();
    await delay(seconds * 1000);
    const m = await client.evaluate('window.__vibe.metrics()');
    const elapsed = (Date.now() - t0) / 1000;
    return {
      fps: Number(((m.renderedFrames - before) / elapsed).toFixed(1)),
      frameMs: m.perf?.frameMs ?? null,
      frameP95Ms: m.perf?.frameP95Ms ?? null,
      cpuMs: m.perf?.cpuMs ?? null,
      targetFps: m.targetFps,
      pixelRatio: m.pixelRatio,
      effects: m.effects,
      quality: m.perf?.quality ? `${m.perf.quality.tier}@${m.perf.quality.scale}` : null,
      device: m.device ?? null,
      pacing: m.pacing ?? null,
      calls: m.calls,
      triangles: m.triangles,
      actors: m.mobileActors,
    };
  }

  const samples = [];
  for (const [step, index] of SEQUENCE.entries()) {
    const theme = THEMES[index];
    if (step > 0 || (await client.evaluate('window.__vibe.metrics().theme')) !== theme) {
      await client.evaluate(`document.querySelectorAll('.loc-btn:not(#variant-btn)')[${index}].click()`);
    }
    await retry(async () => {
      const m = await client.evaluate('window.__vibe.metrics()');
      if (m.theme !== theme || m.calls === 0) throw new Error('loading');
    }, `${theme} room`, 1800);
    // The cast streams after the room's first frame.
    await retry(async () => {
      const m = await client.evaluate('window.__vibe.metrics()');
      if (!(m.mobileActors > 0)) throw new Error('cast streaming');
    }, `${theme} cast`, 1800).catch(() => null);
    const pacing = await sampleFrames(SAMPLE_SECONDS);
    await client.send('HeapProfiler.collectGarbage');
    await delay(500);
    const memory = await client.evaluate('window.__vibe.memoryReport()');
    const processes = await processMemory(chrome.pid);
    let shot = null;
    if (SHOTS) {
      await mkdir(SHOTS, { recursive: true });
      const { data } = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      shot = join(SHOTS, `${SHOT_PREFIX}-${String(step + 1).padStart(2, '0')}-${theme}.jpg`);
      await writeFile(shot, Buffer.from(data, 'base64'));
    }
    samples.push({ step, theme, memory, processes, pacing, shot });
    console.error(`[${LABEL}] ${theme}: heap ${memory.heapMB} MB, gpu ${memory.gpu?.totalMB} MB, tab ${processes?.tabMB ?? '—'} MB, ${pacing.fps} fps`);
  }

  const report = {
    label: LABEL,
    url,
    mobile: MOBILE,
    viewport: VIEWPORT,
    throttle: THROTTLE,
    deviceMemory: DEVICE_MEMORY,
    cores: CORES,
    quality: QUALITY,
    firstFrameMs: firstFrame,
    peakTab,
    samples,
  };
  console.table(samples.map(({ theme, memory, processes, pacing }) => ({
    theme,
    heapMB: memory.heapMB,
    gpuMB: memory.gpu?.totalMB,
    texMB: memory.gpu?.texturesMB,
    rtMB: memory.gpu?.renderTargetsMB,
    bufMB: memory.gpu?.buffersMB,
    cpuGeoMB: memory.cpu.geometryMB,
    cpuImgMB: memory.cpu.imagesMB,
    audioMB: memory.audioMB,
    models: memory.library?.models,
    tabMB: processes?.tabMB,
    fps: pacing.fps,
    p95: pacing.frameP95Ms,
    pr: pacing.pixelRatio,
  })));
  console.log(JSON.stringify({ label: LABEL, firstFrameMs: firstFrame, peakTab }, null, 2));
  if (args.get('out')) await writeFile(String(args.get('out')), JSON.stringify(report, null, 2));
} finally {
  clearInterval(pollTimer);
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(5000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
}
