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
import { loadPreferences, savePreferences } from './preferences.js';

const preferences = loadPreferences();
// A deterministic lifecycle probe used by the checked-in P0 benchmark. It
// freezes autonomous crowd churn so renderer counts compare equivalent scenes
// instead of different random patron populations. Normal visits are unchanged.
const MEMORY_AUDIT_MODE = new URLSearchParams(window.location.search).has('memory-audit');
function resetMemoryAuditRandom(themeIndex) {
  if (!MEMORY_AUDIT_MODE) return;
  // Make every rebuild of a location contain the same patrons and procedural
  // props. This keeps the renderer lifecycle benchmark comparable without
  // changing the normal experience's variety.
  let state = (0x9e3779b9 ^ ((themeIndex + 1) * 0x85ebca6b)) >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- renderer / scene ----------

const canvas = document.getElementById('scene');
// The scene is rendered through a multisampled composer target, so enabling
// antialiasing on the (fullscreen-quad-only) default framebuffer duplicates
// work without improving geometry edges.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.5);
const MIN_PIXEL_RATIO = Math.min(MAX_PIXEL_RATIO, 0.75);
// Start Auto at a predictable 1x render target. It can add effects and extra
// supersampling after a sustained period of headroom, instead of allocating the
// largest half-float buffers first and stuttering while it backs down.
let renderPixelRatio = Math.min(MAX_PIXEL_RATIO, 1);
renderer.setPixelRatio(renderPixelRatio);
// CSS owns the canvas dimensions. Avoid inline pixel dimensions here: they
// become stale when a browser enters fullscreen without a conventional resize.
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Crowd motion is simulated at 30 Hz, so refreshing its shadows faster only
// re-renders the same poses. The main loop requests a shadow update at 30 Hz.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// EffectComposer issues several renderer calls per frame. Disable Three's
// per-call reset so diagnostics capture the complete frame instead of only the
// final fullscreen output pass.
renderer.info.autoReset = false;

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
const rt = new THREE.WebGLRenderTarget(1, 1, {
  samples: 2,
  type: THREE.HalfFloatType,
  colorSpace: THREE.SRGBColorSpace,
});
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));

