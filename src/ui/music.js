// Music source picker (café radio stations or YouTube) and the YouTube mini
// player. YouTube follows the café's music volume, music switch and master
// mute; while it plays, the café radio is held silent underneath.
import { $, $$, root, escapeHtml } from './dom.js';
import { iconSvg } from './icons.js';
import { MUSIC_STATIONS } from '../musicStations.js';
import {
  YOUTUBE_ORIGIN, YOUTUBE_STATIONS, parseYouTubeUrl, youtubeEmbedUrl, youtubeCommand,
} from './youtube.js';
import { getUISettings, updateUISettings } from './settings.js';
import { notify } from './hud.js';

let audio = null;
let iframe = null;
let playerTitle = '';
let lastRadioText = '';
const player = { el: null, collapsed: false };

const sameRef = (a, b) => Boolean(a && b) && a.kind === b.kind && a.id === b.id && a.list === b.list;

function render() {
  const s = getUISettings();
  $('#music-source').innerHTML = `
    <div class="field" role="group" aria-labelledby="music-source-label">
      <span id="music-source-label" class="field__label">Music</span>
      <div class="segmented segmented--even" role="radiogroup" aria-labelledby="music-source-label">
        <button class="chip" role="radio" data-source="radio" aria-checked="${s.musicSource === 'radio'}">Café radio</button>
        <button class="chip" role="radio" data-source="youtube" aria-checked="${s.musicSource === 'youtube'}">YouTube</button>
      </div>
    </div>
    <div class="music__radio" ${s.musicSource === 'radio' ? '' : 'hidden'}>
      <div class="segmented" role="radiogroup" aria-label="Café radio station">
        ${MUSIC_STATIONS.map((st) => `<button class="chip" role="radio" data-station="${st.id}" aria-checked="${st.id === s.musicStation}" title="${escapeHtml(st.description)}">${escapeHtml(st.label)}</button>`).join('')}
      </div>
    </div>
    <div class="music__youtube" ${s.musicSource === 'youtube' ? '' : 'hidden'}>
      <div class="yt-list" role="list">
        ${YOUTUBE_STATIONS.map((st) => `
          <button class="yt-station" role="listitem" data-yt="${st.id}" aria-pressed="${sameRef(st.ref, s.youtube)}">
            ${iconSvg(st.icon)}
            <span class="yt-station__text"><span class="yt-station__title">${escapeHtml(st.title)}</span>
            <span class="yt-station__meta">${escapeHtml(st.genre)} · ${escapeHtml(st.channel)}</span></span>
          </button>`).join('')}
      </div>
      <form class="yt-form" id="yt-form" novalidate>
        <input id="yt-url" type="url" inputmode="url" autocomplete="off" spellcheck="false"
               placeholder="Paste a YouTube video or playlist link" aria-label="YouTube video or playlist link" />
        <button class="btn btn--primary" type="submit">Play</button>
      </form>
      <p class="field__hint" id="yt-hint">Plays through YouTube's privacy-enhanced player and follows the music volume.</p>
    </div>`;
}

function sync() {
  const s = getUISettings();
  $$('#music-source [data-source]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.source === s.musicSource)));
  $$('#music-source [data-station]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.station === s.musicStation)));
  $$('#music-source [data-yt]').forEach((b) => {
    const st = YOUTUBE_STATIONS.find((x) => x.id === b.dataset.yt);
    b.setAttribute('aria-pressed', String(Boolean(iframe) && sameRef(st.ref, s.youtube)));
  });
  $('.music__radio').hidden = s.musicSource !== 'radio';
  $('.music__youtube').hidden = s.musicSource !== 'youtube';
}

// ---------- now playing ----------
function showNowPlaying() {
  const line = $('#track-style');
  if (iframe) {
    line.textContent = `YouTube · ${playerTitle || 'playing'}`;
    line.title = `Now playing on YouTube: ${playerTitle}`;
  } else if (lastRadioText) {
    line.textContent = lastRadioText;
  }
}

// ---------- player ----------
function effectiveVolume() {
  const muted = $('#mute-toggle').getAttribute('aria-pressed') === 'true';
  const musicOn = $('#music-toggle').classList.contains('on');
  return muted || !musicOn ? 0 : Math.round(Number($('#music-vol').value) * 100);
}

function post(func, args) {
  iframe?.contentWindow?.postMessage(youtubeCommand(func, args), YOUTUBE_ORIGIN);
}

function applyVolume() {
  if (!iframe) return;
  const volume = effectiveVolume();
  post('setVolume', [volume]);
  post(volume === 0 ? 'mute' : 'unMute');
}

function buildPlayer() {
  const el = document.createElement('div');
  el.id = 'yt-player';
  el.className = 'yt-player ui-layer';
  el.hidden = true;
  el.innerHTML = `
    <div class="yt-player__bar">
      <span class="yt-player__badge" aria-hidden="true">${iconSvg('music')}</span>
      <span class="yt-player__title" id="yt-player-title">YouTube</span>
      <button class="icon-btn yt-player__toggle" id="yt-toggle" aria-expanded="true" aria-controls="yt-video" aria-label="Hide video">hide</button>
      <button class="icon-btn yt-player__close" id="yt-close" aria-label="Stop YouTube and return to café radio">stop</button>
    </div>
    <div class="yt-player__video" id="yt-video"></div>`;
  document.body.append(el);
  player.el = el;
  $('#yt-toggle').addEventListener('click', () => setCollapsed(!player.collapsed));
  $('#yt-close').addEventListener('click', () => {
    updateUISettings({ musicSource: 'radio' });
    stopYouTube();
    sync();
  });
}

function setCollapsed(collapsed) {
  player.collapsed = collapsed;
  player.el.classList.toggle('collapsed', collapsed);
  $('#yt-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#yt-toggle').setAttribute('aria-label', collapsed ? 'Show video' : 'Hide video');
}

export function startYouTube(ref, title = '') {
  stopYouTube({ keepSuppressed: true });
  playerTitle = title || ref.title || '';
  iframe = document.createElement('iframe');
  iframe.src = youtubeEmbedUrl(ref, location.origin);
  iframe.title = 'YouTube music player';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.addEventListener('load', () => {
    iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'vibe-coffee' }), YOUTUBE_ORIGIN);
    applyVolume();
    setTimeout(applyVolume, 800);
  });
  $('#yt-video').append(iframe);
  player.el.hidden = false;
  $('#yt-player-title').textContent = playerTitle || 'YouTube';
  audio?.setMusicSuppressed(true);
  root.classList.add('youtube-playing');
  updateUISettings({ musicSource: 'youtube', youtube: { ...ref, ...(playerTitle ? { title: playerTitle } : {}) } });
  showNowPlaying();
  sync();
}

