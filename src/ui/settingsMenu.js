// Settings dialog: Graphics, Audio, Controls, Accessibility.
import { $, $$, root, trapFocus, syncRangeFill } from './dom.js';
import { iconSvg } from './icons.js';
import { closePanel } from './panels.js';
import { QUALITY_TIERS, getQualityTier, setQualityTier, onQualityTierChange } from '../qualityTier.js';
import {
  TEXT_SCALES, getUISettings, updateUISettings, resetUISettings, onUISettingsChange,
} from './settings.js';

const TABS = [
  { id: 'graphics', label: 'Graphics', icon: 'monitor' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'controls', label: 'Controls', icon: 'gamepad' },
  { id: 'access', label: 'Accessibility', icon: 'access' },
];

let dialog = null;
let releaseTrap = null;
let returnFocus = null;
let activeTab = 'graphics';

export const isSettingsOpen = () => Boolean(dialog && !dialog.hidden);

const sw = (id, labelId, on) => `<button id="${id}" class="switch" aria-labelledby="${labelId}" aria-pressed="${on}"></button>`;
const row = (id, label, control, hint = '') => `
  <div class="row"><span id="${id}-label" class="row__label">${label}</span>${control}</div>
  ${hint ? `<p class="field__hint">${hint}</p>` : ''}`;
const tierMeter = (tier) => {
  const level = tier.id === 'auto' ? 0 : QUALITY_TIERS.indexOf(tier);
  return `<span class="tier__meter" aria-hidden="true">${[1, 2, 3, 4].map((n) => `<i class="${n <= level ? 'on' : ''}"></i>`).join('')}</span>`;
};
const keymap = (rows) => `<dl class="keymap">${rows.map(([action, keys]) => `<dt>${action}</dt><dd>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</dd>`).join('')}</dl>`;

