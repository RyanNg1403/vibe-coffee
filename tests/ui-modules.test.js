import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_TIERS, QUALITY_TIER_IDS, getQualityTier, initQualityTier, isQualityTier,
  onQualityTierChange, qualityTierConfig, setQualityTier,
} from '../src/qualityTier.js';
import { DEFAULT_UI_SETTINGS, loadUISettings, sanitizeUISettings, saveUISettings, motionReduced } from '../src/ui/settings.js';
import { dayKey, focusSummary, recordFocusBlock, sanitizeStats } from '../src/ui/focusStats.js';
import { computeProgress } from '../src/ui/loading.js';
import { AMBIENCE_PRESETS, presetMatches } from '../src/ui/ambiencePresets.js';
import { loadPreferences } from '../src/preferences.js';

test('quality tiers keep the legacy persisted ids and order effects by cost', () => {
  assert.deepEqual(QUALITY_TIER_IDS, ['auto', 'smooth', 'balanced', 'detail', 'ultra']);
  const fixed = QUALITY_TIERS.filter((tier) => tier.id !== 'auto');
  for (let i = 1; i < fixed.length; i += 1) {
    assert.ok(fixed[i].effects >= fixed[i - 1].effects);
    assert.ok(fixed[i].pixelRatio >= fixed[i - 1].pixelRatio);
  }
  assert.equal(qualityTierConfig('nonsense').id, 'auto');
  assert.equal(isQualityTier('cinematic'), false);
});

test('quality tier changes notify subscribers once and ignore invalid ids', () => {
  initQualityTier('auto');
  const seen = [];
  const off = onQualityTierChange((tier, config) => seen.push([tier, config.effects]));
  assert.equal(setQualityTier('ultra'), true);
  assert.equal(setQualityTier('ultra'), false);
  assert.equal(setQualityTier('bogus'), false);
  off();
  setQualityTier('smooth');
  assert.deepEqual(seen, [['ultra', 2]]);
  assert.equal(getQualityTier(), 'smooth');
  assert.equal(initQualityTier('bogus'), 'auto');
});

test('preferences accept every quality tier', () => {
  for (const id of QUALITY_TIER_IDS) {
    globalThis.localStorage = { getItem: () => JSON.stringify({ qualityMode: id }), setItem() {} };
    assert.equal(loadPreferences().qualityMode, id);
  }
  delete globalThis.localStorage;
});

test('UI settings sanitize corrupt values and round-trip', () => {
  assert.deepEqual(sanitizeUISettings(null), { ...DEFAULT_UI_SETTINGS });
  const dirty = sanitizeUISettings({
    reducedMotion: 'sometimes', textScale: 1.3, lookSensitivity: 99, invertY: 'yes', breakMinutes: 12,
  });
  assert.equal(dirty.reducedMotion, 'system');
  assert.equal(dirty.textScale, 1.25);
  assert.equal(dirty.lookSensitivity, 2.5);
  assert.equal(dirty.invertY, false);
  assert.equal(dirty.breakMinutes, 10);

  let stored = null;
  const storage = { getItem: () => stored, setItem: (_k, v) => { stored = v; } };
  const custom = { ...DEFAULT_UI_SETTINGS, highContrast: true, textScale: 1.4, breakMinutes: 15, reducedMotion: 'reduce' };
  saveUISettings(custom, storage);
  assert.deepEqual(loadUISettings(storage), custom);
  assert.deepEqual(loadUISettings({ getItem() { throw new Error('denied'); } }), { ...DEFAULT_UI_SETTINGS });
  assert.equal(motionReduced({ reducedMotion: 'reduce' }), true);
  assert.equal(motionReduced({ reducedMotion: 'full' }), false);
});

test('focus stats count today, streaks across days and reset at local midnight', () => {
  const day = (d, h = 10) => new Date(2026, 10, d, h);
  let stats = { days: {} };
  stats = recordFocusBlock(stats, 25, day(4));
  stats = recordFocusBlock(stats, 25, day(5));
  stats = recordFocusBlock(stats, 45, day(6, 9));
  stats = recordFocusBlock(stats, 25, day(6, 23));
  const today = focusSummary(stats, day(6, 23));
  assert.equal(today.sessionsToday, 2);
  assert.equal(today.minutesToday, 70);
  assert.equal(today.streak, 3);
  assert.equal(today.week.length, 7);
  assert.equal(today.week.at(-1).key, dayKey(day(6)));

  const nextMorning = focusSummary(stats, new Date(2026, 10, 7, 0, 5));
  assert.equal(nextMorning.sessionsToday, 0);
  assert.equal(nextMorning.streak, 3, 'an unfinished day keeps yesterday\'s streak');
  assert.equal(focusSummary(stats, day(9)).streak, 0);
  assert.deepEqual(sanitizeStats({ days: { nope: { sessions: 3 }, '2026-11-01': { sessions: -1 } } }), { days: {} });
});

test('loading progress is monotonic through its stages and completes only after warm frames', () => {
  const states = [
    { elapsed: 0.1 },
    { elapsed: 2 },
    { started: 40, finished: 10, elapsed: 2.5 },
    { started: 40, finished: 39, elapsed: 4 },
    { started: 40, finished: 40, elapsed: 4.2 },
    { started: 40, finished: 40, built: true, warmFrames: 1, elapsed: 5 },
    { started: 40, finished: 40, built: true, warmFrames: 3, elapsed: 5.1 },
  ];
  const values = states.map((s) => computeProgress(s).value);
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] >= values[i - 1], `step ${i} regressed`);
  assert.ok(values.slice(0, -1).every((v) => v < 1));
  assert.equal(values.at(-1), 1);
  assert.equal(computeProgress(states[2]).stage.id, 'assets');
  assert.equal(computeProgress(states[4]).stage.id, 'build');
  assert.ok(computeProgress({ elapsed: 600 }).value < 0.8, 'time alone never claims the café is ready');
});

test('ambience presets use valid controls and match only their own mix', () => {
  const times = ['auto', 'morning', 'noon', 'sunset', 'night'];
  for (const preset of AMBIENCE_PRESETS) {
    assert.ok(times.includes(preset.time));
    assert.ok(['auto', 'clear', 'rain'].includes(preset.sky));
    assert.ok(preset.venue === null || (preset.venue >= 0 && preset.venue <= 3));
    assert.ok(preset.mix.voices <= 1.5 && preset.mix.rain >= 0 && preset.mix.rain <= 3);
    const live = { venue: preset.venue ?? 2, time: preset.time, sky: preset.sky, mix: { ...preset.mix } };
    assert.equal(presetMatches(preset, live), true);
    assert.equal(presetMatches(preset, { ...live, mix: { ...live.mix, music: live.mix.music + 0.1 } }), false);
  }
  assert.equal(new Set(AMBIENCE_PRESETS.map((p) => p.id)).size, AMBIENCE_PRESETS.length);
});
