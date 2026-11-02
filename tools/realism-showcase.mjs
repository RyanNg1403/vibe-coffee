// Actual app captures, using its selected rendering quality and explicit 30 Hz ticks.
// node tools/realism-showcase.mjs --venue=goldenhour --quality=detail [--video]
// Video samples at 24 fps; capture speed is not a hardware FPS benchmark.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBlueprint } from '../src/cafe/interiorLayouts.js';
import { MODEL_MANIFEST } from '../src/modelManifest.js';

const CHROME = process.env.CHROME_PATH ?? [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const APP_URL = process.env.VIBE_URL ?? 'http://127.0.0.1:5173/?memory-audit=1';
const RETRY_SCALE = Math.max(1, Number(process.env.VIBE_RETRY_SCALE) || 1);
const THEME_INDEX = { goldenhour: 0, roastery: 1, midnight: 2, terrace: 3 };

const args = new Map(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const VENUE = args.get('venue') ?? 'goldenhour';
const QUALITY = args.get('quality') ?? 'detail';
if (!['smooth', 'detail'].includes(QUALITY)) throw Error('Invalid quality');
const VIEW = args.get('view');
const OUT_DIR = args.get('out') ?? `docs/realism/${VENUE}`;
const DEFAULT_EYE_Y = 1.6;
const VIDEO_FPS = 24;
const VIDEO_FRAMES = Math.round(Math.max(3, Math.min(12, Number(args.get('seconds')) || 6)) * VIDEO_FPS);

const blueprint = getBlueprint(VENUE);
if (VIEW && !blueprint.auditViews.some((view) => view.id === VIEW)) {
  throw new Error(`Unknown audit view: ${VIEW}`);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function retry(task, label, attempts = 300 * RETRY_SCALE) {
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
        if (entry.type === 'error' || (entry.type === 'warning' && text.includes('[models]'))) {
          this.errors.push(text);
        }
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
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }
  close() { this.socket.close(); }
}

function lookAngles(pos, lookAt) {
  // authored views carry the eye height in pos[1] (upper-deck views sit at
  // deck + eye); fall back to standing height for legacy 2-value views
  const eyeY = pos[1] ?? DEFAULT_EYE_Y;
  const dx = lookAt[0] - pos[0];
  const dy = lookAt[1] - eyeY;
  const dz = lookAt[2] - pos[2];
  const len = Math.hypot(dx, dz) || 1;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, len) };
}

