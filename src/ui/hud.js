// In-café HUD: venue switcher, ambience panel, hints, idle/zen visibility,
// and smooth fades around room rebuilds.
import { $, $$, root, nextFrame, wait, setInputValue, syncRangeFill, html } from './dom.js';
import { iconSvg } from './icons.js';
import { registerPanel, isPanelOpen, onPanelChange, closePanel } from './panels.js';
import { AMBIENCE_PRESETS, MIX_INPUTS, presetMatches } from './ambiencePresets.js';
import { getUISettings, onUISettingsChange, motionReduced } from './settings.js';
import { getModality, onModalityChange } from './input.js';
import { isEntered } from './title.js';
import { isSettingsOpen } from './settingsMenu.js';

let app = null;

// ---------- notifications (shares the app's toast element) ----------
let toastTimer = null;
export function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ---------- room rebuild transitions ----------
// Changing café, time or weather rebuilds the room synchronously, which
// would read as a hard cut plus a hitch. Fade the canvas out first, apply
// the change, and fade back once the new room has rendered.
let bypass = false;
let transitioning = null;

function sceneFade(on) {
  root.classList.toggle('scene-fade', on);
}

export async function rebuildWith(apply) {
  if (transitioning) await transitioning;
  const before = app.currentCafe();
  transitioning = (async () => {
    sceneFade(true);
    await wait(motionReduced() ? 60 : 280);
    bypass = true;
    try { apply(); } finally { bypass = false; }
    const started = performance.now();
    while (app.currentCafe() === before && performance.now() - started < 4000) await nextFrame();
    await nextFrame();
    await nextFrame();
    sceneFade(false);
  })();
  await transitioning;
  transitioning = null;
}

function interceptRebuildClicks() {
  document.addEventListener('click', (event) => {
    if (bypass) return;
    const target = event.target.closest?.('.loc-btn, #sky-pop [data-time], #sky-pop [data-sky]');
    if (!target || target.classList.contains('active')) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    rebuildWith(() => target.click());
  }, true);
}

export function selectVenue(index) {
  const button = $$('.loc-btn')[index];
  if (!button || button.classList.contains('active')) return;
  rebuildWith(() => button.click());
}

export function stepVenue(delta) {
  const buttons = $$('.loc-btn');
  const active = buttons.findIndex((b) => b.classList.contains('active'));
  selectVenue((active + delta + buttons.length) % buttons.length);
  notify(buttons[(active + delta + buttons.length) % buttons.length].textContent.trim());
}

// ---------- venue switcher ----------
const TIME_LABELS = { auto: '', morning: 'Morning', noon: 'Noon', sunset: 'Sunset', night: 'Night' };
const SKY_LABELS = { auto: '', clear: 'Clear', rain: 'Rain' };

function liveSky() {
  return {
    time: $('#sky-pop [data-time].active')?.dataset.time ?? 'auto',
    sky: $('#sky-pop [data-sky].active')?.dataset.sky ?? 'auto',
  };
}