function template() {
  const s = getUISettings();
  return `
  <div class="settings__dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header class="settings__head">
      <h2 id="settings-title" class="settings__title">Settings</h2>
      <button class="icon-btn settings__close" id="settings-close" aria-label="Close settings">close</button>
    </header>
    <div class="settings__tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
      ${TABS.map((t) => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="false" tabindex="-1">${iconSvg(t.icon)}<span>${t.label}</span></button>`).join('')}
    </div>
    <div class="settings__body">
      <section class="settings__panel" role="tabpanel" id="panel-graphics" aria-labelledby="tab-graphics" hidden>
        <div class="settings__section">
          <span class="field__label" id="tier-label">Quality</span>
          <div class="tier-list" role="radiogroup" aria-labelledby="tier-label">
            ${QUALITY_TIERS.map((tier) => `
              <button class="tier" role="radio" data-tier="${tier.id}" aria-checked="false">
                <span class="tier__dot" aria-hidden="true"></span>
                <span class="tier__name">${tier.label}</span>
                ${tierMeter(tier)}
                <span class="tier__desc">${tier.description}</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="settings__section">
          ${row('set-fullscreen', 'Full screen', sw('set-fullscreen', 'set-fullscreen-label', false))}
        </div>
      </section>

      <section class="settings__panel" role="tabpanel" id="panel-audio" aria-labelledby="tab-audio" hidden>
        <div class="settings__section">
          ${row('set-mute', 'Mute all sound', sw('set-mute', 'set-mute-label', false))}
        </div>
        <div class="settings__section" id="settings-mixer-slot"></div>
      </section>

      <section class="settings__panel" role="tabpanel" id="panel-controls" aria-labelledby="tab-controls" hidden>
        <div class="settings__section">
          <div class="mixer__row">
            <label for="set-look" class="mixer__label">Look sensitivity</label>
            <input id="set-look" type="range" min="0.25" max="2.5" step="0.05" value="${s.lookSensitivity}" />
            <output for="set-look" class="mixer__value tabular" id="set-look-value">${s.lookSensitivity.toFixed(2)}×</output>
          </div>
          ${row('set-invert', 'Invert vertical look', sw('set-invert', 'set-invert-label', s.invertY))}
        </div>
        <div class="settings__section">
          <span class="field__label">Keyboard &amp; mouse</span>
          ${keymap([
            ['Look around', ['Drag']], ['Walk', ['W', 'A', 'S', 'D']], ['Sit', ['Click chair']],
            ['Stand up / sit', ['E']], ['Order a drink', ['O']], ['Laptop', ['L']], ['Ambience', ['V']],
            ['Start / pause focus', ['T']], ['Mute', ['M']], ['Switch café', ['1', '–', '4']],
            ['Full screen', ['F']], ['Hide interface', ['H']], ['Menu', ['Esc']],
          ])}
        </div>
        <div class="settings__section">
          <span class="field__label">Controller</span>
          ${keymap([
            ['Walk / look', ['L', 'R']], ['Sit or use what is under the dot', ['A']], ['Stand up', ['B']],
            ['Order', ['X']], ['Laptop', ['Y']], ['Previous / next café', ['LB', 'RB']],
            ['Ambience / focus panels', ['D-pad ↑', '↓']], ['Hide interface', ['View']], ['Menu', ['Menu']],
          ])}
          <p class="field__hint">In menus, use the D-pad to move, A to select and B to go back.</p>
        </div>
        <div class="settings__section">
          <span class="field__label">Touch</span>
          ${keymap([['Look around', ['Drag']], ['Walk', ['Left stick']], ['Sit', ['Tap chair']]])}
        </div>
      </section>

      <section class="settings__panel" role="tabpanel" id="panel-access" aria-labelledby="tab-access" hidden>
        <div class="settings__section">
          <div class="field" role="group" aria-labelledby="motion-label">
            <span id="motion-label" class="field__label">Reduce motion</span>
            <div class="segmented" id="set-motion">
              ${[['system', 'Match system'], ['reduce', 'Reduce'], ['full', 'Full motion']].map(([v, l]) => `<button class="chip" data-value="${v}" aria-pressed="${s.reducedMotion === v}">${l}</button>`).join('')}
            </div>
            <p class="field__hint">Shortens camera glides between seats and removes interface animation.</p>
          </div>
          <div class="field" role="group" aria-labelledby="text-label">
            <span id="text-label" class="field__label">Text size</span>
            <div class="segmented" id="set-text">
              ${TEXT_SCALES.map((v) => `<button class="chip" data-value="${v}" aria-pressed="${s.textScale === v}">${Math.round(v * 100)}%</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="settings__section">
          ${row('set-contrast', 'High-contrast interface', sw('set-contrast', 'set-contrast-label', s.highContrast), 'Solid panels, brighter text and stronger outlines.')}
          ${row('set-autohide', 'Fade the interface when idle', sw('set-autohide', 'set-autohide-label', s.hudAutoHide), 'Controls return as soon as you move the mouse, touch or press a key.')}
          ${row('set-hints', 'Show control hints', sw('set-hints', 'set-hints-label', s.showHints))}
        </div>
        <div class="settings__section settings__foot">
          <button class="btn btn--ghost" id="set-reset">Reset interface settings</button>
        </div>
      </section>
    </div>
  </div>`;
}

function selectTab(id, { focus = false } = {}) {
  activeTab = id;
  for (const tab of TABS) {
    const button = $(`#tab-${tab.id}`);
    const selected = tab.id === id;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab.id}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  if (id === 'audio') {
    $('#settings-mixer-slot').append($('#mixer-pop'));
    $('#mixer-pop').querySelectorAll('input[type=range]').forEach(syncRangeFill);
  } else {
    $('#mixer-home').append($('#mixer-pop'));
  }
}

function syncTier() {
  const current = getQualityTier();
  $$('.tier', dialog).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tier === current)));
}

function syncMirrors() {
  if (!dialog) return;
  $('#set-fullscreen').setAttribute('aria-pressed', $('#fullscreen-btn').getAttribute('aria-pressed') ?? 'false');
  $('#set-mute').setAttribute('aria-pressed', $('#mute-toggle').getAttribute('aria-pressed') ?? 'false');
}