if (!CHROME) throw new Error('set CHROME_PATH');
await mkdir(OUT_DIR, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vibe-venue-shots-'));
const port = await freePort();
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-extensions', '--disable-gpu-sandbox', '--hide-scrollbars',
  '--window-size=1280,720', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
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
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('app not ready');
  }, 'app');
  await client.evaluate(`localStorage.setItem('vibe-coffee.preferences.v1', JSON.stringify({
    musicVolume: 0, ambienceVolume: 0, voicesVolume: 0, musicOn: false,
    cafeIndex: ${THEME_INDEX[VENUE]}, qualityMode: '${QUALITY}', laptopOn: true, envTime: 'auto', envSky: 'auto'
  }))`);
  await client.evaluate('location.reload()');
  await retry(async () => {
    const ready = await client.evaluate('document.readyState === "complete" && Boolean(window.__vibe)');
    if (!ready) throw new Error('app not ready after reload');
  }, 'app reload');
  await client.evaluate("document.querySelector('#enter-btn').click()");
  await retry(async () => {
    const theme = await client.evaluate('window.__vibe.metrics().theme');
    if (theme !== VENUE) throw new Error(`theme is ${theme}`);
  }, VENUE);
  await retry(async () => {
    const m = await client.evaluate('JSON.stringify({c: window.__vibe.metrics().calls, f: window.__vibe.metrics().renderedFrames})');
    const { c, f } = JSON.parse(m);
    if (c < 50 || f < 3) throw new Error('scene not rendering yet');
  }, 'scene resident');

  await client.evaluate("document.querySelector('#enter-btn').click()");
  await client.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = '#hud-top, #hud-bottom, #hint, #toast, #overlay { display:none !important; }';
    document.head.appendChild(style);
    window.captureTime = 0;
    window.advanceScene = steps => {
      for(let i=0;i<steps;i++) {
        captureTime += 1/30;
        __vibe.cafe.animate(1/30); __vibe.crowd.update(1/30,captureTime);
      }
    };
    advanceScene(60);
    __vibe.cafe.group.parent.traverse(o => {
      if(!o.isMesh)return;
      const original=o.onBeforeRender;
      o.onBeforeRender=function(renderer,scene,camera,...rest) {
        if(camera.isPerspectiveCamera) { window.captureRenderer=renderer; window.captureScene=scene; window.captureCamera=camera; }
        this.onBeforeRender=original; original.call(this,renderer,scene,camera,...rest);
      };
    });
  })()`);
  await retry(async()=>{if(!await client.evaluate('Boolean(window.captureRenderer)'))throw Error('waiting');}, 'renderer');
  await client.evaluate('window.requestAnimationFrame=()=>0');
  await delay(1500);
  const {writeFile} = await import('node:fs/promises');
  async function image(name) {
    const data=await client.evaluate(`__vibe.captureFrame(1).split(',')[1]`);
    await writeFile(join(OUT_DIR,name+'.png'),Buffer.from(data,'base64'));
    console.log('captured',name);
  }
  async function place(pos,lookAt) {
    const {yaw,pitch}=lookAngles(pos,lookAt);
    await client.evaluate(`__vibe.place(${pos[0]},${pos[2]},${yaw},${pitch}); captureCamera.position.set(${pos.join(',')}); captureCamera.lookAt(${lookAt.join(',')}); captureCamera.updateMatrixWorld(true)`);
  }
  const ids={goldenhour:['gh-salon-from-entrance','gh-salon-oval','gh-service-queue'],roastery:['ro-hall-from-entrance'],midnight:['mi-room-from-entrance'],terrace:['te-terrace-from-entrance']};
  for(const view of blueprint.auditViews.filter(v=>!args.get('collection-only') && (VIEW?v.id===VIEW:ids[VENUE].includes(v.id)))) {
    await place(view.pos,view.lookAt); await image(view.id);
  }
  if(args.get('collection') || args.get('collection-only')) {
    const collection=await client.evaluate(`(() => {
      const entries=__vibe.cafe.group.userData.venueCollections??[];
      return {count:entries.length,violations:__vibe.venueCollectionAudit(),
        items:entries.map(({key,support,bounds})=>({key,support,min:bounds.min.toArray(),max:bounds.max.toArray()}))};
    })()`);
    await writeFile(join(OUT_DIR,'collection-report.json'),JSON.stringify(collection,null,2));
    if(collection.count!==1 || collection.violations.length)throw Error('Collection placement failed: '+JSON.stringify(collection));
    const item=collection.items[0], center=item.support.shape.center;
    // Approach Midnight's wall bay from the room aisle so the window stool
    // does not obscure the record player in the foreground.
    const yaw=item.support.shape.rotation, d=VENUE==='midnight'?1.6:2.3;
    const side=VENUE==='midnight'?-1.65:.48;
    const aimY=item.support.y+(item.max[1]-item.support.y)*.42;
    const pos=[center.x+Math.sin(yaw)*d+Math.cos(yaw)*side,aimY+(VENUE==='midnight'?.65:.48),
      center.z+Math.cos(yaw)*d-Math.sin(yaw)*side];
    await client.evaluate('captureCamera.fov=44;captureCamera.updateProjectionMatrix()');
    await place(pos,[center.x,aimY,center.z]);
    await image('collection-detail');
    await client.evaluate('captureCamera.fov=62;captureCamera.updateProjectionMatrix()');
  }
  if(VENUE==='goldenhour' && !args.get('views-only')) {
    const chair=await client.evaluate(`(() => {
      const seat=__vibe.cafe.seats.find((s,i)=>!s.isBar&&!__vibe.crowd.takenSeats.has(i)&&Math.abs(s.pos.x)<6);
      return seat?{x:seat.pos.x,z:seat.pos.z,yaw:seat.facingYaw}:null;
    })()`);
    if(chair) {
      await place([chair.x+Math.sin(chair.yaw)*1.6+Math.cos(chair.yaw)*1.1,.95,chair.z+Math.cos(chair.yaw)*1.6-Math.sin(chair.yaw)*1.1],[chair.x,.46,chair.z]);
      await image('furniture-detail');
    }
    await place([-.7,1.45,-3.55],[-2.15,1.29,-5.2]);
    await image('counter-detail');
    const subject=await client.evaluate(`(() => {
      const npc=__vibe.crowd.npcs.find(n=>n.state==='sitting' && !__vibe.cafe.seats[n.seatIndex]?.isBar);
      if(!npc)return null;
      const p=npc.mesh.position,yaw=npc.mesh.rotation.y;
      return {x:p.x,z:p.z,y:p.y,yaw,key:npc.avatar?.key};
    })()`);
    if(subject) {
      await place([subject.x+Math.sin(subject.yaw)*1.8+Math.cos(subject.yaw)*1.2,1.45,subject.z+Math.cos(subject.yaw)*1.8-Math.sin(subject.yaw)*1.2],[subject.x,.95,subject.z]);
      await image('npc-seated');
    }
    if(args.get('video')) {
      await client.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
      await delay(1000);
      const subject=await client.evaluate(`(() => {
        for(let tick=0;tick<12000;tick++) {
          advanceScene(1);
          const npc=__vibe.crowd.npcs.find(n=> n.state==='toSeat' && n.path && n.pathI===n.path.length-1 && !__vibe.cafe.seats[n.seatIndex].isBar && Math.abs(n.mesh.position.x)<6 && n.mesh.position.distanceTo(__vibe.cafe.seats[n.seatIndex].approach)<.9);
          if(npc) { window.captureSubject=npc;const seat=__vibe.cafe.seats[npc.seatIndex],yaw=seat.facingYaw;
            return {key:npc.avatar.key,x:seat.pos.x,z:seat.pos.z,cameraX:seat.approach.x+Math.cos(yaw)*2.4-Math.sin(yaw)*1.2,cameraZ:seat.approach.z-Math.sin(yaw)*2.4-Math.cos(yaw)*1.2}; }
        }
        throw Error('No seating transition');
      })()`);
      await place([subject.cameraX,1.6,subject.cameraZ],[subject.x,.95,subject.z]);
      await image('npc-arriving');
      const frames=join(OUT_DIR,'frames');await mkdir(frames,{recursive:true});
      for(let frame=0;frame<VIDEO_FRAMES;frame++) {
        const tick=(frame+1)*30/24,previous=frame*30/24;
        const steps=Math.floor(tick+1e-9)-Math.floor(previous+1e-9),alpha=tick-Math.floor(tick+1e-9);
        const data=await client.evaluate(`(() => {
          advanceScene(${steps});return __vibe.captureFrame(${Math.max(0,alpha)},'image/jpeg').split(',')[1];
        })()`);
        await writeFile(join(frames,String(frame).padStart(5,'0')+'.jpg'),Buffer.from(data,'base64'));
        if(frame%24===0)console.log('video frame',frame);
      }
      await image('npc-settled');
      await writeFile(join(OUT_DIR,'video-report.json'),JSON.stringify({subject,frames:VIDEO_FRAMES,fps:VIDEO_FPS,finalState:await client.evaluate('captureSubject.state'),errors:client.errors},null,2));
    }
  }
  if(args.get('verify-assets')) {
    const assets=await client.evaluate(`({ models:__vibe.crowd.models?.size, photographicEnvironment:!!captureScene.background?.isTexture, diversity:__vibe.crowd.characterDiversityReport(), externalResourceRequests:performance.getEntriesByType('resource').filter(entry=>/^https?:/.test(entry.name)).map(entry=>entry.name) })`);
    await writeFile(join(OUT_DIR,'asset-check.json'),JSON.stringify(assets,null,2));
    if(assets.models!==Object.keys(MODEL_MANIFEST).length || !assets.photographicEnvironment || assets.diversity.maxCopies>2 || !assets.diversity.allocationsMatch) {
      throw Error('Asset integration failed: '+JSON.stringify(assets));
    }
    if(args.get('standalone') && assets.externalResourceRequests.length) {
      throw Error('Standalone edition requested external resources: '+JSON.stringify(assets.externalResourceRequests));
    }
  }
  const feet=await client.evaluate(`__vibe.crowd.npcs.filter(n=>n.state==='sitting').map(n=>{
    n.mesh.updateMatrixWorld(true);let min=Infinity;const p=n.mesh.position.clone();
    n.mesh.traverse(o=>{if(o.isSkinnedMesh)for(let i=0;i<o.geometry.attributes.position.count;i++){
      o.getVertexPosition(i,p);p.applyMatrix4(o.matrixWorld);min=Math.min(min,p.y);
    }});
    return {key:n.avatar.key,minY:min,rootY:n.mesh.position.y,bar:!!__vibe.cafe.seats[n.seatIndex].isBar};
  })`);
  await writeFile(join(OUT_DIR,'seating-report.json'),JSON.stringify(feet,null,2));
  await writeFile(join(OUT_DIR,'runtime-report.json'),JSON.stringify({venue:VENUE,metrics:await client.evaluate('__vibe.metrics()'),errors:client.errors},null,2));
  if(client.errors.length)throw Error(client.errors.join('\n'));
} finally {
  client?.close();chrome.kill('SIGTERM');await delay(2000);
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:400}).catch(()=>{});
}