export function stopYouTube({ keepSuppressed = false } = {}) {
  if (iframe) {
    iframe.remove();
    iframe = null;
  }
  if (player.el) player.el.hidden = true;
  root.classList.remove('youtube-playing');
  if (!keepSuppressed) {
    audio?.setMusicSuppressed(false);
    showNowPlaying();
  }
}

function onMessage(event) {
  if (event.origin !== YOUTUBE_ORIGIN || !iframe || event.source !== iframe.contentWindow) return;
  let data = event.data;
  try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
  const title = data?.info?.videoData?.title;
  if (title && title !== playerTitle) {
    playerTitle = title;
    $('#yt-player-title').textContent = title;
    const s = getUISettings();
    if (s.youtube) updateUISettings({ youtube: { ...s.youtube, title: title.slice(0, 120) } });
    showNowPlaying();
  }
}

export function initMusic(bridge) {
  audio = bridge.audio;
  render();
  buildPlayer();
  if (matchMedia('(max-width: 640px)').matches) setCollapsed(true);
  const s = getUISettings();
  audio?.setMusicStation(s.musicStation);
  // A saved YouTube choice resumes on entering (that click allows autoplay);
  // until then the radio stays silent so it never plays underneath.
  if (s.musicSource === 'youtube' && s.youtube) audio?.setMusicSuppressed(true);
  document.addEventListener('vibe:entered', () => {
    const saved = getUISettings();
    if (saved.musicSource === 'youtube' && saved.youtube) startYouTube(saved.youtube, saved.youtube.title);
  });

  window.addEventListener('cafe-track-change', () => {
    lastRadioText = $('#track-style').textContent;
    if (iframe) showNowPlaying();
  });
  window.addEventListener('message', onMessage);

  const container = $('#music-source');
  container.addEventListener('click', (event) => {
    const source = event.target.closest('[data-source]');
    const station = event.target.closest('[data-station]');
    const yt = event.target.closest('[data-yt]');
    if (source) {
      const next = source.dataset.source;
      updateUISettings({ musicSource: next });
      if (next === 'radio') {
        stopYouTube();
      } else if (getUISettings().youtube && !iframe) {
        const saved = getUISettings().youtube;
        startYouTube(saved, saved.title);
      }
      sync();
    } else if (station) {
      updateUISettings({ musicStation: station.dataset.station });
      audio?.setMusicStation(station.dataset.station);
      notify(`${station.textContent.trim()} on the café radio`);
      sync();
    } else if (yt) {
      const st = YOUTUBE_STATIONS.find((x) => x.id === yt.dataset.yt);
      startYouTube(st.ref, st.title);
    }
  });
  container.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#yt-url');
    const ref = parseYouTubeUrl(input.value);
    const hint = $('#yt-hint');
    if (!ref) {
      hint.textContent = 'That doesn\'t look like a YouTube video or playlist link.';
      hint.classList.add('field__hint--error');
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    hint.textContent = 'Playing your link. Volume follows the music slider.';
    hint.classList.remove('field__hint--error');
    input.removeAttribute('aria-invalid');
    input.value = '';
    startYouTube(ref, ref.kind === 'playlist' ? 'YouTube playlist' : '');
  });
  // Typing a link must not trigger café shortcuts or walking.
  container.addEventListener('keydown', (event) => { if (event.target.matches('input') && event.key !== 'Escape') event.stopPropagation(); });

  for (const id of ['#mute-toggle', '#music-toggle']) {
    new MutationObserver(applyVolume).observe($(id), { attributes: true, attributeFilter: ['aria-pressed', 'class'] });
  }
  $('#music-vol').addEventListener('input', applyVolume);
}
