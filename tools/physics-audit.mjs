// Measures the physics & realism layer inside the real app. With the crowd
// simulation frozen (?memory-audit=1) it steps the café, crowd, pets and the
// realism system together at 30 Hz while the player stands in the main aisle,
// alternating minutes with and without the player as an avoidance agent. It
// reports close passes, patron glances, door cycles and the per-step cost.
//
//   npm run dev &
//   node tools/physics-audit.mjs [--venue=goldenhour] [--minutes=6]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?memory-audit=1';
const THEME_INDEX = { goldenhour: 0, roastery: 1, midnight: 2, terrace: 3 };
const args = new Map(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const VENUE = args.get('venue') ?? 'goldenhour';
const MINUTES = Number(args.get('minutes') ?? 6);
const OUT_DIR = args.get('out') ?? `.physics-audit/${VENUE}`;
if (!(VENUE in THEME_INDEX)) throw new Error(`Unknown venue: ${VENUE}`);
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
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.errors.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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
const profile = await mkdtemp(join(tmpdir(), 'vibe-physics-audit-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--hide-scrollbars',
  '--window-size=640,400', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let client;
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, 'chrome');
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, 'tab');
  client = new Cdp(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  const ready = () => retry(async () => {
    if (!(await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)'))) throw new Error('loading');
  }, 'app');
  await ready();
  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false,
    cafeIndex: ${THEME_INDEX[VENUE]}, qualityMode: 'auto', laptopOn: false, envTime: 'auto', envSky: 'auto'
  }))`);
  await client.evaluate('location.reload()');
  await ready();
  await client.evaluate("document.querySelector('#enter-btn').click()");
  await retry(async () => {
    const theme = await client.evaluate('window.__vibe.cafe && window.__vibe.crowd ? window.__vibe.cafe.theme.id : null');
    if (theme !== VENUE) throw new Error(String(theme));
  }, VENUE);

  const report = await client.evaluate(`(() => {
    const v = window.__vibe, c = v.crowd, r = v.realism, cafe = v.cafe;
    const step = 1 / 30;
    // stand in the busiest aisle: halfway between the door and the counter
    const nav = cafe.nav;
    const spot = { x: (nav.corridorX ?? 0) + 0.15, z: (nav.counter.z + nav.door.z) * 0.5 };
    v.place(spot.x, spot.z, 0);
    const player = v.player();
    const eye = { x: player.x, y: player.y + 1.55, z: player.z };
    const windows = { with: { passes: 0, close: 0, minDistance: Infinity }, without: { passes: 0, close: 0, minDistance: Infinity } };
    const nearState = new WeakMap();
    let glances = 0, doorCycles = 0, wasOpen = false, maxDoorAngle = 0, cost = 0;
    const gazed = new WeakSet();
    const ticks = Math.round(${MINUTES} * 60 * 30);
    for (let tick = 0; tick < ticks; tick++) {
      const avoid = Math.floor(tick / 1800) % 2 === 0;
      const bucket = avoid ? windows.with : windows.without;
      r.updatePlayer(player, player.y, player.levelId, avoid);
      cafe.animate(step);
      c.update(step, tick * step);
      v.pets?.update(step, c, null);
      const t0 = performance.now();
      r.simStep(step, eye);
      cost += performance.now() - t0;
      for (const npc of c.npcs) {
        if (!npc.path) continue;
        const d = Math.hypot(npc.mesh.position.x - player.x, npc.mesh.position.z - player.z);
        const state = nearState.get(npc) ?? { inside: false, min: Infinity };
        if (d < 1.2) {
          state.inside = true;
          state.min = Math.min(state.min, d);
        } else if (state.inside) {
          bucket.passes++;
          if (state.min < 0.5) bucket.close++;
          bucket.minDistance = Math.min(bucket.minDistance, state.min);
          state.inside = false;
          state.min = Infinity;
        }
        nearState.set(npc, state);
        if (npc.gazeT > 0 && npc.gazeWorld && Math.abs(npc.gazeWorld.x - eye.x) < 1e-6 && !gazed.has(npc.gazeWorld)) {
          gazed.add(npc.gazeWorld);
          glances++;
        }
      }
      const angle = Math.abs(cafe.entrance?.angle ?? 0);
      maxDoorAngle = Math.max(maxDoorAngle, angle);
      const open = (cafe.entrance?.openness ?? 0) > 0.82;
      if (open && !wasOpen) doorCycles++;
      wasOpen = open;
    }
    r.updatePlayer(player, player.y, player.levelId, false);
    return {
      seconds: ticks / 30, spot, windows, glances, doorCycles,
      maxDoorAngle, doorLimit: cafe.entrance?.hinge?.options.limit ?? null,
      realismMsPerStep: cost / ticks,
      metrics: v.metrics(),
    };
  })()`);
  report.venue = VENUE;
  report.errors = client.errors;
  await writeFile(join(OUT_DIR, 'physics-report.json'), JSON.stringify(report, null, 2) + '\n');
  const rate = (w) => (w.passes ? w.close / w.passes : 0);
  console.log(JSON.stringify({
    venue: VENUE,
    closePassRate: { withAvoidance: rate(report.windows.with), without: rate(report.windows.without) },
    passes: { with: report.windows.with.passes, without: report.windows.without.passes },
    glances: report.glances, doorCycles: report.doorCycles,
    realismMsPerStep: Number(report.realismMsPerStep.toFixed(3)),
  }, null, 2));
  if (client.errors.length) throw new Error(`Browser errors: ${client.errors.join('\n')}`);
  if (report.maxDoorAngle > (report.doorLimit ?? Infinity) + 1e-6) throw new Error('door passed its stop');
  if (report.realismMsPerStep > 1.5) throw new Error('realism layer exceeds its 1.5 ms per-step budget');
  if (report.windows.with.passes >= 4 && rate(report.windows.with) > rate(report.windows.without) + 0.05) {
    throw new Error('player avoidance made close passes more frequent');
  }
  if (report.windows.with.passes + report.windows.without.passes >= 10 && report.glances < 1) {
    throw new Error('no patron ever glanced at a nearby player');
  }
  console.log(`done: ${OUT_DIR}`);
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await delay(2000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
}
