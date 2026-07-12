// Records the Section 14 performance baseline: per-café Auto metrics plus a
// controlled CPU sample of the whole browser process tree while the café sits
// in Auto's ambient state. Run it against a branch before and after a change;
// the numbers are only meaningful when both runs use the same machine, the
// same viewport, and the same sample length.
//
//   npm run dev &            # vite on 127.0.0.1:5173
//   node tools/perf-baseline.mjs [--cpu-seconds=45] [--out=perf-baseline.json]
//
// The page runs with ?visual-audit=1 so the crowd is seeded deterministically
// (patrons still live and animate — unlike ?memory-audit=1, which freezes the
// simulation). Audio volumes are zero but the graph still runs. On machines
// without a GPU the browser falls back to software rasterization, which shows
// up as CPU: that keeps GPU-side regressions visible in this gate too.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?visual-audit=1';
const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];
const args = new Map(process.argv.slice(2)
  .filter((arg) => arg.startsWith('--'))
  .map((arg) => {
    const [key, value] = arg.slice(2).split('=');
    return [key, value ?? true];
  }));
const CPU_SECONDS = Number(args.get('cpu-seconds') ?? 45);
const OUT_FILE = args.get('out');

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

const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE) || 1);

async function retry(task, label, attempts = 300 * RETRY_SCALE) {
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

  close() { this.socket.close(); }
}

// ---- /proc process-tree CPU sampling (Linux; other platforms report null) ----

export function parseProcStat(stat) {
  // pid (comm, may contain spaces/parens) state ppid ... utime(14) stime(15)
  const close = stat.lastIndexOf(')');
  const fields = stat.slice(close + 2).split(' ');
  return {
    ppid: Number(fields[1]),
    utime: Number(fields[11]),
    stime: Number(fields[12]),
  };
}

