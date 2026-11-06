// Interface entry point. Imported by main.js before the app builds the café
// so the stylesheet, loading tracker and settings apply from first paint;
// `connectUI(bridge)` wires the HUD once the app's controls are live.
//
// bridge = {
//   venues: [{ name, blurb }],
//   isReady(): boolean,          // a café has been built
//   currentCafe(): object,       // identity changes on every rebuild
//   controls,                    // src/controls instance (pointer lock, intent)
// }
import css from './ui.css?inline';
import './loading.js';
import { iconCss } from './icons.js';
import { root } from './dom.js';
import { getUISettings, onUISettingsChange, motionReduced } from './settings.js';
import { initTitle, isEntered } from './title.js';
import { initHud, notify, selectVenue, stepVenue, toggleZen, markActivity } from './hud.js';
import { initFocus } from './focus.js';
import { onPanelChange } from './panels.js';
import { initSettingsMenu, openSettings, closeSettings, isSettingsOpen } from './settingsMenu.js';
import { initInput, getModality } from './input.js';

const style = document.createElement('style');
style.id = 'vibe-ui-styles';
style.textContent = iconCss() + css;
document.head.append(style);

function applyDocumentSettings(settings = getUISettings()) {
  root.style.setProperty('--text-scale', String(settings.textScale));
  root.classList.toggle('high-contrast', settings.highContrast);
  root.classList.toggle('reduce-motion', motionReduced(settings));
}
applyDocumentSettings();
onUISettingsChange((settings) => applyDocumentSettings(settings));
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => applyDocumentSettings());
}
// Audit tooling captures page screenshots right after entering; keep the
// canvas at its true framing for automated sessions.
if (navigator.webdriver) root.classList.add('automation');
root.classList.add('ui-ready');

let connected = false;
export function connectUI(bridge) {
  if (connected) return;
  connected = true;
  initSettingsMenu();
  initHud(bridge);
  initFocus();
  initTitle(bridge);
  initInput({
    isEntered, isSettingsOpen, openSettings, closeSettings, selectVenue, stepVenue, toggleZen, notify, markActivity,
  });
  connectControls(bridge.controls);
}

// Gameplay input runs only in the café with no pause menu open. Mouse
// players capture the pointer on entering and on Resume (both are clicks,
// which browsers require); releasing it any other way pauses.
function connectControls(controls) {
  const usesPointerLock = () => ['mouse', 'keyboard'].includes(getModality());
  controls.setContext({ enabled: false });
  document.addEventListener('vibe:entered', () => {
    controls.setContext({ enabled: !isSettingsOpen() });
    if (usesPointerLock()) controls.requestLock();
  });
  document.addEventListener('vibe:settings', (event) => {
    if (event.detail.open) controls.releaseLock();
    controls.setContext({ enabled: !event.detail.open && isEntered() });
  });
  document.addEventListener('vibe:resume', () => {
    if (usesPointerLock()) controls.requestLock();
  });
  onPanelChange((open) => {
    if (open) controls.releaseLock();
    controls.setContext({ menuOpen: Boolean(open) });
  });
  controls.onPause(() => {
    if (isEntered() && !isSettingsOpen()) openSettings();
  });
}
