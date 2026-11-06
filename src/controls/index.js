// First-person controls. Devices write into one accumulator; the consumer
// reads a single movement intent per rendered frame (see ./intent.js).
//
//   const controls = createControls({ canvas, settings });
//   const intent = controls.frame(dt);   // once per rendered frame
//
// Mouse: click the scene to capture the pointer (Pointer Lock), raw mouse
// look, WASD/arrows, Shift sprint, click or E to interact, Esc releases and
// pauses. Where Pointer Lock is unavailable, drag-to-look is the fallback.
// Gamepad: left stick move, right stick look, LT/L3 sprint, A interact.
// Touch: floating thumb stick in the lower-left zone, accelerated swipe
// look elsewhere, tap (or the action button) to interact.
import {
  createIntent, keysToMove, stickToMove, pointerLook, stickLook, smoothLook,
  TOUCH_RADIANS_PER_PIXEL, TOUCH_STICK, touchLookGain,
} from './intent.js';

const MOVE_CODES = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
const TAP_MAX_MS = 280;
const TAP_MAX_PX = 10;
// A refused attempt can raise up to two pointerlockerror events (raw input,
// then plain); fall back to drag-to-look after two refused attempts.
const LOCK_ERRORS_PER_ATTEMPT = 2;
const LOCK_FAILURE_LIMIT = 2 * LOCK_ERRORS_PER_ATTEMPT;

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));

