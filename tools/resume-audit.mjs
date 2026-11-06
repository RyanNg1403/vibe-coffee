// Save/resume audit: visits the café in headless Chrome, changes the session
// (café, time, weather, mix, position, focus timer), reloads, presses
// Continue and checks that every saved field comes back exactly. Runs on a
// desktop and a phone viewport, each in a fresh profile, and also checks
// that preferences saved before checkpoints existed still load, that
// "New session" starts fresh, and that the localStorage fallback works when
// IndexedDB is unavailable.
//
//   npm run dev                       # in another terminal
//   npm run audit:resume              # VIBE_URL, VIBE_RESUME_DIR, VIBE_VIEWPORTS
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/';
const OUTPUT_DIR = resolve(process.env.VIBE_RESUME_DIR ?? '.resume-audit');
// Desktop walks around the Roastery; the phone sits down on the two-level
// Terrace with its laptop out.
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, venue: 1, theme: 'roastery' },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, venue: 3, theme: 'terrace' },
};
const RUN = (process.env.VIBE_VIEWPORTS ?? 'desktop,mobile').split(',').map((name) => name.trim()).filter((name) => VIEWPORTS[name]);
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE ?? 1) || 1);

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function retry(task, label, attempts = 300) {
  let error;
  for (let attempt = 0; attempt < Math.round(attempts * RETRY_SCALE); attempt += 1) {
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
    await new Promise((done, reject) => {
      this.socket.addEventListener('open', done, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      this.pending.set(id, { resolve: done, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  close() { this.socket.close(); }
}

const checks = [];
function check(viewport, name, pass, detail = {}) {
  checks.push({ viewport, name, pass: Boolean(pass), ...detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} [${viewport}] ${name}${pass ? '' : ` ${JSON.stringify(detail)}`}`);
}
const near = (a, b, tolerance) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

async function runViewport(name) {
  const viewport = VIEWPORTS[name];
  const profile = await mkdtemp(join(tmpdir(), 'vibe-resume-audit-'));
  const port = await freePort();
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    `--window-size=${viewport.width},${viewport.height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const exited = new Promise((done) => chrome.once('exit', done));
  let client;
  let shot = 0;
  try {
    await retry(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }, 'Chrome DevTools');
    const target = await retry(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }, 'audit tab');
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    const { venue, theme, ...metrics } = viewport;
    await client.send('Emulation.setDeviceMetricsOverride', metrics);
    if (viewport.mobile) {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await client.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    }

    const capture = async (label, settle = 900) => {
      await delay(settle);
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      shot += 1;
      const file = `${name}-${String(shot).padStart(2, '0')}-${label}.png`;
      await writeFile(join(OUTPUT_DIR, file), Buffer.from(data, 'base64'));
      return file;
    };
    // Real pointer (or touch) input, so Continue runs inside a user gesture.
    const tap = async (selector) => {
      const box = await client.evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (viewport.mobile) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [box] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await client.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
        }
      }
    };
    const waitForTitle = () => retry(async () => {
      const ready = await client.evaluate(`!window.__auditStale && document.readyState === 'complete'
        && document.documentElement.classList.contains('ui-loaded')
        && Boolean(window.__vibe?.cafe?.seats?.length)`);
      if (!ready) throw new Error('title is not ready');
    }, 'title screen', 600);
    const navigate = async (url) => {
      await client.send('Page.navigate', { url });
      await delay(300);
      await waitForTitle();
    };
    const reload = async () => {
      await client.evaluate('window.__auditStale = true');
      await client.send('Page.reload', {});
      await delay(300);
      await waitForTitle();
      // the checkpoint is read in parallel with the build
      await client.evaluate('window.__vibe.checkpoint.whenRead()');
    };
    const snapshot = () => client.evaluate(`(() => {
      const c = window.__vibe.checkpoint.capture();
      return { ...c, music: window.__vibe.audio.musicState?.() ?? null, timer: window.__vibe.checkpoint.timer(),
        theme: window.__vibe.metrics().theme };
    })()`);
    const offered = () => client.evaluate(`(() => {
      const button = document.querySelector('#continue-btn');
      // what is on screen, not the attribute: author CSS can override [hidden]
      const shown = Boolean(button) && getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0;
      return { visible: shown, text: button?.innerText ?? '',
        newSession: document.querySelector('#enter-btn').innerText, checkpoint: window.__vibe.checkpoint.offered };
    })()`);

    // 1. A returning visitor from before checkpoints existed: the legacy
    // preference, interface and stats records must load unchanged.
    await navigate(APP_URL);
    const today = await client.evaluate(`(() => { const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
    await client.evaluate(`localStorage.clear();
      localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({ musicVolume: 0.23, ambienceVolume: 0.64,
        voicesVolume: 0.9, petVolume: 0.4, rainIntensity: 3, musicOn: true, muted: false, cafeIndex: 2,
        envTime: 'sunset', envSky: 'rain', qualityMode: 'smooth', laptopOn: false, focusMinutes: 30 }));
      localStorage.setItem('vibe-coffee.ui.v1', JSON.stringify({ textScale: 1.12, showHints: false }));
      localStorage.setItem('vibe-coffee.focus-stats.v1', JSON.stringify({ days: { ['${today}']: { sessions: 2, minutes: 50 } } }));`);
    await reload();
    const legacy = await client.evaluate(`({
      musicVolume: document.querySelector('#music-vol').value,
      ambience: document.querySelector('#amb-vol').value,
      theme: window.__vibe.metrics().theme,
      textScale: getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim(),
      focus: document.querySelector('#timer-duration').textContent,
      stats: JSON.parse(localStorage.getItem('vibe-coffee.focus-stats.v1')),
      offered: window.__vibe.checkpoint.offered,
    })`);
    check(name, 'legacy preferences load unchanged', legacy.musicVolume === '0.23' && legacy.ambience === '0.64'
      && legacy.theme === 'midnight' && legacy.focus.startsWith('30'), legacy);
    check(name, 'legacy interface settings load unchanged', legacy.textScale === '1.12', { textScale: legacy.textScale });
    check(name, 'legacy focus stats load unchanged', legacy.stats?.days?.[today]?.sessions === 2, legacy.stats);
    const firstTitle = await offered();
    check(name, 'no Continue without a checkpoint', legacy.offered === null && !firstTitle.visible
      && /Step inside/.test(firstTitle.newSession), firstTitle);
    const files = [await capture('first-visit-title')];

    // 2. Visit: enter, change café, time and weather, the mix, start a focus
    // block, then move (walk on desktop, change seat + laptop on mobile).
    await tap('#enter-btn');
    await delay(1200);
    await client.evaluate(`document.querySelectorAll('.loc-btn')[${venue}].click()`);
    await retry(async () => {
      if (await client.evaluate(`window.__vibe.cafe?.theme?.id !== '${theme}'`)) throw new Error('loading');
    }, theme);
    await client.evaluate(`(() => {
      document.querySelector('#sky-pop [data-time="night"]').click();
    })()`);
    await delay(200);
    await retry(async () => {
      // the cast streams in after the room's first frame
      if (!(await client.evaluate(`Boolean(window.__vibe.cafe?.seats?.length) && window.__vibe.cafe.theme.timeOfDay === 'night' && Boolean(window.__vibe.crowd)`))) throw new Error('loading');
    }, `night ${theme}`);
    await client.evaluate(`(() => {
      const slider = document.querySelector('#amb-vol');
      slider.value = '0.37';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#timer-btn').click();
    })()`);
    if (viewport.mobile) {
      await client.evaluate(`(() => {
        const v = window.__vibe;
        const seats = v.cafe.seats.map((s, i) => i).filter((i) => !v.crowd.isSeatTaken(i));
        v.sit(seats[Math.floor(seats.length / 2)]);
        v.face(v.view.yaw + 0.6, -0.12);
        document.querySelector('#laptop-btn').click();
      })()`);
    } else {
      await client.evaluate(`document.querySelector('#walk-btn').click()`);
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await delay(1600);
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await client.evaluate(`window.__vibe.face(window.__vibe.view.yaw + 0.9, -0.18)`);
    }
    await delay(3500);
    // software decoding in headless Chrome can take several seconds to start a track
    await retry(async () => {
      if (!(await client.evaluate('(window.__vibe.audio.musicState()?.position ?? 0) > 2'))) throw new Error('music not playing');
    }, 'recorded music', 400);
    const before = await snapshot();
    check(name, 'moved before saving', viewport.mobile ? before.player?.mode === 'seated' : before.player?.mode === 'walking', before.player);
    files.push(await capture('in-cafe-before-reload', 300));
    const reloadedAt = Date.now();

    // 3. Reload: pagehide writes the checkpoint; the title offers Continue
    // with the saved café already built and the player in place behind it.
    await reload();
    const mirror = await client.evaluate(`JSON.parse(localStorage.getItem('vibe-coffee.checkpoint'))`);
    check(name, 'pagehide wrote the checkpoint synchronously', mirror?.savedAt >= reloadedAt - 1000
      && near(mirror.player?.yaw, before.player.yaw, 1e-3), { savedAt: mirror?.savedAt, reloadedAt });
    const title = await offered();
    check(name, 'Continue is offered after reload', title.visible, { text: title.text });
    check(name, '"Step inside" becomes "New session"', /New session/.test(title.newSession), { text: title.newSession });
    const behind = await snapshot();
    check(name, 'saved café is warmed behind the title', behind.cafeId === theme && behind.theme === theme
      && behind.preferences.envTime === 'night', { cafeId: behind.cafeId, env: behind.preferences.envTime });
    check(name, 'player is already in place behind the title', near(behind.player?.x, before.player.x, 1e-3)
      && near(behind.player?.z, before.player.z, 1e-3), { before: before.player, behind: behind.player });
    files.push(await capture('title-continue'));

    // 4. Continue: everything comes back exactly.
    await tap('#continue-btn');
    await delay(2500);
    if (before.music) {
      await retry(async () => {
        if (!(await client.evaluate('Boolean(window.__vibe.audio.musicState())'))) throw new Error('music not resumed');
      }, 'resumed music', 400);
    }
    const after = await snapshot();
    const away = (Date.now() - reloadedAt) / 1000;
    check(name, 'café, time and weather restored', after.cafeId === before.cafeId
      && after.preferences.envTime === before.preferences.envTime && after.preferences.envSky === before.preferences.envSky,
    { before: before.preferences, after: after.preferences });
    check(name, 'position restored', near(after.player?.x, before.player.x, 1e-3) && near(after.player?.y, before.player.y, 1e-3)
      && near(after.player?.z, before.player.z, 1e-3) && after.player?.levelId === before.player.levelId,
    { before: before.player, after: after.player });
    check(name, 'orientation restored', near(after.player?.yaw, before.player.yaw, 1e-3) && near(after.player?.pitch, before.player.pitch, 1e-3),
      { before: [before.player.yaw, before.player.pitch], after: [after.player?.yaw, after.player?.pitch] });
    check(name, 'seated state restored', after.player?.mode === before.player.mode
      && (before.player.mode !== 'seated' || after.player.seat?.index === before.player.seat.index)
      && after.preferences.laptopOn === before.preferences.laptopOn, { before: before.player.seat, after: after.player?.seat });
    check(name, 'ambience mix restored', after.preferences.ambienceVolume === 0.37 && after.preferences.musicVolume === before.preferences.musicVolume,
      { ambience: after.preferences.ambienceVolume });
    const expected = before.timer.remaining - away;
    check(name, 'in-progress focus timer restored and running', after.timer.running && !after.timer.onBreak
      && after.timer.remaining <= before.timer.remaining && after.timer.remaining >= expected - 3,
    { before: before.timer, after: after.timer, away });
    check(name, 'music track and position restored', before.music?.trackId && after.music?.trackId === before.music.trackId
      && after.music.position >= before.music.position - 0.5 && after.music.position < before.music.position + away + 5,
    { before: before.music, after: after.music, away });
    check(name, 'settings and stats kept', after.settings.textScale === 1.12 && after.stats.days[today]?.sessions === 2);
    const storage = await client.evaluate(`(async () => {
      await window.__vibe.checkpoint.save('audit');
      const db = await new Promise((done, fail) => { const r = indexedDB.open('vibe-coffee'); r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });
      const record = await new Promise((done) => { const r = db.transaction('kv').objectStore('kv').get('checkpoint'); r.onsuccess = () => done(r.result); });
      db.close();
      return { backend: window.__vibe.checkpoint.backend, version: record?.version, bytes: JSON.stringify(record).length,
        persisted: await navigator.storage.persisted?.() };
    })()`);
    check(name, 'checkpoint stored in IndexedDB with a version', storage.backend === 'indexeddb' && storage.version === 1, storage);
    files.push(await capture('continued', 600));

    // 5. Site data partly cleared: the preference and interface records are
    // gone but the checkpoint survived, so their values are recovered from it.
    if (!viewport.mobile) {
      await client.evaluate(`localStorage.removeItem('vibe-coffee.preferences.v1'); localStorage.removeItem('vibe-coffee.ui.v1')`);
      await reload();
      await delay(500);
      const recovered = await client.evaluate(`({
        ambience: document.querySelector('#amb-vol').value,
        textScale: getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim(),
        stored: JSON.parse(localStorage.getItem('vibe-coffee.preferences.v1'))?.ambienceVolume,
      })`);
      check(name, 'preferences and settings recovered from the checkpoint', recovered.ambience === '0.37'
        && recovered.textScale === '1.12' && recovered.stored === 0.37, recovered);
    }

    // 6. New session: same café, a fresh seat and timer.
    await reload();
    if (viewport.mobile) {
      await client.send('Emulation.setDeviceMetricsOverride', { ...metrics, width: metrics.height, height: metrics.width });
      files.push(await capture('title-continue-landscape', 1500));
      await client.send('Emulation.setDeviceMetricsOverride', metrics);
      await delay(800);
    }
    await tap('#enter-btn');
    await delay(1500);
    const fresh = await snapshot();
    check(name, 'New session starts fresh', fresh.player?.mode === 'seated' && !fresh.timer.running
      && fresh.timer.remaining === fresh.timer.minutes * 60 && fresh.cafeId === theme, { player: fresh.player, timer: fresh.timer });
    files.push(await capture('new-session'));

    // 7. IndexedDB unavailable (some private modes): localStorage carries it.
    if (!viewport.mobile) {
      await client.evaluate(`window.__vibe.face(0.4, -0.05)`);
      await delay(300);
      const marker = await client.evaluate(`window.__vibe.checkpoint.capture().player`);
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });`,
      });
      await reload();
      const fallbackTitle = await offered();
      await tap('#continue-btn');
      await delay(1500);
      const fallback = await client.evaluate(`(async () => ({ result: await window.__vibe.checkpoint.save('audit'),
        player: window.__vibe.checkpoint.capture().player }))()`);
      check(name, 'localStorage fallback restores without IndexedDB', fallbackTitle.visible
        && fallback.result?.backend === 'localStorage' && near(fallback.player?.yaw, marker.yaw, 1e-3), { fallback, marker });
      files.push(await capture('localstorage-fallback-continued'));
    }
    return files;
  } finally {
    client?.close();
    chrome.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

if (!CHROME) throw new Error('Chrome/Chromium not found; set CHROME_PATH to run the resume audit');
await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
const screenshots = {};
for (const viewport of RUN) screenshots[viewport] = await runViewport(viewport);
const failed = checks.filter((entry) => !entry.pass);
await writeFile(join(OUTPUT_DIR, 'report.json'), `${JSON.stringify({ url: APP_URL, checks, screenshots }, null, 2)}\n`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · screenshots in ${OUTPUT_DIR}`);
if (failed.length) process.exitCode = 1;
