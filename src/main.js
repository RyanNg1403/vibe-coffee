import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { THEMES, ROOM, buildCafe } from './cafe.js';
import { CrowdSim } from './npc.js';
import { CafeAudio } from './audio.js';
import { loadModelLibrary, cloneModel } from './modelLoader.js';

// ---------- renderer / scene ----------

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 60);

// image-based environment lighting: gives every PBR material soft reflected
// room light instead of the flat "primitive" look of pure analytic lights
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// post-processing chain. A multisampled render target restores the MSAA the
// composer would otherwise throw away (clean edges), GTAO adds real contact
// darkening in corners and under furniture, and bloom makes the lamps glow.
const W0 = window.innerWidth, H0 = window.innerHeight;
const rt = new THREE.WebGLRenderTarget(W0, H0, {
  samples: 4,
  type: THREE.HalfFloatType,
  colorSpace: THREE.SRGBColorSpace,
});
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));

// GTAO reads the rendered depth/normals and multiplies soft occlusion in
const gtaoPass = new GTAOPass(scene, camera, W0, H0);
gtaoPass.output = GTAOPass.OUTPUT.Default;
gtaoPass.updateGtaoMaterial({
  radius: 0.5,
  distanceExponent: 1.0,
  thickness: 1.0,
  scale: 1.0,
  samples: 16,
  distanceFallOff: 1.0,
  screenSpaceRadius: false,
});
gtaoPass.blendIntensity = 0.85;
composer.addPass(gtaoPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(W0, H0), 0.25, 0.5, 0.85
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// a whisper of vignette + film grain, the "3am ambience video" finish
const grainPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * 0.55;          // gentle corner falloff
      float g = (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * 0.028;
      gl_FragColor = vec4(c.rgb * vig + g, c.a);
    }`,
});
composer.addPass(grainPass);

const audio = new CafeAudio();

// ---------- state ----------

let cafe = null;
let crowd = null;
let currentThemeIndex = 0;
let seatIndex = -1;
let mode = 'seated'; // 'seated' | 'walking'
const walkPos = new THREE.Vector3();
let walkBob = 0;
let lastPlayerStep = 0;
const keys = new Set();

const EYE_HEIGHT = 1.16;
const STAND_EYE = 1.55;
const view = { yaw: 0, pitch: 0 };
const tween = { active: false, t: 0, dur: 1.4, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromQ: new THREE.Quaternion(), toQ: new THREE.Quaternion() };

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// highlight ring shown over the hovered chair
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.34, 0.025, 10, 36),
  new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.9 })
);
ring.rotation.x = Math.PI / 2;
ring.visible = false;

// ---------- seats / camera ----------

function seatEye(seat) {
  return new THREE.Vector3(seat.pos.x, seat.pos.y + EYE_HEIGHT, seat.pos.z);
}

function anglesFromLook(eye, look) {
  const d = new THREE.Vector3().subVectors(look, eye).normalize();
  return {
    yaw: Math.atan2(-d.x, -d.z),
    pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
  };
}

function applyView() {
  camera.quaternion.setFromEuler(new THREE.Euler(view.pitch, view.yaw, 0, 'YXZ'));
}

function sitAt(index, instant = false) {
  const seat = cafe.seats[index];
  if (crowd) crowd.setPlayerSeat(index);
  seatIndex = index;
  mode = 'seated';
  updateWalkBtn();
  if (!instant && audio.started) audio.playChairScrape(seat.pos);

  const eye = seatEye(seat);
  const a = anglesFromLook(eye, seat.look);

  if (instant) {
    camera.position.copy(eye);
    view.yaw = a.yaw; view.pitch = a.pitch;
    applyView();
    return;
  }
  // glide over to the new seat
  tween.active = true;
  tween.t = 0;
  tween.fromPos.copy(camera.position);
  tween.toPos.copy(eye);
  tween.fromQ.copy(camera.quaternion);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.pitch, a.yaw, 0, 'YXZ'));
  tween.toQ.copy(q);
  view.yaw = a.yaw; view.pitch = a.pitch;
}

function defaultSeat() {
  // prefer a chair (not stool) at an empty table, looking into the room
  let best = 0, bestScore = -Infinity;
  cafe.seats.forEach((s, i) => {
    if (crowd?.isSeatTaken(i)) return;
    const dir = new THREE.Vector3().subVectors(s.look, s.pos).setY(0).normalize();
    const toCenter = new THREE.Vector3(0, 0, -1);
    let score = dir.dot(toCenter) + (s.pos.y < 0.05 ? 0.5 : 0);
    // avoid tables where someone is already sitting
    cafe.seats.forEach((o, j) => {
      if (crowd?.isSeatTaken(j) && o.tableCenter.distanceTo(s.tableCenter) < 0.01) score -= 3;
    });
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// ---------- scene switching ----------

let loadToken = 0;
let variantOn = false;
let lastModels = null;
let playerCup = null;
let orderPending = false;
function activeTheme(index = currentThemeIndex) {
  const base = THEMES[index];
  return variantOn && base.variant ? { ...base, ...base.variant } : base;
}
async function loadTheme(index) {
  currentThemeIndex = index;
  const theme = activeTheme(index);
  const token = ++loadToken;
  const models = await loadModelLibrary();
  if (token !== loadToken) return; // a newer switch superseded this one
  lastModels = models;
  playerCup = null; // the old room takes the old cup with it

  if (crowd) { crowd.dispose(); crowd = null; }
  if (cafe) {
    scene.remove(cafe.group);
    cafe.dispose();
    cafe = null;
  }

  cafe = buildCafe(theme, models);
  scene.add(cafe.group);
  cafe.group.add(ring);

  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);
  scene.background = new THREE.Color(theme.fog.color);
  renderer.toneMappingExposure = theme.exposure;
  scene.environmentIntensity = theme.envIntensity ?? 0.35;
  bloomPass.strength = theme.bloom ?? 0.25;

  crowd = new CrowdSim(cafe, audio, models);
  audio.setAnchors({ counter: cafe.nav.machineWorld, door: cafe.nav.door });
  audio.setClinkSpots([]);
  audio.setTypingSpots([]);
  audio.setTheme(theme);

  const s = defaultSeat();
  crowd.setPlayerSeat(s);
  sitAt(s, true);

  document.querySelectorAll('.loc-btn').forEach((b, i) => {
    b.classList.toggle('active', i === index);
  });
  document.getElementById('blurb').textContent = theme.blurb;
  const vb = document.getElementById('variant-btn');
  if (vb) {
    const base = THEMES[index];
    vb.textContent = '☀ ' + (variantOn && base.variant ? base.variant.name : base.varName ?? 'now');
  }
}

document.getElementById('variant-btn')?.addEventListener('click', () => {
  variantOn = !variantOn;
  loadTheme(currentThemeIndex);
});

// order a drink: the barista actually makes it, then it lands on your table
document.getElementById('order-btn')?.addEventListener('click', () => {
  if (!crowd || !cafe) return;
  if (seatIndex < 0) { toast('find a seat first — click any free chair'); return; }
  if (orderPending) { toast('your drink is already on its way ☕'); return; }
  if (playerCup) { cafe.group.remove(playerCup); playerCup = null; }
  const ok = crowd.orderDrink(() => {
    orderPending = false;
    if (seatIndex < 0 || !cafe) return; // stood up meanwhile
    const seat = cafe.seats[seatIndex];
    const cup = cloneModel(lastModels, Math.random() < 0.5 ? 'latte' : 'mug');
    if (!cup) return;
    // set it down between you and the middle of the table
    const tc = seat.tableCenter;
    const topY = seat.pos.y > 0.05 ? 1.03 : (seat.tableTopY ?? 0.81);
    cup.position.set(
      tc.x + (seat.pos.x - tc.x) * 0.45,
      topY,
      tc.z + (seat.pos.z - tc.z) * 0.45
    );
    cafe.group.add(cup);
    playerCup = cup;
    toast('order up — enjoy ☕');
  });
  if (ok) {
    orderPending = true;
    toast('coming right up…');
    setTimeout(() => { orderPending = false; }, 20000); // safety net
  } else {
    toast('the barista has their hands full — one moment');
  }
});

// ---------- walk mode ----------

function standUp() {
  if (mode === 'walking' || tween.active || !cafe) return;
  mode = 'walking';
  seatIndex = -1;
  if (crowd) crowd.setPlayerSeat(-1);
  walkPos.set(camera.position.x, 0, camera.position.z);
  resolveCollisions(walkPos);
  updateWalkBtn();
}

function updateWalkBtn() {
  const b = document.getElementById('walk-btn');
  if (b) b.textContent = mode === 'walking' ? 'click a chair to sit' : 'stand up & walk';
}

function resolveCollisions(p) {
  p.x = THREE.MathUtils.clamp(p.x, -ROOM.W / 2 + 0.45, ROOM.W / 2 - 0.45);
  p.z = THREE.MathUtils.clamp(p.z, -ROOM.D / 2 + 0.5, ROOM.D / 2 - 0.5);
  if (!cafe) return;
  for (const c of cafe.colliders) {
    if (c.rect) {
      const r = c.rect, m = 0.3;
      if (p.x > r.x0 - m && p.x < r.x1 + m && p.z > r.z0 - m && p.z < r.z1 + m) {
        const dxl = p.x - (r.x0 - m), dxr = (r.x1 + m) - p.x;
        const dzl = p.z - (r.z0 - m), dzr = (r.z1 + m) - p.z;
        const min = Math.min(dxl, dxr, dzl, dzr);
        if (min === dxl) p.x = r.x0 - m;
        else if (min === dxr) p.x = r.x1 + m;
        else if (min === dzl) p.z = r.z0 - m;
        else p.z = r.z1 + m;
      }
    }
    if (c.r) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.r && d > 0.001) {
        p.x = c.x + (dx / d) * c.r;
        p.z = c.z + (dz / d) * c.r;
      }
    }
  }
}

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
  if (!MOVE_KEYS.includes(e.code)) return;
  e.preventDefault();
  keys.add(e.code);
  if (mode === 'seated') standUp();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---------- input: drag to look, click chair to move ----------

let dragging = false;
let dragMoved = 0;
let lastX = 0, lastY = 0;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragMoved = 0;
  lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  lastX = e.clientX; lastY = e.clientY;
  if (tween.active) return;
  view.yaw -= dx * 0.0032;
  view.pitch = THREE.MathUtils.clamp(view.pitch - dy * 0.0028, -1.1, 1.15);
  applyView();
});

canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  if (dragMoved > 6 || tween.active) return;
  // treat as a click: try to pick a seat
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  const hit = pickSeat();
  if (hit >= 0) {
    if (crowd.isSeatTaken(hit)) {
      toast('Someone’s sitting there — pick another spot ☕');
    } else if (hit !== seatIndex) {
      crowd.setPlayerSeat(hit);
      sitAt(hit);
    }
  }
});

function pickSeat() {
  if (!cafe) return -1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cafe.seatMeshes, true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.userData.seatIndex === undefined) o = o.parent;
    if (o) return o.userData.seatIndex;
  }
  return -1;
}

// ---------- UI ----------

const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

document.querySelectorAll('.loc-btn:not(#variant-btn)').forEach((b, i) => {
  b.addEventListener('click', () => {
    if (i !== currentThemeIndex) loadTheme(i);
  });
});

document.getElementById('walk-btn').addEventListener('click', () => {
  if (mode === 'seated') standUp();
  else toast('Click any free chair to sit back down ☕');
});

const musicToggle = document.getElementById('music-toggle');
musicToggle.addEventListener('click', () => {
  const on = musicToggle.classList.toggle('on');
  audio.setMusicOn(on);
  musicToggle.textContent = on ? '♪ music on' : '♪ music off';
});

document.getElementById('music-vol').addEventListener('input', (e) => {
  audio.setMusicVolume(parseFloat(e.target.value));
});
document.getElementById('amb-vol').addEventListener('input', (e) => {
  audio.setAmbienceVolume(parseFloat(e.target.value));
});
document.getElementById('voices-vol').addEventListener('input', (e) => {
  audio.setVoicesVolume(parseFloat(e.target.value));
});

// focus timer (pomodoro-style 25/5)
const timerEl = document.getElementById('timer-display');
const timerBtn = document.getElementById('timer-btn');
let timerRunning = false, timerBreak = false, timerLeft = 25 * 60;
function renderTimer() {
  const m = String(Math.floor(timerLeft / 60)).padStart(2, '0');
  const s = String(Math.floor(timerLeft % 60)).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
  timerEl.classList.toggle('break', timerBreak);
}
timerBtn.addEventListener('click', () => {
  timerRunning = !timerRunning;
  timerBtn.textContent = timerRunning ? '❚❚' : '▶';
});
document.getElementById('timer-reset').addEventListener('click', () => {
  timerRunning = false; timerBreak = false; timerLeft = 25 * 60;
  timerBtn.textContent = '▶';
  renderTimer();
});
renderTimer();

// enter overlay — also unlocks the AudioContext
const overlay = document.getElementById('overlay');
document.getElementById('enter-btn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  audio.start(activeTheme());
  audio.setMusicOn(musicToggle.classList.contains('on'));
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  gtaoPass.setSize(window.innerWidth, window.innerHeight);
});

// ---------- main loop ----------

const clock = new THREE.Clock();
let elapsed = 0;
let lastListenerSync = 0;
let simAcc = 0;
const SIM_STEP = 1 / 30;

function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clock.getDelta(), 3.0); // real time, survives slow frames
  const dt = Math.min(rawDt, 0.05);              // camera/interaction step
  elapsed += rawDt;

  // the life of the room runs on real time in fixed substeps, so a slow
  // renderer or a throttled tab never turns the crowd into a wax museum
  simAcc = Math.min(simAcc + rawDt, 3.0);
  while (simAcc >= SIM_STEP) {
    simAcc -= SIM_STEP;
    if (cafe) cafe.animate(SIM_STEP);
    if (crowd) crowd.update(SIM_STEP, elapsed - simAcc, camera.position);
  }

  // camera tween between seats
  if (tween.active) {
    tween.t += dt / tween.dur;
    const k = easeInOut(Math.min(tween.t, 1));
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    // arc up slightly mid-flight, like standing and walking over
    camera.position.y += Math.sin(k * Math.PI) * 0.35;
    camera.quaternion.slerpQuaternions(tween.fromQ, tween.toQ, k);
    if (tween.t >= 1) {
      tween.active = false;
      applyView();
    }
  } else if (mode === 'walking' && cafe) {
    // first-person stroll
    const fwd = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    const right = new THREE.Vector3(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
    const move = new THREE.Vector3();
    if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
    const moving = move.lengthSq() > 0;
    if (moving) {
      move.normalize();
      walkPos.addScaledVector(move, dt * 2.0);
      resolveCollisions(walkPos);
      walkBob += dt * 8;
      // your own footsteps
      const stepNow = Math.floor(walkBob / Math.PI);
      if (stepNow !== lastPlayerStep) {
        lastPlayerStep = stepNow;
        if (audio.started) audio.playFootstep(walkPos, 0.55);
      }
    }
    camera.position.set(
      walkPos.x,
      STAND_EYE + (moving ? Math.abs(Math.sin(walkBob)) * 0.03 : Math.sin(elapsed * 1.1) * 0.008),
      walkPos.z
    );
  } else if (seatIndex >= 0 && cafe) {
    // subtle breathing sway while seated
    const seat = cafe.seats[seatIndex];
    const eye = seatEye(seat);
    camera.position.set(
      eye.x + Math.sin(elapsed * 0.5) * 0.006,
      eye.y + Math.sin(elapsed * 1.1) * 0.008,
      eye.z + Math.cos(elapsed * 0.43) * 0.006
    );
  }

  // keep the audio engine's ears where the eyes are (throttled)
  if (audio.started && elapsed - lastListenerSync > 0.08) {
    lastListenerSync = elapsed;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    audio.setListener(camera.position, fwd);
  }

  // hover highlight
  if (cafe && !tween.active && !dragging) {
    const hit = pickSeat();
    if (hit >= 0 && hit !== seatIndex) {
      const seat = cafe.seats[hit];
      ring.position.set(seat.pos.x, seat.pos.y + 0.72, seat.pos.z);
      ring.visible = true;
      ring.material.color.set(crowd.isSeatTaken(hit) ? 0xd06050 : 0xffe2a8);
      ring.material.opacity = 0.6 + Math.sin(elapsed * 5) * 0.25;
      canvas.style.cursor = 'pointer';
    } else {
      ring.visible = false;
      canvas.style.cursor = 'grab';
    }
  } else {
    ring.visible = false;
  }

  // focus mode gently dims the room; break/idle brings the light back
  {
    const baseExp = activeTheme().exposure;
    const targetExp = timerRunning && !timerBreak ? baseExp * 0.84 : baseExp;
    renderer.toneMappingExposure += (targetExp - renderer.toneMappingExposure) * Math.min(1, dt * 1.5);
  }

  // focus timer
  if (timerRunning) {
    timerLeft -= rawDt;
    if (timerLeft <= 0) {
      timerBreak = !timerBreak;
      timerLeft = (timerBreak ? 5 : 25) * 60;
      if (audio.started) { audio.playChime(); }
      toast(timerBreak ? 'Break time — stretch a little 🌿' : 'Back to focus ☕');
    }
    renderTimer();
  }

  grainPass.uniforms.uTime.value = elapsed % 10;
  composer.render();
}

loadTheme(0);
frame();

// tiny debug handle for automated tests: place the camera, inspect audio
window.__vibe = {
  audio,
  get crowd() { return crowd; },
  place(x, z, yaw, pitch = 0) {
    standUp();
    walkPos.set(x, 0, z);
    view.yaw = yaw; view.pitch = pitch;
    applyView();
  },
};
