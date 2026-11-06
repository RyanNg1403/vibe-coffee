// Captures a fixed set of camera views for every café so rendering changes can
// be compared before/after on the same machine.
//
//   npm run dev &
//   node tools/render-shots.mjs --out=.render-shots --quality=medium
//   VIBE_URL=http://127.0.0.1:5174/ node tools/render-shots.mjs --legacy-mode=detail
//
// --quality selects a rendering tier through the `?quality=` URL override.
// --legacy-mode writes the pre-tier preference value (auto/detail/smooth) for
// builds that predate quality tiers. --views and --themes take comma lists.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getBlueprint } from '../src/cafe/interiorLayouts.js';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const args = new Map(process.argv.slice(2)
  .filter((arg) => arg.startsWith('--'))
  .map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.length ? value.join('=') : true];
  }));
const BASE_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/';
const QUALITY = args.get('quality') ?? null;
const LEGACY_MODE = args.get('legacy-mode') ?? null;
const OUTPUT_DIR = resolve(args.get('out') ?? '.render-shots');
const PREFIX = args.get('prefix') ?? '';
const WIDTH = Number(args.get('width') ?? 1440);
const HEIGHT = Number(args.get('height') ?? 900);
const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];
const themeFilter = args.get('themes')?.split(',') ?? THEMES;
const ENV_TIME = args.get('time') ?? 'auto';
const ENV_SKY = args.get('sky') ?? 'auto';
const VIEW_NAMES = ['seat', 'entrance', 'window', 'service'];
const viewFilter = args.get('views')?.split(',') ?? VIEW_NAMES;

// Authored audit views from each venue blueprint; `place` takes yaw/pitch.
function blueprintView(theme, name) {
  const views = getBlueprint(theme).auditViews;
  const view = name === 'entrance' ? views[0]
    : name === 'window' ? (views.find((v) => v.id.includes('window')) ?? views.find((v) => v.id.includes('pergola')))
      : views.find((v) => v.id.includes('service-queue'));
  const eyeY = 1.55;
  const dx = view.lookAt[0] - view.pos[0];
  const dz = view.lookAt[2] - view.pos[2];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(view.lookAt[1] - eyeY, Math.hypot(dx, dz) || 1);
  return `window.__vibe.place(${view.pos[0]}, ${view.pos[2]}, ${yaw}, ${pitch})`;
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE ?? 1) || 1);

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function retry(task, label, attempts = 300) {
  let error;
  for (let attempt = 0; attempt < attempts * RETRY_SCALE; attempt += 1) {
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
    await new Promise((done, reject) => {
      this.socket.addEventListener('open', done, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        console.error('[page exception]', details.exception?.description ?? details.text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        console.error(`[page ${message.params.type}]`, message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 2000),
          process.env.VIBE_STACKS ? (message.params.stackTrace?.callFrames ?? []).slice(0, 8).map((f) => `${f.functionName}@${f.url.split('/').pop()}:${f.lineNumber}`).join(' < ') : '');
      }
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      this.pending.set(id, { resolve: done, reject });
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

if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH');
await mkdir(OUTPUT_DIR, { recursive: true });
const url = new URL(BASE_URL);
url.searchParams.set('visual-audit', '1');
if (QUALITY) url.searchParams.set('quality', QUALITY);
const profile = await mkdtemp(join(tmpdir(), 'vibe-render-shots-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--hide-scrollbars',
  `--window-size=${WIDTH},${HEIGHT}`,
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise((done) => chrome.once('exit', done));

let client;
const report = { url: url.href, quality: QUALITY, legacyMode: LEGACY_MODE, shots: [] };
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, 'Chrome DevTools');
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url.href)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'tab');
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  });
  await retry(async () => {
    if (!await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)')) throw new Error('not ready');
  }, 'application startup');
  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false, muted: true,
    cafeIndex: ${THEMES.indexOf(themeFilter[0])}, laptopOn: true,
    envTime: ${JSON.stringify(ENV_TIME)}, envSky: ${JSON.stringify(ENV_SKY)},
    ${LEGACY_MODE ? `qualityMode: ${JSON.stringify(LEGACY_MODE)},` : ''}
  })); location.reload()`);
  await retry(async () => {
    const ready = await client.evaluate(`document.readyState === 'complete'
      && performance.getEntriesByType('navigation')[0]?.type === 'reload'
      && Boolean(window.__vibe?.cafe)`);
    if (!ready) throw new Error('not ready');
  }, 'configured startup');
  await client.evaluate(`document.querySelector('#enter-btn').click();
    ['#hud-top', '#hud-bottom', '#hint', '#toast'].forEach((selector) => {
      const element = document.querySelector(selector);
      if (element) element.style.display = 'none';
    });`);

  async function waitFrames(count) {
    const start = await client.evaluate('window.__vibe.metrics().renderedFrames');
    await retry(async () => {
      const frames = await client.evaluate('window.__vibe.metrics().renderedFrames');
      if (frames < start + count) throw new Error('waiting for frames');
    }, 'fresh frames', 900);
  }

  for (const theme of themeFilter) {
    const index = THEMES.indexOf(theme);
    await client.evaluate(`document.querySelectorAll('.loc-btn:not(#variant-btn)')[${index}].click()`);
    await delay(200);
    await retry(async () => {
      const ready = await client.evaluate(`Boolean(window.__vibe.cafe?.seats?.length)
        && window.__vibe.metrics().theme === '${theme}'`);
      if (!ready) throw new Error('loading');
    }, theme, 900);
    // Environment maps and probes settle asynchronously after a switch.
    await waitFrames(4);
    await delay(1500);
    if (args.get('eval')) console.log('eval:', JSON.stringify(await client.evaluate(args.get('eval'))));
    for (const view of viewFilter) {
      if (view === 'seat') {
        const seats = await client.evaluate('window.__vibe.cafe.seats.length');
        await client.evaluate(`window.__vibe.sit(${Math.floor(seats / 2)})`);
      } else {
        await client.evaluate(blueprintView(theme, view));
      }
      await waitFrames(3);
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = `${PREFIX}${theme}-${view}.png`;
      await writeFile(join(OUTPUT_DIR, file), Buffer.from(data, 'base64'));
      const metrics = await client.evaluate('window.__vibe.metrics()');
      report.shots.push({
        file, theme, view,
        calls: metrics.calls, triangles: metrics.triangles,
        lastRenderMs: metrics.lastRenderMs, rendering: metrics.rendering ?? null,
      });
      console.log(`${file}  calls=${metrics.calls} renderMs=${metrics.lastRenderMs}`);
    }
  }
  await writeFile(join(OUTPUT_DIR, `${PREFIX}shots.json`), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(3000)]);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