function wire() {
  $('#settings-close').addEventListener('click', () => closeSettings());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeSettings(); });

  const tablist = $('.settings__tabs', dialog);
  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role=tab]');
    if (tab) selectTab(tab.id.replace('tab-', ''));
  });
  tablist.addEventListener('keydown', (event) => {
    const index = TABS.findIndex((t) => t.id === activeTab);
    const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (delta) {
      event.preventDefault();
      selectTab(TABS[(index + delta + TABS.length) % TABS.length].id, { focus: true });
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      selectTab(TABS[event.key === 'Home' ? 0 : TABS.length - 1].id, { focus: true });
    }
  });

  const tiers = $('.tier-list', dialog);
  tiers.addEventListener('click', (event) => {
    const tier = event.target.closest('[data-tier]');
    if (tier) setQualityTier(tier.dataset.tier);
  });
  tiers.addEventListener('keydown', (event) => {
    const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const ids = QUALITY_TIERS.map((t) => t.id);
    const next = ids[(ids.indexOf(getQualityTier()) + delta + ids.length) % ids.length];
    setQualityTier(next);
    $(`.tier[data-tier="${next}"]`, dialog).focus();
  });

  $('#set-fullscreen').addEventListener('click', () => $('#fullscreen-btn').click());
  $('#set-mute').addEventListener('click', () => { $('#mute-toggle').click(); syncMirrors(); });
  const look = $('#set-look');
  syncRangeFill(look);
  look.addEventListener('input', () => {
    updateUISettings({ lookSensitivity: Number(look.value) });
    $('#set-look-value').textContent = `${Number(look.value).toFixed(2)}×`;
    syncRangeFill(look);
  });
  const toggles = {
    'set-invert': 'invertY', 'set-contrast': 'highContrast', 'set-autohide': 'hudAutoHide', 'set-hints': 'showHints',
  };
  for (const [id, key] of Object.entries(toggles)) {
    $(`#${id}`).addEventListener('click', () => updateUISettings({ [key]: !getUISettings()[key] }));
  }
  $('#set-motion').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-value]');
    if (chip) updateUISettings({ reducedMotion: chip.dataset.value });
  });
  $('#set-text').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-value]');
    if (chip) updateUISettings({ textScale: Number(chip.dataset.value) });
  });
  $('#set-reset').addEventListener('click', () => resetUISettings());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    }
  });
}

function syncSettings(s) {
  if (!dialog) return;
  const toggles = { 'set-invert': s.invertY, 'set-contrast': s.highContrast, 'set-autohide': s.hudAutoHide, 'set-hints': s.showHints };
  for (const [id, on] of Object.entries(toggles)) $(`#${id}`).setAttribute('aria-pressed', String(on));
  $$('#set-motion [data-value]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === s.reducedMotion)));
  $$('#set-text [data-value]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === s.textScale)));
  const look = $('#set-look');
  if (Number(look.value) !== s.lookSensitivity) {
    look.value = String(s.lookSensitivity);
    $('#set-look-value').textContent = `${s.lookSensitivity.toFixed(2)}×`;
    syncRangeFill(look);
  }
}

export function openSettings(tab = activeTab) {
  if (!dialog) return;
  closePanel();
  if (!dialog.hidden) { selectTab(tab, { focus: true }); return; }
  returnFocus = document.activeElement;
  dialog.hidden = false;
  root.classList.add('settings-open');
  syncTier();
  syncMirrors();
  selectTab(tab);
  releaseTrap = trapFocus(dialog);
  $(`#tab-${tab}`).focus();
}

export function closeSettings() {
  if (!isSettingsOpen()) return;
  dialog.hidden = true;
  root.classList.remove('settings-open');
  $('#mixer-home').append($('#mixer-pop'));
  releaseTrap?.();
  releaseTrap = null;
  if (returnFocus && document.contains(returnFocus) && returnFocus !== document.body) returnFocus.focus();
  returnFocus = null;
}

export function toggleSettings() {
  if (isSettingsOpen()) closeSettings();
  else openSettings();
}

export function initSettingsMenu() {
  dialog = $('#settings');
  dialog.innerHTML = template();
  wire();
  $('#settings-btn').addEventListener('click', () => toggleSettings());
  onQualityTierChange(() => syncTier());
  onUISettingsChange((s) => syncSettings(s));
  for (const id of ['#fullscreen-btn', '#mute-toggle']) {
    new MutationObserver(syncMirrors).observe($(id), { attributes: true, attributeFilter: ['aria-pressed'] });
  }
}
