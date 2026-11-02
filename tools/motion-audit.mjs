// Measure 180 seconds of real crowd simulation at 30 Hz, including doorway,
// service and seating transitions. Uses the memory-audit URL to disable the
// automatic simulation loop, then advances the scene and crowd together.
// CHROME_PATH=/path/to/chrome node tools/motion-audit.mjs --venue=goldenhour
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?memory-audit=1';
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE) || 1);
const THEME_INDEX = { goldenhour: 0, roastery: 1, midnight: 2, terrace: 3 };

const args = new Map(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const VENUE = args.get('venue') ?? 'goldenhour';
const OUT_DIR = args.get('out') ?? `.motion-audit/${VENUE}`;
if (!(VENUE in THEME_INDEX)) throw new Error(`Unknown venue: ${VENUE}`);

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
  constructor(url) { this.nextId = 1; this.pending = new Map(); this.errors = []; this.socket = new WebSocket(url); }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        this.errors.push(details.exception?.description ?? details.text);
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const entry = message.params;
        const text = entry.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (entry.type === 'error' || (entry.type === 'warning' && text.includes('[models]'))) {
          this.errors.push(text);
        }
      }
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
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
  close() { this.socket.close(); }
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

  const report = await client.evaluate(`(() => {
    const c = window.__vibe.crowd;
    const step = 1 / 30;
    const max = { walkStep: 0, baristaTurn: 0, waiterStep: 0, seatedTurn: 0, seatStep: 0, seatTurn: 0, renderRestoreError: 0 };
    const states = new Set();
    let interpolatedFrames = 0;
    let baristaTurns = 0;
    const prior = new WeakMap();
    const worst = [];
    for (let tick = 0; tick < 5400; tick++) {
      const actors = [...c.npcs, c.barista, c.waiter, c.performer].filter(Boolean);
      for (const actor of actors) prior.set(actor, {
        x: actor.mesh.position.x, z: actor.mesh.position.z,
        yaw: actor.mesh.rotation.y, state: actor.state,
        parent: actor.mesh.parent, path: !!actor.path,
      });
      window.__vibe.cafe.animate(step);
      c.update(step, tick * step);
      for (const actor of actors) {
        const prev = prior.get(actor);
        if (actor.mesh.parent !== prev.parent) continue;
        const p = actor.mesh.position;
        const distance = Math.hypot(p.x - prev.x, p.z - prev.z);
        const turn = Math.abs(Math.atan2(Math.sin(actor.mesh.rotation.y - prev.yaw), Math.cos(actor.mesh.rotation.y - prev.yaw)));
        if (actor === c.barista) { max.baristaTurn = Math.max(max.baristaTurn, turn); if (turn > 0.001) baristaTurns++; }
        if (actor === c.waiter) max.waiterStep = Math.max(max.waiterStep, distance);
        if (prev.state === 'sitting' && actor.state === 'sitting') max.seatedTurn = Math.max(max.seatedTurn, turn);
        if (prev.state === 'aligningSeat' || prev.state === 'standingSeat') {
          max.seatStep = Math.max(max.seatStep, distance);
          max.seatTurn = Math.max(max.seatTurn, turn);
        }
        if (prev.path && actor.state !== 'transferred' && actor !== c.waiter && actor !== c.performer) {
          max.walkStep = Math.max(max.walkStep, distance);
          if (distance > 0.06 && worst.length < 10) worst.push({ state: prev.state, after: actor.state, distance });
        }
        if (actor.state) states.add(actor.state);
      }
      if (tick % 30 === 0) {
        const roots = [];
        c._eachMovingRoot(root => roots.push({root, pos: root.position.clone(), q: root.quaternion.clone()}));
        c.interpolate(0.5);
        for (const {root, pos} of roots) if (root.position.distanceTo(pos) > 0.0001) interpolatedFrames++;
        c.restoreSimulationPose();
        for (const {root, pos, q} of roots) max.renderRestoreError = Math.max(max.renderRestoreError, root.position.distanceTo(pos), root.quaternion.angleTo(q));
      }
    }
    return { seconds: 180, max, interpolatedFrames, baristaTurns, states: [...states], worst, dwell: c.dwellReport() };
  })()`);
  console.log(JSON.stringify({ venue: VENUE, max: report.max, states: report.states }, null, 2));
  const { writeFile: writeReport } = await import('node:fs/promises');
  await writeReport(join(OUT_DIR, 'motion-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.max.walkStep > 0.06 || report.max.baristaTurn > 4.2 / 30 + 1e-8
    || report.max.renderRestoreError > 1e-6 || report.interpolatedFrames < 100
    || report.max.seatedTurn > 2.4 / 30 + 1e-8 || report.max.waiterStep > 0.03
    || report.max.seatStep > 1.2 / 30 + 1e-8 || report.max.seatTurn > 3.2 / 30 + 1e-8) {
    throw new Error('Movement audit failed');
  }
  await capture('motion-scene');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(OUT_DIR, 'runtime-report.json'), JSON.stringify({
    venue: VENUE, metrics: await client.evaluate('window.__vibe.metrics()'), errors: client.errors,
  }, null, 2) + '\n');
  if (client.errors.length) throw new Error(`Browser errors: ${client.errors.join('\n')}`);
  console.log(`done: ${OUT_DIR} (no runtime, shader or model-loading errors)`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await delay(3000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
