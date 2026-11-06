// Headless Chrome smoke test of the built site served like GitHub Pages.
// Fails on any HTTP error or console error during a first visit, a repeat
// visit (which must be served by the service worker) and an offline reload.
//
//   npm run build && node tools/pages/smoke.mjs [--out dir] [--port 4321]
//
// Writes numbered screenshots and smoke-report.json to --out
// (default .pages-smoke/). CHROME_PATH overrides the browser.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map(process.argv.slice(2).flatMap((arg, i, all) => arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : []));
const OUT = resolve(args.get('out') ?? '.pages-smoke');
const PORT = Number(args.get('port') ?? 4321);
const DEBUG_PORT = PORT + 1;
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH');

const html = readFileSync(resolve('dist/index.html'), 'utf8');
const BASE = html.match(/<script type="module"[^>]*src="(\/[^"]*?)assets\//)?.[1] ?? '/';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP_URL = `${ORIGIN}${BASE}`;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(check, label, timeoutMs = 120000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(url) {
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((done, fail) => {
      this.socket.addEventListener('open', done, { once: true });
      this.socket.addEventListener('error', fail, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      }
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
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
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const startServer = () => spawn(process.execPath, [join(HERE, 'serve.mjs'), '--port', String(PORT)], { stdio: 'ignore' });
let server = startServer();
const profile = await mkdtemp(join(tmpdir(), 'vibe-pages-smoke-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const report = { url: APP_URL, phases: {} };
let failed = false;
try {
  await until(async () => (await fetch(APP_URL)).ok, 'Pages server', 15000);
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
    return response.ok && response.json();
  }, 'Chrome DevTools', 30000);
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();

  let phase = null;
  const requests = new Map();
  const track = (name) => {
    phase = { name, requests: 0, httpErrors: [], failures: [], consoleErrors: [], duplicates: [], fromServiceWorker: 0, networkBytes: 0, lastActivity: Date.now() };
    requests.clear();
    return phase;
  };
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!phase || !request.url.startsWith('http')) return;
    if (requests.has(requestId)) return;
    if ([...requests.values()].includes(request.url)) phase.duplicates.push(request.url);
    requests.set(requestId, request.url);
    phase.requests += 1;
    phase.lastActivity = Date.now();
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    if (!phase || !requests.has(requestId)) return;
    phase.lastActivity = Date.now();
    if (response.fromServiceWorker) phase.fromServiceWorker += 1;
    if (response.status >= 400 && !phase.expectNotFound) phase.httpErrors.push(`${response.status} ${response.url}`);
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    if (!phase || !requests.has(requestId)) return;
    phase.networkBytes += encodedDataLength;
    phase.lastActivity = Date.now();
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText, canceled }) => {
    if (!phase || !requests.has(requestId) || canceled || errorText === 'net::ERR_ABORTED') return;
    if (phase.offline) (phase.offlineMisses ??= []).push(requests.get(requestId));
    else phase.failures.push(`${errorText} ${requests.get(requestId)}`);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args: values }) => {
    if (phase && type === 'error') phase.consoleErrors.push(values.map((v) => v.value ?? v.description).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    phase?.consoleErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (phase && entry.level === 'error' && !phase.expectNotFound && !phase.offline) phase.consoleErrors.push(`${entry.source}: ${entry.text} ${entry.url ?? ''}`);
  });
  for (const domain of ['Runtime', 'Page', 'Network', 'Log']) await cdp.send(`${domain}.enable`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const settle = async (quietMs = 3000) => {
    await until(() => window_ready(), 'café scene', 180000);
    await until(() => Date.now() - phase.lastActivity > quietMs, 'network quiet', 120000);
  };
  const window_ready = () => cdp.evaluate('document.readyState === "complete" && Boolean(window.__vibe?.cafe)');
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const enter = async () => {
    const box = await cdp.evaluate(`(() => { const r = document.querySelector('#enter-btn').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await delay(4000);
  };
  const finish = (current) => {
    const { lastActivity, expectNotFound, offline, ...summary } = current;
    report.phases[current.name] = summary;
    if (summary.httpErrors.length || summary.failures.length || summary.consoleErrors.length) failed = true;
  };

  // 1. First visit: nothing cached.
  track('first-visit');
  await cdp.send('Page.navigate', { url: APP_URL });
  await settle();
  await shot('01-first-visit-overlay');
  await enter();
  await shot('02-first-visit-inside');
  phase.serviceWorker = await until(() => cdp.evaluate(
    'navigator.serviceWorker.ready.then((r) => r.active?.state === "activated" && Boolean(navigator.serviceWorker.controller))'), 'service worker', 30000);
  // Wait for the worker to backfill the first visit's downloads.
  let previous = -1;
  phase.cachedAssets = await until(async () => {
    const count = await cdp.evaluate('caches.open("vibe-assets").then((c) => c.keys()).then((k) => k.length)');
    const stable = count > 0 && count === previous;
    previous = count;
    await delay(1500);
    return stable && count;
  }, 'asset cache backfill', 120000);
  finish(phase);

  // 2. Repeat visit: assets must come from the service worker.
  track('repeat-visit');
  const repeatStart = Date.now();
  await cdp.send('Page.reload', { ignoreCache: false });
  await settle();
  phase.readyMs = Date.now() - repeatStart;
  await enter();
  await shot('03-repeat-visit-inside');
  finish(phase);

  // 3. Server gone: the precached shell and cached assets still start the café.
  track('offline-reload').offline = true;
  server.kill('SIGTERM');
  await until(async () => !(await fetch(APP_URL).then(() => true, () => false)), 'server shutdown', 10000);
  await cdp.send('Page.reload', {});
  await settle();
  await enter();
  await shot('04-offline-reload-inside');
  finish(phase);
  server = startServer();
  await until(async () => (await fetch(APP_URL)).ok, 'Pages server restart', 15000);

  // 4. Unknown page: GitHub Pages answers with 404.html.
  track('not-found').expectNotFound = true;
  await cdp.send('Page.navigate', { url: `${APP_URL}no-such-table` });
  await until(() => cdp.evaluate('document.readyState === "complete" && document.title.includes("not found")'), '404 page', 15000);
  await shot('05-not-found-page');
  finish(phase);
} catch (error) {
  failed = true;
  report.error = error.stack ?? String(error);
} finally {
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
  await delay(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

report.ok = !failed;
await writeFile(join(OUT, 'smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
