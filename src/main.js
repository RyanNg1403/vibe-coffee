import { connectUI } from './ui/index.js';
import { lookSettings, motionReduced, breakMinutes, getUISettings, updateUISettings, onUISettingsChange } from './ui/settings.js';
import { adoptFocusStats, getFocusStats, noteRestoredFocus } from './ui/focus.js';
import { createControls } from './controls/index.js';
import { clampPitch } from './controls/intent.js';
import { initQualityTier, onQualityTierChange, qualityTierConfig, setQualityTier } from './qualityTier.js';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadDaylightEnvironment } from './rendering/daylightEnvironment.js';
import { groundingAuditObjects } from './rendering/placementBounds.js';
import { auditVenueCollections } from './decor/venueCollection.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { THEMES, ROOM, buildCafe, resolveEnvironment, makeDrink } from './cafe.js';
import { createNavigator, pointInPolygon, surfaceHeightAt } from './cafe/levelNavigation.js';
import {
  placeFootprintForSeat, pullInsideShape, footprintSupported,
  footprintCorners, convexPolygonsOverlap, pointSupported, shapeBounds,
} from './cafe/tableSupport.js';
import { CrowdSim } from './npc.js';
import { PetSystem } from './pets.js';
import { CafeAudio } from './audio.js';
import { loadModelLibrary, cloneModel } from './modelLoader.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { STORAGE_KEYS, readJSON, requestPersistentStorage } from './storage/index.js';
import { createCheckpointStore } from './storage/checkpointStore.js';
import { createAutosave } from './storage/autosave.js';
import { describeCheckpoint, formatClock, resumeFocus } from './storage/checkpoint.js';
import { laptopCupOffset, clearanceSlots } from './tableClearance.js';
import { AdaptiveFrameScheduler } from './frameScheduler.js';
import { WorldInteractions } from './interactions/worldInteractions.js';

const preferences = loadPreferences();
// A deterministic lifecycle probe used by the checked-in P0 benchmark. It
// freezes autonomous crowd churn so renderer counts compare equivalent scenes
// instead of different random patron populations. Normal visits are unchanged.
const auditParams = new URLSearchParams(window.location.search);
const MEMORY_AUDIT_MODE = auditParams.has('memory-audit');
const SEEDED_AUDIT_MODE = MEMORY_AUDIT_MODE || auditParams.has('visual-audit');

// Session checkpoints (src/storage). Reading starts now so the first café
// built can be the one the visitor left. Audits stay deterministic: they
// neither restore nor save.
const hadStoredPreferences = readJSON(STORAGE_KEYS.preferences) != null;
const hadStoredUISettings = readJSON(STORAGE_KEYS.ui) != null;
const checkpointStore = createCheckpointStore();
const checkpointLoad = SEEDED_AUDIT_MODE
  ? Promise.resolve(null)
  : checkpointStore.load().catch((error) => {
    console.warn('[checkpoint] could not be read:', error);
    return null;
  });
const autosave = createAutosave({
  capture: captureCheckpoint,
  store: checkpointStore,
  onResult: reportCheckpointSave,
});
function resetMemoryAuditRandom(themeIndex) {
  if (!SEEDED_AUDIT_MODE) return;
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
const DEVICE_PIXEL_RATIO = window.devicePixelRatio || 1;
// Auto stays at CSS-native resolution. On Retina screens, 1.5x creates 2.25x
// as many half-float pixels across every composer target for little visible
// benefit in a softly lit scene. Detail retains restrained supersampling.
const AUTO_MAX_PIXEL_RATIO = Math.min(DEVICE_PIXEL_RATIO, 1);
const MAX_PIXEL_RATIO = Math.min(DEVICE_PIXEL_RATIO, 1.25);
const MIN_PIXEL_RATIO = Math.min(MAX_PIXEL_RATIO, 0.75);
// Only the explicit Ultra tier supersamples past MAX_PIXEL_RATIO.
const ULTRA_PIXEL_RATIO = Math.min(DEVICE_PIXEL_RATIO, 1.5);
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
renderer.toneMapping = THREE.AgXToneMapping;
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
const fallbackRoom = new RoomEnvironment();
let environmentTarget = pmrem.fromScene(fallbackRoom, 0.04);
fallbackRoom.dispose();
scene.environment = environmentTarget.texture;
let photographicEnvironment = null;
function applyPhotographicEnvironment(theme) {
  if (!photographicEnvironment) return;
  const night = theme.timeOfDay === 'night' || theme.outside.includes('Night') || theme.outside.includes('night');
  scene.background = photographicEnvironment;
  scene.backgroundBlurriness = theme.rain ? 0.2 : 0.06;
  const daylight = { morning: 0.78, noon: 0.9, sunset: 0.72 }[theme.timeOfDay] ?? 0.72;
  scene.backgroundIntensity = night ? 0.018 : daylight * (theme.rain ? 0.45 : 1);
  scene.backgroundRotation.y = Math.PI * 0.6;
  scene.environmentRotation.y = Math.PI * 0.6;
  cafe?.group.traverse((object) => {
    if (object.userData.illustratedBackdrop) object.visible = false;
  });
}
loadDaylightEnvironment().then((texture) => {
  let target;
  try { target = pmrem.fromEquirectangular(texture); }
  catch (error) { texture.dispose(); throw error; }
  const previousTarget = environmentTarget;
  environmentTarget = target;
  scene.environment = target.texture;
  previousTarget.dispose();
  photographicEnvironment = texture;
  applyPhotographicEnvironment(currentTheme);
}).catch((error) => console.warn('[environment] HDR lighting unavailable:', error.message));

// Post-processing chain. FXAA at the end replaces a persistent multisampled
// half-float buffer, preserving clean edges at a fraction of its memory cost.
// GTAO adds contact darkening; bloom makes practical lamps glow.
const W0 = window.innerWidth, H0 = window.innerHeight;
const rt = new THREE.WebGLRenderTarget(1, 1, {
  samples: 0,
  type: THREE.HalfFloatType,
  colorSpace: THREE.LinearSRGBColorSpace,
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
  samples: 6,
  distanceFallOff: 1.0,
  screenSpaceRadius: false,
});
gtaoPass.blendIntensity = 0.5;
// Contact AO remains soft and convincing at half resolution, while avoiding
// four full-resolution depth/normal/AO buffers on high-DPI displays.
const setGtaoSize = gtaoPass.setSize.bind(gtaoPass);
gtaoPass.setSize = (width, height) => {
  setGtaoSize(Math.max(1, Math.ceil(width * 0.5)), Math.max(1, Math.ceil(height * 0.5)));
};
composer.addPass(gtaoPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(W0, H0), 0.25, 0.5, 0.85
);
// Bloom is a deliberately blurred signal. Half-resolution buffers preserve
// the perceived glow while cutting their pixel work and memory by about 75%.
const setBloomSize = bloomPass.setSize.bind(bloomPass);
bloomPass.setSize = (width, height) => {
  setBloomSize(Math.max(1, Math.ceil(width * 0.5)), Math.max(1, Math.ceil(height * 0.5)));
};
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
const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);
function updateFxaaResolution(width = window.innerWidth, height = window.innerHeight) {
  fxaaPass.material.uniforms.resolution.value.set(
    1 / Math.max(1, width * renderPixelRatio),
    1 / Math.max(1, height * renderPixelRatio),
  );
}
composer.setPixelRatio(renderPixelRatio);
composer.setSize(W0, H0);
updateFxaaResolution(W0, H0);

const audio = new CafeAudio();

// ---------- state ----------