function initVenue() {
  registerPanel('venue-pop', { trigger: $('#venue-btn') });
  $$('.loc-btn').forEach((button, i) => {
    const key = document.createElement('kbd');
    key.className = 'kbd-only';
    key.setAttribute('aria-hidden', 'true');
    key.textContent = String(i + 1);
    button.append(key);
  });
  const syncName = () => {
    const active = $('.loc-btn.active');
    if (active) $('#venue-name').textContent = active.firstChild.textContent.trim();
    const { time, sky } = liveSky();
    $('#venue-cond').textContent = [TIME_LABELS[time], SKY_LABELS[sky]].filter(Boolean).join(' · ') || 'Café pick';
    syncPresets();
  };
  const observer = new MutationObserver(syncName);
  observer.observe($('#locations'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  observer.observe($('#sky-pop'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  syncName();
}

// ---------- ambience panel ----------
const PERCENT_INPUTS = ['music-vol', 'amb-vol', 'voices-vol', 'pets-vol'];
const RAIN_NAMES = ['off', 'light', 'steady', 'heavy'];

function syncMixerReadouts() {
  for (const id of PERCENT_INPUTS) {
    const input = document.getElementById(id);
    const out = input.parentElement.querySelector('output');
    const max = Number(input.max);
    out.textContent = `${Math.round((Number(input.value) / (max > 1 ? 1 : max)) * 100)}%`;
    syncRangeFill(input);
  }
  const rain = $('#rain-vol');
  rain.setAttribute('aria-valuetext', RAIN_NAMES[Number(rain.value)] ?? 'steady');
  syncRangeFill(rain);
}

function liveAmbience() {
  const mix = {};
  for (const [key, id] of Object.entries(MIX_INPUTS)) mix[key] = Number(document.getElementById(id).value);
  return { venue: $$('.loc-btn').findIndex((b) => b.classList.contains('active')), ...liveSky(), mix };
}

function syncPresets() {
  const live = liveAmbience();
  $$('#preset-list .preset').forEach((button) => {
    const preset = AMBIENCE_PRESETS.find((p) => p.id === button.dataset.preset);
    button.setAttribute('aria-pressed', String(presetMatches(preset, live)));
  });
}

export function applyPreset(preset) {
  for (const [key, value] of Object.entries(preset.mix)) setInputValue(document.getElementById(MIX_INPUTS[key]), value);
  if (!$('#music-toggle').classList.contains('on') && preset.mix.music > 0) $('#music-toggle').click();
  const venueButton = preset.venue != null ? $$('.loc-btn')[preset.venue] : null;
  const timeChip = $(`#sky-pop [data-time="${preset.time}"]`);
  const skyChip = $(`#sky-pop [data-sky="${preset.sky}"]`);
  const pending = [venueButton, timeChip, skyChip].filter((b) => b && !b.classList.contains('active'));
  // Venue, then time, then weather in one task: the app supersedes the
  // earlier rebuild requests, so the room is rebuilt once.
  if (pending.length) rebuildWith(() => pending.forEach((b) => b.click()));
  syncMixerReadouts();
  syncPresets();
  notify(`${preset.name} ambience`);
}

function initAmbience() {
  $('#preset-list').innerHTML = AMBIENCE_PRESETS.map((preset) => html`
    <button class="preset" data-preset="${preset.id}" aria-pressed="false">
      ${iconSvg(preset.icon)}
      <span class="preset__name">${preset.name}</span>
      <span class="preset__desc">${preset.description}</span>
    </button>`).join('');
  $('#preset-list').addEventListener('click', (event) => {
    const button = event.target.closest('.preset');
    if (button) applyPreset(AMBIENCE_PRESETS.find((p) => p.id === button.dataset.preset));
  });
  registerPanel('ambience-pop', {
    trigger: $('#ambience-btn'),
    onOpen: () => { $('#mixer-home').append($('#mixer-pop')); syncMixerReadouts(); syncPresets(); },
  });
  $('#mixer-pop').addEventListener('input', () => { syncMixerReadouts(); syncPresets(); });
  syncMixerReadouts();
}

// ---------- contextual hints ----------
const HINTS = {
  mouse: [
    ['Mouse', 'look'], ['W A S D', 'move'], ['Shift', 'sprint'], ['Click / E', 'sit · use'], ['Esc', 'pause'],
  ],
  touch: [['Drag', 'look around'], ['Stick', 'walk'], ['Tap', 'sit · use']],
  gamepad: [['L', 'walk'], ['R', 'look'], ['LT', 'sprint'], ['A', 'sit / use'], ['X', 'order'], ['☰', 'menu']],
};
let hintTimer = null;
const hintsShown = new Set();

function showHint(force = false) {
  const hint = $('#hint');
  const modality = getModality() === 'keyboard' ? 'mouse' : getModality();
  if (!getUISettings().showHints || !isEntered() || (!force && hintsShown.has(modality))) return;
  hintsShown.add(modality);
  hint.innerHTML = HINTS[modality].map(([key, action]) => `<span><b class="hint__key">${key}</b>${action}</span>`).join('');
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('show'), 9000);
}

// ---------- idle, focus and zen visibility ----------
let lastActivity = performance.now();
let zen = false;

export function markActivity() {
  lastActivity = performance.now();
  if (root.classList.contains('hud-idle')) root.classList.remove('hud-idle');
}

export function toggleZen(force) {
  zen = typeof force === 'boolean' ? force : !zen;
  root.classList.toggle('hud-zen', zen);
  if (zen) {
    closePanel();
    notify('Interface hidden · press H to show it');
  }
  return zen;
}
export const isZen = () => zen;

function idleLoop() {
  const settings = getUISettings();
  const focusing = root.classList.contains('focus-active') && settings.focusHideHud;
  const active = document.activeElement;
  const hudFocused = active?.matches?.(':focus-visible')
    && ($('#hud-top').contains(active) || $('#hud-bottom').contains(active));
  const canIdle = isEntered() && !isPanelOpen() && !isSettingsOpen() && !hudFocused && (settings.hudAutoHide || focusing);
  const threshold = focusing ? 3000 : 7000;
  const idle = canIdle && performance.now() - lastActivity > threshold;
  root.classList.toggle('hud-idle', idle);
}

export function initHud(bridge) {
  app = bridge;
  interceptRebuildClicks();
  initVenue();
  initAmbience();
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, markActivity, { passive: true, capture: true });
  }
  setInterval(idleLoop, 500);
  onPanelChange((open) => {
    markActivity();
    root.classList.toggle('panel-open', Boolean(open));
  });
  document.addEventListener('vibe:entered', () => setTimeout(() => showHint(), 900));
  onModalityChange(() => showHint());
  onUISettingsChange((settings, changed) => {
    if (changed.includes('showHints') && !settings.showHints) $('#hint').classList.remove('show');
  });
}
