import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_MANIFEST } from '../src/musicManifest.js';
import { MUSIC_STATIONS, TRACK_GENRES, stationTracks, isMusicStation } from '../src/musicStations.js';
import {
  YOUTUBE_STATIONS, parseYouTubeUrl, sanitizeYouTubeRef, youtubeEmbedUrl, youtubeCommand,
} from '../src/ui/youtube.js';

const allIds = [...new Set(Object.values(MUSIC_MANIFEST).flat().map((t) => t.id))];

test('every radio station has music in every café', () => {
  for (const station of MUSIC_STATIONS) {
    for (const venue of ['goldenhour', 'roastery', 'midnight', 'terrace']) {
      assert.ok(stationTracks(station.id, venue).length > 0, `${station.id} @ ${venue}`);
    }
  }
});

test('genre stations draw across cafés and stay on genre', () => {
  for (const genre of ['lofi', 'jazz', 'bossa', 'piano']) {
    const tracks = stationTracks(genre, 'goldenhour');
    assert.ok(tracks.length >= 3, `${genre} has a real rotation`);
    assert.ok(tracks.every((t) => TRACK_GENRES[t.id].includes(genre)));
  }
  const jazzVenues = new Set(stationTracks('jazz', 'goldenhour')
    .map((t) => Object.keys(MUSIC_MANIFEST).find((venue) => MUSIC_MANIFEST[venue].some((x) => x.id === t.id))));
  assert.ok(jazzVenues.size >= 2, 'a genre is not just one café\'s playlist');
});

test('café pick keeps each café\'s records and gives the terrace its own mix', () => {
  assert.deepEqual(stationTracks('cafe', 'midnight').map((t) => t.id), MUSIC_MANIFEST.midnight.map((t) => t.id));
  const terrace = stationTracks('cafe', 'terrace').map((t) => t.id);
  assert.ok(terrace.length >= 4);
  assert.notDeepEqual(terrace, MUSIC_MANIFEST.goldenhour.map((t) => t.id));
  assert.equal(stationTracks('shuffle', 'midnight').length, allIds.length);
  assert.equal(isMusicStation('polka'), false);
  assert.deepEqual(stationTracks('polka', 'midnight').map((t) => t.id), MUSIC_MANIFEST.midnight.map((t) => t.id));
});

test('every recorded track is tagged with at least one genre', () => {
  for (const id of allIds) assert.ok(TRACK_GENRES[id]?.length, id);
});

test('YouTube links of every common shape parse', () => {
  const id = 'DWcJFNfaw9c';
  for (const url of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) assert.deepEqual(parseYouTubeUrl(url), { kind: 'video', id }, url);
  const list = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
  assert.deepEqual(parseYouTubeUrl(`https://www.youtube.com/playlist?list=${list}`), { kind: 'playlist', list });
  assert.deepEqual(parseYouTubeUrl(`https://www.youtube.com/watch?v=${id}&list=${list}`), { kind: 'video', id, list });
});

test('non-YouTube text is rejected', () => {
  for (const bad of ['', 'hello world', 'https://vimeo.com/123456', 'https://youtube.com/watch?v=short', 'javascript:alert(1)', 'https://evil.example/watch?v=DWcJFNfaw9c']) {
    assert.equal(parseYouTubeUrl(bad), null, bad);
  }
});

test('saved YouTube choices are sanitised', () => {
  assert.equal(sanitizeYouTubeRef({ kind: 'video', id: '<script>' }), null);
  assert.equal(sanitizeYouTubeRef('nope'), null);
  assert.deepEqual(sanitizeYouTubeRef({ kind: 'video', id: 'DWcJFNfaw9c', title: 'x'.repeat(300), extra: 1 }), { kind: 'video', id: 'DWcJFNfaw9c', title: 'x'.repeat(120) });
});

test('embeds use the privacy-enhanced host with the JS API and looping', () => {
  const url = new URL(youtubeEmbedUrl({ kind: 'video', id: 'DWcJFNfaw9c' }, 'https://example.github.io'));
  assert.equal(url.origin, 'https://www.youtube-nocookie.com');
  assert.equal(url.pathname, '/embed/DWcJFNfaw9c');
  assert.equal(url.searchParams.get('enablejsapi'), '1');
  assert.equal(url.searchParams.get('origin'), 'https://example.github.io');
  assert.equal(url.searchParams.get('playlist'), 'DWcJFNfaw9c');
  const series = new URL(youtubeEmbedUrl({ kind: 'playlist', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }));
  assert.equal(series.pathname, '/embed/videoseries');
  assert.deepEqual(JSON.parse(youtubeCommand('setVolume', [40])), { event: 'command', func: 'setVolume', args: [40] });
});

test('curated YouTube stations are well-formed and unique', () => {
  assert.ok(YOUTUBE_STATIONS.length >= 8);
  assert.equal(new Set(YOUTUBE_STATIONS.map((s) => s.ref.id)).size, YOUTUBE_STATIONS.length);
  assert.ok(new Set(YOUTUBE_STATIONS.map((s) => s.genre)).size >= 4, 'covers several genres');
  for (const s of YOUTUBE_STATIONS) assert.deepEqual(sanitizeYouTubeRef(s.ref), s.ref);
});