let cafe = null;
let crowd = null;
let pets = null;
let currentThemeIndex = preferences.cafeIndex;
let seatIndex = -1;
let mode = 'seated'; // 'seated' | 'walking'
const walkPos = new THREE.Vector3();
// §8 traversal contract: the active floor is persistent state, never
// inferred from height; it changes only through authored stair portals.
let walkLevelId = 'ground';
let walkY = 0;
let navigator = null;
let walkBob = 0;
let lastPlayerStep = 0;
const controls = createControls({ canvas, settings: lookSettings });
const WALK_SPEED = 2.0;
const SPRINT_MULTIPLIER = 1.75;
const frameScheduler = new AdaptiveFrameScheduler();
const markInteraction = () => frameScheduler.markInteraction(performance.now());
window.addEventListener('pointerdown', markInteraction, { passive: true });
window.addEventListener('keydown', markInteraction, { passive: true });
window.addEventListener('wheel', markInteraction, { passive: true });

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
let hoveredWorld = null;
// clickable world objects (player laptop, pets, ...) — empty by default, so
// seat picking behaves exactly as before until something registers
const interactions = new WorldInteractions();

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
  autosave.touch('seat');
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
  tween.dur = motionReduced() ? 0.35 : 1.4;
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
let envTime = preferences.envTime;
let envSky = preferences.envSky;
let lastModels = null;
let playerCup = null;
let playerLaptop = null;
let playerLaptopSeatIndex = -1;
let laptopSurfacePropCount = -1;
let laptopNpcPropRevision = -1;
let orderPending = false;
let currentTheme = resolveEnvironment(THEMES[currentThemeIndex], envTime, envSky);
function activeTheme(index = currentThemeIndex) {
  const base = THEMES[index];
  if (index === currentThemeIndex) return currentTheme;
  return resolveEnvironment(base, envTime, envSky);
}
// `place` may position the player in the new room (returns true when it
// did); otherwise they take the best free seat.
async function loadTheme(index, { place } = {}) {
  currentThemeIndex = index;
  const baseTheme = THEMES[index];
  const theme = resolveEnvironment(baseTheme, envTime, envSky);
  currentTheme = theme;
  const token = ++loadToken;
  const models = await loadModelLibrary();
  if (token !== loadToken) return; // a newer switch superseded this one
  lastModels = models;
  playerCup = null; // the old room takes the old cup with it
  playerLaptop = null;
  playerLaptopSeatIndex = -1;
  laptopSurfacePropCount = -1;
  laptopNpcPropRevision = -1;

  interactions.clear(); // world click targets belong to the departing room
  hoveredWorld = null;
  audio.stopPlayerTyping(); // no burst may outlive the room it was typed in
  if (pets) { pets.dispose(); pets = null; }
  if (crowd) { crowd.dispose(); crowd = null; }
  if (cafe) {
    scene.remove(cafe.group);
    cafe.dispose();
    cafe = null;
  }

  resetMemoryAuditRandom(index);
  cafe = buildCafe(theme, models);
  navigator = createNavigator(cafe.blueprint);
  walkLevelId = 'ground';
  walkY = 0;
  resetMemoryAuditRandom(index + 16); // TEMP for A/B measurement

  // Re-seed between construction and crowd spawn: decor edits change how many
  // random draws a build consumes, and without this every decor PR would
  // reshuffle the seeded audit crowd and make renderer counts incomparable.
  resetMemoryAuditRandom(index + 16);
  // Furniture contacts need centimetre-scale detail across the room.
  cafe.group.traverse((object) => {
    if (object.isDirectionalLight && object.castShadow) {
      object.shadow.mapSize.set(2048, 2048);
      object.shadow.needsUpdate = true;
    }
  });
  scene.add(cafe.group);
  cafe.group.add(ring);

  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);
  scene.background = new THREE.Color(theme.fog.color);
  renderer.toneMappingExposure = theme.exposure;
  scene.environmentIntensity = theme.envIntensity ?? 0.35;
  applyPhotographicEnvironment(theme);
  bloomPass.strength = theme.bloom ?? 0.25;

  crowd = new CrowdSim(cafe, audio, models);
  pets = new PetSystem(cafe, models, theme, audio, interactions);
  crowd.petSources = pets.pets; // live reference: the planner sees pets spawn/leave
  applyEffectLevel(qualityMode === 'auto' ? autoEffectLevel : qualityTierConfig(qualityMode).effects);
  audio.setAnchors({
    counter: cafe.nav.machineWorld,
    door: cafe.nav.door,
    // service-derived emitters: sound and visible work zones share one source
    register: cafe.serviceAnchors?.audio.register,
    pickup: cafe.serviceAnchors?.audio.pickup,
    dishes: cafe.serviceAnchors?.audio.dishes,
  });
  audio.setClinkSpots([]);
  audio.setTypingSpots([]);
  audio.setTheme(theme);

  if (!place?.()) {
    const s = defaultSeat();
    crowd.setPlayerSeat(s);
    sitAt(s, true);
  }
  pointerDirty = true;
  renderer.shadowMap.needsUpdate = true;
  autosave.touch('cafe');

  document.querySelectorAll('.loc-btn').forEach((b, i) => {
    const active = i === index;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('blurb').textContent = theme.blurb;
}

// ---------- time of day × weather chips (shown in the UI's ambience panel) ----------
const skyPop = document.getElementById('sky-pop');
function renderSkyChips() {
  skyPop?.querySelectorAll('[data-time]').forEach((b) => {
    const active = b.dataset.time === envTime;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  skyPop?.querySelectorAll('[data-sky]').forEach((b) => {
    const active = b.dataset.sky === envSky;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
skyPop?.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.time) envTime = b.dataset.time;
  else if (b.dataset.sky) envSky = b.dataset.sky;
  else return;
  renderSkyChips();
  persistPreferences();
  loadTheme(currentThemeIndex);
});
renderSkyChips();

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
function restoreTableProps(seat) {
  for (const entry of seat?.surfaceProps ?? []) {
    if (!entry.object?.parent) continue;
    entry.object.position.copy(entry.home);
  }
  // NPC props were only nudged aside (never hidden): walk them back to the
  // spots their owners chose.
  for (const candidate of cafe?.seats ?? []) {
    if (!seat || candidate.tableCenter.distanceToSquared(seat.tableCenter) > 0.0001) continue;
    for (const entry of candidate.npcTableProps ?? []) {
      if (entry.object?.parent) entry.object.position.copy(entry.home);
    }
  }
}

function syncLaptopSurfaceProps() {
  if (!playerLaptop || seatIndex < 0 || !cafe) {
    laptopSurfacePropCount = -1;
    laptopNpcPropRevision = -1;
    return;
  }
  const seat = cafe.seats[seatIndex];
  const activeCount = (seat.surfaceProps ?? []).filter((entry) => entry.object?.parent).length;
  const npcRevision = cafe.npcTablePropRevision ?? 0;
  if (activeCount === laptopSurfacePropCount && npcRevision === laptopNpcPropRevision) return;
  const tableSeats = cafe.seats.filter((candidate) => candidate.tableCenter.distanceToSquared(seat.tableCenter) < 0.0001);
  // NPC laptops/sketchpads at a shared table stay visible next to the
  // player's MacBook (plan §10) — they join the clearance flow below and are
  // nudged aside only if the two would genuinely collide.
  const npcProps = tableSeats.flatMap((candidate) => candidate.npcTableProps ?? []).filter((entry) => entry.object?.parent);
  const toTable = new THREE.Vector3().subVectors(seat.tableCenter, seat.pos).setY(0).normalize();
  const beside = new THREE.Vector3(-toTable.z, 0, toTable.x);
  const towardRoom = new THREE.Vector3(-seat.tableCenter.x, 0, -seat.tableCenter.z);
  if (beside.dot(towardRoom) < 0) beside.negate();
  clearTablePropsForLaptop(seat, beside, npcProps);
  laptopSurfacePropCount = activeCount;
  laptopNpcPropRevision = npcRevision;
}

function clearTablePropsForLaptop(seat, beside, npcProps = []) {
  // widest settings claim the first slots so a book never overlaps a card
  const movableNpcProps = npcProps.filter((entry) => entry.movableForPlayer);
  const pinnedNpcProps = npcProps.filter((entry) => !entry.movableForPlayer);
  const props = [
    ...(seat.surfaceProps ?? []).filter((entry) => entry.object?.parent),
    ...movableNpcProps,
  ]
    .sort((a, b) => (b.footprint ?? 0.08) - (a.footprint ?? 0.08));
  const towardFarEdge = new THREE.Vector3()
    .subVectors(seat.tableCenter, playerLaptop.position)
    .setY(0)
    .normalize();
  const elevatedBar = !!seat.isBar;
  const slots = clearanceSlots(props.map((entry) => entry.footprint ?? 0.08), elevatedBar);
  props.forEach((entry, index) => {
    const object = entry.object;
    const offset = slots[index];
    object.position.set(
      playerLaptop.position.x + towardFarEdge.x * offset.forward + beside.x * offset.side,
      entry.home.y,
      playerLaptop.position.z + towardFarEdge.z * offset.forward + beside.z * offset.side,
    );
    clampToTable(object.position, seat, entry.footprint ?? 0.08);
  });
  // Large owned props (especially another laptop) stay pinned and visible;
  // small drink props opt into the same gentle clearance motion as fixed
  // décor, then restore to `home` when the player's MacBook closes.
  for (const entry of pinnedNpcProps) {
    const object = entry.object;
    object.visible = true;
    object.position.copy(entry.home);
  }
  relaxClearedProps(props, seat, pinnedNpcProps);
  finalizeClearedProps(props, seat, pinnedNpcProps);
  renderer.shadowMap.needsUpdate = true;
}

// The radial relax can wedge a prop between the laptop's keep-off ring and
// the table edge with nowhere to go along its push direction. This last pass
// is exhaustive instead of iterative: any prop still in conflict is moved to
// the nearest supported spot (polar sweep of the tabletop) that is clear of
// the laptop, the pinned NPC props, and everything placed before it.
function finalizeClearedProps(props, seat, pinned) {
  const placed = pinned
    .filter((entry) => entry.object?.parent)
    .map((entry) => ({
      x: entry.object.position.x, z: entry.object.position.z,
      f: entry.footprint ?? 0.08,
    }));
  const shape = seat.supportShape;
  const cx = shape?.center.x ?? seat.tableCenter.x;
  const cz = shape?.center.z ?? seat.tableCenter.z;
  let maxR = seat.tableRadius ?? 0.6;
  if (shape) {
    const bounds = shapeBounds(shape);
    maxR = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2;
  }
  for (const prop of props) {
    const p = prop.object.position;
    const f = prop.footprint ?? 0.08;
    if (!clearedPropConflicts(p.x, p.z, f, placed, seat)) {
      placed.push({ x: p.x, z: p.z, f });
      continue;
    }
    let best = null;
    for (let r = 0.06; r <= maxR; r += 0.05) {
      for (let k = 0; k < 24; k += 1) {
        const a = (k / 24) * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (clearedPropConflicts(x, z, f, placed, seat)) continue;
        const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (!best || d2 < best.d2) best = { x, z, d2 };
      }
    }
    if (best) { p.x = best.x; p.z = best.z; }
    placed.push({ x: p.x, z: p.z, f });
  }
}

function clearedPropConflicts(x, z, f, placed, seat) {
  if (playerLaptop) {
    const d = Math.hypot(x - playerLaptop.position.x, z - playerLaptop.position.z);
    if (d < 0.24 + f) return true;
  }
  for (const other of placed) {
    if (Math.hypot(x - other.x, z - other.z) < (f + other.f) * 0.72) return true;
  }
  if (seat.supportShape) return !pointSupported(seat.supportShape, x, z, f + 0.01);
  if (seat.tableRadius) {
    return Math.hypot(x - seat.tableCenter.x, z - seat.tableCenter.z) > seat.tableRadius - f - 0.01;
  }
  return false;
}

// Clamping can bunch several cleared props onto the same stretch of table
// rim. A few separation passes push overlapping pairs apart along the rim
// while keeping everything on the table and off the laptop. `pinned` props
// (an NPC's laptop or sketchpad) act as fixed obstacles: only the player's
// cleared props give way.
function relaxClearedProps(props, seat, pinned = []) {
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let a = 0; a < props.length; a++) {
      for (let b = a + 1; b < props.length; b++) {
        const pa = props[a].object.position;
        const pb = props[b].object.position;
        const fa = props[a].footprint ?? 0.08;
        const fb = props[b].footprint ?? 0.08;
        const minGap = (fa + fb) * 0.72;
        let dx = pb.x - pa.x;
        let dz = pb.z - pa.z;
        let d = Math.hypot(dx, dz);
        if (d >= minGap) continue;
        if (d < 0.001) { dx = 1; dz = 0; d = 1; }
        const push = (minGap - d) / 2 + 0.005;
        pa.x -= (dx / d) * push; pa.z -= (dz / d) * push;
        pb.x += (dx / d) * push; pb.z += (dz / d) * push;
        keepOffLaptop(pa, fa);
        keepOffLaptop(pb, fb);
        clampToTable(pa, seat, fa);
        clampToTable(pb, seat, fb);
        moved = true;
      }
      for (const obstacle of pinned) {
        const pa = props[a].object.position;
        const po = obstacle.object.position;
        const fa = props[a].footprint ?? 0.08;
        const fo = obstacle.footprint ?? 0.08;
        const minGap = (fa + fo) * 0.72;
        let dx = pa.x - po.x;
        let dz = pa.z - po.z;
        let d = Math.hypot(dx, dz);
        if (d >= minGap) continue;
        if (d < 0.001) { dx = 1; dz = 0; d = 1; }
        const push = (minGap - d) + 0.005;
        pa.x += (dx / d) * push; pa.z += (dz / d) * push;
        keepOffLaptop(pa, fa);
        clampToTable(pa, seat, fa);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function keepOffLaptop(position, footprint) {
  if (!playerLaptop) return;
  const minD = 0.24 + footprint;
  const dx = position.x - playerLaptop.position.x;
  const dz = position.z - playerLaptop.position.z;
  const d = Math.hypot(dx, dz);
  if (d < minD && d > 0.001) {
    position.x = playerLaptop.position.x + (dx / d) * minD;
    position.z = playerLaptop.position.z + (dz / d) * minD;
  }
}

// A cleared prop must stay ON its table: pull anything the slot grid pushed
// past the top's edge back inside, keeping its height. The clamp uses the
// exact rotated support shape (rect/circle/ellipse — window bars included),
// falling back to the legacy inscribed disc only if a seat carries no shape.
function clampToTable(position, seat, footprint) {
  const shape = seat?.supportShape;
  if (shape) {
    const inside = pullInsideShape(shape, position.x, position.z, footprint + 0.01);
    position.x = inside.x;
    position.z = inside.z;
    return;
  }
  if (!seat?.tableRadius) return;
  const maxR = Math.max(0.05, seat.tableRadius - footprint - 0.01);
  const dx = position.x - seat.tableCenter.x;
  const dz = position.z - seat.tableCenter.z;
  const d = Math.hypot(dx, dz);
  if (d > maxR) {
    position.x = seat.tableCenter.x + (dx / d) * maxR;
    position.z = seat.tableCenter.z + (dz / d) * maxR;
  }
}

function placePlayerCup() {
  if (!playerCup || seatIndex < 0 || !cafe) return;
  const seat = cafe.seats[seatIndex];
  const tc = seat.tableCenter;
  const topY = seat.isBar ? (seat.tableTopY ?? 1.035) - 0.005 : (seat.tableTopY ?? 0.81);
  if (playerLaptop) {
    // A drink belongs beside a laptop, never on its keyboard. Offset along the
    // table edge and prefer the side facing the room centre so end seats at the
    // narrow window bar still keep the mug fully supported.
    const towardTable = new THREE.Vector3().subVectors(tc, seat.pos).setY(0).normalize();
    const beside = new THREE.Vector3(-towardTable.z, 0, towardTable.x);
    const towardRoom = new THREE.Vector3(-tc.x, 0, -tc.z);
    if (beside.dot(towardRoom) < 0) beside.negate();
    const offset = laptopCupOffset(!!seat.isBar);
    playerCup.position.set(
      playerLaptop.position.x + beside.x * offset.side + towardTable.x * offset.forward,
      topY,
      playerLaptop.position.z + beside.z * offset.side + towardTable.z * offset.forward
    );
    clampToTable(playerCup.position, seat, 0.06);
  } else {
    playerCup.position.set(
      tc.x + (seat.pos.x - tc.x) * 0.45,
      topY,
      tc.z + (seat.pos.z - tc.z) * 0.45
    );
  }
}
function placePlayerLaptop() {
  const previousSeat = cafe?.seats[playerLaptopSeatIndex];
  restoreTableProps(previousSeat);
  playerLaptopSeatIndex = -1;
  laptopSurfacePropCount = -1;
  laptopNpcPropRevision = -1;
  audio.stopPlayerTyping(); // a moved or packed laptop takes its sound with it
  if (playerLaptop) {
    interactions.unregister(playerLaptop);
    playerLaptop.parent?.remove(playerLaptop);
    playerLaptop = null;
  }
  if (!laptopOn || seatIndex < 0 || !cafe) {
    placePlayerCup();
    return;
  }
  const seat = cafe.seats[seatIndex];
  const toTable = new THREE.Vector3().subVectors(seat.tableCenter, seat.pos).setY(0);
  const d = toTable.length() || 1;
  const yaw = Math.atan2(toTable.x, toTable.z) + Math.PI; // open side faces you
  // One placement rule for every tabletop (plan §9/§10): aim arm's reach in
  // front of your chair, then let the solver pull the rotated base
  // (0.32 x 0.23) onto the seat's true support shape.
  const solved = seat.supportShape
    ? placeFootprintForSeat(seat.supportShape, seat.pos, seat.tableCenter,
      { yaw, width: 0.32, depth: 0.23 })
    : null;
  const fallbackReach = Math.max(0, d - 0.34);
  playerLaptop = makeMacBook();
  playerLaptop.position.set(
    solved?.x ?? (seat.pos.x + (toTable.x / d) * fallbackReach),
    seat.tableTopY ?? (seat.isBar ? 1.035 : 0.81),
    solved?.z ?? (seat.pos.z + (toTable.z / d) * fallbackReach)
  );
  playerLaptop.rotation.y = yaw;
  cafe.group.add(playerLaptop);
  // clicking your MacBook types on it, right where it sits
  interactions.register(playerLaptop, {
    cooldownMs: 350, // debounce: repeated clicks restart the burst, never stack it
    onClick: () => {
      if (!audio.started || !playerLaptop) return;
      playerLaptop.getWorldPosition(playerLaptopWorld);
      audio.playPlayerTyping(playerLaptopWorld, { intentional: true });
    },
  });
  syncLaptopSurfaceProps();
  playerLaptopSeatIndex = seatIndex;
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
    const cup = makeDrink(activeTheme().accent, lastModels);
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
  const seat = seatIndex >= 0 ? cafe.seats[seatIndex] : null;
  mode = 'walking';
  seatIndex = -1;
  if (crowd) crowd.setPlayerSeat(-1);
  placePlayerLaptop(); // packs it into your bag while you wander
  // standing up from an upper seat stays on the upper floor (§8)
  walkLevelId = seat?.levelId ?? walkLevelId ?? 'ground';
  walkPos.set(camera.position.x, 0, camera.position.z);
  resolveCollisions(walkPos);
  walkY = navigator?.resolveHeight(walkLevelId, walkPos.x, walkPos.z)
    ?? (seat ? seat.pos.y - (seat.isBar ? 0.15 : 0) : walkY);
  autosave.touch('stand');
  updateWalkBtn();
}

function updateWalkBtn() {
  const b = document.getElementById('walk-btn');
  if (!b) return;
  b.textContent = mode === 'walking' ? 'click a chair to sit' : 'stand up & walk';
  b.dataset.mode = mode;
  b.setAttribute('aria-label', mode === 'walking' ? 'Click a free chair to sit' : 'Stand up and walk');
}

const walkProposed = new THREE.Vector3();

// Commit a proposed walking position: authored portal transitions first, then
// the current floor's surface height; off-surface candidates slide along one
// axis or stay put. This is the only place walkLevelId ever changes on foot.
function commitWalkMove(p) {
  if (!navigator) {
    walkPos.x = p.x;
    walkPos.z = p.z;
    walkY = 0;
    return;
  }
  const portal = navigator.portalAt(walkLevelId, walkPos.x, walkPos.z)
    ?? navigator.portalAt(walkLevelId, p.x, p.z);
  if (portal && portal.toLevelId !== walkLevelId) {
    // directional: only cross when actually moving toward the destination
    // portal, otherwise a climber inside the seam zone would flip back to a
    // level whose surface also happens to contain the proposed point
    const toPortal = portal.to.portal;
    const dNow = Math.hypot(walkPos.x - toPortal.x, walkPos.z - toPortal.z);
    const dNext = Math.hypot(p.x - toPortal.x, p.z - toPortal.z);
    const linked = dNext < dNow - 1e-4 ? navigator.surfaces.get(portal.to.surfaceId) : null;
    if (linked && pointInPolygon(linked.polygon, p.x, p.z)) {
      const linkedY = surfaceHeightAt(linked, p.x, p.z);
      // a portal crossing is a single step, never a hop or a cliff
      if (Math.abs(linkedY - walkY) < 0.3) {
        walkLevelId = linked.levelId;
        walkPos.x = p.x;
        walkPos.z = p.z;
        walkY = linkedY;
        return;
      }
    }
  }
  const h = navigator.resolveHeight(walkLevelId, p.x, p.z);
  if (h != null) {
    walkPos.x = p.x;
    walkPos.z = p.z;
    walkY = h;
    return;
  }
  const hx = navigator.resolveHeight(walkLevelId, p.x, walkPos.z);
  if (hx != null) {
    walkPos.x = p.x;
    walkY = hx;
    return;
  }
  const hz = navigator.resolveHeight(walkLevelId, walkPos.x, p.z);
  if (hz != null) {
    walkPos.z = p.z;
    walkY = hz;
  }
  // fully blocked: keep the last valid position — never fall through
}

function resolveCollisions(p) {
  p.x = THREE.MathUtils.clamp(p.x, -ROOM.W / 2 + 0.45, ROOM.W / 2 - 0.45);
  p.z = THREE.MathUtils.clamp(p.z, -ROOM.D / 2 + 0.5, ROOM.D / 2 - 0.5);
  if (!cafe) return;
  for (const c of cafe.colliders) {
    // only the colliders of the walker's floor apply (guards carry levelId)
    if ((c.levelId ?? 'ground') !== walkLevelId) continue;
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

// ---------- input: first-person controls (src/controls) ----------
// Devices produce one movement intent per rendered frame; the frame loop
// applies it below. The raycast pointer stays on the crosshair (screen
// centre) except while resolving a touch tap at its own point.

function aimAtCentre() {
  pointer.set(0, 0);
  pointerDirty = true;
}

// interact at a point in normalised device coordinates (0,0 = crosshair):
// a world object or a seat
function activateAt(ndcX, ndcY) {
  if (tween.active || !cafe) return;
  pointer.set(ndcX, ndcY);
  const seatHit = pickSeat(); // also points the raycaster at the pointer
  aimAtCentre();
  // a registered world object (laptop, pet) owns the click only when it is
  // the nearer target; otherwise chairs keep their existing behaviour
  const worldHit = interactions.pick(raycaster);
  if (worldHit && (seatHit.index < 0 || worldHit.distance <= seatHit.distance)) {
    if (interactions.click(worldHit)) return;
  }
  const hit = seatHit.index;
  if (hit >= 0) {
    if (crowd.isSeatTaken(hit)) {
      toast('Someone’s sitting there — pick another spot ☕');
    } else if (hit !== seatIndex) {
      crowd.setPlayerSeat(hit);
      sitAt(hit);
    }
  }
}

// Reused result record: pickSeat runs on every pointer move, so it must not
// allocate. distance lets world interactions arbitrate against the seat hit.
const seatPick = { index: -1, distance: Infinity };
function pickSeat() {
  seatPick.index = -1;
  seatPick.distance = Infinity;
  if (!cafe) return seatPick;
  raycaster.setFromCamera(pointer, camera);
  seatHits.length = 0;
  raycaster.intersectObjects(cafe.seatMeshes, true, seatHits);
  for (const h of seatHits) {
    if (h.object.isInstancedMesh && h.instanceId !== undefined) {
      const index = h.object.userData.seatIndices?.[h.instanceId];
      if (index !== undefined) {
        seatPick.index = index;
        seatPick.distance = h.distance;
        break;
      }
    }
    let o = h.object;
    while (o && o.userData.seatIndex === undefined) o = o.parent;
    if (o) {
      seatPick.index = o.userData.seatIndex;
      seatPick.distance = h.distance;
      break;
    }
  }
  seatHits.length = 0;
  return seatPick;
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

const musicToggle = document.getElementById('music-toggle');
const muteToggle = document.getElementById('mute-toggle');
const trackStyle = document.getElementById('track-style');
const musicVolume = document.getElementById('music-vol');
const ambienceVolume = document.getElementById('amb-vol');
const voicesVolume = document.getElementById('voices-vol');
const petsVolume = document.getElementById('pets-vol');
const rainSlider = document.getElementById('rain-vol');
const rainLevelName = document.getElementById('rain-level');
const RAIN_STOP_NAMES = ['off', 'light', 'steady', 'heavy'];
function renderRainStop() {
  if (rainLevelName) rainLevelName.textContent = RAIN_STOP_NAMES[Number(rainSlider.value)] ?? 'steady';
}
musicVolume.value = String(preferences.musicVolume);
ambienceVolume.value = String(preferences.ambienceVolume);
voicesVolume.value = String(preferences.voicesVolume);
petsVolume.value = String(preferences.petVolume);
rainSlider.value = String(preferences.rainIntensity);
renderRainStop();
musicToggle.classList.toggle('on', preferences.musicOn);
musicToggle.textContent = preferences.musicOn ? '♪ music on' : '♪ music off';
musicToggle.setAttribute('aria-pressed', String(preferences.musicOn));
let masterMuted = preferences.muted || SEEDED_AUDIT_MODE;
function renderMuteToggle() {
  muteToggle?.classList.toggle('on', masterMuted);
  if (!muteToggle) return;
  muteToggle.textContent = masterMuted ? '🔇 muted' : '🔊 sound';
  muteToggle.setAttribute('aria-pressed', String(masterMuted));
  muteToggle.setAttribute('aria-label', masterMuted ? 'Unmute all sound' : 'Mute all sound');
  muteToggle.title = masterMuted ? 'unmute all sound' : 'mute all sound';
}
renderMuteToggle();
document.getElementById('laptop-btn')?.classList.toggle('on', laptopOn);
audio.setMusicVolume(preferences.musicVolume);
audio.setAmbienceVolume(preferences.ambienceVolume);
audio.setVoicesVolume(preferences.voicesVolume);
audio.setPetVolume(preferences.petVolume);
audio.setRainIntensity(preferences.rainIntensity);
audio.setMuted(masterMuted);

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

function currentPreferences() {
  return {
    musicVolume: Number(musicVolume.value),
    ambienceVolume: Number(ambienceVolume.value),
    voicesVolume: Number(voicesVolume.value),
    petVolume: Number(petsVolume.value),
    rainIntensity: Number(rainSlider.value),
    musicOn: musicToggle.classList.contains('on'),
    muted: masterMuted,
    cafeIndex: currentThemeIndex,
    envTime,
    envSky,
    qualityMode,
    laptopOn,
    focusMinutes,
  };
}
function persistPreferences() {
  savePreferences(currentPreferences());
  autosave.touch('preferences');
}
window.addEventListener('cafe-track-change', (e) => {
  autosave.touch('music');
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
muteToggle?.addEventListener('click', () => {
  masterMuted = !masterMuted;
  audio.setMuted(masterMuted);
  renderMuteToggle();
  persistPreferences();
  toast(masterMuted ? 'all sound muted' : 'sound restored');
});

// qualityMode is the shared quality tier (src/qualityTier.js), chosen in the
// settings menu: 'auto' adapts; every other tier pins effects + resolution.
let qualityMode = initQualityTier(preferences.qualityMode);
let autoEffectLevel = 0;
let effectLevel = 0;
let shadowInterval = 1 / 8;
const AUTO_MAX_EFFECT_LEVEL = 0;

// Resolution is only one part of the GPU budget. GTAO, bloom and animated
// shadow maps each render the scene (or a full-screen buffer) again, so the
// adaptive mode can shed those layers independently before the café starts
// dropping input frames. Level 0 still keeps PBR lighting and the sun shadow.
function applyEffectLevel(nextLevel) {
  effectLevel = THREE.MathUtils.clamp(Math.round(nextLevel), 0, 2);
  gtaoPass.enabled = effectLevel >= 1;
  bloomPass.enabled = effectLevel >= 2;
  shadowInterval = effectLevel === 2 ? 1 / 20 : effectLevel === 1 ? 1 / 12 : 1 / 8;
  cafe?.setQuality?.(effectLevel);
  crowd?.setQuality?.(effectLevel);
  renderer.shadowMap.needsUpdate = true;
}

onQualityTierChange((tier, config) => {
  qualityMode = tier;
  perfSampleTime = 0;
  perfSampleFrames = 0;
  qualityCooldown = 0;
  if (tier === 'auto') {
    applyEffectLevel(autoEffectLevel);
    applyRenderPixelRatio(Math.min(renderPixelRatio, AUTO_MAX_PIXEL_RATIO));
  } else {
    applyEffectLevel(config.effects);
    applyRenderPixelRatio(config.pixelRatio);
  }
  persistPreferences();
  toast(tier === 'auto'
    ? 'quality will adapt to keep the café smooth'
    : `quality set to ${config.label.toLowerCase()}`);
});
if (qualityMode !== 'auto') applyRenderPixelRatio(qualityTierConfig(qualityMode).pixelRatio);

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
petsVolume.addEventListener('input', (e) => {
  audio.setPetVolume(parseFloat(e.target.value));
  persistPreferences();
});
rainSlider.addEventListener('input', (e) => {
  audio.setRainIntensity(Number(e.target.value));
  renderRainStop();
  persistPreferences();
});

// focus timer (adjustable focus interval / break length from UI settings);
// the UI's focus panel hosts the duration controls
const timerEl = document.getElementById('timer-display');
const timerBtn = document.getElementById('timer-btn');
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
function renderTimerButton() {
  timerBtn.textContent = timerRunning ? '❚❚' : '▶';
  timerBtn.setAttribute('aria-label', timerRunning ? 'Pause focus timer' : 'Start focus timer');
}
timerBtn.addEventListener('click', () => {
  timerRunning = !timerRunning;
  if (!timerRunning) audio.stopPlayerTyping();
  renderTimerButton();
  autosave.touch('focus');
});
document.getElementById('timer-reset').addEventListener('click', () => {
  timerRunning = false; timerBreak = false; timerLeft = focusMinutes * 60;
  audio.stopPlayerTyping();
  renderTimerButton();
  renderTimer();
  autosave.touch('focus');
});
document.getElementById('timer-minus').addEventListener('click', () => {
  setFocusMinutes(focusMinutes - (focusMinutes > 5 ? 5 : 1));
});
document.getElementById('timer-plus').addEventListener('click', () => {
  setFocusMinutes(focusMinutes + (focusMinutes < 5 ? 1 : 5));
});
timerPresetButtons.forEach((button) => {
  button.addEventListener('click', () => setFocusMinutes(Number(button.dataset.minutes)));
});
renderTimerDuration();
renderTimer();

// enter overlay — also unlocks the AudioContext
const overlay = document.getElementById('overlay');
function enterCafe() {
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  audio.start(activeTheme());
  audio.setMusicVolume(Number(musicVolume.value));
  audio.setAmbienceVolume(Number(ambienceVolume.value));
  audio.setVoicesVolume(Number(voicesVolume.value));
  audio.setPetVolume(Number(petsVolume.value));
  audio.setRainIntensity(Number(rainSlider.value));
  audio.setMusicOn(musicToggle.classList.contains('on'));
  audio.setMuted(masterMuted);
}

// ---------- session checkpoints: Continue / New session ----------
// The title offers Continue when a checkpoint exists. Its café, time and
// weather are already the ones built behind the title, with the player in
// their saved spot, so Continue only has to resume the timer and music.

let sessionStarted = false;
let offeredCheckpoint = null;
let restoredMusic = null;
let saveProblemShown = false;
let playerWasMoving = false;

const cafeIndexOf = (checkpoint) => {
  const byId = THEMES.findIndex((theme) => theme.id === checkpoint.cafeId);
  return byId >= 0 ? byId : THREE.MathUtils.clamp(checkpoint.preferences.cafeIndex, 0, THEMES.length - 1);
};

function captureCheckpoint() {
  let player = null;
  // While a different room is being built, the old position means nothing.
  if (cafe && cafe.theme === currentTheme) {
    const look = { yaw: view.yaw, pitch: view.pitch };
    if (mode === 'seated' && seatIndex >= 0) {
      const { pos, levelId } = cafe.seats[seatIndex];
      player = {
        mode: 'seated', seat: { index: seatIndex, x: pos.x, y: pos.y, z: pos.z },
        x: pos.x, y: pos.y, z: pos.z, levelId: levelId ?? 'ground', ...look,
      };
    } else if (mode === 'walking') {
      player = { mode: 'walking', x: walkPos.x, y: walkY, z: walkPos.z, levelId: walkLevelId, ...look };
    }
  }
  const music = audio.started ? audio.musicState() : null;
  if (music) restoredMusic = null;
  return {
    savedAt: Date.now(),
    cafeId: THEMES[currentThemeIndex].id,
    preferences: currentPreferences(),
    settings: getUISettings(),
    stats: getFocusStats(),
    player,
    focus: { running: timerRunning, onBreak: timerBreak, remaining: timerLeft },
    music: music ?? restoredMusic,
  };
}

function reportCheckpointSave(result) {
  if (!result || result.ok || saveProblemShown) return;
  saveProblemShown = true;
  toast(result.reason === 'quota'
    ? 'storage is full, so this device can’t keep your spot for now'
    : 'this browser isn’t keeping site data, so your spot won’t be saved');
}

// A saved seat is matched by position as well as index, so a layout change
// between deploys never seats the player somewhere unexpected.
function savedSeatIndex(saved) {
  if (!saved || !cafe) return -1;
  const near = (seat) => seat
    && Math.hypot(seat.pos.x - saved.x, seat.pos.z - saved.z) < 0.35
    && Math.abs(seat.pos.y - saved.y) < 0.5;
  return near(cafe.seats[saved.index]) ? saved.index : cafe.seats.findIndex(near);
}

function restorePlayer(player) {
  if (!cafe || !player) return false;
  tween.active = false;
  const index = player.mode === 'seated' ? savedSeatIndex(player.seat) : -1;
  // a patron who sat down in the freshly built room gives the seat back
  const seated = index >= 0 && (!crowd?.isSeatTaken(index) || crowd.evictSeat(index));
  if (seated) {
    crowd?.setPlayerSeat(index);
    sitAt(index, true);
  } else {
    standUp();
    mode = 'walking';
    seatIndex = -1;
    crowd?.setPlayerSeat(-1);
    const onLevel = navigator?.resolveHeight(player.levelId, player.x, player.z) != null;
    walkLevelId = onLevel ? player.levelId : 'ground';
    // Patrons are respawned on every visit; the saved spot is honoured even
    // if one stands there now (they step around the player).
    walkPos.set(player.x, 0, player.z);
    resolveCollisions(walkPos);
    walkY = navigator?.resolveHeight(walkLevelId, walkPos.x, walkPos.z) ?? 0;
    camera.position.set(walkPos.x, walkY + STAND_EYE, walkPos.z);
    placePlayerLaptop();
    updateWalkBtn();
  }
  view.yaw = player.yaw;
  view.pitch = clampPitch(player.pitch);
  applyView();
  return true;
}

function restoreFocusState(focus, savedAt) {
  const resumed = resumeFocus(focus, savedAt, Date.now());
  if (resumed.remaining <= 0) Object.assign(resumed, { running: false, onBreak: false, remaining: focusMinutes * 60 });
  noteRestoredFocus(resumed);
  timerRunning = resumed.running;
  timerBreak = resumed.onBreak;
  timerLeft = resumed.remaining;
  renderTimerButton();
  renderTimer();
  if (resumed.interrupted) {
    toast(`your ${resumed.onBreak ? 'break' : 'focus session'} is paused at ${formatClock(resumed.remaining)}, press play to carry on`);
  }
}

// Only used to recover values a checkpoint holds when this device's
// preference record is missing (for example after site data was partly
// cleared). Normal visits already loaded these from src/preferences.js.
function applyPreferenceValues(p) {
  musicVolume.value = String(p.musicVolume);
  ambienceVolume.value = String(p.ambienceVolume);
  voicesVolume.value = String(p.voicesVolume);
  petsVolume.value = String(p.petVolume);
  rainSlider.value = String(p.rainIntensity);
  renderRainStop();
  audio.setMusicVolume(p.musicVolume);
  audio.setAmbienceVolume(p.ambienceVolume);
  audio.setVoicesVolume(p.voicesVolume);
  audio.setPetVolume(p.petVolume);
  audio.setRainIntensity(p.rainIntensity);
  if (musicToggle.classList.contains('on') !== p.musicOn) musicToggle.click();
  if (masterMuted !== p.muted) {
    masterMuted = p.muted;
    audio.setMuted(masterMuted);
    renderMuteToggle();
  }
  setQualityTier(p.qualityMode);
  laptopOn = p.laptopOn;
  document.getElementById('laptop-btn')?.classList.toggle('on', laptopOn);
  if (focusMinutes !== p.focusMinutes) setFocusMinutes(p.focusMinutes);
  persistPreferences();
}

function startNewSession() {
  sessionStarted = true;
  // The room behind the title showed the saved spot; a new session starts
  // from the best free seat instead.
  if (offeredCheckpoint && cafe && cafe.theme === currentTheme) {
    const s = defaultSeat();
    crowd.setPlayerSeat(s);
    sitAt(s, true);
  }
  persistPreferences();
  autosave.enable();
  autosave.saveNow('new-session');
}

function resumeSession(checkpoint) {
  sessionStarted = true;
  const { preferences: saved } = checkpoint;
  const index = cafeIndexOf(checkpoint);
  const sameRoom = index === currentThemeIndex && envTime === saved.envTime && envSky === saved.envSky
    && cafe && cafe.theme === currentTheme;
  envTime = saved.envTime;
  envSky = saved.envSky;
  renderSkyChips();
  if (laptopOn !== saved.laptopOn) {
    laptopOn = saved.laptopOn;
    document.getElementById('laptop-btn')?.classList.toggle('on', laptopOn);
  }
  if (focusMinutes !== saved.focusMinutes) setFocusMinutes(saved.focusMinutes);
  // Re-applied even in the same room: the visitor may have looked around on
  // the title screen.
  if (sameRoom) restorePlayer(checkpoint.player);
  else loadTheme(index, { place: () => restorePlayer(checkpoint.player) });
  restoreFocusState(checkpoint.focus, checkpoint.savedAt);
  restoredMusic = checkpoint.music;
  audio.queueMusicResume(checkpoint.music);
  persistPreferences();
  autosave.enable();
  autosave.touch('continue');
  requestPersistentStorage();
}

document.getElementById('enter-btn').addEventListener('click', () => {
  if (!sessionStarted) startNewSession();
  enterCafe();
});
document.getElementById('continue-btn')?.addEventListener('click', () => {
  if (!sessionStarted) {
    if (offeredCheckpoint) resumeSession(offeredCheckpoint);
    else startNewSession();
  }
  enterCafe();
});
onUISettingsChange(() => autosave.touch('settings'));
document.addEventListener('vibe:focus-block', () => {
  autosave.touch('focus-block');
  requestPersistentStorage();
});

checkpointLoad.then((checkpoint) => {
  if (!checkpoint || sessionStarted) return;
  offeredCheckpoint = checkpoint;
  adoptFocusStats(checkpoint.stats);
  if (!hadStoredUISettings) updateUISettings(checkpoint.settings);
  if (!hadStoredPreferences) applyPreferenceValues(checkpoint.preferences);
});

// Warm the checkpoint's café first: build the room, time and weather the
// visitor left (with them in their spot) instead of a default room that
// Continue would have to tear down, and fetch their music track meanwhile.
// The model library starts downloading while the checkpoint is read.
async function bootCafe() {
  loadModelLibrary().catch(() => {});
  const checkpoint = await Promise.race([
    checkpointLoad,
    new Promise((resolve) => setTimeout(resolve, 1500, null)),
  ]);
  if (!checkpoint) {
    await loadTheme(preferences.cafeIndex);
    return;
  }
  envTime = checkpoint.preferences.envTime;
  envSky = checkpoint.preferences.envSky;
  renderSkyChips();
  audio.prefetchMusic(checkpoint.music);
  await loadTheme(cafeIndexOf(checkpoint), {
    place: () => !sessionStarted && restorePlayer(checkpoint.player),
  });
}

function applyRenderPixelRatio(nextRatio) {
  const clamped = THREE.MathUtils.clamp(nextRatio, MIN_PIXEL_RATIO, ULTRA_PIXEL_RATIO);
  const rounded = Math.round(clamped * 20) / 20;
  if (Math.abs(rounded - renderPixelRatio) < 0.001) return;
  renderPixelRatio = rounded;
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(renderPixelRatio);
  updateFxaaResolution();
}

function resizeViewport() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  updateFxaaResolution();
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
let perfTargetFps = 0;
let qualityCooldown = 0;
let nextPlayerTypingAt = 0;
let playerTypingActive = false;
let metricsSyncAt = 0;
let observedRenderFps = 0;
let fpsWindowStartedAt = performance.now();
let fpsWindowFrames = 0;
let lastRenderMs = 0;
const playerLaptopWorld = new THREE.Vector3();
const lastRenderStats = { calls: 0, triangles: 0, points: 0, lines: 0 };
const SIM_STEP = 1 / 30;
// Never replay more than 0.2 seconds of crowd history after a throttled or
// backgrounded tab. Catching up several seconds creates a visible CPU spike
// exactly when the user returns to the café.
const MAX_SIM_STEPS = 6;

function updateAdaptiveQuality(frameDt, targetFps) {
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
  if (perfTargetFps !== targetFps) {
    perfTargetFps = targetFps;
    perfSampleTime = 0;
    perfSampleFrames = 0;
  }
  qualityCooldown = Math.max(0, qualityCooldown - frameDt);
  perfSampleTime += frameDt;
  perfSampleFrames += 1;
  if (perfSampleTime < 2.5) return;

  const averageFrameMs = (perfSampleTime / perfSampleFrames) * 1000;
  const targetFrameMs = 1000 / targetFps;
  if (averageFrameMs > targetFrameMs * 1.18) {
    if (renderPixelRatio > 1.001) {
      applyRenderPixelRatio(renderPixelRatio - 0.15);
    } else if (autoEffectLevel > 0) {
      autoEffectLevel -= 1;
      applyEffectLevel(autoEffectLevel);
    } else if (renderPixelRatio > MIN_PIXEL_RATIO + 0.001) {
      applyRenderPixelRatio(renderPixelRatio - 0.1);
    }
    qualityCooldown = 5;
  } else if (averageFrameMs < targetFrameMs * 1.05 && qualityCooldown <= 0) {
    // Restore scene depth before supersampling: a low-resolution image with
    // contact light and bloom generally reads better than a sharper flat one.
    if (autoEffectLevel < AUTO_MAX_EFFECT_LEVEL) {
      autoEffectLevel += 1;
      applyEffectLevel(autoEffectLevel);
    } else if (renderPixelRatio < AUTO_MAX_PIXEL_RATIO) {
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

function frame(now = performance.now()) {
  requestAnimationFrame(frame);
  const activelyMoving = tween.active || controls.isActive();
  if (!frameScheduler.shouldRender(now, {
    moving: activelyMoving,
    visible: !document.hidden,
  })) return;
  const rawDt = Math.min(clock.getDelta(), 3.0); // real time, survives slow frames
  const dt = Math.min(rawDt, 0.05);              // camera/interaction step
  elapsed += rawDt;
  updateAdaptiveQuality(rawDt, frameScheduler.targetFps);

  // first-person input: one movement intent per rendered frame
  const intent = controls.frame(dt);
  if (!tween.active && (intent.look.yaw || intent.look.pitch)) {
    view.yaw += intent.look.yaw;
    view.pitch = clampPitch(view.pitch + intent.look.pitch);
    applyView();
  }
  if (intent.interact) activateAt(intent.interact.x, intent.interact.y);
  if (mode === 'seated' && !tween.active && (intent.move.x || intent.move.z)) standUp();

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
      if (pets) pets.update(SIM_STEP, crowd, camera.position);
    }
  }

  // Patrons may open or pack a laptop after the player has already sat down.
  // Reflow only when the registered prop count changes, never every frame.
  syncLaptopSurfaceProps();

  // camera tween between seats
  let cameraMoved = false;
  if (tween.active) {
    cameraMoved = true;
    tween.t += dt / tween.dur;
    const k = easeInOut(Math.min(tween.t, 1));
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    // arc up slightly mid-flight, like standing and walking over
    if (tween.dur > 1) camera.position.y += Math.sin(k * Math.PI) * 0.35;
    camera.quaternion.slerpQuaternions(tween.fromQ, tween.toQ, k);
    if (tween.t >= 1) {
      tween.active = false;
      applyView();
    }
  } else if (mode === 'walking' && cafe) {
    // first-person stroll
    walkForward.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    walkRight.set(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
    walkMove.set(0, 0, 0)
      .addScaledVector(walkForward, intent.move.z)
      .addScaledVector(walkRight, intent.move.x);
    const moving = walkMove.lengthSq() > 1e-4;
    if (playerWasMoving && !moving) autosave.touch('moved');
    playerWasMoving = moving;
    if (moving) {
      cameraMoved = true;
      const speed = WALK_SPEED * (intent.sprint ? SPRINT_MULTIPLIER : 1);
      walkProposed.copy(walkPos).addScaledVector(walkMove, dt * speed);
      resolveCollisions(walkProposed);
      crowd?.resolvePlayerCollision?.(walkProposed, 0.3, walkY);
      // A person can push the player toward a table edge; resolve the room once
      // more so the two collision systems cannot squeeze the camera into props.
      resolveCollisions(walkProposed);
      // §8: collision and walk-surface height resolve atomically — a candidate
      // off every surface of the current floor is rejected (or slid along an
      // axis), never dropped to another floor's height.
      commitWalkMove(walkProposed);
      walkBob += dt * 8 * (intent.sprint ? 1.35 : 1);
      // your own footsteps
      const stepNow = Math.floor(walkBob / Math.PI);
      if (stepNow !== lastPlayerStep) {
        lastPlayerStep = stepNow;
        if (audio.started) audio.playFootstep(walkPos, 0.55);
      }
    }
    camera.position.set(
      walkPos.x,
      walkY + STAND_EYE + (moving ? Math.abs(Math.sin(walkBob)) * 0.03 : 0),
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
  if (cafe && !tween.active) {
    if (pointerDirty || cameraMoved) {
      const seatHit = pickSeat();
      hoveredSeat = seatHit.index;
      hoveredWorld = interactions.size ? interactions.pick(raycaster) : null;
      if (hoveredWorld && hoveredSeat >= 0 && hoveredWorld.distance > seatHit.distance) {
        hoveredWorld = null; // the chair is in front — it owns the pointer
      }
      interactions.hover(hoveredWorld);
      pointerDirty = false;
    }
    if (hoveredWorld) {
      ring.visible = false;
      controls.setAimTarget('use');
    } else if (hoveredSeat >= 0 && hoveredSeat !== seatIndex) {
      const seat = cafe.seats[hoveredSeat];
      const taken = crowd.isSeatTaken(hoveredSeat);
      ring.position.set(seat.pos.x, seat.pos.y + 0.72, seat.pos.z);
      ring.visible = true;
      ring.material.color.set(taken ? 0xd06050 : 0xffe2a8);
      ring.material.opacity = 0.6 + Math.sin(elapsed * 5) * 0.25;
      controls.setAimTarget(taken ? 'taken' : 'sit');
    } else {
      ring.visible = false;
      controls.setAimTarget(null);
    }
  } else {
    ring.visible = false;
    controls.setAimTarget(null);
    if (hoveredWorld) {
      hoveredWorld = null;
      interactions.hover(null);
    }
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
      timerLeft = (timerBreak ? breakMinutes() : focusMinutes) * 60;
      if (audio.started) audio.playTimerAlarm();
      toast(timerBreak ? 'Break time — stretch a little 🌿' : 'Back to focus ☕');
      autosave.touch('focus');
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
      nextPlayerTypingAt = elapsed + 9 + Math.random() * 9;
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
  const renderStartedAt = performance.now();
  crowd?.interpolate(simAcc / SIM_STEP);
  pets?.interpolate(simAcc / SIM_STEP);
  try {
    if (effectLevel === 0) renderer.render(scene, camera);
    else composer.render(dt);
  } finally {
    crowd?.restoreSimulationPose();
    pets?.restoreSimulationPose();
  }
  lastRenderMs = performance.now() - renderStartedAt;
  lastRenderStats.calls = renderer.info.render.calls;
  lastRenderStats.triangles = renderer.info.render.triangles;
  lastRenderStats.points = renderer.info.render.points;
  lastRenderStats.lines = renderer.info.render.lines;
  fpsWindowFrames += 1;
  const fpsWindowMs = now - fpsWindowStartedAt;
  if (fpsWindowMs >= 1000) {
    observedRenderFps = fpsWindowFrames * 1000 / fpsWindowMs;
    fpsWindowFrames = 0;
    fpsWindowStartedAt = now;
  }

  if (elapsed >= metricsSyncAt && window.__vibe) {
    metricsSyncAt = elapsed + 0.5;
    document.documentElement.dataset.vibeMetrics = JSON.stringify(window.__vibe.metrics());
  }
}

bootCafe();
frame();

connectUI({
  venues: THEMES.map((theme) => ({ name: theme.name, blurb: theme.blurb })),
  isReady: () => Boolean(cafe),
  currentCafe: () => cafe,
  controls,
  audio,
  checkpoint: checkpointLoad.then((checkpoint) => (checkpoint
    ? describeCheckpoint(checkpoint, { cafeName: THEMES[cafeIndexOf(checkpoint)].name })
    : null)),
});

// tiny debug handle for automated tests: place the camera, inspect audio
window.__vibe = {
  audio,
  // Capture the same rendering path used by the app, including its current
  // quality settings. The simulation is advanced by the audit harness.
  captureFrame(alpha = 1, format = 'image/png') {
    crowd?.interpolate(alpha);
    pets?.interpolate(alpha);
    try {
      renderer.shadowMap.needsUpdate = true;
      renderer.info.reset();
      if (effectLevel === 0) renderer.render(scene, camera);
      else composer.render(1 / 30);
      for (const key of ['calls', 'triangles', 'points', 'lines']) {
        lastRenderStats[key] = renderer.info.render[key];
      }
      return renderer.domElement.toDataURL(format, 0.92);
    } finally {
      crowd?.restoreSimulationPose();
      pets?.restoreSimulationPose();
    }
  },
  get cafe() { return cafe; },
  venueCollectionAudit() { return auditVenueCollections(cafe.group); },
  get crowd() { return crowd; },
  get pets() { return pets; },
  get interactions() { return interactions; },
  get controls() { return controls; },
  get view() { return { yaw: view.yaw, pitch: view.pitch }; },
  checkpoint: {
    capture: () => captureCheckpoint(),
    save: (reason = 'debug') => autosave.saveNow(reason),
    load: () => checkpointStore.load(),
    whenRead: () => checkpointLoad.then(Boolean),
    get backend() { return checkpointStore.backend; },
    get offered() { return offeredCheckpoint; },
    get autosaving() { return autosave.enabled; },
    timer: () => ({ running: timerRunning, onBreak: timerBreak, remaining: timerLeft, minutes: focusMinutes }),
  },
  metrics() {
    let decodedAudioBytes = 0;
    let instancedMeshes = 0;
    let instancedInstances = 0;
    const activeGeometries = new Set();
    const activeTextures = new Set();
    const activeSharedTextures = new Set();
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        instancedMeshes += 1;
        instancedInstances += object.count;
      }
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
      rain: !!cafe?.theme.rain,
      qualityMode,
      pixelRatio: renderPixelRatio,
      effects: effectLevel,
      targetFps: frameScheduler.targetFps,
      observedFps: Number(observedRenderFps.toFixed(1)),
      renderedFrames: frameScheduler.renderedFrames,
      skippedFrames: frameScheduler.skippedFrames,
      lastRenderMs: Number(lastRenderMs.toFixed(2)),
      shadowFps: Math.round(1 / shadowInterval),
      gtaoScale: 0.5,
      bloomScale: 0.5,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      decodedAudioBytes,
      outsidePedestrians: crowd?.outside?.walkers?.length ?? 0,
      indoorPatrons: crowd?.npcs?.length ?? 0,
      mobileActors: (crowd?.outside?.walkers?.length ?? 0) + (crowd?.npcs?.length ?? 0),
      characterDiversity: crowd?.characterDiversityReport() ?? null,
      outsideUmbrellas: crowd?.outside?.walkers?.filter((walker) => walker.umbrella).length ?? 0,
      outsideUmbrellaHands: crowd?.outside?.walkers?.filter((walker) => walker.avatar?.bones?.RightHand).length ?? 0,
      outsideUmbrellaGripError: Math.max(
        0,
        ...(crowd?.outside?.walkers ?? []).map((walker) => walker.umbrella?.gripError ?? 0),
      ),
      doorOpenness: cafe?.entrance?.openness ?? 1,
      doorQueue: crowd?.doorFlow?.queueLength ?? 0,
      playerTypingBursts: audio.playerTypingBursts ?? 0,
      playerTypingActive: (audio._playerTypingNodes?.length ?? 0) > 0,
      // Immersion V2 instrumentation. Systems that do not exist yet report
      // zero so per-PR audits can watch these budgets from the first commit.
      activeOneShotSources: audio.activeOneShotSources ?? 0,
      activePetVoices: pets?.activeVoiceCount ?? 0,
      plannerEvalsPerSecond: crowd?.planner?.evalsPerSecond ?? 0,
      serviceTasks: crowd?.service?.taskCount ?? 0,
      serviceReservations: crowd?.service?.reservationCount ?? 0,
      steamEmitters: cafe?.steamEmitterCount ?? 0,
      interactionTargets: interactions.size,
      instancedMeshes,
      instancedInstances,
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
  place(x, z, yaw, pitch = 0, levelId = null) {
    standUp();
    if (levelId) walkLevelId = levelId;
    walkPos.set(x, 0, z);
    resolveCollisions(walkPos);
    crowd?.resolvePlayerCollision?.(walkPos);
    walkY = navigator?.resolveHeight(walkLevelId, walkPos.x, walkPos.z)
      ?? navigator?.resolveHeight('ground', walkPos.x, walkPos.z) ?? 0;
    view.yaw = yaw; view.pitch = pitch;
    applyView();
  },
  player() {
    return { x: walkPos.x, y: walkY, z: walkPos.z, levelId: walkLevelId, mode, seatIndex };
  },
  face(yaw, pitch = 0) {
    view.yaw = yaw; view.pitch = pitch;
    applyView();
  },
  sit(index) {
    if (!cafe?.seats[index]) return false;
    // mirror the click-to-sit occupancy rule: a seated guest gives the seat
    // up (departing normally, props cleared); a guest mid-walk/order keeps
    // their reservation and the caller skips this seat
    if (crowd?.isSeatTaken(index) && !crowd.evictSeat(index)) return false;
    sitAt(index, true);
    return true;
  },
  // Physical-sanity sweep for tabletop decor: no floating, no sinking, no
  // pairwise overlap, no table-edge overhang. Pure measurement (no rendering
  // needed), so audits can sweep every seat and laptop state quickly.
  decorAudit() {
    if (!cafe) return { violations: [{ kind: 'no-cafe' }] };
    const violations = [];
    const box = new THREE.Box3();
    const seenTables = new Set();
    cafe.seats.forEach((seat, seatIdx) => {
      const key = `${seat.tableCenter.x.toFixed(2)},${seat.tableCenter.z.toFixed(2)}`;
      if (seenTables.has(key)) return;
      seenTables.add(key);
      const entries = (seat.surfaceProps ?? []).filter((entry) => entry.object?.parent);
      entries.forEach((entry, i) => {
        entry.object.updateWorldMatrix(true, true);
        box.setFromObject(entry.object);
        if (box.isEmpty()) return;
        const bottom = box.min.y;
        const name = `${cafe.theme.id} table@${key} prop#${i}`;
        if (bottom > seat.tableTopY + 0.06) {
          violations.push({ kind: 'floating', name, bottom: +bottom.toFixed(3), surface: seat.tableTopY });
        }
        if (bottom < seat.tableTopY - 0.08) {
          violations.push({ kind: 'sunken', name, bottom: +bottom.toFixed(3), surface: seat.tableTopY });
        }
        // overhang against the exact rotated support shape (covers the long
        // window-bar strips the old inscribed-disc rule couldn't describe)
        if (seat.supportShape) {
          const margin = (entry.footprint ?? 0.08) * 0.5 - 0.03;
          if (!pointSupported(seat.supportShape, entry.object.position.x, entry.object.position.z, margin)) {
            violations.push({ kind: 'overhang', name, footprint: entry.footprint ?? 0.08 });
          }
        } else if (seat.tableRadius) {
          const dx = entry.object.position.x - seat.tableCenter.x;
          const dz = entry.object.position.z - seat.tableCenter.z;
          const reach = Math.hypot(dx, dz) + (entry.footprint ?? 0.08) * 0.5;
          if (reach > seat.tableRadius + 0.03) {
            violations.push({ kind: 'overhang', name, reach: +reach.toFixed(3), radius: seat.tableRadius });
          }
        }
        for (let j = i + 1; j < entries.length; j++) {
          const other = entries[j];
          const d = Math.hypot(
            entry.object.position.x - other.object.position.x,
            entry.object.position.z - other.object.position.z,
          );
          const minGap = ((entry.footprint ?? 0.08) + (other.footprint ?? 0.08)) * 0.6;
          if (d < minGap) {
            violations.push({ kind: 'overlap', name: `${name} vs prop#${j}`, distance: +d.toFixed(3), minGap: +minGap.toFixed(3) });
          }
        }
      });
    });
    // The player's MacBook is never a point: all four base corners must sit
    // on the seat's true support shape (plan §9).
    const playerSeat = seatIndex >= 0 ? cafe.seats[seatIndex] : null;
    const playerBase = playerLaptop && playerSeat ? {
      x: playerLaptop.position.x, z: playerLaptop.position.z,
      yaw: playerLaptop.rotation.y, width: 0.32, depth: 0.23,
    } : null;
    if (playerBase && playerSeat.supportShape
      && !footprintSupported(playerSeat.supportShape, playerBase, 0)) {
      violations.push({
        kind: 'laptop-overhang', name: `${cafe.theme.id} player laptop @${playerSeat.id}`,
        x: +playerBase.x.toFixed(3), z: +playerBase.z.toFixed(3),
      });
    }
    // NPC tabletop props: never hidden as a clearance workaround, always on
    // their own tabletop, and an NPC laptop must coexist with the player's
    // (visible + non-overlapping OBBs) at a shared table (plan §10).
    for (const seat of cafe.seats) {
      for (const entry of seat.npcTableProps ?? []) {
        if (!entry.object?.parent) continue;
        const name = `${cafe.theme.id} npc prop @${seat.id ?? 'seat'}`;
        if (!entry.object.visible) {
          violations.push({ kind: 'npc-prop-hidden', name });
        }
        entry.object.updateWorldMatrix(true, true);
        box.setFromObject(entry.object);
        if (!box.isEmpty()) {
          if (box.min.y > seat.tableTopY + 0.06) {
            violations.push({ kind: 'floating', name, bottom: +box.min.y.toFixed(3), surface: seat.tableTopY });
          }
          if (box.min.y < seat.tableTopY - 0.08) {
            violations.push({ kind: 'sunken', name, bottom: +box.min.y.toFixed(3), surface: seat.tableTopY });
          }
        }
        if (seat.supportShape) {
          const margin = (entry.footprint ?? 0.08) * 0.5 - 0.03;
          if (!pointSupported(seat.supportShape, entry.object.position.x, entry.object.position.z, margin)) {
            violations.push({ kind: 'overhang', name, footprint: entry.footprint ?? 0.08 });
          }
        }
        if (playerBase && playerSeat.tableCenter.distanceToSquared(seat.tableCenter) < 0.0001) {
          const overlaps = entry.base
            ? convexPolygonsOverlap(footprintCorners(playerBase), footprintCorners({
              x: entry.object.position.x, z: entry.object.position.z,
              yaw: entry.object.rotation.y, width: entry.base.width, depth: entry.base.depth,
            }))
            : Math.hypot(
              entry.object.position.x - playerBase.x,
              entry.object.position.z - playerBase.z,
            ) < 0.16 + (entry.footprint ?? 0.08) * 0.5;
          if (overlaps) {
            violations.push({ kind: 'laptop-collision', name });
          }
        }
      }
    }
    // objects that declare their support surface (service-counter dressing)
    cafe.group.traverse((object) => {
      if (object.userData.surfaceY === undefined) return;
      object.updateWorldMatrix(true, true);
      box.setFromObject(object);
      if (box.isEmpty()) return;
      if (box.min.y > object.userData.surfaceY + 0.05 || box.min.y < object.userData.surfaceY - 0.05) {
        violations.push({
          kind: 'off-surface', name: `${cafe.theme.id} ${object.userData.surfaceName ?? 'counter prop'}`,
          bottom: +box.min.y.toFixed(3), surface: object.userData.surfaceY,
        });
      }
    });
    return { tables: seenTables.size, violations };
  },
  // Whole-venue world-grounding sweep (plan §17 / user directive): every solid
  // mesh in the scene must rest on a real support plane — a floor level, the
  // upper deck, a tabletop, a counter/shelf, or the stage — OR be legitimately
  // suspended (its bbox reaches up to the ceiling/pergola like a pendant, beam
  // or hanging plant) OR be flush against a wall (art, clock, mirror, menu,
  // neon). A mesh that rests on nothing below, reaches nothing above, and
  // touches no wall is isolated in mid-air: a floating bug. Anything dipping
  // below its floor is sunken. Pure geometry, no per-mesh tagging.
  worldGroundingAudit() {
    if (!cafe) return { checked: 0, violations: [{ kind: 'no-cafe' }] };
    const W = ROOM.W ?? 17;
    const D = ROOM.D ?? 13.5;
    const ceilingH = ROOM.H ?? 3.8;
    const levels = cafe.blueprint?.levels ?? [{ id: 'ground', y: 0 }];
    // support planes contributed by tabletops
    const tablePlanes = [];
    const seenT = new Set();
    for (const seat of cafe.seats) {
      const key = `${seat.tableCenter.x.toFixed(2)},${seat.tableCenter.z.toFixed(2)}`;
      if (seenT.has(key)) continue;
      seenT.add(key);
      tablePlanes.push({
        x: seat.tableCenter.x, z: seat.tableCenter.z,
        r: (seat.tableRadius ?? 0.6) + 0.25, y: seat.tableTopY ?? 0.81,
        shape: seat.supportShape,
      });
    }
    // support planes declared by counter/shelf dressing
    const surfacePlanes = [];
    cafe.group.traverse((o) => {
      if (o.userData.surfaceY === undefined) return;
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      surfacePlanes.push({ x: p.x, z: p.z, r: 1.2, y: o.userData.surfaceY });
    });
    // window-bar and tasting-rail counters are long strips, not discs: register
    // their full rectangular top so structure and props resting anywhere along
    // them read as grounded
    const rectPlanes = [];
    for (const t of cafe.blueprint?.tables ?? []) {
      if (!t.isBar && t.archetype !== 'rail') continue;
      rectPlanes.push({
        x0: t.center.x - (t.width ?? 0.5) / 2 - 0.35, x1: t.center.x + (t.width ?? 0.5) / 2 + 0.35,
        z0: t.center.z - (t.depth ?? 0.5) / 2 - 0.35, z1: t.center.z + (t.depth ?? 0.5) / 2 + 0.35,
        y: t.surfaceY ?? 1.03,
      });
    }
    const stage = cafe.blueprint?.decor?.stage;
    const stageY = stage ? (stage.height ?? stage.y ?? 0.18) : 0;
    // curated ground-level equipment daises: the roasting lab and the side
    // table hold visibly-grounded assemblies whose parts sit on their own
    // plinth/top rather than the floor
    const prodRect = cafe.blueprint?.decor?.production?.rect;
    // matches the placement fallback in buildCafe: a lounge side table (and its
    // lantern) sits at this default spot unless the venue overrides it
    const sideTable = cafe.blueprint?.decor?.sideTable ?? { x: -5.1, z: -0.5 };
    const floorLevelYs = levels.map((l) => l.y);
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const violations = [];
    let checked = 0;
    // Grounding is a property of a whole PLACED object (a chair rests on its
    // legs even though its backrest floats at 0.7 m), so the unit is a direct
    // child of the venue group — its full bbox spans base-to-top — not each
    // constituent mesh. Instanced batches (chairs, books) span the room and
    // are validated by the layout/decor audits instead.
    // The hovering selection ring is UI; the physical chair is audited below.
    const groundingObjects = groundingAuditObjects(cafe.group, [ring]);
    for (const object of groundingObjects) {
      if (object.isInstancedMesh) continue;
      if (!object.visible) continue;
      if (object.bounds) box.copy(object.bounds);
      else {
        object.updateWorldMatrix(true, true);
        box.setFromObject(object);
      }
      if (box.isEmpty()) continue;
      const sx = box.max.x - box.min.x;
      const sy = box.max.y - box.min.y;
      const sz = box.max.z - box.min.z;
      box.getCenter(centre);
      // skip the shell and everything beyond the room: floor slab, walls,
      // ceiling, windows, sky, street props, pedestrians, vehicles
      if (sx * sz > 24 || sx > 14 || sz > 12) continue;
      if (Math.abs(centre.x) > W / 2 - 0.05 || Math.abs(centre.z) > D / 2 - 0.05) continue;
      if (box.min.y > ceilingH + 0.6) continue; // pergola slats / string lights above the frame
      // Imported plant/tree models report an inflated rest-pose Box3 (a known
      // setFromObject quirk with grouped GLTF foliage) that does not reflect
      // the visibly grounded geometry — a >2.2 m span in a low-poly cafe is
      // always one of these, never a real placeable. Grounding of the greenery
      // is confirmed by the screenshot review, not this box.
      if (sy > 2.2) continue;
      checked += 1;
      // resolve the floor directly under this object (deck, ramp, or ground)
      let floorY = 0;
      for (const lvl of levels) {
        const h = navigator?.resolveHeight(lvl.id, centre.x, centre.z);
        if (h != null && h <= box.min.y + 0.25 && h >= floorY) floorY = h;
      }
      // the best support plane at-or-below the object's base
      let bestPlane = floorLevelYs.filter((y) => y <= box.min.y + 0.1).reduce((m, y) => Math.max(m, y), 0);
      for (const p of tablePlanes) {
        // Communal and oval tables extend beyond a circular approximation.
        // Use the same authored footprint as the tabletop placement audit.
        const onTable = p.shape ? pointSupported(p.shape, centre.x, centre.z)
          : Math.hypot(centre.x - p.x, centre.z - p.z) <= p.r;
        if (onTable && p.y <= box.min.y + 0.1) {
          bestPlane = Math.max(bestPlane, p.y);
        }
      }
      for (const p of surfacePlanes) {
        if (Math.hypot(centre.x - p.x, centre.z - p.z) <= p.r && p.y <= box.min.y + 0.1) {
          bestPlane = Math.max(bestPlane, p.y);
        }
      }
      for (const p of rectPlanes) {
        if (centre.x >= p.x0 && centre.x <= p.x1 && centre.z >= p.z0 && centre.z <= p.z1
          && p.y <= box.min.y + 0.1) {
          bestPlane = Math.max(bestPlane, p.y);
        }
      }
      if (stage) {
        const r = stage.rect;
        if (centre.x >= r.x0 - 0.2 && centre.x <= r.x1 + 0.2 && centre.z >= r.z0 - 0.2 && centre.z <= r.z1 + 0.2
          && stageY <= box.min.y + 0.1) {
          bestPlane = Math.max(bestPlane, stageY);
        }
      }
      if (sideTable && Math.hypot(centre.x - sideTable.x, centre.z - sideTable.z) < 0.5
        && box.min.y < 0.75) {
        bestPlane = Math.max(bestPlane, box.min.y); // resting on the side table top
      }
      const gapBelow = box.min.y - bestPlane;
      // sunken: base pushed below its own floor
      if (box.min.y < floorY - 0.15) {
        violations.push({
          kind: 'sunken', name: object.name || object.userData.surfaceName || object.type,
          bottom: +box.min.y.toFixed(3), floor: +floorY.toFixed(3),
          size: [+sx.toFixed(2), +sy.toFixed(2), +sz.toFixed(2)],
          pos: [+centre.x.toFixed(2), +centre.z.toFixed(2)],
          kids: object.children?.length ?? 0,
        });
        continue;
      }
      if (gapBelow <= 0.12) continue; // resting on a plane
      // curated equipment dais (roasting lab): parts sit on their own plinth
      if (prodRect && centre.x >= prodRect.x0 && centre.x <= prodRect.x1
        && centre.z >= prodRect.z0 && centre.z <= prodRect.z1) continue;
      // flat signage/labels (a plate with a near-zero dimension) mount on
      // counter fronts and shelf lips, not on a horizontal surface
      if (Math.min(sx, sy, sz) < 0.02) continue;
      // elevated: legitimate only if anchored to the ceiling/pergola above or
      // flush against a wall
      const reachesCeiling = box.max.y >= floorY + ceilingH - 0.6;
      // decor lives in a band along each wall: mounted art/clock/mirror/menu
      // flush to the wall, plus window-bar counters, wall shelves and wall
      // booths inset up to ~1.7 m from the glass
      const nearWall = (W / 2 - Math.abs(centre.x) < 1.7) || (D / 2 - Math.abs(centre.z) < 1.7);
      if (reachesCeiling || (nearWall && box.max.y > floorY + 0.35)) continue;
      violations.push({
        kind: 'floating', name: object.name || object.userData.surfaceName || object.type,
        bottom: +box.min.y.toFixed(3), plane: +bestPlane.toFixed(3), gap: +gapBelow.toFixed(3),
        size: [+sx.toFixed(2), +sy.toFixed(2), +sz.toFixed(2)],
        pos: [+centre.x.toFixed(2), +centre.z.toFixed(2)],
        kids: object.children?.length ?? 0,
      });
    }
    return { checked, violations };
  },
};
