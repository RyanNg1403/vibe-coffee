// Records the physics & realism layer in the real app: a table bump (Rapier
// prop rattle), the hinged door swinging into the player with the gust
// swaying the hanging plants, a walk past patrons (gait, look-at, avoidance)
// and the terrace pendants in the breeze. Chrome's virtual time advances the
// app in exact 1/30 s steps, so software-GL machines still produce a smooth
// real-time video.
//
//   npm run dev &
//   node tools/physics-demo.mjs [--out=.physics-demo] [--scenes=bump,door,walk]
//   node tools/physics-demo.mjs --venue=terrace --scenes=terrace
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
const BASE_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/';
const args = new Map(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const OUT_DIR = args.get('out') ?? '.physics-demo';
const SCENES = String(args.get('scenes') ?? 'bump,door,walk').split(',');
const THEME_INDEX = { goldenhour: 0, roastery: 1, midnight: 2, terrace: 3 };
const VENUE = args.get('venue') ?? 'goldenhour';
if (!(VENUE in THEME_INDEX)) throw new Error(`Unknown venue: ${VENUE}`);
const WIDTH = 960;
const HEIGHT = 540;
const FPS = 30;
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
  constructor(url) {
    this.nextId = 1; this.pending = new Map(); this.errors = []; this.listeners = new Map();
    this.socket = new WebSocket(url);
  }
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
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.errors.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  once(method) {
    return new Promise((resolve) => {
      const list = this.listeners.get(method) ?? [];
      const listener = (params) => { list.splice(list.indexOf(listener), 1); resolve(params); };
      list.push(listener);
      this.listeners.set(method, list);
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
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vibe-physics-demo-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${WIDTH},${HEIGHT}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let client;
const summary = { scenes: {}, frames: 0 };
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, 'chrome');
  const url = `${BASE_URL}?visual-audit=1&physics=full`;
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'tab');
  client = new Cdp(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const appReady = () => retry(async () => {
    if (!(await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)'))) throw new Error('loading');
  }, 'app');
  await appReady();
  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false,
    cafeIndex: ${THEME_INDEX[VENUE]}, qualityMode: 'auto', laptopOn: false, envTime: 'auto', envSky: 'auto'
  }))`);
  await client.evaluate('location.reload()');
  await appReady();
  await client.evaluate("document.querySelector('#enter-btn').click()");

  async function waitForVenue(id) {
    await retry(async () => {
      const m = await client.evaluate('JSON.stringify(window.__vibe.metrics())');
      const metrics = JSON.parse(m);
      if (metrics.theme !== id || metrics.calls < 50 || metrics.renderedFrames < 3) throw new Error('not resident');
    }, id);
  }
  await waitForVenue(VENUE);

  let virtual = true;
  async function advance(ms) {
    if (!virtual) { await delay(ms); return; }
    const expired = client.once('Emulation.virtualTimeBudgetExpired');
    await client.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms, maxVirtualTimeTaskStarvationCount: 200 });
    const timedOut = await Promise.race([expired.then(() => false), delay(20000).then(() => true)]);
    if (timedOut) {
      console.warn('virtual time stalled; continuing in real time');
      virtual = false;
    }
  }
  async function pauseTime() {
    if (virtual) await client.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  }
  async function key(code, down) {
    const k = code.replace('Key', '').toLowerCase();
    await client.send('Input.dispatchKeyEvent', {
      type: down ? 'keyDown' : 'keyUp', code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
    });
  }

  let sceneDir;
  let frame = 0;
  async function capture() {
    const data = await client.evaluate("window.__vibe.captureFrame(1, 'image/jpeg')");
    const name = String(frame++).padStart(4, '0');
    await writeFile(join(sceneDir, `${name}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
  async function record(seconds, during = null) {
    const frames = Math.round(seconds * FPS);
    for (let i = 0; i < frames; i += 1) {
      if (during) await during(i / FPS);
      await advance(1000 / FPS);
      await capture();
    }
  }
  async function beginScene(name) {
    sceneDir = join(OUT_DIR, name);
    frame = 0;
    await mkdir(sceneDir, { recursive: true });
    console.log(`scene ${name}`);
  }
  async function finishScene(name, extra = {}) {
    const metrics = await client.evaluate('JSON.parse(JSON.stringify(window.__vibe.metrics()))');
    summary.scenes[name] = { frames: frame, ...extra, metrics };
    summary.frames += frame;
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(sceneDir, '%04d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(OUT_DIR, `${name}.mp4`)]);
  }

  // let Rapier load in real time before the virtual clock takes over
  await client.evaluate('window.__vibe.place(0, 2, 0); window.__vibe.realism.props.warm()');
  await retry(async () => {
    const state = await client.evaluate('window.__vibe.metrics().physicsWorker');
    if (state !== 'ready' && state !== 'failed' && state !== 'off') throw new Error(state);
  }, 'physics worker');
  summary.worker = await client.evaluate('window.__vibe.metrics().physicsWorker');
  await pauseTime();

  if (SCENES.includes('bump')) {
    await beginScene('bump');
    // the ground-floor table with the most loose props and a clear approach
    const plan = await client.evaluate(`(() => {
      const v = window.__vibe, r = v.realism;
      let best = null;
      for (const t of r.tables) {
        if (t.levelId !== 'ground' || t.shape !== 'cylinder' && Math.max(t.hx, t.hz) > 0.6) continue;
        const props = r._tableObjects(t).length;
        if (props < 2) continue;
        const seatIndices = t.seats.map(s => v.cafe.seats.indexOf(s));
        const occupied = seatIndices.some(i => v.crowd.isSeatTaken(i));
        // approach between the chairs: the bearing furthest from every seat
        const seatAngles = t.seats.map(s => Math.atan2(s.pos.x - t.x, s.pos.z - t.z));
        let bearing = 0, clearance = -1;
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          const gap = Math.min(...seatAngles.map(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))));
          if (gap > clearance) { clearance = gap; bearing = a; }
        }
        const reach = (t.shape === 'cylinder' ? t.radius : Math.max(t.hx, t.hz)) + 1.35;
        const x = t.x + Math.sin(bearing) * reach, z = t.z + Math.cos(bearing) * reach;
        v.place(x, z, 0);
        const p = v.player();
        if (Math.hypot(p.x - x, p.z - z) > 0.05) continue;
        const score = props + clearance - (occupied ? 3 : 0);
        if (!best || score > best.score) best = { score, x, z, tx: t.x, tz: t.z, y: t.y, props, key: t.key, occupied };
      }
      return best;
    })()`);
    if (!plan) throw new Error('no table with props found');
    const yaw = Math.atan2(-(plan.tx - plan.x), -(plan.tz - plan.z));
    const distance = Math.hypot(plan.tx - plan.x, plan.tz - plan.z);
    const pitch = Math.atan2(plan.y - 1.62, distance - 0.2);
    await client.evaluate(`window.__vibe.place(${plan.x}, ${plan.z}, ${yaw}, ${pitch})`);
    const before = await client.evaluate(`window.__vibe.realism._tableObjects(window.__vibe.realism.tables.find(t => t.key === ${JSON.stringify(plan.key)})).map(o => [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.z])`);
    await record(0.6);
    await key('KeyW', true);
    await record(1.0);
    await key('KeyW', false);
    await record(2.4);
    const after = await client.evaluate(`window.__vibe.realism._tableObjects(window.__vibe.realism.tables.find(t => t.key === ${JSON.stringify(plan.key)})).map(o => [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.z])`);
    const moved = before.map((b, i) => Math.hypot(after[i][0] - b[0], after[i][2] - b[2]));
    await finishScene('bump', { table: plan, propDisplacementMetres: moved, propHeightsAfter: after.map((a) => a[1]) });
  }

  if (SCENES.includes('door')) {
    await beginScene('door');
    // stand just inside the entrance, within the leaf's inward swing
    const D = 13.5;
    // an unseen visitor uses the real door coordinator, exactly like a patron
    const open = `(() => { const d = window.__vibe.crowd.doorFlow; window.__demoVisitor ??= { kind: 'demo' };
      d.join(window.__demoVisitor, 'in'); d.request(window.__demoVisitor, 'in'); })()`;
    const close = 'window.__vibe.crowd.doorFlow.release(window.__demoVisitor)';
    await client.evaluate(`window.__vibe.place(0.35, ${D / 2 - 2.6}, Math.PI, 0.2)`);
    await record(0.4);
    await record(1.1, async () => client.evaluate(open));
    await client.evaluate(close);
    await record(1.6);
    // now stand inside the leaf's inward swing: it strikes, bounces, shoves
    await client.evaluate(`window.__vibe.place(0.15, ${D / 2 - 0.6}, Math.PI * 0.78, 0.0)`);
    await record(0.3);
    const angles = [];
    await record(1.0, async () => {
      await client.evaluate(open);
      angles.push(await client.evaluate('window.__vibe.metrics().doorAngle'));
    });
    await client.evaluate(close);
    await record(1.2);
    const player = await client.evaluate('window.__vibe.player()');
    await finishScene('door', { playerAfterDoorHit: player, doorAngleWhileBlocked: angles });
  }

  if (SCENES.includes('walk')) {
    await beginScene('walk');
    await client.evaluate('window.__vibe.place(0.2, 3.6, 0, -0.05)');
    await record(0.4);
    await key('KeyW', true);
    let yaw = 0;
    await record(3.2, async (t) => {
      if (t > 1.4 && t < 2.6) {
        yaw += 0.018;
        await client.evaluate(`window.__vibe.face(${yaw}, -0.05)`);
      }
    });
    await key('KeyW', false);
    await record(1.0);
    await finishScene('walk');
  }

  if (SCENES.includes('terrace')) {
    await beginScene('terrace');
    const view = await client.evaluate(`(() => {
      const items = [];
      window.__vibe.cafe.group.traverse(o => { if (o.userData.secondaryMotion) items.push(o.userData.secondaryMotion.anchor); });
      return items;
    })()`);
    const anchor = view[0] ?? [0, 3.6, 0];
    await client.evaluate(`window.__vibe.place(${anchor[0] + 0.3}, ${anchor[2] + 2.6}, 0.12, 0.42)`);
    await record(4.0);
    await finishScene('terrace', { swayFixtures: view.length });
  }

  summary.errors = client.errors;
  await writeFile(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const files = SCENES.map((name) => resolve(OUT_DIR, `${name}.mp4`)).filter(existsSync);
  await writeFile(join(OUT_DIR, 'concat.txt'), files.map((f) => `file '${f}'`).join('\n'));
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(OUT_DIR, 'concat.txt'),
    '-c', 'copy', join(OUT_DIR, `physics-demo-${VENUE}.mp4`)]);
  console.log(JSON.stringify({ worker: summary.worker, frames: summary.frames, errors: client.errors.length }, null, 2));
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await delay(2000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
