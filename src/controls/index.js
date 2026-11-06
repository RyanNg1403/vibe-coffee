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
// Touch: drag to look, tap to interact, on-screen stick to move.
import {
  createIntent, keysToMove, stickToMove, pointerLook, stickLook, smoothLook,
  TOUCH_RADIANS_PER_PIXEL,
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
  const pointers = new Map(); // touch/drag pointers: id -> { x, y, startX, startY, t }
  const toNdc = (x, y) => ({ x: (x / window.innerWidth) * 2 - 1, y: -(y / window.innerHeight) * 2 + 1 });

  canvas.addEventListener('pointerdown', (event) => {
    if (!enabled) return;
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return;
      if (locked()) { pending.interact = { x: 0, y: 0 }; touchInput(); return; }
      if (!dragFallback()) { requestLock(); return; }
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, t: now() });
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  });
  canvas.addEventListener('pointermove', (event) => {
    const p = pointers.get(event.pointerId);
    if (!p || !enabled) return;
    const look = pointerLook(event.clientX - p.x, event.clientY - p.y, settings(), TOUCH_RADIANS_PER_PIXEL);
    pending.yaw += look.yaw;
    pending.pitch += look.pitch;
    p.x = event.clientX;
    p.y = event.clientY;
    touchInput();
  });
  const endPointer = (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    pointers.delete(event.pointerId);
    const moved = Math.hypot(event.clientX - p.startX, event.clientY - p.startY);
    if (event.type === 'pointerup' && enabled && moved < TAP_MAX_PX && now() - p.t < TAP_MAX_MS * (event.pointerType === 'mouse' ? 3 : 1)) {
      pending.interact = toNdc(event.clientX, event.clientY);
      touchInput();
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // ---------- on-screen stick (touch) ----------
  const stickEl = document.getElementById('joystick');
  const stickBase = stickEl?.querySelector('.joystick__base');
  if (stickEl && stickBase) {
    let stickPointer = null;
    const move = (event) => {
      const rect = stickBase.getBoundingClientRect();
      const radius = rect.width / 2;
      let dx = event.clientX - (rect.left + radius);
      let dy = event.clientY - (rect.top + radius);
      const max = radius * 0.62;
      const length = Math.hypot(dx, dy);
      if (length > max) { dx = (dx / length) * max; dy = (dy / length) * max; }
      stickEl.style.setProperty('--jx', `${dx}px`);
      stickEl.style.setProperty('--jy', `${dy}px`);
      stick.x = dx / max;
      stick.y = dy / max;
      touchInput();
    };
    const end = () => {
      stickPointer = null;
      stick.active = false;
      stick.x = 0;
      stick.y = 0;
      stickEl.classList.remove('active');
      stickEl.style.setProperty('--jx', '0px');
      stickEl.style.setProperty('--jy', '0px');
    };
    stickEl.addEventListener('pointerdown', (event) => {
      stickPointer = event.pointerId;
      try { stickEl.setPointerCapture(event.pointerId); } catch { /* synthetic */ }
      stick.active = true;
      stickEl.classList.add('active');
      move(event);
      event.preventDefault();
    });
    stickEl.addEventListener('pointermove', (event) => { if (event.pointerId === stickPointer) move(event); });
    stickEl.addEventListener('pointerup', end);
    stickEl.addEventListener('pointercancel', end);
  }

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
        const s = stickToMove(stick.x, stick.y, 0.12);
        if (Math.hypot(s.x, s.z) > Math.hypot(intent.move.x, intent.move.z)) intent.move = s;
        if (Math.hypot(stick.x, stick.y) > 0.95) intent.sprint = true;
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
      }
      enabled = nextEnabled;
      menuOpen = nextMenu;
    },
    setAimTarget,
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
