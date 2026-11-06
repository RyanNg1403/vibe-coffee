// YouTube as a music source: link parsing, privacy-enhanced embed URLs and
// a few curated streams. Nothing here touches the network until a player is
// created on the visitor's request.

export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

// Verified embeddable via YouTube oEmbed (Nov 2026). Long mixes or 24/7
// streams suit hours of background listening.
export const YOUTUBE_STATIONS = Object.freeze([
  { id: 'lofi-sleep', genre: 'Lo-fi', icon: 'moon', title: 'lofi hip hop radio · beats to sleep/chill to', channel: 'Lofi Girl', ref: { kind: 'video', id: 'DWcJFNfaw9c' } },
  { id: 'lofi-study', genre: 'Lo-fi', icon: 'cup', title: '1 A.M Study Session', channel: 'Lofi Girl', ref: { kind: 'video', id: 'lTRiuFIWV54' } },
  { id: 'chillhop', genre: 'Lo-fi', icon: 'music', title: 'lofi hip hop radio · beats to study/relax to', channel: 'Chillhop Music', ref: { kind: 'video', id: '7NOSDKb0HlU' } },
  { id: 'morning-coffee', genre: 'Lo-fi', icon: 'sun', title: 'Morning Coffee', channel: 'Lofi Girl', ref: { kind: 'video', id: '1fueZCTYkpA' } },
  { id: 'jazz-piano-radio', genre: 'Jazz', icon: 'music', title: 'Relaxing Jazz Piano Radio · 24/7', channel: 'Cafe Music BGM channel', ref: { kind: 'video', id: 'Dx5qFachd3A' } },
  { id: 'relaxing-jazz', genre: 'Jazz', icon: 'cup', title: 'Relaxing Jazz · chill-out background', channel: 'Cafe Music BGM channel', ref: { kind: 'video', id: 'neV3EPgvZ3g' } },
  { id: 'coffee-shop-jazz', genre: 'Jazz', icon: 'cup', title: 'Cozy Coffee Shop · smooth piano jazz', channel: 'Relaxing Jazz Piano', ref: { kind: 'video', id: 'MYPVQccHhAQ' } },
  { id: 'rainy-night-jazz', genre: 'Jazz', icon: 'rain', title: 'Rainy Night Coffee Shop · jazz & rain', channel: 'Calmed By Nature', ref: { kind: 'video', id: 'c0_ejQQcrwI' } },
  { id: 'soft-piano', genre: 'Piano', icon: 'sparkle', title: 'Soft, beautiful & relaxing piano', channel: 'Peder B. Helland', ref: { kind: 'video', id: '9Q634rbsypE' } },
  { id: 'synthwave', genre: 'Synthwave', icon: 'moon', title: 'synthwave radio · beats to chill/game to', channel: 'Lofi Girl', ref: { kind: 'video', id: '4xDzrJKXOOY' } },
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

// Accepts watch, youtu.be, shorts, live, embed and playlist links, or a bare
// 11-character video id. Returns { kind: 'video', id, list? } or
// { kind: 'playlist', list }, or null when the text is not a YouTube link.
export function parseYouTubeUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return { kind: 'video', id: text };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const list = url.searchParams.get('list');
  const validList = list && LIST_ID.test(list) ? list : null;
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'live', 'embed', 'v'].includes(first) && second !== 'videoseries') id = second;
    else if (first === 'playlist' && validList) return { kind: 'playlist', list: validList };
    else if (first === 'embed' && second === 'videoseries' && validList) return { kind: 'playlist', list: validList };
  } else {
    return null;
  }
  if (id && VIDEO_ID.test(id)) return validList ? { kind: 'video', id, list: validList } : { kind: 'video', id };
  if (validList) return { kind: 'playlist', list: validList };
  return null;
}

export function sanitizeYouTubeRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.kind === 'video' && VIDEO_ID.test(ref.id ?? '')) {
    return { kind: 'video', id: ref.id, ...(LIST_ID.test(ref.list ?? '') ? { list: ref.list } : {}), ...(typeof ref.title === 'string' ? { title: ref.title.slice(0, 120) } : {}) };
  }
  if (ref.kind === 'playlist' && LIST_ID.test(ref.list ?? '')) {
    return { kind: 'playlist', list: ref.list, ...(typeof ref.title === 'string' ? { title: ref.title.slice(0, 120) } : {}) };
  }
  return null;
}

// Privacy-enhanced embed with the JS API enabled so volume and play/pause
// can follow the café's own controls via postMessage.
export function youtubeEmbedUrl(ref, origin) {
  const params = new URLSearchParams({
    autoplay: '1', enablejsapi: '1', playsinline: '1', rel: '0', modestbranding: '1',
  });
  if (origin) params.set('origin', origin);
  let path;
  if (ref.kind === 'playlist') {
    path = 'videoseries';
    params.set('list', ref.list);
  } else {
    path = ref.id;
    if (ref.list) params.set('list', ref.list);
    else {
      // A single video loops by naming itself as its own playlist.
      params.set('loop', '1');
      params.set('playlist', ref.id);
    }
  }
  return `${YOUTUBE_ORIGIN}/embed/${path}?${params}`;
}

export function youtubeCommand(func, args = []) {
  return JSON.stringify({ event: 'command', func, args });
}
