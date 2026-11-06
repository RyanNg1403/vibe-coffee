// Input layer: modality detection, keyboard shortcuts, gamepad and the
// touch joystick. Movement is delivered as the same key events the app
// already understands, so walking behaviour stays owned by the app.
import { $, $$, root, focusables, setInputValue } from './dom.js';
import { isPanelOpen, closePanel, togglePanel } from './panels.js';

let app = null;
let modality = 'mouse';
const modalityListeners = new Set();

export const getModality = () => modality;
export const onModalityChange = (fn) => modalityListeners.add(fn);

function setModality(next) {
  if (next === modality) return;
  modality = next;
  root.classList.remove('input-mouse', 'input-touch', 'input-gamepad', 'input-keyboard');
  root.classList.add(`input-${next}`);
  $('#reticle').hidden = next !== 'gamepad';
  syncJoystick();
  modalityListeners.forEach((fn) => fn(next));
}

// ---------- synthetic movement keys ----------
const held = new Set();
function pressKey(code, down) {
  if (down === held.has(code)) return;
  if (down) held.add(code); else held.delete(code);
  const event = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true });
  event.vibeSynthetic = true;
  window.dispatchEvent(event);
}
function setMoveVector(x, y, threshold = 0.35) {
  pressKey('KeyW', y < -threshold);
  pressKey('KeyS', y > threshold);
  pressKey('KeyA', x < -threshold);
  pressKey('KeyD', x > threshold);
}

// ---------- keyboard ----------
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));
const inMenu = (el) => Boolean(el?.closest?.('#settings, .popover, #overlay'));

function onKeyDown(event, hooks) {
  if (event.vibeSynthetic || event.defaultPrevented || event.repeat) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = document.activeElement;
  if (event.key === 'Escape') {
    if (hooks.isSettingsOpen()) return; // the dialog closes itself
    if (isPanelOpen()) { closePanel({ restoreFocus: true }); event.preventDefault(); return; }
    hooks.openSettings();
    event.preventDefault();
    return;
  }
  if (isTyping(target) || hooks.isSettingsOpen()) return;

  if (!hooks.isEntered()) {
    if (event.key === 'Enter' && !target?.closest?.('button')) { $('#enter-btn').click(); event.preventDefault(); }
    else if (event.code === 'KeyF') $('#title-focus').click();
    else if (/^Digit[1-4]$/.test(event.code)) hooks.selectVenue(Number(event.code.slice(5)) - 1);
    return;
  }
  const click = (selector) => { $(selector)?.click(); event.preventDefault(); };
  switch (event.code) {
    case 'KeyH': hooks.toggleZen(); break;
    case 'KeyM': click('#mute-toggle'); break;
    case 'KeyT': click('#timer-btn'); break;
    case 'KeyO': click('#order-btn'); break;
    case 'KeyL': click('#laptop-btn'); break;
    case 'KeyE': click('#walk-btn'); break;
    case 'KeyV': togglePanel('ambience-pop'); break;
    case 'KeyF': click('#fullscreen-btn'); break;
    case 'Slash': if (event.shiftKey) hooks.openSettings('controls'); break;
    default:
      if (/^Digit[1-4]$/.test(event.code)) hooks.selectVenue(Number(event.code.slice(5)) - 1);
  }
}

// Arrow keys on sliders, tabs and menu items belong to those controls; stop
// them reaching the app's window-level walk listener (bubble phase).
function shieldMenuKeys(event) {
  if (event.vibeSynthetic || !MOVE_CODES.has(event.code)) return;
  if (inMenu(event.target) || isTyping(event.target) || root.classList.contains('settings-open')) event.stopPropagation();
}

// ---------- touch joystick ----------
let joystickPointer = null;
function syncJoystick() {
  const stick = $('#joystick');
  stick.hidden = !(modality === 'touch' && root.classList.contains('entered'));
}

function initJoystick() {
  const stick = $('#joystick');
  const base = $('.joystick__base', stick);
  const move = (event) => {
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = event.clientX - (rect.left + radius);
    let dy = event.clientY - (rect.top + radius);
    const length = Math.hypot(dx, dy);
    const max = radius * 0.62;
    if (length > max) { dx = (dx / length) * max; dy = (dy / length) * max; }
    stick.style.setProperty('--jx', `${dx}px`);
    stick.style.setProperty('--jy', `${dy}px`);
    setMoveVector(dx / max, dy / max, 0.32);
  };
  const end = () => {
    joystickPointer = null;
    stick.classList.remove('active');
    stick.style.setProperty('--jx', '0px');
    stick.style.setProperty('--jy', '0px');
    setMoveVector(0, 0);
  };
  stick.addEventListener('pointerdown', (event) => {
    joystickPointer = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    stick.classList.add('active');
    move(event);
    event.preventDefault();
  });
  stick.addEventListener('pointermove', (event) => { if (event.pointerId === joystickPointer) move(event); });
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  document.addEventListener('vibe:entered', syncJoystick);
}

// ---------- gamepad ----------
const pads = { polling: false, last: new Map(), repeatAt: 0 };
const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const dead = (v, d) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

function menuContext(hooks) {
  if (hooks.isSettingsOpen()) return $('#settings');
  if (isPanelOpen()) return $('.popover:not([hidden])');
  if (!hooks.isEntered()) return $('#overlay');
  return null;
}

