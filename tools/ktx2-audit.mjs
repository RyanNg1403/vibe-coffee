// KTX2 texture-loading audit for a production build (dist/ with KTX2
// textures, served e.g. by `npx vite preview` or tools/pages/serve.mjs).
//
//   node tools/ktx2-audit.mjs --url=http://127.0.0.1:4173/ [--runs=6]
//        [--throttle=4] [--inject-faults]
//
// Each run is a cold visit (fresh profile, HTTP cache off) under CPU
// throttling that enters the café and switches cafés while models, the cast
// and textures are still streaming. A run fails on any console error (CI
// fails on GLTFLoader's "Couldn't load texture blob:…") and on any model or
// texture that could not be loaded. With --inject-faults the page makes its
// first blob reads and its first transcoder fetch fail, so the run proves
// that transient KTX2 failures are retried rather than surfaced.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Map(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, value] = arg.slice(2).split('=');
  return [key, value ?? true];
}));
const URL_ = String(args.get('url') ?? 'http://127.0.0.1:4173/');
const RUNS = Number(args.get('runs') ?? 6);
const THROTTLE = Number(args.get('throttle') ?? 4);
const INJECT = args.has('inject-faults');
const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function retry(task, label, attempts = 1800) {
  let error;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await task();
    } catch (cause) {
      error = cause;
      await delay(100);
    }
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: error });
}

const FAULTS = `(() => {
  const realFetch = window.fetch.bind(window);
  let blobFaults = 6;
  let transcoderFaults = 1;
  window.__ktx2Faults = { injected: 0 };
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('blob:') && blobFaults > 0) { blobFaults -= 1; window.__ktx2Faults.injected += 1; return Promise.reject(new TypeError('injected blob read failure')); }
    if (/basis_transcoder[^/]*\\.js/.test(url) && transcoderFaults > 0) { transcoderFaults -= 1; window.__ktx2Faults.injected += 1; return Promise.reject(new TypeError('injected transcoder fetch failure')); }
    return realFetch(input, init);
  };
})();`;

async function visit(run) {
  const profile = await mkdtemp(join(tmpdir(), 'vibe-ktx2-audit-'));
  const port = await freePort();
  const chrome = spawn(CHROME, ['--headless=new', '--disable-extensions', '--hide-scrollbars', '--window-size=1280,720',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const problems = [];
  const warnings = [];
  try {
    await retry(async () => { if (!(await fetch(`http://127.0.0.1:${port}/json/version`)).ok) throw new Error('devtools'); }, 'Chrome');
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 1;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        if (message.params.type === 'error') problems.push(`console.error: ${text.slice(0, 300)}`);
        else if (message.params.type === 'warning' && /\[models\]|\[textures\]|KTX2/.test(text)) {
          (/unavailable|after retries/.test(text) ? problems : warnings).push(text.slice(0, 300));
        }
      }
      if (message.method === 'Runtime.exceptionThrown') problems.push(`exception: ${(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 300)}`);
      const waiter = message.id && pending.get(message.id);
      if (waiter) { pending.delete(message.id); waiter(message); }
    });
    const send = (method, params = {}) => new Promise((resolve) => { const i = id++; pending.set(i, resolve); socket.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({ qualityMode: 'smooth', musicOn: false }));${INJECT ? FAULTS : ''}`,
    });
    const separator = URL_.includes('?') ? '&' : '?';
    await send('Page.navigate', { url: `${URL_}${separator}no-sw` });
    await retry(async () => { if (!(await evaluate('Boolean(window.__vibe && document.querySelector("#enter-btn"))'))) throw new Error('app'); }, 'app start');
    await evaluate(`document.querySelector('#enter-btn').click()`);
    for (const index of [1, 3, 2, 0]) {
      await delay(300 + Math.random() * 1200);
      await evaluate(`document.querySelectorAll('.loc-btn')[${index}].click()`);
    }
    await retry(async () => { if (!(await evaluate('(window.__vibe?.crowd?.npcs?.length ?? 0) > 0'))) throw new Error('crowd'); }, 'crowd', 2400);
    await delay(4000);
    const stats = await evaluate('JSON.stringify({ ktx2: window.__vibe.metrics().perf?.ktx2 ?? null, faults: window.__ktx2Faults ?? null })');
    socket.close();
    return { run, problems, warnings, stats: JSON.parse(stats ?? 'null') };
  } catch (error) {
    problems.push(`harness: ${error.message}`);
    return { run, problems, warnings, stats: null };
  } finally {
    chrome.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
}

let failed = 0;
for (let run = 1; run <= RUNS; run += 1) {
  const result = await visit(run);
  if (result.problems.length) failed += 1;
  console.log(`run ${run}: ${result.problems.length ? 'FAIL' : 'ok'} ${JSON.stringify(result.stats)}`);
  for (const line of result.problems.slice(0, 6)) console.log(`  ${line}`);
  if (INJECT) for (const line of result.warnings.slice(0, 3)) console.log(`  (warning) ${line}`);
}
console.log(`${failed}/${RUNS} runs failed${INJECT ? ' (with injected faults)' : ''}`);
process.exit(failed ? 1 : 0);
