// Focus session panel and timer presentation. The app owns the countdown;
// this module reads its visible state (display text, break class, play
// label) to draw progress, track completed blocks and adapt the HUD.
import { $, $$, root } from './dom.js';
import { iconSvg } from './icons.js';
import { registerPanel, closePanel } from './panels.js';
import { BREAK_MINUTES, getUISettings, updateUISettings, onUISettingsChange } from './settings.js';
import { focusSummary, loadFocusStats, recordFocusBlock, saveFocusStats } from './focusStats.js';

let stats = loadFocusStats();
const baseTitle = document.title;

const state = { running: false, onBreak: false, remaining: 0 };

const focusMinutes = () => parseInt($('#timer-duration').textContent, 10) || 25;

function parseClock(text) {
  const [m, s] = text.split(':').map(Number);
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : 0;
}

function render() {
  const display = $('#timer-display');
  const running = $('#timer-btn').getAttribute('aria-label')?.startsWith('Pause') ?? false;
  const onBreak = display.classList.contains('break');
  if (onBreak && !state.onBreak && running) {
    stats = recordFocusBlock(stats, focusMinutes());
    saveFocusStats(stats);
    renderStats();
  }
  state.running = running;
  state.onBreak = onBreak;
  state.remaining = parseClock(display.textContent);

  const total = (onBreak ? getUISettings().breakMinutes : focusMinutes()) * 60;
  const progress = running || state.remaining < total ? Math.min(1, Math.max(0, 1 - state.remaining / total)) : 0;
  $('#timer-ring').style.strokeDashoffset = String(100 - progress * 100);

  const pill = $('#timer');
  pill.classList.toggle('is-running', running);
  pill.classList.toggle('is-break', onBreak);
  root.classList.toggle('focus-active', running && !onBreak);
  root.classList.toggle('focus-locked', running);
  $$('#timer-pop button').forEach((b) => { b.disabled = running; });

  const start = $('#focus-start');
  if (start) {
    start.querySelector('span').textContent = running ? 'Pause session' : state.remaining < total ? 'Resume session' : 'Start focusing';
  }
  document.title = running ? `${display.textContent} · ${onBreak ? 'Break' : 'Focus'} — vibe coffee` : baseTitle;
}

function renderStats() {
  const container = $('#focus-stats');
  if (!container) return;
  const summary = focusSummary(stats);
  const max = Math.max(1, ...summary.week.map((d) => d.sessions));
  container.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat__value tabular">${summary.sessionsToday}</div><div class="stat__label">Sessions today</div></div>
      <div class="stat"><div class="stat__value tabular">${summary.minutesToday}</div><div class="stat__label">Minutes</div></div>
      <div class="stat"><div class="stat__value tabular">${iconSvg('flame')}${summary.streak}</div><div class="stat__label">Day streak</div></div>
    </div>
    <div class="week" role="img" aria-label="Sessions over the last seven days: ${summary.week.map((d) => d.sessions).join(', ')}">
      ${summary.week.map((d, i) => `<span class="week__bar${d.sessions ? ' has' : ''}${i === 6 ? ' today' : ''}" style="height:${Math.max(8, (d.sessions / max) * 100)}%"></span>`).join('')}
    </div>`;
}

function renderExtras() {
  const settings = getUISettings();
  $('#focus-extra').innerHTML = `
    <div class="focus-section">
      <div class="field" role="group" aria-labelledby="break-label">
        <span id="break-label" class="field__label">Break length</span>
        <div class="segmented segmented--even" id="break-options">
          ${BREAK_MINUTES.map((m) => `<button class="chip" data-break="${m}" aria-pressed="${m === settings.breakMinutes}">${m} min</button>`).join('')}
        </div>
      </div>
      <div class="row">
        <span id="focus-hide-label" class="row__label">Fade the interface while focusing</span>
        <button id="focus-hide" class="switch" aria-labelledby="focus-hide-label" aria-pressed="${settings.focusHideHud}"></button>
      </div>
    </div>
    <div class="focus-section">
      <span class="field__label">Your focus</span>
      <div id="focus-stats"></div>
    </div>
    <div class="focus-section">
      <button id="focus-start" class="btn btn--primary btn--block"><span>Start focusing</span></button>
    </div>`;
  $('#break-options').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-break]');
    if (chip) updateUISettings({ breakMinutes: Number(chip.dataset.break) });
  });
  $('#focus-hide').addEventListener('click', () => updateUISettings({ focusHideHud: !getUISettings().focusHideHud }));
  $('#focus-start').addEventListener('click', () => {
    const starting = !state.running;
    $('#timer-btn').click();
    if (starting) closePanel({ restoreFocus: true });
  });
  renderStats();
}

export function initFocus() {
  registerPanel('focus-pop', { trigger: $('#timer-display'), onOpen: () => { renderStats(); render(); } });
  renderExtras();
  onUISettingsChange((settings, changed) => {
    if (changed.includes('breakMinutes')) {
      $$('#break-options [data-break]').forEach((chip) => chip.setAttribute('aria-pressed', String(Number(chip.dataset.break) === settings.breakMinutes)));
    }
    if (changed.includes('focusHideHud')) $('#focus-hide')?.setAttribute('aria-pressed', String(settings.focusHideHud));
  });
  const observer = new MutationObserver(render);
  observer.observe($('#timer-display'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  observer.observe($('#timer-btn'), { attributes: true, attributeFilter: ['aria-label'] });
  observer.observe($('#timer-duration'), { childList: true, subtree: true });
  render();
}
