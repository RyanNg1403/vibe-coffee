import * as THREE from 'three';
import { THEMES, buildCafe } from './cafe.js';
import { CrowdSim } from './npc.js';
import { CafeAudio } from './audio.js';

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

const audio = new CafeAudio();

// ---------- state ----------

let cafe = null;
let crowd = null;
let currentThemeIndex = 0;
let seatIndex = -1;

const EYE_HEIGHT = 1.16;
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
  if (crowd) {
    if (seatIndex >= 0) crowd.setPlayerSeat(index);
    else crowd.setPlayerSeat(index);
  }
  seatIndex = index;

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

function loadTheme(index) {
  currentThemeIndex = index;
  const theme = THEMES[index];

  if (crowd) { crowd.dispose(); crowd = null; }
  if (cafe) {
    scene.remove(cafe.group);
    cafe.dispose();
    cafe = null;
  }

  cafe = buildCafe(theme);
  scene.add(cafe.group);
  cafe.group.add(ring);

  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);
  scene.background = new THREE.Color(theme.fog.color);
  renderer.toneMappingExposure = theme.exposure;

  crowd = new CrowdSim(cafe, audio);
  audio.setTheme(theme);

  const s = defaultSeat();
  crowd.setPlayerSeat(s);
  sitAt(s, true);

  document.querySelectorAll('.loc-btn').forEach((b, i) => {
    b.classList.toggle('active', i === index);
  });
  document.getElementById('blurb').textContent = theme.blurb;
}

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

document.querySelectorAll('.loc-btn').forEach((b, i) => {
  b.addEventListener('click', () => {
    if (i !== currentThemeIndex) loadTheme(i);
  });
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
  audio.start(THEMES[currentThemeIndex]);
  audio.setMusicOn(musicToggle.classList.contains('on'));
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- main loop ----------

const clock = new THREE.Clock();
let elapsed = 0;

function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (cafe) cafe.animate(dt);
  if (crowd) crowd.update(dt, elapsed);

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

  // focus timer
  if (timerRunning) {
    timerLeft -= dt;
    if (timerLeft <= 0) {
      timerBreak = !timerBreak;
      timerLeft = (timerBreak ? 5 : 25) * 60;
      if (audio.started) { audio.playChime(); }
      toast(timerBreak ? 'Break time — stretch a little 🌿' : 'Back to focus ☕');
    }
    renderTimer();
  }

  renderer.render(scene, camera);
}

loadTheme(0);
frame();
