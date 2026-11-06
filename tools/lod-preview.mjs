// Captures tools/lod-preview.html: each model at LOD0 / LOD1 / LOD2, loaded
// through GLTFLodPlugin in a real browser.
//
//   npm run dev &
//   node tools/lod-preview.mjs --keys=studio_espresso,char_atelier_1 --out=lod.png
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/local/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const args = new Map(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const keys = args.get('keys') ?? 'studio_espresso';
const out = args.get('out') ?? 'lod-preview.png';
const base = process.env.VIBE_URL?.replace(/\/\?.*$/, '') ?? 'http://127.0.0.1:5173';
const rows = keys.split(',').length;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const profile = await mkdtemp(join(tmpdir(), 'vibe-lod-preview-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  `--window-size=1080,${rows * 360}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let socket;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const url = `${base}/tools/lod-preview.html?keys=${keys}`;
      target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    } catch { await delay(200); }
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); socket.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: rows * 360, deviceScaleFactor: 1, mobile: false });
  let result;
  for (let i = 0; i < 600; i++) {
    const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.lodPreview ?? null)', returnByValue: true });
    result = JSON.parse(r.result.result.value ?? 'null');
    if (result?.done || errors.length) break;
    await delay(250);
  }
  if (!result?.done) throw new Error(`preview did not finish: ${errors.join('\n')}`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(out, Buffer.from(shot.result.data, 'base64'));
  console.log(JSON.stringify(result.report));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await delay(1000);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
