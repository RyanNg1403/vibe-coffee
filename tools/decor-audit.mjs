// Physical-sanity audit for decor: sweeps every cafe, every seat, laptop on
// and off, and asserts via window.__vibe.decorAudit() that no tabletop or
// counter object floats, sinks, overlaps a neighbour, or hangs off its table.
// Pure measurement — no rendering waits — so the full sweep stays fast even
// on software-GL machines.
//
//   npm run dev &
//   npm run audit:decor
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?visual-audit=1';
const THEMES = ['goldenhour', 'roastery', 'midnight', 'terrace'];
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE ?? 1) || 1);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function retry(task, label, attempts = 160) {
  let error;
  attempts = Math.round(attempts * RETRY_SCALE);
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

if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH to run the decor audit');
const profile = await mkdtemp(join(tmpdir(), 'vibe-decor-audit-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-extensions',
  '--disable-gpu-sandbox',
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
  }, 'decor audit tab');
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send('Runtime.enable');
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe?.cafe)');
    if (!ready) throw new Error('application is not ready');
  }, 'application startup', 300);
  await client.evaluate("document.querySelector('#enter-btn').click()");

  const report = {};
  let total = 0;
  for (let index = 0; index < THEMES.length; index += 1) {
    await client.evaluate(`document.querySelectorAll('.loc-btn')[${index}].click()`);
    await retry(async () => {
      const theme = await client.evaluate('window.__vibe.cafe?.theme.id');
      if (theme !== THEMES[index]) throw new Error('scene is still loading');
    }, THEMES[index], 300);

    const summary = await client.evaluate(`(() => {
      const vibe = window.__vibe;
      const violations = [];
      const groundingViolations = [];
      const seatCount = vibe.cafe.seats.length;
      // resting state first
      violations.push(...vibe.decorAudit().violations.map((v) => ({ ...v, phase: 'rest' })));
      // whole-venue world-grounding sweep at rest: no mesh floats or sinks
      const ground0 = vibe.worldGroundingAudit();
      groundingViolations.push(...ground0.violations.map((v) => ({ ...v, phase: 'rest' })));
      const groundingChecked = ground0.checked;
      // then every seat with the laptop out: clearance must keep everything
      // grounded, separated, and on the table
      const laptopBtn = document.getElementById('laptop-btn');
      const skipped = [];
      for (let seat = 0; seat < seatCount; seat += 1) {
        // sit() mirrors gameplay: a seated guest is evicted (departing
        // normally), a mid-walk/order reservation keeps the seat and the
        // unreachable player-in-lap state is skipped
        if (!vibe.sit(seat)) { skipped.push(seat); continue; }
        if (!laptopBtn.classList.contains('on')) laptopBtn.click();
        for (const v of vibe.decorAudit().violations) {
          violations.push({ ...v, phase: 'laptop@seat' + seat });
        }
      }
      if (laptopBtn.classList.contains('on')) laptopBtn.click();
      violations.push(...vibe.decorAudit().violations.map((v) => ({ ...v, phase: 'restored' })));
      // grounding sweep again with a laptop deployed (props relocated)
      if (seatCount) { vibe.sit(0); if (!laptopBtn.classList.contains('on')) laptopBtn.click(); }
      const ground1 = vibe.worldGroundingAudit();
      groundingViolations.push(...ground1.violations.map((v) => ({ ...v, phase: 'laptop@seat0' })));
      if (laptopBtn.classList.contains('on')) laptopBtn.click();
      return { seatCount, skipped, groundingChecked, violations, groundingViolations };
    })()`);
    report[THEMES[index]] = summary;
    total += summary.violations.length + summary.groundingViolations.length;
    console.error(`${THEMES[index]}: ${summary.seatCount} seats, ${summary.violations.length} decor + ${summary.groundingViolations.length} grounding violations (${summary.groundingChecked} meshes swept)`);
  }
  console.log(JSON.stringify({ report, total, passed: total === 0 }, null, 2));
  if (total > 0) process.exitCode = 1;
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  await Promise.race([chromeExited, delay(5000)]);
  await rm(profile, { recursive: true, force: true });
}
