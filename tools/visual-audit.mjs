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
  async function capture(name, settleMilliseconds = 700) {
    await delay(settleMilliseconds);
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

  // Follow one real street actor through the hinged door and back out. The
  // mesh UUID must remain identical across both ownership handoffs.
  await switchTo(0);
  const goldenActorCount = await client.evaluate(`window.__vibe.crowd.npcs.length
    + window.__vibe.crowd.outside.walkers.length`);
  await client.evaluate(`window.__vibe.place(-1.4, 5.15, -2.48, 0.02);
    window.__vibe.crowd.npcs.forEach((npc) => { npc.sitDuration = 9999; });
    window.__vibe.crowd.outside.walkers.forEach((walker, index) => {
      walker.x = index === 0 ? 0 : 8 + index;
      walker.mesh.position.x = walker.x;
    });
    window.__vibe.crowd.spawnCooldown = 0;`);
  const arrivalIdentity = await retry(async () => {
    const result = await client.evaluate(`(() => {
      const npc = window.__vibe.crowd.npcs.find((candidate) => candidate.sourceWalker);
      if (!npc) return null;
      npc.speed = 2.2;
      return { uuid: npc.mesh.uuid, state: npc.state };
    })()`);
    if (!result || result.state !== 'crossingDoorIn') throw new Error('arrival has not reached the open door');
    return result.uuid;
  }, 'visible café arrival', 400);
  await capture('goldenhour-door-arrival', 80);
  await retry(async () => {
    const ready = await client.evaluate(`(() => {
      const npc = window.__vibe.crowd.npcs.find((candidate) => candidate.mesh.uuid === '${arrivalIdentity}');
      if (!npc || (npc.state !== 'queueing' && npc.state !== 'ordering')) return false;
      const crowd = window.__vibe.crowd;
      if (crowd.ordering === npc) crowd.ordering = null;
      crowd.dequeue(npc);
      if (npc.seatIndex >= 0) crowd.releaseSeat(npc.seatIndex);
      npc.seatIndex = -1;
      npc.speed = 2.2;
      npc._beginExit();
      return true;
    })()`);
    if (!ready) throw new Error('arrival has not entered the café');
  }, 'arrival inside café', 400);
  await retry(async () => {
    const state = await client.evaluate(`window.__vibe.crowd.npcs
      .find((npc) => npc.mesh.uuid === '${arrivalIdentity}')?.state`);
    if (state !== 'crossingDoorOut') throw new Error('departure has not reached the open door');
    return state;
  }, 'visible café departure', 400);
  await capture('goldenhour-door-departure', 80);
  const goldenIdentityContinuous = await retry(async () => {
    const found = await client.evaluate(`window.__vibe.crowd.outside.walkers
      .some((walker) => walker.mesh.uuid === '${arrivalIdentity}')`);
    if (!found) throw new Error('departing actor has not joined the pavement');
    return found;
  }, 'pavement handoff', 400);
  const goldenActorCountStable = await client.evaluate(`window.__vibe.crowd.npcs.length
    + window.__vibe.crowd.outside.walkers.length === ${goldenActorCount}`);

  // Stress the physical doorway with three simultaneous departures. Only the
  // reservation holder may approach; the other two must remain in distinct
  // indoor holding positions until the preceding actor clears the threshold.
  await client.evaluate('window.__vibe.crowd.spawnCooldown = 9999');
  await retry(async () => {
    const idle = await client.evaluate(`window.__vibe.crowd.doorFlow.totalWaiting === 0
      && window.__vibe.cafe.entrance.openness < 0.06`);
    if (!idle) throw new Error('doorway has not cleared before congestion test');
    return true;
  }, 'idle doorway before congestion', 300);
  const congestedIds = await client.evaluate(`(() => {
    const crowd = window.__vibe.crowd;
    const actors = crowd.npcs.slice(0, 3);
    actors.forEach((npc, index) => {
      crowd.dequeue(npc);
      if (crowd.ordering === npc) crowd.ordering = null;
      if (crowd.brewFor === npc) crowd.brewFor = null;
      if (npc.seatIndex >= 0) crowd.releaseSeat(npc.seatIndex);
      npc.seatIndex = -1;
      npc._clearProps();
      npc.setCup(false);
      npc.mesh.position.set(-1.2, 0, crowd.cafe.nav.doorInside.z - 0.9 - index * 0.8);
      npc.speed = 0.7;
      npc._beginExit();
    });
    crowd.doorFlow.active.speed = 0.25;
    crowd.doorFlow.queue.forEach((entry) => { entry.actor.speed = 1.8; });
    return actors.map((npc) => npc.mesh.uuid);
  })()`);
  const doorCongestionSerialized = await retry(async () => {
    const result = await client.evaluate(`(() => {
      const flow = window.__vibe.crowd.doorFlow;
      const queued = flow.queue.map((entry) => entry.actor);
      const distinct = new Set(queued.map((npc) => npc.doorSlot)).size === queued.length;
      const heldBack = queued.every((npc) => npc.state === 'holdingDoorOut');
      const settled = queued.every((npc) => !npc.path);
      return { active: !!flow.active, queued: queued.length, distinct, heldBack, settled };
    })()`);
    if (!result.active || result.queued < 2 || !result.distinct || !result.heldBack || !result.settled) {
      throw new Error('doorway queue is not holding actors clear of the active reservation');
    }
    return true;
  }, 'serialized doorway congestion', 200);
  await client.evaluate('window.__vibe.place(-4, 2.5, -2.2, 0.06)');
  await capture('goldenhour-door-queue', 120);
  await client.evaluate(`window.__vibe.crowd.npcs
    .filter((npc) => ${JSON.stringify(congestedIds)}.includes(npc.mesh.uuid))
    .forEach((npc) => { npc.speed = 3; });`);
  const doorCongestionCleared = await retry(async () => {
    const cleared = await client.evaluate(`${JSON.stringify(congestedIds)}.every((uuid) =>
      window.__vibe.crowd.outside.walkers.some((walker) => walker.mesh.uuid === uuid))`);
    if (!cleared) throw new Error('congested actors have not cleared the doorway');
    return true;
  }, 'congested doorway clearance', 400);

  // In rain, an arriving umbrella user closes outside, crosses with the
  // canopy folded, then reopens it only after leaving the door again.
  await switchTo(2);
  const rainyActorCount = await client.evaluate(`window.__vibe.crowd.npcs.length
    + window.__vibe.crowd.outside.walkers.length`);
  await client.evaluate(`window.__vibe.place(-1.4, 5.15, -2.48, 0.02);
    window.__vibe.crowd.npcs.forEach((npc) => { npc.sitDuration = 9999; });
    const holder = window.__vibe.crowd.outside.walkers.find((walker) => walker.umbrella);
    window.__vibe.crowd.outside.walkers.forEach((walker, index) => {
      walker.x = walker === holder ? 0 : 8 + index;
      walker.mesh.position.x = walker.x;
    });
    window.__vibe.crowd.spawnCooldown = 0;`);
  const rainyIdentity = await retry(async () => {
    const result = await client.evaluate(`(() => {
      const npc = window.__vibe.crowd.npcs.find((candidate) => candidate.sourceWalker?.umbrella);
      if (!npc) return null;
      npc.speed = 2.2;
      return { uuid: npc.mesh.uuid, state: npc.state, open: npc.umbrella?.openAmount ?? 0 };
    })()`);
    const closingOutside = result && ['holdingDoorIn', 'approachingDoorIn', 'waitingDoorIn'].includes(result.state);
    if (!closingOutside || result.open < 0.15 || result.open > 0.8) {
      throw new Error('umbrella is not in its closing transition');
    }
    return result.uuid;
  }, 'umbrella closing before entry', 400);
  await capture('midnight-umbrella-closing', 80);
  await retry(async () => {
    const ready = await client.evaluate(`(() => {
      const npc = window.__vibe.crowd.npcs.find((candidate) => candidate.mesh.uuid === '${rainyIdentity}');
      if (!npc || (npc.state !== 'queueing' && npc.state !== 'ordering')) return false;
      const crowd = window.__vibe.crowd;
      if (crowd.ordering === npc) crowd.ordering = null;
      crowd.dequeue(npc);
      if (npc.seatIndex >= 0) crowd.releaseSeat(npc.seatIndex);
      npc.seatIndex = -1;
      npc.speed = 2.2;
      npc._beginExit();
      npc.exitUsesUmbrella = true;
      return true;
    })()`);
    if (!ready) throw new Error('rainy arrival has not entered the café');
  }, 'rainy arrival inside café', 400);
  await retry(async () => {
    const result = await client.evaluate(`(() => {
      const npc = window.__vibe.crowd.npcs.find((candidate) => candidate.mesh.uuid === '${rainyIdentity}');
      return npc ? { state: npc.state, open: npc.umbrella?.openAmount ?? 0 } : null;
    })()`);
    if (!result || result.state !== 'openingUmbrella' || result.open < 0.15 || result.open > 0.85) {
      throw new Error('umbrella is not in its opening transition');
    }
    return result;
  }, 'umbrella opening after exit', 400);
  await capture('midnight-umbrella-opening', 80);
  const rainyIdentityContinuous = await retry(async () => {
    const result = await client.evaluate(`(() => {
      const walker = window.__vibe.crowd.outside.walkers
        .find((candidate) => candidate.mesh.uuid === '${rainyIdentity}');
      return walker ? { found: true, open: walker.umbrella?.openAmount ?? 0 } : null;
    })()`);
    if (!result?.found || result.open < 0.94) throw new Error('rainy actor has not rejoined with an open umbrella');
    return true;
  }, 'rainy pavement handoff', 400);
  const rainyActorCountStable = await client.evaluate(`window.__vibe.crowd.npcs.length
    + window.__vibe.crowd.outside.walkers.length === ${rainyActorCount}`);

  await switchTo(0);
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

  // The default Auto profile intentionally favors thermals: direct PBR render,
  // 24 Hz ambient cadence, and no compositor. Keep a visual artifact and a
  // machine-readable contract so later polish cannot silently restore the
  // high-heat 60 Hz multi-pass path.
  await client.evaluate(`(() => {
    const key = 'vibe-coffee.preferences.v1';
    const preferences = JSON.parse(localStorage.getItem(key));
    preferences.qualityMode = 'auto';
    preferences.cafeIndex = 0;
    localStorage.setItem(key, JSON.stringify(preferences));
    location.reload();
  })()`);
  await retry(async () => {
    const ready = await client.evaluate(`document.readyState === 'complete'
      && Boolean(window.__vibe?.cafe)
      && window.__vibe.metrics().qualityMode === 'auto'`);
    if (!ready) throw new Error('Auto efficiency profile is not ready');
    return true;
  }, 'Auto efficiency profile', 300);
  await client.evaluate(`document.querySelector('#enter-btn').click();
    ['#hud-top', '#hud-bottom', '#hint', '#toast'].forEach((selector) => {
      const element = document.querySelector(selector);
      if (element) element.style.display = 'none';
    });
    window.__vibe.place(0, 4.8, 0, 0.04);`);
  await delay(3200);
  await capture('auto-efficiency-overview', 500);
  const autoMetrics = await retry(async () => {
    const metrics = await client.evaluate('window.__vibe.metrics()');
    if (metrics.observedFps < 22 || metrics.observedFps > 26) {
      throw new Error('Auto cadence has not settled');
    }
    return metrics;
  }, 'steady Auto cadence', 100);
  const continuityChecks = {
    goldenIdentityContinuous,
    goldenActorCountStable,
    doorCongestionSerialized,
    doorCongestionCleared,
    rainyIdentityContinuous,
    rainyActorCountStable,
  };
  const passed = rainyMetrics.outsideUmbrellas > 0
    && rainyMetrics.outsideUmbrellas < rainyMetrics.outsidePedestrians
    && rainyMetrics.outsideUmbrellaGripError < 0.02
    && autoMetrics.qualityMode === 'auto'
    && autoMetrics.effects === 0
    && autoMetrics.targetFps === 24
    && autoMetrics.observedFps >= 22
    && autoMetrics.observedFps <= 26
    && Object.values(continuityChecks).every(Boolean);
  const manifest = { url: APP_URL, files, rainyMetrics, autoMetrics, continuityChecks, passed };
  await writeFile(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(5000)]);
  await rm(profile, { recursive: true, force: true });
}
