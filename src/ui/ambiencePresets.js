// One-tap ambience scenes for focus work. A preset only sets values the
// visitor could set by hand (venue, time, weather, mixer levels), so it is
// applied through the same controls and persists like any manual change.

export const AMBIENCE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'deep-work',
    name: 'Deep work',
    description: 'Low chatter, steady rain, music in the background.',
    icon: 'rain',
    venue: null,
    time: 'night',
    sky: 'rain',
    mix: { music: 0.32, ambience: 0.45, voices: 0.35, pets: 0.25, rain: 2 },
  }),
  Object.freeze({
    id: 'morning-pages',
    name: 'Morning pages',
    description: 'Early light, the first pours, a bright quiet room.',
    icon: 'sun',
    venue: 0,
    time: 'morning',
    sky: 'clear',
    mix: { music: 0.45, ambience: 0.7, voices: 0.8, pets: 0.65, rain: 0 },
  }),
  Object.freeze({
    id: 'busy-cafe',
    name: 'Busy café',
    description: 'A lively room to body-double with.',
    icon: 'people',
    venue: 1,
    time: 'noon',
    sky: 'clear',
    mix: { music: 0.4, ambience: 0.9, voices: 1.25, pets: 0.65, rain: 0 },
  }),
  Object.freeze({
    id: 'late-jazz',
    name: 'Late-night jazz',
    description: 'Warm lamps, a slow record, rain on the glass.',
    icon: 'moon',
    venue: 2,
    time: 'auto',
    sky: 'auto',
    mix: { music: 0.7, ambience: 0.55, voices: 0.6, pets: 0.5, rain: 1 },
  }),
]);

export const MIX_INPUTS = Object.freeze({
  music: 'music-vol',
  ambience: 'amb-vol',
  voices: 'voices-vol',
  pets: 'pets-vol',
  rain: 'rain-vol',
});

// Returns how close the live mixer is to a preset (true when it matches),
// so the panel can mark the active scene after manual tweaks too.
export function presetMatches(preset, live) {
  if (preset.venue != null && live.venue !== preset.venue) return false;
  if (preset.time !== live.time || preset.sky !== live.sky) return false;
  return Object.entries(preset.mix).every(([key, value]) => Math.abs((live.mix[key] ?? -1) - value) < 0.011);
}
