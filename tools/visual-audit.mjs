import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?visual-audit=1';
const OUTPUT_DIR = resolve(process.env.VIBE_VISUAL_DIR ?? '.visual-audit');
const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function retry(task, label, attempts = 160) {
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
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
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
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
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

if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH to run the visual audit');
await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vibe-visual-audit-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-extensions',
  '--disable-gpu-sandbox',
  '--hide-scrollbars',
  '--window-size=1440,900',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise((resolveExit) => chrome.once('exit', resolveExit));

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
  }, 'visual audit tab');
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('application is not ready');
  }, 'application startup', 300);

  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0,
    ambienceVolume: 0,
    voicesVolume: 0,
    musicOn: false,
    cafeIndex: 0,
    variantOn: false,
    qualityMode: 'detail',
    laptopOn: true,
    envTime: 'auto',
    envSky: 'auto'
  })); location.reload()`);
  await retry(async () => {
    const ready = await client.evaluate(`document.readyState === 'complete'
      && performance.getEntriesByType('navigation')[0]?.type === 'reload'
      && Boolean(window.__vibe?.cafe)`);
    if (!ready) throw new Error('configured application is not ready');
  }, 'configured application startup', 300);
  await client.evaluate(`document.querySelector('#enter-btn').click();
    ['#hud-top', '#hud-bottom', '#hint', '#toast'].forEach((selector) => {
      const element = document.querySelector(selector);
      if (element) element.style.display = 'none';
    });`);

  const files = [];
  async function capture(name) {
    await delay(700);
    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const filename = `${name}.png`;
    await writeFile(join(OUTPUT_DIR, filename), Buffer.from(data, 'base64'));
    files.push(filename);
  }

  async function switchTo(index) {
    await client.evaluate(`document.querySelectorAll('.loc-btn:not(#variant-btn)')[${index}].click()`);
    // Clicking the already-active location still rebuilds it. Give teardown a
    // chance to begin so the previous scene cannot satisfy the readiness poll.
    await delay(150);
    await retry(async () => {
      const ready = await client.evaluate(`Boolean(window.__vibe.cafe?.seats?.length)
        && window.__vibe.metrics().theme === '${THEMES[index]}'
        && window.__vibe.metrics().calls > 0`);
      if (!ready) throw new Error('scene is still loading');
      return ready;
    }, THEMES[index], 300);
    await delay(1100);
  }

  for (let index = 0; index < THEMES.length; index += 1) {
    await switchTo(index);
    const seatCount = await retry(async () => {
      const count = await client.evaluate('window.__vibe.cafe?.seats?.length ?? 0');
      if (!count) throw new Error('seats are still loading');
      return count;
    }, `${THEMES[index]} seats`, 300);
    await client.evaluate(`window.__vibe.sit(${Math.floor(seatCount / 2)})`);
    await capture(`${THEMES[index]}-seat-middle`);
    await client.evaluate(`window.__vibe.sit(${seatCount - 1})`);
    await capture(`${THEMES[index]}-seat-last`);
    await client.evaluate('window.__vibe.place(0, 4.8, 0, 0.04)');
    await capture(`${THEMES[index]}-overview`);
    if (index < 3) {
      await client.evaluate('window.__vibe.place(4.4, 1.25, -Math.PI / 2, 0.22)');
      await capture(`${THEMES[index]}-right-wall`);
    }
  }

  await switchTo(2);
  await client.evaluate(`window.__vibe.crowd.npcs.forEach((npc) => { npc.mesh.visible = false; });
  window.__vibe.crowd.staticPatrons.forEach((patron) => { patron.model.visible = false; });
  window.__vibe.crowd.outside.walkers.forEach((walker, index) => {
    const stagedX = [-4.95, -3.55, 11, -2.25, 12, 13, 14, 15][index];
    walker.x = stagedX;
    walker.speed = 0;
    walker.mesh.position.x = walker.x;
  }); window.__vibe.place(-4.15, 5.65, Math.PI, 0.04)`);
  await delay(1800);
  await capture('midnight-rainy-street');
  const rainyMetrics = await client.evaluate('window.__vibe.metrics()');
  const passed = rainyMetrics.outsideUmbrellas > 0
    && rainyMetrics.outsideUmbrellas < rainyMetrics.outsidePedestrians
    && rainyMetrics.outsideUmbrellaGripError < 0.02;
  const manifest = { url: APP_URL, files, rainyMetrics, passed };
  await writeFile(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(5000)]);
  await rm(profile, { recursive: true, force: true });
}
