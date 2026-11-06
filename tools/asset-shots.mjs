// Hero-asset close-ups rendered through the live application path
// (`__vibe.captureFrame`, post-processing included). The capture camera is
// detached from the first-person rig so props can be framed at close range.
//
//   npm run dev &
//   node tools/asset-shots.mjs --venue=goldenhour --out=.asset-shots/after
//
// Requires a dev server (VIBE_URL or http://127.0.0.1:5173) and CHROME_PATH.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?visual-audit=1';
const THEME_INDEX = { goldenhour: 0, roastery: 1, midnight: 2, terrace: 3 };
const args = new Map(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const VENUE = args.get('venue') ?? 'goldenhour';
const OUT_DIR = args.get('out') ?? `.asset-shots/${VENUE}`;
const ONLY = args.get('only')?.split(',');
const WIDTH = Number(args.get('width') ?? 1280), HEIGHT = Number(args.get('height') ?? 720);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function retry(task, label, attempts = 600) {
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
        if (entry.type === 'error' || (entry.type === 'warning' && text.includes('[models]'))) this.errors.push(text);
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
const profile = await mkdtemp(join(tmpdir(), 'vibe-asset-shots-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--disable-gpu-sandbox', '--hide-scrollbars', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', `--window-size=${WIDTH},${HEIGHT}`, `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
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
  await client.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await retry(async () => {
    if (!await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)')) throw new Error('app');
  }, 'app');
  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false,
    cafeIndex: ${THEME_INDEX[VENUE]}, qualityMode: 'high', laptopOn: true, envTime: 'auto', envSky: 'auto'
  }))`);
  await client.evaluate('location.reload()');
  await retry(async () => {
    if (!await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)')) throw new Error('app');
  }, 'app reload');
  await client.evaluate("document.querySelector('#enter-btn').click()");
  await retry(async () => {
    const theme = await client.evaluate('window.__vibe.metrics().theme');
    if (theme !== VENUE) throw new Error(`theme is ${theme}`);
  }, VENUE);
  await retry(async () => {
    const { c, f } = JSON.parse(await client.evaluate('JSON.stringify({c: __vibe.metrics().calls, f: __vibe.metrics().renderedFrames})'));
    if (c < 50 || f < 3) throw new Error('scene not rendering yet');
  }, 'scene resident');
  await client.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = '#hud-top, #hud-bottom, #hint, #toast, #overlay { display:none !important; }';
    document.head.appendChild(style);
    window.captureTime = 0;
    window.advanceScene = (steps) => {
      for (let i = 0; i < steps; i++) {
        captureTime += 1 / 30;
        __vibe.cafe.animate(1 / 30); __vibe.crowd.update(1 / 30, captureTime);
        if (window.captureCamera) __vibe.pets?.update?.(1 / 30, __vibe.crowd, captureCamera.position);
      }
    };
    __vibe.cafe.group.parent.traverse((o) => {
      if (!o.isMesh) return;
      const original = o.onBeforeRender;
      o.onBeforeRender = function (renderer, scene, camera, ...rest) {
        if (camera.isPerspectiveCamera && !window.captureCamera) window.captureCamera = camera;
        this.onBeforeRender = original; original.call(this, renderer, scene, camera, ...rest);
      };
    });
  })()`);
  await retry(async () => { if (!await client.evaluate('Boolean(window.captureCamera)')) throw new Error('camera'); }, 'camera');
  // seat the crowd and let the pets settle before freezing the loop
  await client.evaluate('advanceScene(900)');
  await client.evaluate('window.requestAnimationFrame = () => 0');
  await delay(1500);

  async function shot(name, pos, lookAt, fov = 50) {
    if (ONLY && !ONLY.includes(name)) return;
    const data = await client.evaluate(`(() => {
      const cam = captureCamera;
      cam.fov = ${fov}; cam.aspect = ${WIDTH / HEIGHT}; cam.updateProjectionMatrix();
      cam.position.set(${pos.join(',')}); cam.lookAt(${lookAt.join(',')}); cam.updateMatrixWorld(true);
      __vibe.captureFrame(1);
      return __vibe.captureFrame(1).split(',')[1];
    })()`);
    await writeFile(join(OUT_DIR, `${VENUE}-${name}.png`), Buffer.from(data, 'base64'));
    console.log(`captured ${VENUE}-${name}`);
  }

  const counterZ = -13.5 / 2 + 1.15;
  await shot('espresso', [-1.45, 1.62, counterZ + 1.05], [-2.2, 1.3, counterZ], 45);
  await shot('counter', [1.6, 1.75, counterZ + 3.2], [-1.6, 1.0, counterZ], 55);
  await shot('countertop', [0.9, 1.5, counterZ + 1.0], [0.1, 1.06, counterZ - 0.05], 50);
  const subjects = JSON.parse(await client.evaluate(`JSON.stringify((() => {
    const out = {};
    const npc = __vibe.crowd.npcs.find((n) => n.state === 'sitting' && !__vibe.cafe.seats[n.seatIndex]?.isBar);
    if (npc) out.npc = { x: npc.mesh.position.x, y: npc.mesh.position.y, z: npc.mesh.position.z, yaw: npc.mesh.rotation.y };
    const seat = __vibe.cafe.seats.find((s) => !s.isBar && !s.level) ?? __vibe.cafe.seats[0];
    out.table = { x: seat.tableCenter.x, z: seat.tableCenter.z, y: seat.tableTopY, sx: seat.pos.x, sz: seat.pos.z };
    const barista = __vibe.crowd.barista?.mesh;
    if (barista) out.barista = { x: barista.position.x, y: barista.position.y, z: barista.position.z };
    const pet = (__vibe.pets?.pets ?? __vibe.pets?.actors ?? [])[0];
    const petMesh = pet?.mesh ?? pet?.root ?? pet?.object;
    if (petMesh) { const p = petMesh.getWorldPosition(petMesh.position.clone()); out.pet = { x: p.x, y: p.y, z: p.z }; }
    return out;
  })())`));
  if (subjects.npc) {
    const { x, y, z, yaw } = subjects.npc;
    await shot('patron', [x + Math.sin(yaw) * 1.6 + Math.cos(yaw) * 0.9, y + 1.35, z + Math.cos(yaw) * 1.6 - Math.sin(yaw) * 0.9], [x, y + 0.85, z], 45);
  }
  {
    const { x, z, y, sx, sz } = subjects.table;
    const dx = x - sx, dz = z - sz, len = Math.hypot(dx, dz) || 1;
    await shot('table', [x + (dx / len) * 1.25 + (dz / len) * 0.6, y + 0.55, z + (dz / len) * 1.25 - (dx / len) * 0.6], [x, y, z], 45);
    await shot('furniture', [x + (dz / len) * 2.6, 1.55, z - (dx / len) * 2.6], [x, 0.55, z], 50);
  }
  if (subjects.barista) {
    const { x, y, z } = subjects.barista;
    await shot('barista', [x + 0.9, y + 1.75, z + 2.3], [x, y + 1.2, z], 45);
  }
  if (subjects.pet) {
    const { x, y, z } = subjects.pet;
    await shot('pet', [x + 0.9, y + 0.65, z + 0.9], [x, y + 0.2, z], 45);
  }
  await writeFile(join(OUT_DIR, `${VENUE}-report.json`), JSON.stringify({
    venue: VENUE, subjects, metrics: await client.evaluate('__vibe.metrics()'), errors: client.errors,
  }, null, 2) + '\n');
  if (client.errors.length) throw new Error(`Browser errors: ${client.errors.join('\n')}`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await delay(2000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