// GTAO reads the rendered depth/normals and multiplies soft occlusion in
const gtaoPass = new GTAOPass(scene, camera, W0, H0);
gtaoPass.output = GTAOPass.OUTPUT.Default;
gtaoPass.updateGtaoMaterial({
  // a tighter radius and softer blend keep the contact shadow under chairs
  // and tables without the view-dependent dark halo that used to sweep
  // across wall art as the camera panned
  radius: 0.3,
  distanceExponent: 1.4,
  thickness: 0.6,
  scale: 1.0,
  samples: 8,
  distanceFallOff: 1.0,
  screenSpaceRadius: false,
});
gtaoPass.blendIntensity = 0.5;
// Contact AO remains soft and convincing at 60% resolution, while avoiding
// four full-resolution depth/normal/AO buffers on high-DPI displays.
const setGtaoSize = gtaoPass.setSize.bind(gtaoPass);
gtaoPass.setSize = (width, height) => {
  setGtaoSize(Math.max(1, Math.ceil(width * 0.6)), Math.max(1, Math.ceil(height * 0.6)));
};
composer.addPass(gtaoPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(W0, H0), 0.25, 0.5, 0.85
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// A gentle vignette and static dither add depth without temporal grain.
// Animating random grain every frame reads as full-screen flicker.
const grainPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * 0.55;          // gentle corner falloff
      float g = (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * 0.012;
      gl_FragColor = vec4(c.rgb * vig + g, c.a);
    }`,
});
composer.addPass(grainPass);
composer.setPixelRatio(renderPixelRatio);
composer.setSize(W0, H0);

const audio = new CafeAudio();

// ---------- state ----------

let cafe = null;
let crowd = null;
let currentThemeIndex = preferences.cafeIndex;
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
const seatHits = [];
const seatEyeScratch = new THREE.Vector3();
const walkForward = new THREE.Vector3();
const walkRight = new THREE.Vector3();
const walkMove = new THREE.Vector3();
const listenerForward = new THREE.Vector3();
const viewEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let pointerDirty = true;
let hoveredSeat = -1;
let canvasCursor = '';

// highlight ring shown over the hovered chair
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.34, 0.025, 10, 36),
  new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.9 })
);
ring.rotation.x = Math.PI / 2;
ring.visible = false;

// ---------- seats / camera ----------

function seatEye(seat, target = new THREE.Vector3()) {
  return target.set(seat.pos.x, seat.pos.y + EYE_HEIGHT, seat.pos.z);
}

function anglesFromLook(eye, look) {
  const d = new THREE.Vector3().subVectors(look, eye).normalize();
  return {
    yaw: Math.atan2(-d.x, -d.z),
    pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
  };
}

function applyView() {
  camera.quaternion.setFromEuler(viewEuler.set(view.pitch, view.yaw, 0, 'YXZ'));
  pointerDirty = true;
}

function sitAt(index, instant = false) {
  const seat = cafe.seats[index];
  if (crowd) crowd.setPlayerSeat(index);
  seatIndex = index;
  mode = 'seated';
  updateWalkBtn();
  placePlayerLaptop(); // your MacBook follows you to the new table
  placePlayerCup(); // keep an existing order grounded at the current table
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
let variantOn = preferences.variantOn;
let lastModels = null;
let playerCup = null;
let playerLaptop = null;
let orderPending = false;
let currentTheme = variantOn && THEMES[currentThemeIndex].variant
  ? { ...THEMES[currentThemeIndex], ...THEMES[currentThemeIndex].variant }
  : THEMES[currentThemeIndex];
function activeTheme(index = currentThemeIndex) {
  const base = THEMES[index];
  if (index === currentThemeIndex) return currentTheme;
  return variantOn && base.variant ? { ...base, ...base.variant } : base;
}
async function loadTheme(index) {
  currentThemeIndex = index;
  const baseTheme = THEMES[index];
  const theme = variantOn && baseTheme.variant ? { ...baseTheme, ...baseTheme.variant } : baseTheme;
  currentTheme = theme;
  const token = ++loadToken;
  const models = await loadModelLibrary();
  if (token !== loadToken) return; // a newer switch superseded this one
  lastModels = models;
  playerCup = null; // the old room takes the old cup with it
  playerLaptop = null;

  if (crowd) { crowd.dispose(); crowd = null; }
  if (cafe) {
    scene.remove(cafe.group);
    cafe.dispose();
    cafe = null;
  }

  resetMemoryAuditRandom(index);
  cafe = buildCafe(theme, models);
  // A 1024px soft sun shadow is visually comparable in this compact room and
  // quarters the shadow-map fill/memory cost of the original 2048px map.
  cafe.group.traverse((object) => {
    if (object.isDirectionalLight && object.castShadow) {
      object.shadow.mapSize.set(1024, 1024);
      object.shadow.needsUpdate = true;
    }
  });
  scene.add(cafe.group);
  cafe.group.add(ring);

  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);
  scene.background = new THREE.Color(theme.fog.color);
  renderer.toneMappingExposure = theme.exposure;
  scene.environmentIntensity = theme.envIntensity ?? 0.35;
  bloomPass.strength = theme.bloom ?? 0.25;

  crowd = new CrowdSim(cafe, audio, models);
  applyEffectLevel(qualityMode === 'auto' ? autoEffectLevel : qualityMode === 'detail' ? 2 : 0);
  audio.setAnchors({ counter: cafe.nav.machineWorld, door: cafe.nav.door });
  audio.setClinkSpots([]);
  audio.setTypingSpots([]);
  audio.setTheme(theme);

  const s = defaultSeat();
  crowd.setPlayerSeat(s);
  sitAt(s, true);
  pointerDirty = true;
  renderer.shadowMap.needsUpdate = true;

  document.querySelectorAll('.loc-btn').forEach((b, i) => {
    const active = i === index;
    b.classList.toggle('active', active);
    if (b.id !== 'variant-btn') b.setAttribute('aria-pressed', String(active));
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
  persistPreferences();
  loadTheme(currentThemeIndex);
});

// your MacBook Pro (M series): space-grey unibody, notched display, glowing
// desktop — placed on whatever table you're sitting at via the HUD toggle
function makeMacBook() {
  const g = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 0.75, roughness: 0.32 });
  // base: thin unibody slab with a keyboard well and trackpad
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.312, 0.016, 0.221), alu);
  base.position.y = 0.008;
  base.castShadow = true;
  g.add(base);
  const kbTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7d8085'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#1d1e20';
    for (let r = 0; r < 6; r++)
      for (let k = 0; k < 14; k++)
        ctx.fillRect(4 + k * 8.8, 6 + r * 9.6, 7.4, 7.8);
    // space bar
    ctx.fillRect(34, 6 + 5 * 9.6, 56, 7.8);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.115),
    new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.7 }));
  kb.rotation.x = -Math.PI / 2;
  kb.position.set(0, 0.0165, -0.045);
  g.add(kb);
  const trackpad = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.082),
    new THREE.MeshStandardMaterial({ color: 0x82858a, metalness: 0.6, roughness: 0.25 }));
  trackpad.rotation.x = -Math.PI / 2;
  trackpad.position.set(0, 0.0165, 0.062);
  g.add(trackpad);
  // lid: hinged at the back, slightly reclined
  const lid = new THREE.Group();
  const lidBody = new THREE.Mesh(new THREE.BoxGeometry(0.312, 0.21, 0.007), alu);
  lidBody.position.y = 0.105;
  lidBody.castShadow = true;
  lid.add(lidBody);
  const wallTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 84;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 128, 84); // macOS-y dunes
    grad.addColorStop(0, '#3c2a5e'); grad.addColorStop(0.5, '#a04670');
    grad.addColorStop(1, '#e88a5e');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 84);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.moveTo(0, 66); ctx.quadraticCurveTo(56, 36, 128, 62);
    ctx.lineTo(128, 84); ctx.lineTo(0, 84); ctx.fill();
    // dock
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(34, 74, 60, 7);
    // menu bar + notch
    ctx.fillStyle = 'rgba(250,250,250,0.32)'; ctx.fillRect(0, 0, 128, 5);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(56, 0, 16, 5);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.294, 0.19),
    new THREE.MeshBasicMaterial({ map: wallTex }));
  screen.position.set(0, 0.107, 0.0037);
  lid.add(screen);
  lid.position.set(0, 0.014, -0.108);
  lid.rotation.x = 0.32; // comfortable viewing recline
  g.add(lid);
  return g;
}

let laptopOn = preferences.laptopOn;
function placePlayerCup() {
  if (!playerCup || seatIndex < 0 || !cafe) return;
  const seat = cafe.seats[seatIndex];
  const tc = seat.tableCenter;
  const topY = seat.pos.y > 0.05 ? 1.03 : (seat.tableTopY ?? 0.81);
  if (playerLaptop) {
    // A drink belongs beside a laptop, never on its keyboard. Offset along the
    // table edge and prefer the side facing the room centre so end seats at the
    // narrow window bar still keep the mug fully supported.
    const towardTable = new THREE.Vector3().subVectors(tc, seat.pos).setY(0).normalize();
    const beside = new THREE.Vector3(-towardTable.z, 0, towardTable.x);
    const towardRoom = new THREE.Vector3(-tc.x, 0, -tc.z);
    if (beside.dot(towardRoom) < 0) beside.negate();
    playerCup.position.set(
      playerLaptop.position.x + beside.x * 0.26,
      topY,
      playerLaptop.position.z + beside.z * 0.26
    );
  } else {
    playerCup.position.set(
      tc.x + (seat.pos.x - tc.x) * 0.45,
      topY,
      tc.z + (seat.pos.z - tc.z) * 0.45
    );
  }
}
function placePlayerLaptop() {
  if (playerLaptop) { playerLaptop.parent?.remove(playerLaptop); playerLaptop = null; }
  if (!laptopOn || seatIndex < 0 || !cafe) {
    placePlayerCup();
    return;
  }
  const seat = cafe.seats[seatIndex];
  const toTable = new THREE.Vector3().subVectors(seat.tableCenter, seat.pos).setY(0);
  const d = toTable.length() || 1;
  // Keep the whole 22 cm-deep base supported by the tabletop. Regular tables
  // leave the laptop near the player's edge; the shallower window bar needs it
  // almost centred so its front edge does not hang over the counter.
  const distanceFromCenter = seat.pos.y > 0.05 ? 0.075 : 0.34;
  const edge = Math.max(0, d - distanceFromCenter);
  playerLaptop = makeMacBook();
  playerLaptop.position.set(
    seat.pos.x + (toTable.x / d) * edge,
    seat.pos.y > 0.05 ? 1.035 : (seat.tableTopY ?? 0.81),
    seat.pos.z + (toTable.z / d) * edge
  );
  // open side faces you
  playerLaptop.rotation.y = Math.atan2(toTable.x, toTable.z) + Math.PI;
  cafe.group.add(playerLaptop);
  placePlayerCup();
}

document.getElementById('laptop-btn')?.addEventListener('click', () => {
  if (seatIndex < 0) { toast('sit down first, then set up your laptop'); return; }
  laptopOn = !laptopOn;
  placePlayerLaptop();
  document.getElementById('laptop-btn').classList.toggle('on', laptopOn);
  if (!laptopOn) audio.stopPlayerTyping();
  persistPreferences();
  toast(laptopOn ? 'MacBook out — focus time 💻' : 'laptop packed away');
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
    cafe.group.add(cup);
    playerCup = cup;
    placePlayerCup();
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
  placePlayerLaptop(); // packs it into your bag while you wander
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
  pointerDirty = true;
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
  seatHits.length = 0;
  raycaster.intersectObjects(cafe.seatMeshes, true, seatHits);
  for (const h of seatHits) {
    if (h.object.isInstancedMesh && h.instanceId !== undefined) {
      const index = h.object.userData.seatIndices?.[h.instanceId];
      if (index !== undefined) {
        seatHits.length = 0;
        return index;
      }
    }
    let o = h.object;
    while (o && o.userData.seatIndex === undefined) o = o.parent;
    if (o) {
      const index = o.userData.seatIndex;
      seatHits.length = 0;
      return index;
    }
  }
  seatHits.length = 0;
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
    if (i !== currentThemeIndex) {
      currentThemeIndex = i;
      persistPreferences();
      loadTheme(i);
    }
  });
});

document.getElementById('walk-btn').addEventListener('click', () => {
  if (mode === 'seated') standUp();
  else toast('Click any free chair to sit back down ☕');
});

// the volume sliders live in a small popover so the bar stays uncrowded
const mixerBtn = document.getElementById('mixer-btn');
const mixerPop = document.getElementById('mixer-pop');
function setMixerOpen(open) {
  if (!mixerBtn || !mixerPop) return;
  mixerPop.hidden = !open;
  mixerBtn.classList.toggle('open', open);
  mixerBtn.setAttribute('aria-expanded', String(open));
}
mixerBtn?.addEventListener('click', () => setMixerOpen(mixerPop.hidden));
document.addEventListener('pointerdown', (e) => {
  if (mixerPop && !mixerPop.hidden
    && !mixerPop.contains(e.target) && !mixerBtn.contains(e.target)) {
    setMixerOpen(false);
  }
});

const musicToggle = document.getElementById('music-toggle');
const trackStyle = document.getElementById('track-style');
const musicVolume = document.getElementById('music-vol');
const ambienceVolume = document.getElementById('amb-vol');
const voicesVolume = document.getElementById('voices-vol');
musicVolume.value = String(preferences.musicVolume);
ambienceVolume.value = String(preferences.ambienceVolume);
voicesVolume.value = String(preferences.voicesVolume);
musicToggle.classList.toggle('on', preferences.musicOn);
musicToggle.textContent = preferences.musicOn ? '♪ music on' : '♪ music off';
musicToggle.setAttribute('aria-pressed', String(preferences.musicOn));
document.getElementById('laptop-btn')?.classList.toggle('on', laptopOn);
audio.setMusicVolume(preferences.musicVolume);
audio.setAmbienceVolume(preferences.ambienceVolume);
audio.setVoicesVolume(preferences.voicesVolume);

const fullscreenButton = document.getElementById('fullscreen-btn');
const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
function syncFullscreenButton() {
  if (!fullscreenButton) return;
  const active = Boolean(fullscreenElement());
  fullscreenButton.textContent = active ? '⛶' : '⛶ full screen';
  fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.title = active ? 'exit fullscreen' : 'enter fullscreen';
  // Fullscreen layout can settle after fullscreenchange. Resize on the next
  // two frames so both the canvas and post-processing targets fill it exactly.
  requestAnimationFrame(() => {
    resizeViewport();
    requestAnimationFrame(resizeViewport);
  });
}
async function toggleFullscreen() {
  try {
    if (fullscreenElement()) {
      const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
      await exit?.call(document);
    } else {
      const enter = document.documentElement.requestFullscreen
        ?? document.documentElement.webkitRequestFullscreen;
      if (!enter) {
        toast('full screen is not supported in this browser');
        return;
      }
      await enter.call(document.documentElement);
    }
  } catch {
    toast('could not change full screen mode');
  }
}
fullscreenButton?.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreenButton);
document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
syncFullscreenButton();

function persistPreferences() {
  savePreferences({
    musicVolume: Number(musicVolume.value),
    ambienceVolume: Number(ambienceVolume.value),
    voicesVolume: Number(voicesVolume.value),
    musicOn: musicToggle.classList.contains('on'),
    cafeIndex: currentThemeIndex,
    variantOn,
    qualityMode,
    laptopOn,
    focusMinutes,
  });
}
window.addEventListener('cafe-track-change', (e) => {
  if (!trackStyle) return;
  if (e.detail.recorded) {
    trackStyle.textContent = `${e.detail.title} — ${e.detail.artist}`;
    trackStyle.title = `Now playing: ${e.detail.title} by ${e.detail.artist}`;
  } else {
    trackStyle.textContent = `${e.detail.style} · ${e.detail.bpm} bpm`;
    trackStyle.title = `Now playing: ${e.detail.style}, ${e.detail.bpm} beats per minute`;
  }
});
musicToggle.addEventListener('click', () => {
  const on = musicToggle.classList.toggle('on');
  audio.setMusicOn(on);
  musicToggle.textContent = on ? '♪ music on' : '♪ music off';
  musicToggle.setAttribute('aria-pressed', String(on));
  persistPreferences();
});

const qualityToggle = document.getElementById('quality-toggle');
const QUALITY_MODES = ['auto', 'detail', 'smooth'];
let qualityMode = preferences.qualityMode;
let autoEffectLevel = 1;
let effectLevel = 1;
let shadowInterval = 1 / 20;

// Resolution is only one part of the GPU budget. GTAO, bloom and animated
// shadow maps each render the scene (or a full-screen buffer) again, so the
// adaptive mode can shed those layers independently before the café starts
// dropping input frames. Level 0 still keeps PBR lighting and the sun shadow.
function applyEffectLevel(nextLevel) {
  effectLevel = THREE.MathUtils.clamp(Math.round(nextLevel), 0, 2);
  gtaoPass.enabled = effectLevel >= 1;
  bloomPass.enabled = effectLevel >= 2;
  shadowInterval = effectLevel === 2 ? 1 / 30 : effectLevel === 1 ? 1 / 20 : 1 / 12;
  cafe?.setQuality?.(effectLevel);
  crowd?.setQuality?.(effectLevel);
  renderer.shadowMap.needsUpdate = true;
}

function renderQualityMode() {
  qualityToggle.textContent = `quality · ${qualityMode}`;
  qualityToggle.setAttribute('aria-label', `Rendering quality: ${qualityMode}`);
}
qualityToggle.addEventListener('click', () => {
  qualityMode = QUALITY_MODES[(QUALITY_MODES.indexOf(qualityMode) + 1) % QUALITY_MODES.length];
  perfSampleTime = 0;
  perfSampleFrames = 0;
  qualityCooldown = 0;
  if (qualityMode === 'detail') {
    applyEffectLevel(2);
    applyRenderPixelRatio(MAX_PIXEL_RATIO);
  } else if (qualityMode === 'smooth') {
    applyEffectLevel(0);
    applyRenderPixelRatio(Math.min(0.9, MAX_PIXEL_RATIO));
  } else {
    applyEffectLevel(autoEffectLevel);
  }
  renderQualityMode();
  persistPreferences();
  toast(qualityMode === 'auto'
    ? 'quality will adapt to keep the café smooth'
    : `quality locked to ${qualityMode}`);
});
renderQualityMode();
if (qualityMode === 'detail') applyRenderPixelRatio(MAX_PIXEL_RATIO);
if (qualityMode === 'smooth') applyRenderPixelRatio(Math.min(0.9, MAX_PIXEL_RATIO));

musicVolume.addEventListener('input', (e) => {
  audio.setMusicVolume(parseFloat(e.target.value));
  persistPreferences();
});
ambienceVolume.addEventListener('input', (e) => {
  audio.setAmbienceVolume(parseFloat(e.target.value));
  persistPreferences();
});
voicesVolume.addEventListener('input', (e) => {
  audio.setVoicesVolume(parseFloat(e.target.value));
  persistPreferences();
});

// focus timer (adjustable focus interval / five-minute break)
const timerEl = document.getElementById('timer-display');
const timerBtn = document.getElementById('timer-btn');
const timerPop = document.getElementById('timer-pop');
const timerDuration = document.getElementById('timer-duration');
const timerPresetButtons = [...document.querySelectorAll('#timer-presets button')];
let focusMinutes = preferences.focusMinutes;
let timerRunning = false, timerBreak = false, timerLeft = focusMinutes * 60;
let lastTimerText = '';
let lastTimerBreak = null;
function renderTimerDuration() {
  timerDuration.innerHTML = `${focusMinutes}<small>min</small>`;
  timerPresetButtons.forEach((button) => {
    const active = Number(button.dataset.minutes) === focusMinutes;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  timerEl.setAttribute('aria-label', `Set focus duration, currently ${focusMinutes} minutes`);
}
function setTimerPopOpen(open) {
  timerPop.hidden = !open;
  timerEl.classList.toggle('open', open);
  timerEl.setAttribute('aria-expanded', String(open));
}
function setFocusMinutes(nextMinutes) {
  focusMinutes = Math.round(THREE.MathUtils.clamp(nextMinutes, 1, 180));
  timerBreak = false;
  timerLeft = focusMinutes * 60;
  persistPreferences();
  renderTimerDuration();
  renderTimer();
}
function renderTimer() {
  const m = String(Math.floor(timerLeft / 60)).padStart(2, '0');
  const s = String(Math.floor(timerLeft % 60)).padStart(2, '0');
  const text = `${m}:${s}`;
  if (text !== lastTimerText) {
    timerEl.textContent = text;
    lastTimerText = text;
  }
  if (timerBreak !== lastTimerBreak) {
    timerEl.classList.toggle('break', timerBreak);
    lastTimerBreak = timerBreak;
  }
}
timerBtn.addEventListener('click', () => {
  timerRunning = !timerRunning;
  if (!timerRunning) audio.stopPlayerTyping();
  if (timerRunning) setTimerPopOpen(false);
  timerEl.disabled = timerRunning;
  timerBtn.textContent = timerRunning ? '❚❚' : '▶';
  timerBtn.setAttribute('aria-label', timerRunning ? 'Pause focus timer' : 'Start focus timer');
});
document.getElementById('timer-reset').addEventListener('click', () => {
  timerRunning = false; timerBreak = false; timerLeft = focusMinutes * 60;
  audio.stopPlayerTyping();
  timerEl.disabled = false;
  timerBtn.textContent = '▶';
  timerBtn.setAttribute('aria-label', 'Start focus timer');
  renderTimer();
});
timerEl.addEventListener('click', () => setTimerPopOpen(timerPop.hidden));
document.getElementById('timer-minus').addEventListener('click', () => {
  setFocusMinutes(focusMinutes - (focusMinutes > 5 ? 5 : 1));
});
document.getElementById('timer-plus').addEventListener('click', () => {
  setFocusMinutes(focusMinutes + (focusMinutes < 5 ? 1 : 5));
});
timerPresetButtons.forEach((button) => {
  button.addEventListener('click', () => setFocusMinutes(Number(button.dataset.minutes)));
});
document.addEventListener('pointerdown', (event) => {
  if (!timerPop.hidden && !document.getElementById('timer').contains(event.target)) setTimerPopOpen(false);
});
renderTimerDuration();
renderTimer();

// enter overlay — also unlocks the AudioContext
const overlay = document.getElementById('overlay');
document.getElementById('enter-btn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  audio.start(activeTheme());
  audio.setMusicVolume(Number(musicVolume.value));
  audio.setAmbienceVolume(Number(ambienceVolume.value));
  audio.setVoicesVolume(Number(voicesVolume.value));
  audio.setMusicOn(musicToggle.classList.contains('on'));
});

function applyRenderPixelRatio(nextRatio) {
  const clamped = THREE.MathUtils.clamp(nextRatio, MIN_PIXEL_RATIO, MAX_PIXEL_RATIO);
  const rounded = Math.round(clamped * 20) / 20;
  if (Math.abs(rounded - renderPixelRatio) < 0.001) return;
  renderPixelRatio = rounded;
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(renderPixelRatio);
}

function resizeViewport() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  pointerDirty = true;
}
window.addEventListener('resize', resizeViewport);

// ---------- main loop ----------

const clock = new THREE.Clock();
let elapsed = 0;
let lastListenerSync = 0;
let simAcc = 0;
let shadowAcc = 1 / 30;
let perfSampleTime = 0;
let perfSampleFrames = 0;
let qualityCooldown = 0;
let nextPlayerTypingAt = 0;
let playerTypingActive = false;
let metricsSyncAt = 0;
const playerLaptopWorld = new THREE.Vector3();
const lastRenderStats = { calls: 0, triangles: 0, points: 0, lines: 0 };
const SIM_STEP = 1 / 30;
// Catch-up budget after a slow frame or a throttled tab. Crowd updates are
// renderer-free math (~20 NPCs), so even the full 3 s budget costs only a few
// milliseconds — while a small cap makes café time crawl on slow machines,
// which reads as "everyone is stuck".
const MAX_SIM_STEPS = 90;

function updateAdaptiveQuality(frameDt) {
  if (qualityMode !== 'auto') return;
  // The intro is intentionally cheap and mostly opaque. Measuring it would
  // over-promote quality before the real café and crowd are visible.
  if (!overlay.classList.contains('hidden')) {
    perfSampleTime = 0;
    perfSampleFrames = 0;
    return;
  }
  // Ignore tab switches and breakpoint pauses; they do not describe rendering
  // performance and would otherwise force an unnecessary quality drop.
  if (document.hidden || frameDt > 0.1) {
    perfSampleTime = 0;
    perfSampleFrames = 0;
    return;
  }
  qualityCooldown = Math.max(0, qualityCooldown - frameDt);
  perfSampleTime += frameDt;
  perfSampleFrames += 1;
  if (perfSampleTime < 2.5) return;

  const averageFrameMs = (perfSampleTime / perfSampleFrames) * 1000;
  if (averageFrameMs > 19.5) {
    if (renderPixelRatio > 1.001) {
      applyRenderPixelRatio(renderPixelRatio - 0.15);
    } else if (autoEffectLevel > 0) {
      autoEffectLevel -= 1;
      applyEffectLevel(autoEffectLevel);
    } else if (renderPixelRatio > MIN_PIXEL_RATIO + 0.001) {
      applyRenderPixelRatio(renderPixelRatio - 0.1);
    }
    qualityCooldown = 5;
  } else if (averageFrameMs < 16.9 && qualityCooldown <= 0) {
    // Restore scene depth before supersampling: a low-resolution image with
    // contact light and bloom generally reads better than a sharper flat one.
    if (autoEffectLevel < 2) {
      autoEffectLevel += 1;
      applyEffectLevel(autoEffectLevel);
    } else if (renderPixelRatio < MAX_PIXEL_RATIO) {
      applyRenderPixelRatio(renderPixelRatio + 0.1);
    }
    // Composer target reallocations and light-count shader changes should be
    // rare. A long hold prevents a 60 Hz display from repeatedly toggling on
    // the 16.67 ms boundary.
    qualityCooldown = 15;
  }
  perfSampleTime = 0;
  perfSampleFrames = 0;
}

function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clock.getDelta(), 3.0); // real time, survives slow frames
  const dt = Math.min(rawDt, 0.05);              // camera/interaction step
  elapsed += rawDt;
  updateAdaptiveQuality(rawDt);

  // Run room life in stable 30 Hz steps, but cap catch-up work after a paused
  // or throttled tab so returning to the café cannot trigger a long CPU spike.
  if (MEMORY_AUDIT_MODE) {
    simAcc = 0;
  } else {
    simAcc = Math.min(simAcc + rawDt, SIM_STEP * MAX_SIM_STEPS);
    let simSteps = 0;
    while (simAcc >= SIM_STEP && simSteps < MAX_SIM_STEPS) {
      simAcc -= SIM_STEP;
      simSteps += 1;
      if (cafe) cafe.animate(SIM_STEP);
      if (crowd) crowd.update(SIM_STEP, elapsed - simAcc, camera.position);
    }
  }

  // camera tween between seats
  let cameraMoved = false;
  if (tween.active) {
    cameraMoved = true;
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
    walkForward.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    walkRight.set(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
    walkMove.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) walkMove.add(walkForward);
    if (keys.has('KeyS') || keys.has('ArrowDown')) walkMove.sub(walkForward);
    if (keys.has('KeyD') || keys.has('ArrowRight')) walkMove.add(walkRight);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) walkMove.sub(walkRight);
    const moving = walkMove.lengthSq() > 0;
    if (moving) {
      cameraMoved = true;
      walkMove.normalize();
      walkPos.addScaledVector(walkMove, dt * 2.0);
      resolveCollisions(walkPos);
      crowd?.resolvePlayerCollision?.(walkPos);
      // A person can push the player toward a table edge; resolve the room once
      // more so the two collision systems cannot squeeze the camera into props.
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
      STAND_EYE + (moving ? Math.abs(Math.sin(walkBob)) * 0.03 : 0),
      walkPos.z
    );
  } else if (seatIndex >= 0 && cafe) {
    // Keep a seated view pixel-stable. Sub-pixel idle motion made GTAO and
    // detailed PBR textures shimmer even though the user was not moving.
    const seat = cafe.seats[seatIndex];
    camera.position.copy(seatEye(seat, seatEyeScratch));
  }

  // keep the audio engine's ears where the eyes are (throttled)
  if (audio.started && elapsed - lastListenerSync > 0.08) {
    lastListenerSync = elapsed;
    listenerForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    audio.setListener(camera.position, listenerForward);
  }

  // hover highlight
  if (cafe && !tween.active && !dragging) {
    if (pointerDirty || cameraMoved) {
      hoveredSeat = pickSeat();
      pointerDirty = false;
    }
    if (hoveredSeat >= 0 && hoveredSeat !== seatIndex) {
      const seat = cafe.seats[hoveredSeat];
      ring.position.set(seat.pos.x, seat.pos.y + 0.72, seat.pos.z);
      ring.visible = true;
      ring.material.color.set(crowd.isSeatTaken(hoveredSeat) ? 0xd06050 : 0xffe2a8);
      ring.material.opacity = 0.6 + Math.sin(elapsed * 5) * 0.25;
      if (canvasCursor !== 'pointer') {
        canvas.style.cursor = 'pointer';
        canvasCursor = 'pointer';
      }
    } else {
      ring.visible = false;
      if (canvasCursor !== 'grab') {
        canvas.style.cursor = 'grab';
        canvasCursor = 'grab';
      }
    }
  } else {
    ring.visible = false;
  }

  // focus mode gently dims the room; break/idle brings the light back
  {
    const baseExp = currentTheme.exposure;
    const targetExp = timerRunning && !timerBreak ? baseExp * 0.84 : baseExp;
    renderer.toneMappingExposure += (targetExp - renderer.toneMappingExposure) * Math.min(1, dt * 1.5);
  }

  // focus timer
  if (timerRunning) {
    timerLeft -= rawDt;
    if (timerLeft <= 0) {
      timerBreak = !timerBreak;
      if (timerBreak) audio.stopPlayerTyping();
      timerLeft = (timerBreak ? 5 : focusMinutes) * 60;
      if (audio.started) audio.playTimerAlarm();
      toast(timerBreak ? 'Break time — stretch a little 🌿' : 'Back to focus ☕');
    }
    renderTimer();
  }

  const shouldType = timerRunning && !timerBreak && laptopOn && playerLaptop && audio.started;
  if (shouldType) {
    if (!playerTypingActive) nextPlayerTypingAt = elapsed + 0.8;
    playerTypingActive = true;
    if (elapsed >= nextPlayerTypingAt) {
      playerLaptop.getWorldPosition(playerLaptopWorld);
      audio.playPlayerTyping(playerLaptopWorld);
      nextPlayerTypingAt = elapsed + 2.8 + Math.random() * 4.8;
    }
  } else if (playerTypingActive) {
    playerTypingActive = false;
    audio.stopPlayerTyping();
  }

  shadowAcc += rawDt;
  if (shadowAcc >= shadowInterval) {
    renderer.shadowMap.needsUpdate = true;
    shadowAcc %= shadowInterval;
  }

  renderer.info.reset();
  composer.render(dt);
  lastRenderStats.calls = renderer.info.render.calls;
  lastRenderStats.triangles = renderer.info.render.triangles;
  lastRenderStats.points = renderer.info.render.points;
  lastRenderStats.lines = renderer.info.render.lines;

  if (elapsed >= metricsSyncAt && window.__vibe) {
    metricsSyncAt = elapsed + 0.5;
    document.documentElement.dataset.vibeMetrics = JSON.stringify(window.__vibe.metrics());
  }
}

loadTheme(preferences.cafeIndex);
frame();

// tiny debug handle for automated tests: place the camera, inspect audio
window.__vibe = {
  audio,
  get crowd() { return crowd; },
  metrics() {
    let decodedAudioBytes = 0;
    const activeGeometries = new Set();
    const activeTextures = new Set();
    const activeSharedTextures = new Set();
    scene.traverse((object) => {
      if (object.geometry) activeGeometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (!value?.isTexture) continue;
          activeTextures.add(value);
          if (value.userData.vibeShared) activeSharedTextures.add(value);
        }
      }
    });
    for (const { buffer } of audio.buffers.values()) {
      decodedAudioBytes += buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    }
    return {
      theme: cafe?.theme.id ?? currentTheme.id,
      qualityMode,
      pixelRatio: renderPixelRatio,
      effects: effectLevel,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      decodedAudioBytes,
      playerTypingBursts: audio.playerTypingBursts ?? 0,
      playerTypingActive: (audio._playerTypingNodes?.length ?? 0) > 0,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      activeGeometries: activeGeometries.size,
      activeTextures: activeTextures.size,
      activeSharedTextures: activeSharedTextures.size,
      calls: lastRenderStats.calls,
      triangles: lastRenderStats.triangles,
      points: lastRenderStats.points,
      lines: lastRenderStats.lines,
    };
  },
  place(x, z, yaw, pitch = 0) {
    standUp();
    walkPos.set(x, 0, z);
    view.yaw = yaw; view.pitch = pitch;
    applyView();
  },
};