export function createControls({ canvas, settings = () => ({ sensitivity: 1, invertY: false, smoothing: false }) }) {
  const keys = { forward: false, back: false, left: false, right: false };
  const pending = { yaw: 0, pitch: 0, interact: null };
  const smoothing = {};
  const stick = { x: 0, y: 0, active: false };
  const pad = { sprintLatch: false, prev: [] };
  let sprintKey = false;
  let enabled = false;
  let menuOpen = false;
  let lastInputAt = 0;
  let forcedLock = false;
  let expectingRelease = false;
  let lockFailures = 0;
  let wasLocked = false;
  const lockListeners = new Set();
  const pauseListeners = new Set();
  const intent = createIntent();

  const now = () => performance.now();
  const touchInput = () => { lastInputAt = now(); };
  const locked = () => forcedLock || document.pointerLockElement === canvas;
  const lockSupported = () => typeof canvas.requestPointerLock === 'function';
  // Pointer Lock may be refused (iframes, old browsers, repeated denials);
  // fall back to the drag-to-look scheme so the mouse always works.
  const dragFallback = () => !lockSupported() || lockFailures >= LOCK_FAILURE_LIMIT;

  function emitLock() {
    const isLocked = locked();
    document.documentElement.classList.toggle('pointer-locked', isLocked);
    document.documentElement.classList.toggle('pointer-fallback', dragFallback());
    lockListeners.forEach((fn) => fn(isLocked));
  }

  function requestLock() {
    if (locked() || dragFallback()) return;
    try {
      const result = canvas.requestPointerLock({ unadjustedMovement: true });
      // Raw (unadjusted) input is unsupported on some platforms; retry plain
      // unless a menu opened while the first request was pending.
      result?.catch?.(() => {
        if (enabled && !menuOpen && !locked()) canvas.requestPointerLock()?.catch?.(() => {});
      });
    } catch {
      lockFailures += LOCK_ERRORS_PER_ATTEMPT;
      emitLock();
    }
  }

  function releaseLock() {
    const wasForced = forcedLock;
    forcedLock = false;
    if (document.pointerLockElement === canvas) {
      expectingRelease = true;
      document.exitPointerLock();
    } else if (wasForced) {
      emitLock();
    }
  }

  document.addEventListener('pointerlockchange', () => {
    const isLocked = locked();
    const lost = wasLocked && !isLocked;
    wasLocked = isLocked;
    if (isLocked) lockFailures = 0;
    // A lock granted after a menu opened (requests resolve asynchronously)
    // must not capture the pointer away from that menu.
    if (isLocked && (!enabled || menuOpen)) { releaseLock(); return; }
    emitLock();
    if (!isLocked) {
      Object.assign(keys, { forward: false, back: false, left: false, right: false });
      sprintKey = false;
      // Only a lock that was actually held and taken away (browser Esc,
      // focus loss) pauses; refused or cancelled requests do not.
      if (lost && !expectingRelease) pauseListeners.forEach((fn) => fn());
      expectingRelease = false;
    }
  });
  document.addEventListener('pointerlockerror', () => { lockFailures += 1; emitLock(); });

  // ---------- keyboard ----------
  window.addEventListener('keydown', (event) => {
    if (!enabled || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    const action = MOVE_CODES[event.code];
    if (action) {
      keys[action] = true;
      event.preventDefault();
      touchInput();
    } else if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      sprintKey = true;
    } else if (event.code === 'KeyE' && !event.repeat) {
      pending.interact = { x: 0, y: 0 };
      touchInput();
    }
  });
  window.addEventListener('keyup', (event) => {
    const action = MOVE_CODES[event.code];
    if (action) keys[action] = false;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') sprintKey = false;
  });
  window.addEventListener('blur', () => {
    Object.assign(keys, { forward: false, back: false, left: false, right: false });
    sprintKey = false;
  });

  // ---------- mouse ----------
  document.addEventListener('mousemove', (event) => {
    if (!enabled || !locked()) return;
    const look = pointerLook(event.movementX, event.movementY, settings());
    pending.yaw += look.yaw;
    pending.pitch += look.pitch;
    touchInput();
  });

  // ---------- pointer on the scene: lock, interact, touch look ----------
  // Touch layout: a touch that starts in the lower-left thumb zone becomes a
  // floating stick centred under the thumb; any other touch looks around
  // (accelerated swipes) and a short tap interacts.
  const pointers = new Map(); // look/drag pointers: id -> { x, y, startX, startY, t, lastT }
  const toNdc = (x, y) => ({ x: (x / window.innerWidth) * 2 - 1, y: -(y / window.innerHeight) * 2 + 1 });
  const inStickZone = (x, y) => x < window.innerWidth * 0.42 && y > window.innerHeight * 0.38;

  canvas.addEventListener('pointerdown', (event) => {
    if (!enabled) return;
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return;
      if (locked()) { pending.interact = { x: 0, y: 0 }; touchInput(); return; }
      if (!dragFallback()) { requestLock(); return; }
    }
    if (event.pointerType === 'touch' && stickPointer === null && inStickZone(event.clientX, event.clientY)) {
      startStick(event, event.clientX, event.clientY, canvas);
      return;
    }
    const t = now();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, t, lastT: event.timeStamp });
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickPointer) { moveStick(event); return; }
    const p = pointers.get(event.pointerId);
    if (!p || !enabled) return;
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;
    // Speed from the events' own timestamps: a busy main thread delivers
    // moves late, which must not make a flick read as a slow drag.
    const elapsed = Math.max(1, event.timeStamp - p.lastT);
    const gain = event.pointerType === 'touch' ? touchLookGain(Math.hypot(dx, dy) / elapsed) : 1;
    const look = pointerLook(dx * gain, dy * gain, settings(), TOUCH_RADIANS_PER_PIXEL);
    pending.yaw += look.yaw;
    pending.pitch += look.pitch;
    p.x = event.clientX;
    p.y = event.clientY;
    p.lastT = event.timeStamp;
    touchInput();
  });
  const endPointer = (event) => {
    if (event.pointerId === stickPointer) { endStick(); return; }
    const p = pointers.get(event.pointerId);
    if (!p) return;
    pointers.delete(event.pointerId);
    const moved = Math.hypot(event.clientX - p.startX, event.clientY - p.startY);
    if (event.type === 'pointerup' && enabled && moved < TAP_MAX_PX && now() - p.t < TAP_MAX_MS * (event.pointerType === 'mouse' ? 3 : 1)) {
      // A tap close to the crosshair uses whatever the crosshair is on.
      const nearCrosshair = Math.hypot(event.clientX - window.innerWidth / 2, event.clientY - window.innerHeight / 2) < 56;
      pending.interact = nearCrosshair ? { x: 0, y: 0 } : toNdc(event.clientX, event.clientY);
      touchInput();
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // Long-press must not open the browser's context menu or callout.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  // ---------- thumb stick (touch) ----------
  const stickEl = document.getElementById('joystick');
  const stickKnob = stickEl?.querySelector('.joystick__knob');
  let stickPointer = null;
  let stickOrigin = { x: 0, y: 0 };
  let stickTarget = null;
  const restCentre = () => {
    const rect = stickEl.getBoundingClientRect();
    const shift = stickEl._shift ?? { x: 0, y: 0 };
    return { x: rect.left - shift.x + rect.width / 2, y: rect.top - shift.y + rect.height / 2 };
  };
  function placeStick(x, y) {
    if (!stickEl) return;
    const rest = restCentre();
    stickEl._shift = { x: x - rest.x, y: y - rest.y };
    stickEl.style.transform = `translate3d(${stickEl._shift.x}px, ${stickEl._shift.y}px, 0)`;
  }
  function startStick(event, x, y, target) {
    stickPointer = event.pointerId;
    stickTarget = target;
    stickOrigin = { x, y };
    try { target.setPointerCapture(event.pointerId); } catch { /* synthetic */ }
    if (target === canvas) placeStick(x, y);
    stick.active = true;
    stickEl?.classList.add('active');
    moveStick(event);
  }
  function moveStick(event) {
    let dx = event.clientX - stickOrigin.x;
    let dy = event.clientY - stickOrigin.y;
    const max = TOUCH_STICK.travel;
    const length = Math.hypot(dx, dy);
    if (length > max) { dx = (dx / length) * max; dy = (dy / length) * max; }
    if (stickKnob) stickKnob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    stick.x = dx / max;
    stick.y = dy / max;
    stickEl?.classList.toggle('sprint', Math.hypot(stick.x, stick.y) >= TOUCH_STICK.sprintAt);
    touchInput();
  }
  function endStick() {
    stickPointer = null;
    stickTarget = null;
    stick.active = false;
    stick.x = 0;
    stick.y = 0;
    if (stickEl) {
      stickEl.classList.remove('active', 'sprint');
      stickEl._shift = { x: 0, y: 0 };
      stickEl.style.transform = '';
      if (stickKnob) stickKnob.style.transform = '';
    }
  }
  if (stickEl) {
    stickEl.addEventListener('pointerdown', (event) => {
      if (!enabled || stickPointer !== null) return;
      const rest = restCentre();
      startStick(event, rest.x, rest.y, stickEl);
      event.preventDefault();
    });
    stickEl.addEventListener('pointermove', (event) => { if (event.pointerId === stickPointer) moveStick(event); });
    stickEl.addEventListener('pointerup', (event) => { if (event.pointerId === stickPointer) endStick(); });
    stickEl.addEventListener('pointercancel', (event) => { if (event.pointerId === stickPointer) endStick(); });
  }
  // Rotation or a resize mid-gesture must not leave the player walking.
  window.addEventListener('orientationchange', () => { endStick(); pointers.clear(); });

  // ---------- gamepad ----------
  function readGamepad(dt, out) {
    const list = navigator.getGamepads?.() ?? [];
    for (const gp of list) {
      if (!gp) continue;
      const pressed = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      const edge = (i) => pressed[i] && !pad.prev[gp.index]?.[i];
      pad.prev[gp.index] = pressed;
      if (menuOpen) continue;
      const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
      const move = stickToMove(lx, ly);
      if (Math.hypot(move.x, move.z) > Math.hypot(out.move.x, out.move.z)) out.move = move;
      if (edge(10)) pad.sprintLatch = !pad.sprintLatch;
      if (!move.x && !move.z) pad.sprintLatch = false;
      if (pad.sprintLatch || (gp.buttons[6]?.value ?? 0) > 0.5) out.sprint = true;
      const look = stickLook(rx, ry, dt, settings());
      out.look.yaw += look.yaw;
      out.look.pitch += look.pitch;
      if (edge(0)) pending.interact = { x: 0, y: 0 };
      if (move.x || move.z || look.yaw || look.pitch || pressed.some(Boolean)) touchInput();
    }
  }

  // ---------- per-frame intent ----------
  function frame(dt) {
    intent.move = { x: 0, z: 0 };
    intent.look = { yaw: 0, pitch: 0 };
    intent.sprint = false;
    intent.interact = null;
    if (enabled) {
      const fromKeys = keysToMove(keys);
      intent.move = fromKeys;
      intent.sprint = sprintKey;
      if (stick.active) {
        const s = stickToMove(stick.x, stick.y, TOUCH_STICK.deadZone, TOUCH_STICK.curve);
        if (Math.hypot(s.x, s.z) > Math.hypot(intent.move.x, intent.move.z)) intent.move = s;
        if (Math.hypot(stick.x, stick.y) >= TOUCH_STICK.sprintAt) intent.sprint = true;
      }
      readGamepad(dt, intent);
      const pointerLookDelta = smoothLook(smoothing, { yaw: pending.yaw, pitch: pending.pitch }, dt, settings().smoothing);
      intent.look.yaw += pointerLookDelta.yaw;
      intent.look.pitch += pointerLookDelta.pitch;
      intent.interact = pending.interact;
    }
    pending.yaw = 0;
    pending.pitch = 0;
    pending.interact = null;
    intent.active = Boolean(intent.move.x || intent.move.z || intent.look.yaw || intent.look.pitch)
      || now() - lastInputAt < 200;
    return intent;
  }

  // ---------- crosshair ----------
  const reticle = document.getElementById('reticle');
  const label = reticle && document.createElement('span');
  if (label) { label.className = 'reticle__label'; reticle.append(label); }
  let aimKind = null;
  emitLock();
  const AIM_LABELS = { sit: 'Sit', taken: 'Seat taken', use: 'Use' };
  function setAimTarget(kind) {
    if (kind === aimKind || !reticle) return;
    aimKind = kind;
    if (kind) reticle.dataset.target = kind; else delete reticle.dataset.target;
    label.textContent = AIM_LABELS[kind] ?? '';
  }

  return {
    frame,
    requestLock,
    releaseLock,
    isLocked: locked,
    usesDragFallback: dragFallback,
    // Something is steering this frame, or did very recently.
    isActive: () => stick.active || pointers.size > 0 || now() - lastInputAt < 200
      || Object.values(keys).some(Boolean) || pending.yaw !== 0 || pending.pitch !== 0
      || Boolean(smoothing.pendingYaw) || Boolean(smoothing.pendingPitch),
    // enabled: gameplay input allowed (false on the title and pause menu).
    // menuOpen: a HUD panel is open (gamepad sticks drive the menu instead).
    setContext({ enabled: nextEnabled = enabled, menuOpen: nextMenu = menuOpen } = {}) {
      if (!nextEnabled && enabled) {
        Object.assign(keys, { forward: false, back: false, left: false, right: false });
        sprintKey = false;
        pointers.clear();
        endStick();
      }
      enabled = nextEnabled;
      menuOpen = nextMenu;
    },
    setAimTarget,
    // Interact with what the crosshair is on (on-screen action button).
    requestInteract(ndc = { x: 0, y: 0 }) { if (enabled) { pending.interact = ndc; touchInput(); } },
    onLockChange: (fn) => lockListeners.add(fn),
    onPause: (fn) => pauseListeners.add(fn),
    // Test hook: headless browsers cannot grant Pointer Lock. Forcing it
    // routes document mousemove deltas exactly like a real lock.
    debugForceLock(on) {
      const lost = forcedLock && !on;
      forcedLock = Boolean(on);
      emitLock();
      if (lost) pauseListeners.forEach((fn) => fn());
    },
  };
}
