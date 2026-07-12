// Blueprint-driven venue capture (CAFE_INTERIOR_REBUILD_PLAN §12): renders
// every authored audit view for a venue plus a first-person capture from
// EVERY usable seat (laptop on), so close-range placement issues can be
// reviewed by a human instead of inferred from pass flags.
//
//   node tools/venue-shots.mjs --venue=goldenhour [--views-only] [--out=DIR]
//
// Requires a dev server (VIBE_URL or http://127.0.0.1:5173) and CHROME_PATH.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
const VIEWS_ONLY = !!args.get('views-only');
const OUT_DIR = args.get('out') ?? `.venue-shots/${VENUE}`;
const EYE_Y = 1.6;

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

function lookAngles(pos, lookAt) {
  const dx = lookAt[0] - pos[0];
  const dy = lookAt[1] - EYE_Y;
  const dz = lookAt[2] - pos[2];
  const len = Math.hypot(dx, dz) || 1;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, len) };
}

if (!CHROME) throw new Error('set CHROME_PATH');
await mkdir(OUT_DIR, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vibe-venue-shots-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--disable-gpu-sandbox', '--hide-scrollbars',
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
    cafeIndex: ${THEME_INDEX[VENUE]}, qualityMode: 'auto', laptopOn: true, envTime: 'auto', envSky: 'auto'
  }))`);
  await client.evaluate('location.reload()');
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('app not ready after reload');
  }, 'app reload');
  await client.evaluate("document.querySelector('#enter-btn').click()");
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

  async function capture(name) {
    await freshFrames(2);
    const { writeFile } = await import('node:fs/promises');
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`captured ${name}`);
  }

  for (const view of blueprint.auditViews) {
    const { yaw, pitch } = lookAngles(view.pos, view.lookAt);
    await client.evaluate(`window.__vibe.place(${view.pos[0]}, ${view.pos[2]}, ${yaw}, ${pitch})`);
    await capture(view.id);
  }

  if (!VIEWS_ONLY) {
    const seatCount = await client.evaluate('window.__vibe.cafe.seats.length');
    for (let i = 0; i < seatCount; i += 1) {
      const info = await client.evaluate(`JSON.stringify({
        id: window.__vibe.cafe.seats[${i}].id ?? 'seat-${i}',
        ok: window.__vibe.sit(${i}),
      })`);
      const { id, ok } = JSON.parse(info);
      if (!ok) { console.log(`skip seat ${i}`); continue; }
      await capture(`seat-${String(i).padStart(2, '0')}-${id}`);
    }
  }
  console.log(`done: ${OUT_DIR}`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await delay(3000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
