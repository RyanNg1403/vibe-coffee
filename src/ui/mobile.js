// Mobile and low-end device behaviour: lite rendering of the interface,
// the touch action button, the landscape suggestion and orientation changes.
import { $, root } from './dom.js';
import { iconSvg } from './icons.js';
import { getQualityTier, onQualityTierChange } from '../qualityTier.js';
import { closePanel } from './panels.js';
import { getModality, onModalityChange } from './input.js';

// Frosted glass (backdrop-filter) re-blurs the live 3D scene behind every
// panel each frame. Low-memory/low-core devices, "reduce transparency" and
// the Performance tier get solid surfaces instead.
export function prefersLiteUI({ deviceMemory, cores, reducedTransparency, tier } = {}) {
  return (deviceMemory !== undefined && deviceMemory <= 4)
    || (cores !== undefined && cores <= 4)
    || Boolean(reducedTransparency)
    || tier === 'smooth';
}

function applyLite() {
  root.classList.toggle('lite', prefersLiteUI({
    deviceMemory: navigator.deviceMemory,
    cores: navigator.hardwareConcurrency,
    reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    tier: getQualityTier(),
  }));
}

// ---------- touch action button: "Sit" / "Use" for the crosshair target ----------
function initActionButton(controls) {
  const button = document.createElement('button');
  button.id = 'touch-action';
  button.className = 'touch-action ui-layer';
  button.hidden = true;
  button.innerHTML = `<span class="touch-action__icon" aria-hidden="true"></span><span class="touch-action__label"></span>`;
  document.body.append(button);
  const label = button.querySelector('.touch-action__label');
  const icon = button.querySelector('.touch-action__icon');
  const ICONS = { sit: iconSvg('chair'), use: iconSvg('sparkle') };
  let kind = null;
  const sync = () => {
    const target = $('#reticle').dataset.target ?? null;
    const usable = target === 'sit' || target === 'use';
    const show = usable && getModality() === 'touch' && root.classList.contains('entered');
    if (target !== kind && usable) {
      icon.innerHTML = ICONS[target];
      label.textContent = target === 'sit' ? 'Sit' : 'Use';
      button.setAttribute('aria-label', target === 'sit' ? 'Sit in the chair at the centre of the screen' : 'Use what is at the centre of the screen');
    }
    kind = target;
    if (button.hidden === show) button.hidden = !show;
  };
  new MutationObserver(sync).observe($('#reticle'), { attributes: true, attributeFilter: ['data-target'] });
  onModalityChange(sync);
  document.addEventListener('vibe:entered', sync);
  button.addEventListener('click', () => controls.requestInteract());
}

// ---------- landscape suggestion ----------
const portraitPhone = () => matchMedia('(orientation: portrait) and (max-width: 640px)').matches;

function initRotateHint() {
  const card = document.createElement('div');
  card.id = 'rotate-hint';
  card.className = 'rotate-hint ui-layer';
  card.setAttribute('role', 'status');
  card.hidden = true;
  card.innerHTML = `
    <span class="rotate-hint__phone" aria-hidden="true"></span>
    <span class="rotate-hint__text"><strong>Turn your phone sideways</strong><span>The café is best in landscape.</span></span>
    <button class="btn btn--primary rotate-hint__go" id="rotate-go">Full screen</button>
    <button class="icon-btn rotate-hint__close" id="rotate-close" aria-label="Dismiss">dismiss</button>`;
  document.body.append(card);
  let dismissed = false;
  const sync = () => {
    const show = !dismissed && root.classList.contains('entered') && getModality() === 'touch' && portraitPhone();
    if (card.hidden === show) card.hidden = !show;
  };
  $('#rotate-close').addEventListener('click', () => { dismissed = true; sync(); });
  // Fullscreen first: browsers only allow an orientation lock in fullscreen.
  $('#rotate-go').addEventListener('click', async () => {
    dismissed = true;
    sync();
    try {
      const el = document.documentElement;
      await (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
      await screen.orientation?.lock?.('landscape');
    } catch {
      // iOS Safari has neither API for web pages; the hint was the help.
    }
  });
  document.addEventListener('vibe:entered', () => setTimeout(sync, 1600));
  onModalityChange(sync);
  matchMedia('(orientation: portrait)').addEventListener?.('change', sync);
}

// ---------- orientation changes ----------
function initOrientation() {
  const settle = () => {
    // A popover laid out for the old orientation is closed rather than left
    // half off-screen; the canvas re-measures after the browser settles
    // (iOS reports the new size a few frames late).
    closePanel();
    for (const delay of [120, 420]) setTimeout(() => window.dispatchEvent(new Event('resize')), delay);
  };
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', settle);
  else window.addEventListener('orientationchange', settle);
}

export function initMobile(bridge) {
  applyLite();
  onQualityTierChange(applyLite);
  matchMedia('(prefers-reduced-transparency: reduce)').addEventListener?.('change', applyLite);
  if (bridge.controls) initActionButton(bridge.controls);
  initRotateHint();
  initOrientation();
}