async function sampleProcessTree(rootPid) {
  if (process.platform !== 'linux') return null;
  const entries = await readdir('/proc');
  const stats = new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      stats.set(Number(entry), parseProcStat(await readFile(`/proc/${entry}/stat`, 'utf8')));
    } catch {
      // process exited between readdir and readFile
    }
  }
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, { ppid }] of stats) {
      if (tree.has(ppid) && !tree.has(pid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  let jiffies = 0;
  for (const pid of tree) {
    const stat = stats.get(pid);
    if (stat) jiffies += stat.utime + stat.stime;
  }
  return { jiffies, processes: tree.size };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH to run the perf baseline');
  const profile = await mkdtemp(join(tmpdir(), 'vibe-perf-baseline-'));
  const port = await freePort();
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    '--enable-precise-memory-info',
    '--hide-scrollbars',
    '--window-size=1440,900',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
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
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, {
        method: 'PUT',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }, 'baseline tab');
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await retry(async () => {
      const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
      if (!ready) throw new Error('application is not ready');
    }, 'application startup');

    await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
      musicVolume: 0,
      ambienceVolume: 0,
      voicesVolume: 0,
      musicOn: false,
      cafeIndex: 0,
      qualityMode: 'auto',
      laptopOn: true,
      envTime: 'auto',
      envSky: 'auto'
    })); location.reload()`);
    await retry(async () => {
      const ready = await client.evaluate(`document.readyState === 'complete'
        && performance.getEntriesByType('navigation')[0]?.type === 'reload'
        && window.__vibe?.metrics().qualityMode === 'auto'`);
      if (!ready) throw new Error('configured application is not ready');
    }, 'configured application startup');
    await client.evaluate("document.querySelector('#enter-btn').click()");

    async function settleTheme(index) {
      await client.evaluate(`document.querySelectorAll('.loc-btn')[${index}].click()`);
      await delay(150);
      await retry(async () => {
        const theme = await client.evaluate('window.__vibe.metrics().theme');
        if (theme !== THEMES[index]) throw new Error('scene is still loading');
      }, THEMES[index]);
      const settledFrames = await client.evaluate('window.__vibe.metrics().renderedFrames');
      await retry(async () => {
        const frames = await client.evaluate('window.__vibe.metrics().renderedFrames');
        if (frames < settledFrames + 3) throw new Error('new scene has not rendered yet');
      }, `${THEMES[index]} fresh frames`);
      // A cold dev-server cache can leave models and audio still streaming in
      // when the theme flag flips; sampling then records an empty renderer
      // (calls=0) and zero decoded audio. Wait for real draw calls and for the
      // decoded-audio pool to stop growing before reading the metrics.
      await retry(async () => {
        const m = await client.evaluate(
          'JSON.stringify({calls: window.__vibe.metrics().calls, audio: window.__vibe.metrics().decodedAudioBytes})',
        );
        const { calls, audio } = JSON.parse(m);
        if (calls < 50) throw new Error(`scene not rendering yet (calls=${calls})`);
        if (audio <= 0) throw new Error('audio still decoding');
      }, `${THEMES[index]} assets resident`);
      let lastAudio = -1;
      await retry(async () => {
        const audio = await client.evaluate('window.__vibe.metrics().decodedAudioBytes');
        if (audio !== lastAudio) {
          lastAudio = audio;
          throw new Error('decoded audio still growing');
        }
      }, `${THEMES[index]} audio settled`);
      await delay(1000);
      await client.send('HeapProfiler.collectGarbage');
      await delay(250);
      return client.evaluate('window.__vibe.metrics()');
    }

    const perCafe = {};
    for (let index = 0; index < THEMES.length; index += 1) {
      const metrics = await settleTheme(index);
      perCafe[THEMES[index]] = {
        heapMB: metrics.heapBytes ? Number((metrics.heapBytes / 1_000_000).toFixed(2)) : null,
        decodedAudioMB: Number((metrics.decodedAudioBytes / 1_000_000).toFixed(2)),
        calls: metrics.calls,
        triangles: metrics.triangles,
        geometries: metrics.geometries,
        textures: metrics.textures,
        activeGeometries: metrics.activeGeometries,
        activeTextures: metrics.activeTextures,
        instancedMeshes: metrics.instancedMeshes,
        instancedInstances: metrics.instancedInstances,
        steamEmitters: metrics.steamEmitters,
        indoorPatrons: metrics.indoorPatrons,
        outsidePedestrians: metrics.outsidePedestrians,
        pixelRatio: metrics.pixelRatio,
        effects: metrics.effects,
      };
      console.error(`${THEMES[index]}: calls=${metrics.calls} triangles=${metrics.triangles} `
        + `geometries=${metrics.geometries} textures=${metrics.textures}`);
    }

    // CPU sample: Golden Hour, Auto quality, ambient (no interaction).
    await settleTheme(0);
    await delay(5000); // leave adaptive quality time to settle before sampling
    const cpuStart = await sampleProcessTree(chrome.pid);
    const startedAt = Date.now();
    const metricsBefore = await client.evaluate('window.__vibe.metrics()');
    await delay(CPU_SECONDS * 1000);
    const cpuEnd = await sampleProcessTree(chrome.pid);
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const metricsAfter = await client.evaluate('window.__vibe.metrics()');
    const clockTicks = 100; // Linux CLK_TCK
    const framesRendered = metricsAfter.renderedFrames - metricsBefore.renderedFrames;
    const cpu = cpuStart && cpuEnd
      ? {
        seconds: Number(elapsedSeconds.toFixed(1)),
        processTreeSize: cpuEnd.processes,
        cpuSeconds: Number(((cpuEnd.jiffies - cpuStart.jiffies) / clockTicks).toFixed(1)),
        combinedCpuPercent: Number((((cpuEnd.jiffies - cpuStart.jiffies) / clockTicks) / elapsedSeconds * 100).toFixed(1)),
        // On machines whose renderer is saturated (software GL), CPU percent
        // pegs while throughput absorbs scene cost. Per-frame CPU seconds stay
        // meaningful in both regimes, so regressions gate on this too.
        framesRendered,
        cpuSecondsPerFrame: framesRendered > 0
          ? Number((((cpuEnd.jiffies - cpuStart.jiffies) / clockTicks) / framesRendered).toFixed(3))
          : null,
      }
      : null;

    const report = {
      capturedAt: new Date().toISOString(),
      url: APP_URL,
      viewport: '1440x900@1x',
      qualityMode: 'auto',
      cpuSample: {
        theme: 'goldenhour',
        ambient: true,
        observedFpsBefore: metricsBefore.observedFps,
        observedFpsAfter: metricsAfter.observedFps,
        targetFps: metricsAfter.targetFps,
        ...cpu,
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
    // Chrome can still be flushing profile files as it exits; a leaked temp
    // profile is not worth failing the whole baseline over.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
  }
}
