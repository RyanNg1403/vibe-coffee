// Title + loading screen: real progress while the café prepares, then the
// start menu over the live scene.
import { $, $$, root, escapeHtml, nextFrame } from './dom.js';
import { trackLoading } from './loading.js';
import { notify, selectVenue } from './hud.js';
import { openSettings } from './settingsMenu.js';

const TIPS = [
  'Press Esc at any time for settings: graphics quality, sound mixer, controls and accessibility.',
  'Click any free chair to sit there. Drag to look around, or press W A S D to stand up and walk.',
  'Start a focus timer and the café dims its lights while you work. Breaks bring them back.',
  'Ambience presets set the room, weather and mix in one tap. Try “Deep work”.',
  'Press H to hide the interface entirely, then press H again to bring it back.',
  'Set out your laptop and you will hear yourself typing quietly during focus blocks.',
  'A controller works too: left stick to walk, right stick to look, A to sit.',
];

let entered = false;
let ready = false;

export const isEntered = () => entered;
export const isLoaded = () => ready;

export function initTitle(app) {
  renderVenueCards(app.venues);
  runTips();

  const fill = $('#loader');
  const stage = $('#loader-stage');
  const pct = $('#loader-pct');
  trackLoading({
    isBuilt: () => app.isReady(),
    onProgress({ value, stage: s, detail }) {
      const percent = Math.round(value * 100);
      fill.style.setProperty('--progress', value.toFixed(4));
      fill.setAttribute('aria-valuenow', String(percent));
      fill.setAttribute('aria-valuetext', `${s.label}, ${percent}%`);
      stage.textContent = detail ? `${s.label} · ${detail}` : s.label;
      pct.textContent = `${percent}%`;
    },
  }).then(() => {
    ready = true;
    root.classList.add('ui-loaded');
    $('#veil').classList.remove('on', 'loading');
    if (!entered && (document.activeElement === document.body || !document.activeElement)) {
      startButton().focus({ preventScroll: true });
    }
    document.dispatchEvent(new CustomEvent('vibe:ui-loaded'));
  });

  // The app's own #enter-btn handler (registered first) hides the overlay and
  // unlocks audio inside this same user gesture.
  $('#enter-btn').addEventListener('click', () => enter());
  $('#continue-btn').addEventListener('click', () => enter());
  app.checkpoint?.then((summary) => { if (summary && !entered) offerContinue(summary); });
  $('#title-focus').addEventListener('click', () => {
    $('#enter-btn').click();
    const timerBtn = $('#timer-btn');
    if (!timerBtn.getAttribute('aria-label')?.startsWith('Pause')) timerBtn.click();
    const minutes = parseInt($('#timer-duration').textContent, 10) || 25;
    notify(`Focus session started · ${minutes} minutes`);
  });
  $('#title-settings').addEventListener('click', () => openSettings());
}

// The primary start action: Continue when a checkpoint is offered.
export function startButton() {
  const resume = $('#continue-btn');
  return resume && !resume.hidden ? resume : $('#enter-btn');
}

// The app has already built the saved café behind the title, with the
// visitor in their spot; "Step inside" becomes a secondary "New session".
function offerContinue({ place, detail }) {
  const resume = $('#continue-btn');
  const fresh = $('#enter-btn');
  $('#continue-place').textContent = place;
  $('#continue-detail').textContent = detail;
  resume.setAttribute('aria-label', `Continue where you left off: ${place}`);
  resume.hidden = false;
  fresh.classList.remove('btn--primary');
  fresh.setAttribute('aria-label', 'Start a new session');
  fresh.innerHTML = '<span>New session</span><kbd>N</kbd>';
  root.classList.add('has-checkpoint');
  if (ready && document.activeElement === fresh) resume.focus({ preventScroll: true });
}

function enter() {
  if (entered) return;
  entered = true;
  root.classList.add('entered');
  document.activeElement?.blur?.();
  if (!ready) $('#veil').classList.add('on', 'loading');
  document.dispatchEvent(new CustomEvent('vibe:entered'));
}

function renderVenueCards(venues) {
  const container = $('#venue-cards');
  container.innerHTML = venues.map((venue, i) => `
    <button class="venue-card" data-venue="${i}" aria-pressed="false" aria-describedby="venue-detail">
      <kbd aria-hidden="true">${i + 1}</kbd>
      <span class="venue-card__name">${escapeHtml(venue.name)}</span>
    </button>`).join('');
  const detail = document.createElement('p');
  detail.id = 'venue-detail';
  detail.className = 'venue-detail';
  container.after(detail);
  container.addEventListener('click', (event) => {
    const card = event.target.closest('.venue-card');
    if (card) selectVenue(Number(card.dataset.venue));
  });
  const sync = () => {
    const active = $$('.loc-btn').findIndex((b) => b.classList.contains('active'));
    $$('.venue-card', container).forEach((card, i) => card.setAttribute('aria-pressed', String(i === active)));
    detail.textContent = venues[active]?.blurb ?? '';
  };
  new MutationObserver(sync).observe($('#locations'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  sync();
}

function runTips() {
  const tip = $('#loader-tip');
  let index = Math.floor(Math.random() * TIPS.length);
  tip.textContent = TIPS[index];
  const timer = setInterval(async () => {
    if (ready) { clearInterval(timer); return; }
    tip.classList.add('swap');
    await new Promise((r) => setTimeout(r, 240));
    index = (index + 1) % TIPS.length;
    tip.textContent = TIPS[index];
    await nextFrame();
    tip.classList.remove('swap');
  }, 5200);
}
