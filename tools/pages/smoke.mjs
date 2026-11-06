// Headless Chrome smoke test of the built site served like GitHub Pages.
// Fails on any HTTP error or console error during a first visit, a repeat
// visit (which must be served by the service worker) and an offline reload,
// and when the first visit downloads more than BUDGET_FIRST_FRAME_MB
// (decimal MB of response bodies) before the first café frame.
//
//   npm run build && node tools/pages/smoke.mjs [--out dir] [--port 4321]
//
// Writes numbered screenshots and smoke-report.json to --out
// (default .pages-smoke/). CHROME_PATH overrides the browser.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map(process.argv.slice(2).flatMap((arg, i, all) => arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : []));
const OUT = resolve(args.get('out') ?? '.pages-smoke');
const PORT = Number(args.get('port') ?? 4321);
const DEBUG_PORT = PORT + 1;
// 27.5 MB measured before the first café frame once startup only waits for
// the opening venue, plus ~9 % headroom.
const BUDGET_FIRST_FRAME_MB = Number(process.env.BUDGET_FIRST_FRAME_MB ?? 30);
const WATCHDOG_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15 * 60 * 1000);
const VIEWPORT = { width: 1280, height: 720 };
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
const startedAt = Date.now();
const log = (message) => console.error(`[smoke ${((Date.now() - startedAt) / 1000).toFixed(0)}s] ${message}`);

// Runs in the page before any app script: software GL keeps the smoke test
// fast enough for CI runners, and the first café frame records how many
// bytes the visit needed to get there.
const PAGE_SETUP = `(() => {
  const key = 'vibe-coffee.preferences.v1';
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ qualityMode: 'smooth' }));
  const bytes = () => performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource'))
    .reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
  const tick = () => {
    if (!window.__vibe?.cafe) return requestAnimationFrame(tick);
    requestAnimationFrame(() => { window.__smokeFirstFrame = { ms: Math.round(performance.now()), bytes: bytes() }; });
  };
  requestAnimationFrame(tick);
})();`;

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

  // A starved renderer can leave a command unanswered; never wait forever.
  send(method, params = {}, timeoutMs = 60000) {
    const id = this.id++;
    return new Promise((resolveSend, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolveSend(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
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
  '--autoplay-policy=no-user-gesture-required', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const report = { url: APP_URL, budgetFirstFrameMB: BUDGET_FIRST_FRAME_MB, phases: {} };
let failed = false;
let phase = null;
const finish = (current) => {
  const { lastActivity, expectNotFound, offline, ...summary } = current;
  report.phases[current.name] = summary;
  if (summary.httpErrors.length || summary.failures.length || summary.consoleErrors.length) failed = true;
};

async function shutdown() {
  if (phase && !report.phases[phase.name]) finish(phase);
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
  await delay(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  report.ok = !failed;
  await writeFile(join(OUT, 'smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  const first = report.phases['first-visit']?.firstFrame;
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '## Pages smoke test', '',
      `Result: **${failed ? 'failed' : 'passed'}**${report.error ? ` (${report.error.split('\n')[0]})` : ''}`, '',
      first ? `Downloaded before the first café frame: **${first.mb} MB** (budget ${BUDGET_FIRST_FRAME_MB} MB)` : '',
      ...Object.values(report.phases).map((p) => `- ${p.name}: ${p.requests} requests, ${p.fromServiceWorker} from the service worker, `
        + `${(p.networkBytes / 1e6).toFixed(2)} MB over the network, ${p.httpErrors.length + p.failures.length + p.consoleErrors.length} errors`),
      '',
    ].join('\n'));
  }
  process.exit(failed ? 1 : 0);
}

const watchdog = setTimeout(() => {
  failed = true;
  report.error = `watchdog: smoke test exceeded ${WATCHDOG_MS / 60000} min`;
  log(report.error);
  shutdown();
}, WATCHDOG_MS);

try {
  await until(async () => (await fetch(APP_URL)).ok, 'Pages server', 15000);
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
    return response.ok && response.json();
  }, 'Chrome DevTools', 30000);
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();

  const requests = new Map();
  const track = (name) => {
    log(`phase ${name}`);
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
    else if (phase.name !== 'first-visit') (phase.notFromServiceWorker ??= []).push(response.url);
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SETUP });

  const ready = () => cdp.evaluate('document.readyState === "complete" && Boolean(window.__vibe?.cafe)');
  const settle = async (quietMs = 3000) => {
    await until(ready, 'café scene', 240000);
    await until(() => Date.now() - phase.lastActivity > quietMs, 'network quiet', 180000);
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, 120000);
    await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    log(`saved ${name}.png`);
  };
  const enter = async () => {
    const box = await cdp.evaluate(`(() => { const r = document.querySelector('#enter-btn').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await delay(4000);
  };

  // 1. First visit: nothing cached.
  track('first-visit');
  await cdp.send('Page.navigate', { url: APP_URL });
  await settle();
  const firstFrame = await until(() => cdp.evaluate('window.__smokeFirstFrame'), 'first café frame', 30000);
  phase.firstFrame = { ms: firstFrame.ms, mb: Number((firstFrame.bytes / 1e6).toFixed(2)) };
  log(`first café frame after ${phase.firstFrame.mb} MB`);
  if (phase.firstFrame.mb > BUDGET_FIRST_FRAME_MB) {
    phase.failures.push(`downloaded ${phase.firstFrame.mb} MB before the first café frame; budget is ${BUDGET_FIRST_FRAME_MB} MB`);
  }
  await shot('01-first-visit-overlay');
  await enter();
  await shot('02-first-visit-inside');
  phase.serviceWorker = await until(() => cdp.evaluate(
    'navigator.serviceWorker.ready.then((r) => r.active?.state === "activated" && Boolean(navigator.serviceWorker.controller))'), 'service worker', 60000);
  // Wait for the worker to backfill the first visit's downloads.
  let previous = -1;
  phase.cachedAssets = await until(async () => {
    const count = await cdp.evaluate('caches.open("vibe-assets").then((c) => c.keys()).then((k) => k.length)');
    const stable = count > 0 && count === previous;
    previous = count;
    await delay(1500);
    return stable && count;
  }, 'asset cache backfill', 180000);
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
  log(`error: ${error.message}`);
}
clearTimeout(watchdog);
await shutdown();
