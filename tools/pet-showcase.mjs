// Close-ups and a 4-second actual-app pet movement reel.
// CHROME_PATH=... VIBE_URL=http://127.0.0.1:4173/?memory-audit=1 node tools/pet-showcase.mjs --video
// Only destinations are staged; models, gait, steering, lighting and rendering are the live app.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const KINDS = args.get('kind') ? [args.get('kind')] : ['cat','dog'];
if(KINDS.some(kind=>!['cat','dog'].includes(kind)))throw Error('Invalid pet kind');
if (!['smooth', 'detail'].includes(QUALITY)) throw Error('Invalid quality');
const OUT_DIR = args.get('out') ?? 'docs/realism/pets';
const DEFAULT_EYE_Y = 1.6;
const VIDEO_FPS = 24;
const FRAMES_PER_PET = 48;
const VIDEO_FRAMES = FRAMES_PER_PET * KINDS.length;

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
const profile = await mkdtemp(join(tmpdir(), 'vibe-pet-shots-'));
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
    window.petMotion = {cat:{ticks:0,maxStep:0,maxYaw:0},dog:{ticks:0,maxStep:0,maxYaw:0}};
    window.advanceScene = steps => {
      for(let i=0;i<steps;i++) {
        captureTime += 1/30;
        __vibe.cafe.animate(1/30); __vibe.crowd.update(1/30,captureTime);
        const previous = __vibe.pets.pets.map(p => ({p, position:p.mesh.position.clone(), yaw:p.mesh.rotation.y}));
        __vibe.pets.update(1/30, __vibe.crowd, null);
        for (const before of previous) {
          const p = before.p, stats = petMotion[p.kind];
          const yaw = p.mesh.rotation.y - before.yaw;
          stats.ticks++;
          stats.maxStep = Math.max(stats.maxStep, before.position.distanceTo(p.mesh.position));
          stats.maxYaw = Math.max(stats.maxYaw, Math.abs(Math.atan2(Math.sin(yaw),Math.cos(yaw))));
        }
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
  async function image(name) {
    const data=await client.evaluate(`__vibe.captureFrame(1).split(',')[1]`);
    await writeFile(join(OUT_DIR,name+'.png'),Buffer.from(data,'base64'));
    console.log('captured',name);
  }
  async function place(pos,lookAt) {
    const {yaw,pitch}=lookAngles(pos,lookAt);
    await client.evaluate(`__vibe.place(${pos[0]},${pos[2]},${yaw},${pitch}); captureCamera.position.set(${pos.join(',')}); captureCamera.lookAt(${lookAt.join(',')}); captureCamera.updateMatrixWorld(true)`);
  }

  const report = { venue:VENUE, quality:QUALITY, frames:args.get('video') ? VIDEO_FRAMES : 0, fps:VIDEO_FPS,
    staging:'Actual pet positions; only a clear walking destination and close-up camera are staged.', pets:[], errors:[] };
  await client.evaluate(`(() => {
    window.clearPetTarget = p => {
      const pos = p.mesh.position;
      if (pos.z > 5.7 || pos.z < -4.5 || Math.abs(pos.x) > 7) return null;
      for (const angle of [0,.6,-.6,1.2,-1.2,Math.PI,-2,2]) {
        const yaw=p.mesh.rotation.y+angle, dx=Math.sin(yaw)*1.8, dz=Math.cos(yaw)*1.8;
        let clear=true;
        for(let i=1;i<=18&&clear;i++) {
          const x=pos.x+dx*i/18,z=pos.z+dz*i/18;
          if(Math.abs(x)>7||z>5.65||z< -4.5) {clear=false;break;}
          for(const c of __vibe.cafe.colliders) {
            if((c.levelId??'ground')!=='ground')continue;
            if(c.r && Math.hypot(x-c.x,z-c.z)<c.r+.24) {clear=false;break;}
            if(c.rect && x>c.rect.x0-.24 && x<c.rect.x1+.24 && z>c.rect.z0-.24 && z<c.rect.z1+.24) {clear=false;break;}
          }
        }
        if(clear)return {x:pos.x+dx,z:pos.z+dz};
      }
      return null;
    };
    const placements=(__vibe.cafe.group.userData.placedUnits??[]).filter(unit=> {
      const b=unit.bounds;
      return b && b.max.x-b.min.x<3 && b.max.z-b.min.z<3 && b.max.y>.05;
    }).map(unit=>unit.bounds);
    const segmentHits=(origin,target,box)=> {
      let enter=0,exit=1;
      for(const axis of ['x','y','z']) {
        const delta=target[axis]-origin[axis];
        if(Math.abs(delta)<1e-8) {if(origin[axis]<box.min[axis]||origin[axis]>box.max[axis])return false;continue;}
        let a=(box.min[axis]-origin[axis])/delta,b=(box.max[axis]-origin[axis])/delta;
        if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);if(enter>exit)return false;
      }
      return exit>.005&&enter<.995;
    };
    window.findPetView = pet => {
      const p=pet.mesh.position,forward=pet.mesh.getWorldDirection(p.clone()),d=pet.kind==='cat'?1.25:1.6;
      for(const [ahead,side] of [[.6,.8],[.6,-.8],[.85,.53],[.85,-.53],[1,0],[.35,.937],[.35,-.937]]) {
        const camera={x:p.x+(forward.x*ahead+forward.z*side)*d,y:pet.kind==='cat'?.51:.73,z:p.z+(forward.z*ahead-forward.x*side)*d};
        const aimY=pet.kind==='cat'?.18:.28;
        const targets=[-.12,0,.16].map(offset=>({x:p.x+forward.x*offset,y:aimY,z:p.z+forward.z*offset}));
        if(targets.every(target=>!placements.some(box=>segmentHits(camera,target,box))))return {ahead,side};
      }
      return null;
    };
    window.followPet = alpha => {
      __vibe.pets.interpolate(alpha);
      const p=capturePet.mesh.position,forward=capturePet.mesh.getWorldDirection(p.clone()),d=capturePet.kind==='cat'?1.25:1.6;
      const {ahead,side}=capturePetView;
      const x=p.x+(forward.x*ahead+forward.z*side)*d;
      const z=p.z+(forward.z*ahead-forward.x*side)*d;
      const y=capturePet.kind==='cat'?.51:.73, aimY=capturePet.kind==='cat'?.18:.28;
      __vibe.place(x,z,0,0);captureCamera.position.set(x,y,z);
      captureCamera.fov=45;captureCamera.updateProjectionMatrix();
      captureCamera.lookAt(p.x,aimY,p.z);captureCamera.updateMatrixWorld(true);
      __vibe.pets.restoreSimulationPose();
    };
    window.petProofFrame = alpha => {
      const nodes=capturePet.motionNodes;
      const before=nodes.map(n=>[...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()]);
      followPet(alpha);
      const data=__vibe.captureFrame(alpha,'image/jpeg');
      const error=Math.max(...nodes.map((n,i)=>Math.max(...[...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()].map((v,j)=>Math.abs(v-before[i][j])))));
      return {data:data.split(',')[1],restoreError:error,state:capturePet.state,mode:capturePet.mode};
    };
  })()`);
  let frameIndex=0;
  const frameDir=join(OUT_DIR,'frames');
  if(args.get('video'))await mkdir(frameDir,{recursive:true});
  for(const kind of KINDS) {
    const subject=await client.evaluate(`(() => {
      for(let tick=0;tick<7200;tick++) {
        const pet=__vibe.pets.pets.find(p=>p.kind==='${kind}'&&!p.dead&&p.state!=='leaving');
        const target=pet&&clearPetTarget(pet);
        if(target&&findPetView(pet)) {
          window.capturePet=pet;
          const originalState=pet.state, start=pet.mesh.position.toArray();
          pet._walkTo(target.x,target.z);advanceScene(15);
          window.capturePetView=findPetView(pet);
          if(!capturePetView)continue;
          return {kind:pet.kind,key:'pet_'+pet.kind,originalState,start,target,bones:pet.motionNodes.length-1};
        }
        advanceScene(1);
      }
      throw Error('No ${kind} with a clear walking route');
    })()`);
    await client.send('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false });
    await delay(500);
    await client.evaluate('followPet(1)');
    await image(kind+'-close');
    let maxRestoreError=0;
    if(args.get('video')) {
      await client.send('Emulation.setDeviceMetricsOverride', { width:960, height:540, deviceScaleFactor:1, mobile:false });
      await delay(500);
      for(let frame=0;frame<FRAMES_PER_PET;frame++) {
        const tick=(frame+1)*30/VIDEO_FPS,previous=frame*30/VIDEO_FPS;
        const steps=Math.floor(tick+1e-9)-Math.floor(previous+1e-9),alpha=Math.max(0,tick-Math.floor(tick+1e-9));
        const result=await client.evaluate('(()=>{advanceScene('+steps+');return petProofFrame('+alpha+');})()');
        maxRestoreError=Math.max(maxRestoreError,result.restoreError);
        await writeFile(join(frameDir,String(frameIndex++).padStart(5,'0')+'.jpg'),Buffer.from(result.data,'base64'));
        if(frame%24===0)console.log(kind,'video frame',frame);
      }
    }
    const end=await client.evaluate('({position:capturePet.mesh.position.toArray(),state:capturePet.state,mode:capturePet.mode})');
    report.pets.push({...subject,end,maxRestoreError});
    if(maxRestoreError>1e-6)throw Error('Render interpolation changed pet simulation pose');
    if(args.get('video')&&Math.hypot(end.position[0]-subject.start[0],end.position[2]-subject.start[2])<.35)throw Error('Pet did not move enough for a useful gait capture');
  }
  report.motion=await client.evaluate('petMotion');
  report.metrics=await client.evaluate('__vibe.metrics()');
  report.errors=client.errors;
  await writeFile(join(OUT_DIR,args.get('video')?'pet-report.json':args.get('kind')?args.get('kind')+'-stills-report.json':'pet-stills-report.json'),JSON.stringify(report,null,2));
  for(const [kind,stats] of Object.entries(report.motion)) {
    const speed=kind==='cat'?.5:.62;
    if(stats.maxStep>speed/30+1e-6 || stats.maxYaw>3.6/30+1e-6)throw Error('Unbounded '+kind+' movement: '+JSON.stringify(stats));
  }
  if(client.errors.length)throw Error(client.errors.join('\n'));
  console.log(JSON.stringify(report,null,2));
} finally {
  client?.close();chrome.kill('SIGTERM');await delay(2000);
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:400}).catch(()=>{});
}
