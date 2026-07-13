// Room-corner capture pass (CAFE_INTERIOR_REBUILD_PLAN §12: "all four room
// corners" per venue). Places the player in each corner of every room in the
// venue blueprint, looking at the room center, and captures a frame.
//
//   node tools/corner-shots.mjs --venue=goldenhour [--out=DIR]
//     [--time=auto|morning|noon|sunset|night] [--sky=auto|clear|rain]
//
// Requires a dev server (VIBE_URL or http://127.0.0.1:5173) and CHROME_PATH.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBlueprint } from '../src/cafe/interiorLayouts.js';

const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?visual-audit=1';
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE) || 1);
const THEME_INDEX = { goldenhour: 0, roastery: 1, midnight: 2, terrace: 3 };

const args = new Map(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const VENUE = args.get('venue') ?? 'goldenhour';
const OUT_DIR = args.get('out') ?? `.venue-shots/${VENUE}-corners`;
const ENV_TIME = args.get('time') ?? 'auto';
const ENV_SKY = args.get('sky') ?? 'auto';
const EYE = 1.6;
const INSET = 0.85; // stand just off the walls, like a player would

const blueprint = getBlueprint(VENUE);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function retry(task, label, attempts = 300 * RETRY_SCALE) {
  let error;
  for (let i = 0; i < attempts; i += 1) {
    try { return await task(); } catch (cause) { error = cause; await delay(100); }
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: error });
}

class Cdp {
  constructor(url) { this.nextId = 1; this.pending = new Map(); this.socket = new WebSocket(url); }
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
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }
  close() { this.socket.close(); }
}

// Every room contributes its four corners; the camera looks across the room
// at seated-head height so furniture, walls, and ceiling edges all appear.
function cornerViews() {
  const views = [];
  for (const room of blueprint.rooms ?? []) {
    const { x0, x1, z0, z1 } = room.bounds;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const level = room.levelId && room.levelId !== 'ground' ? room.levelId : null;
    const corners = [
      ['nw', x0 + INSET, z0 + INSET], ['ne', x1 - INSET, z0 + INSET],
      ['sw', x0 + INSET, z1 - INSET], ['se', x1 - INSET, z1 - INSET],
    ];
    for (const [tag, x, z] of corners) {
      const dx = cx - x;
      const dz = cz - z;
      views.push({
        id: `${room.id}-corner-${tag}`,
        x, z, level,
        yaw: Math.atan2(-dx, -dz),
        pitch: Math.atan2(1.1 - EYE, Math.hypot(dx, dz) || 1),
      });
    }
  }
  return views;
}

if (!CHROME) throw new Error('set CHROME_PATH');
await mkdir(OUT_DIR, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vibe-corner-shots-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--disable-gpu-sandbox', '--hide-scrollbars',
  ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []),
  '--window-size=880,560', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let client;
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, 'chrome devtools');
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'tab');
  client = new Cdp(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 560, deviceScaleFactor: 1, mobile: false });
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('app not ready');
  }, 'app');
  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false,
    cafeIndex: ${THEME_INDEX[VENUE]}, qualityMode: 'auto', laptopOn: true, envTime: '${ENV_TIME}', envSky: '${ENV_SKY}'
  }))`);
  await client.evaluate('location.reload()');
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('app not ready after reload');
  }, 'app reload');
  await client.evaluate("document.querySelector('#enter-btn').click()");
  await client.evaluate(`for (const id of ['hud-top', 'hud-bottom', 'hint']) {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  }`);
  await retry(async () => {
    const theme = await client.evaluate('window.__vibe.metrics().theme');
    if (theme !== VENUE) throw new Error(`theme is ${theme}`);
  }, VENUE);
  await retry(async () => {
    const m = await client.evaluate('JSON.stringify({c: window.__vibe.metrics().calls, f: window.__vibe.metrics().renderedFrames})');
    const { c, f } = JSON.parse(m);
    if (c < 50 || f < 3) throw new Error('scene not rendering yet');
  }, 'scene resident');

  async function freshFrames(n = 2) {
    const start = await client.evaluate('window.__vibe.metrics().renderedFrames');
    await retry(async () => {
      const now = await client.evaluate('window.__vibe.metrics().renderedFrames');
      if (now < start + n) throw new Error('waiting for fresh frames');
    }, 'fresh frames');
  }

  for (const view of cornerViews()) {
    const level = view.level ? `'${view.level}'` : 'null';
    await client.evaluate(`window.__vibe.place(${view.x}, ${view.z}, ${view.yaw}, ${view.pitch}, ${level})`);
    await freshFrames(2);
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT_DIR, `${view.id}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`captured ${view.id}`);
  }
  console.log(`done: ${OUT_DIR}`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await delay(3000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