function moveFocus(container, direction) {
  const items = focusables(container);
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  if (current >= 0 && document.activeElement.type === 'range' && (direction === 'left' || direction === 'right')) {
    const input = document.activeElement;
    const step = Number(input.step) || 0.05;
    const next = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) + (direction === 'right' ? step * (step < 1 ? 5 : 1) : -step * (step < 1 ? 5 : 1))));
    setInputValue(input, next);
    return;
  }
  const delta = direction === 'down' || direction === 'right' ? 1 : -1;
  const next = current < 0 ? (delta > 0 ? 0 : items.length - 1) : (current + delta + items.length) % items.length;
  items[next].focus();
}

function pollGamepads(hooks, now) {
  const list = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
  if (!list.length) { pads.polling = false; setMoveVector(0, 0); return; }
  requestAnimationFrame((t) => pollGamepads(hooks, t));
  const dt = Math.min(0.05, (now - (pads.lastTime ?? now)) / 1000);
  pads.lastTime = now;

  for (const pad of list) {
    const previous = pads.last.get(pad.index) ?? [];
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i) => pressed[i] && !previous[i];
    pads.last.set(pad.index, pressed);
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    const active = pressed.some(Boolean) || [lx, ly, rx, ry].some((v) => Math.abs(v) > 0.3);
    if (active) {
      setModality('gamepad');
      hooks.markActivity();
    }
    const menu = menuContext(hooks);
    if (menu) {
      setMoveVector(0, 0);
      const dir = edge(BUTTON.UP) || ly < -0.6 ? 'up' : edge(BUTTON.DOWN) || ly > 0.6 ? 'down'
        : edge(BUTTON.LEFT) || lx < -0.6 ? 'left' : edge(BUTTON.RIGHT) || lx > 0.6 ? 'right' : null;
      const isEdge = [BUTTON.UP, BUTTON.DOWN, BUTTON.LEFT, BUTTON.RIGHT].some(edge);
      if (dir && (isEdge || now > pads.repeatAt)) {
        moveFocus(menu, dir);
        pads.repeatAt = now + (isEdge ? 380 : 150);
      }
      if (edge(BUTTON.A)) {
        const el = document.activeElement;
        if (el && menu.contains(el) && el !== document.body) el.click();
        else focusables(menu)[0]?.focus();
      }
      if (edge(BUTTON.B)) {
        if (hooks.isSettingsOpen()) hooks.closeSettings();
        else if (isPanelOpen()) closePanel({ restoreFocus: true });
      }
      if (edge(BUTTON.START)) {
        if (hooks.isSettingsOpen()) hooks.closeSettings();
        else hooks.openSettings();
      }
      continue;
    }

    setMoveVector(lx, ly);
    const lookX = dead(rx, 0.14);
    const lookY = dead(ry, 0.14);
    if (lookX || lookY) {
      const speed = 2.6 * dt;
      app.lookBy(Math.sign(lookX) * lookX ** 2 * speed * 312, Math.sign(lookY) * lookY ** 2 * speed * 220);
      app.aimAt(window.innerWidth / 2, window.innerHeight / 2);
    }
    if (edge(BUTTON.A)) app.activateAt(window.innerWidth / 2, window.innerHeight / 2);
    if (edge(BUTTON.B) && $('#walk-btn').dataset.mode === 'seated') $('#walk-btn').click();
    if (edge(BUTTON.X)) $('#order-btn').click();
    if (edge(BUTTON.Y)) $('#laptop-btn').click();
    if (edge(BUTTON.LB)) hooks.stepVenue(-1);
    if (edge(BUTTON.RB)) hooks.stepVenue(1);
    if (edge(BUTTON.UP)) { togglePanel('ambience-pop'); focusables($('#ambience-pop'))[0]?.focus(); }
    if (edge(BUTTON.DOWN)) { togglePanel('focus-pop'); focusables($('#focus-pop'))[0]?.focus(); }
    if (edge(BUTTON.BACK)) hooks.toggleZen();
    if (edge(BUTTON.START)) hooks.openSettings();
  }
}

function initGamepad(hooks) {
  const start = () => {
    if (pads.polling) return;
    pads.polling = true;
    pads.lastTime = undefined;
    requestAnimationFrame((t) => pollGamepads(hooks, t));
  };
  window.addEventListener('gamepadconnected', (event) => {
    start();
    hooks.notify(`Controller connected · ${event.gamepad?.id?.split('(')[0].trim() || 'gamepad'}`);
  });
  window.addEventListener('gamepaddisconnected', () => hooks.notify('Controller disconnected'));
  if ([...(navigator.getGamepads?.() ?? [])].some(Boolean)) start();
}

export function initInput(bridge, hooks) {
  app = bridge;
  root.classList.add('input-mouse');
  window.addEventListener('pointerdown', (event) => {
    setModality(event.pointerType === 'touch' ? 'touch' : 'mouse');
  }, { capture: true, passive: true });
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse' && modality === 'gamepad' && (Math.abs(event.movementX) + Math.abs(event.movementY)) > 4) setModality('mouse');
  }, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (!event.vibeSynthetic && modality === 'gamepad') setModality('keyboard');
    onKeyDown(event, hooks);
  });
  document.addEventListener('keydown', shieldMenuKeys);
  window.addEventListener('blur', () => setMoveVector(0, 0));
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) setModality('touch');
  initJoystick();
  initGamepad(hooks);
}
