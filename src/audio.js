// Hybrid audio engine: positional recorded café ambience with procedural
// fallbacks and a generative music engine.
//
// Realism techniques used here:
//  - a ConvolverNode with a procedurally generated impulse response puts
//    every sound "inside the room"
//  - PannerNodes + the AudioContext listener give true 3D positions: the
//    espresso machine sounds from the counter, the chime from the door,
//    clinks from whichever table they happen at
//  - events are multi-stage (knock -> grind -> pump -> steam) instead of
//    single noise bursts

import { loadSoundLibrary } from './soundLoader.js';
import { SOUND_MANIFEST } from './soundManifest.js';
import { MUSIC_MANIFEST } from './musicManifest.js';

const MIDI_A4 = 69;
const freq = (midi) => 440 * Math.pow(2, (midi - MIDI_A4) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Authored onset markers from the bundled recordings. Starting at impacts
// avoids the conspicuous mid-sound slices produced by arbitrary offsets.
const FOOTSTEP_ONSETS = [0.55, 1.3, 2.1, 2.91, 3.71, 4.57, 5.23, 5.96, 6.69, 7.47, 8.24, 9.04, 9.84, 10.54, 11.32];
const CLINK_ONSETS = [0.43, 1.6, 2.67, 3.35, 3.7, 3.89, 4.23];

// ---------- per-café music styles ----------

// Each café has a pool of styles; every new song draws one, so an afternoon
// in one café wanders through genres the way a good café playlist does.
const MAJ_SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const MIN_SCALE = [0, 3, 5, 7, 10, 12, 15, 17];
const BLUES_SCALE = [0, 3, 5, 6, 7, 10, 12, 15];

const STYLES = {
  goldenhour: [
    { name: 'lofi', bpm: [68, 80], key: [-2, 0, 2, 3], swing: 0.13,
      progressions: [
        [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]],
        [[-3, 0, 4, 7], [5, 9, 12, 16], [0, 4, 7, 11], [-5, -1, 2, 5]],
        [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]],
        [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [0, 4, 7, 11]],
      ],
      scale: MAJ_SCALE, drums: 'lofi', lead: 'ep', comp: 'ep',
      pluckChance: 0.5, padChance: 0.35, bassStyle: 'roots', melodyDensity: 0.16 },
    { name: 'soul', bpm: [60, 72], key: [-2, 0, 3], swing: 0.1,
      progressions: [
        [[0, 4, 7, 11, 14], [-3, 0, 4, 7, 10], [2, 5, 9, 12], [7, 11, 14, 17]],
        [[5, 9, 12, 16], [4, 7, 11, 14], [0, 4, 7, 11, 14], [0, 4, 7, 11, 14]],
      ],
      scale: MAJ_SCALE, drums: 'soul', lead: 'ep', comp: 'ep',
      pluckChance: 0.15, padChance: 0.55, bassStyle: 'roots', melodyDensity: 0.11 },
    { name: 'acoustic', bpm: [76, 90], key: [0, 2, 5], swing: 0.07,
      progressions: [
        [[0, 4, 7, 12], [7, 11, 14, 19], [-3, 0, 4, 7], [5, 9, 12, 16]],
        [[0, 4, 7, 12], [5, 9, 12, 16], [0, 4, 7, 12], [7, 11, 14, 17]],
      ],
      scale: MAJ_SCALE, drums: 'shaker', lead: 'pluck', comp: 'pluck',
      pluckChance: 1, padChance: 0.15, bassStyle: 'roots', melodyDensity: 0.24 },
    { name: 'minimal piano', bpm: [54, 66], key: [-2, 0, 5], swing: 0.04,
      progressions: [
        [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [-3, 0, 4, 7]],
        [[0, 4, 7, 14], [-5, -1, 2, 7], [5, 9, 12, 19], [4, 7, 11, 16]],
      ],
      scale: MAJ_SCALE, drums: 'none', lead: 'ep', comp: 'ep',
      pluckChance: 0, padChance: 0.75, bassStyle: 'roots', melodyDensity: 0.08 },
  ],
  roastery: [
    { name: 'bossa', bpm: [86, 98], key: [0, 2, 5, 7], swing: 0.06,
      progressions: [
        [[0, 4, 7, 11], [2, 5, 9, 12], [4, 7, 11, 14], [2, 5, 9, 12]],
        [[5, 9, 12, 16], [4, 8, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]],
        [[0, 4, 7, 11], [0, 3, 7, 10], [5, 9, 12, 16], [5, 8, 12, 15]],
      ],
      scale: [0, 2, 4, 7, 9, 11, 12, 14], drums: 'bossa', lead: 'pluck', comp: 'pluck',
      pluckChance: 1, padChance: 0.15, bassStyle: 'bossa', melodyDensity: 0.2 },
    { name: 'swing', bpm: [96, 114], key: [0, 3, 5, 7], swing: 0.22,
      progressions: [
        [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [0, 4, 7, 11]],
        [[0, 4, 7, 11], [0, 3, 7, 10], [2, 5, 9, 12], [7, 11, 14, 17]],
      ],
      scale: [0, 2, 4, 7, 9, 11, 12, 14], drums: 'ride', lead: 'ep', comp: 'ep',
      pluckChance: 0.2, padChance: 0.1, bassStyle: 'walking', melodyDensity: 0.2 },
    { name: 'latin', bpm: [92, 104], key: [-3, 0, 2], swing: 0.03,
      progressions: [
        [[0, 3, 7, 10], [-2, 2, 5, 8], [0, 3, 7, 10], [5, 8, 12, 15]],
        [[0, 3, 7, 10], [3, 7, 10, 14], [-2, 2, 5, 8], [-4, 0, 3, 7]],
      ],
      scale: MIN_SCALE, drums: 'latin', lead: 'pluck', comp: 'pluck',
      pluckChance: 1, padChance: 0.1, bassStyle: 'bossa', melodyDensity: 0.22 },
    { name: 'downtempo', bpm: [72, 84], key: [-3, 0, 5], swing: 0.12,
      progressions: [
        [[0, 3, 7, 10], [5, 9, 12, 16], [-2, 2, 5, 9], [3, 7, 10, 14]],
        [[0, 4, 7, 11], [-4, 0, 3, 7], [5, 9, 12, 16], [2, 5, 9, 12]],
      ],
      scale: MIN_SCALE, drums: 'lofi', lead: 'ep', comp: 'ep',
      pluckChance: 0.35, padChance: 0.55, bassStyle: 'roots', melodyDensity: 0.13 },
  ],
  midnight: [
    { name: 'brushjazz', bpm: [56, 66], key: [-5, -3, -1], swing: 0.15,
      progressions: [
        [[0, 3, 7, 10, 14], [5, 8, 12, 15], [-2, 2, 5, 8], [0, 3, 7, 10]],
        [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 1, 5, 8], [-7, -3, 0, 3]],
        [[0, 3, 7, 10, 14], [0, 3, 7, 10, 14], [-4, -1, 3, 6], [-2, 2, 5, 9]],
      ],
      scale: MIN_SCALE, drums: 'brush', lead: 'ep', comp: 'ep',
      pluckChance: 0.2, padChance: 0.6, bassStyle: 'walking', melodyDensity: 0.12 },
    { name: 'blues', bpm: [58, 70], key: [-5, -2, 0], swing: 0.18,
      progressions: [
        [[0, 4, 7, 10], [0, 4, 7, 10], [5, 9, 12, 15], [0, 4, 7, 10]],
        [[5, 9, 12, 15], [5, 9, 12, 15], [0, 4, 7, 10], [7, 11, 14, 17]],
      ],
      scale: BLUES_SCALE, drums: 'brush', lead: 'ep', comp: 'ep',
      pluckChance: 0.35, padChance: 0.2, bassStyle: 'blues', melodyDensity: 0.16 },
    { name: 'nocturne', bpm: [52, 60], key: [-5, -3], swing: 0.1,
      progressions: [
        [[0, 3, 7, 14], [-4, 0, 3, 10], [5, 8, 12, 15], [-2, 2, 5, 12]],
        [[0, 3, 7, 14], [5, 8, 12, 19], [-4, 0, 3, 10], [-7, -3, 0, 7]],
      ],
      scale: MIN_SCALE, drums: 'none', lead: 'ep', comp: 'ep',
      pluckChance: 0.1, padChance: 0.95, bassStyle: 'roots', melodyDensity: 0.09 },
    { name: 'piano trio', bpm: [68, 82], key: [-5, -2, 0], swing: 0.2,
      progressions: [
        [[0, 3, 7, 10], [5, 8, 12, 15], [2, 5, 9, 12], [7, 10, 14, 17]],
        [[0, 3, 7, 14], [-3, 0, 4, 10], [-5, -1, 2, 9], [5, 8, 12, 17]],
      ],
      scale: MIN_SCALE, drums: 'ride', lead: 'ep', comp: 'ep',
      pluckChance: 0.05, padChance: 0.18, bassStyle: 'walking', melodyDensity: 0.18 },
  ],
};

// Every café hears the world differently: how full the room is, how the
// street sounds through the glass, how bright the footsteps are, how often
// cups ring. These profiles steer both the recorded beds and the synth layers.
const AMBIENCE_PROFILES = {
  goldenhour: {
    // relaxed afternoon: the classic walla blend
    beds: { chatter: 0.8, chatter2: 0.35, chatter_busy: 0, chatter_quiet: 0 },
    chatterRate: 1.0, chatterLP: 7500,
    traffic: 0.8, murmur: 0.3, stepRate: 1.0, stepVol: 1.0,
    room: { seconds: 1.35, decay: 3.8, wet: 0.32 },
    clinkMs: [5000, 17000], typeMs: [1500, 7000],
  },
  roastery: {
    // busy daytime spot: its own denser, livelier crowd recording; loud street
    beds: { chatter: 0.3, chatter2: 0.25, chatter_busy: 1.1, chatter_quiet: 0 },
    chatterRate: 1.04, chatterLP: 11000,
    traffic: 1.5, murmur: 0.45, stepRate: 1.14, stepVol: 1.2,
    room: { seconds: 0.95, decay: 4.6, wet: 0.22 },
    clinkMs: [3000, 11000], typeMs: [1000, 4500],
  },
  midnight: {
    // nearly empty, hushed: its own sparse late-night recording; rain-wet street
    beds: { chatter: 0.1, chatter2: 0, chatter_busy: 0, chatter_quiet: 0.55 },
    chatterRate: 0.92, chatterLP: 2400,
    traffic: 0.55, murmur: 0.14, stepRate: 0.88, stepVol: 0.8,
    room: { seconds: 1.85, decay: 3.1, wet: 0.46 },
    clinkMs: [9000, 26000], typeMs: [4000, 14000],
  },
  terrace: {
    // open air: conversation floats away, distant road, gravel underfoot
    beds: { chatter: 0.35, chatter2: 0.2, chatter_busy: 0, chatter_quiet: 0.5 },
    chatterRate: 0.98, chatterLP: 6000,
    traffic: 0.18, murmur: 0.2, stepRate: 0.85, stepVol: 0.65,
    room: { seconds: 0.55, decay: 5.0, wet: 0.08 },
    clinkMs: [7000, 20000], typeMs: [2500, 9000],
  },
};

export class CafeAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.musicOn = true;
    this.theme = null;
    this._timers = new Set();
    this.clinkSpots = [];   // world positions where seated people are
    this.typingSpots = [];  // world positions of laptop users
    this.pageSpots = [];    // world positions of people actually reading
    this.occupancy = 0;
    this.capacity = 1;
    this.buffers = new Map(); // recorded assets (loaded async; synth covers gaps)
    this.activeOneShotSources = 0; // live non-looping recorded sources, for runtime audits
    this.voicesLevel = 1;     // user's "people talking" slider, scales the crowd beds
    this.recordedVolume = 0.5;
    this.recordedDuck = 1;
  }

  start(theme) {
    if (this.started) return;
    this.started = true;
    this.theme = theme;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // gentle mastering squeeze so quiet layers stay audible
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.ratio.value = 3;
    this.master.connect(this.comp).connect(ctx.destination);

    // procedural room reverb
    this.reverb = ctx.createConvolver();
    const initialRoom = this._profile().room;
    this._irCache = new Map();
    this.reverb.buffer = this._makeImpulseResponse(initialRoom.seconds, initialRoom.decay);
    this._irCache.set(this.theme.id, this.reverb.buffer);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = initialRoom.wet;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    // makeup gain: the synth voices are written quiet; this brings the music
    // up to sit beside the recorded ambience beds instead of underneath them
    this.musicMakeup = ctx.createGain();
    this.musicMakeup.gain.value = 2.15;
    this.musicDucker = ctx.createGain();
    this.musicDucker.gain.value = 1;
    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    // Keep the top octave of percussion and plucked strings. The former
    // 3.4 kHz cutoff made every genre sound like the same muffled game loop.
    this.musicLP.frequency.value = 8200;
    this.musicBus.connect(this.musicMakeup).connect(this.musicDucker).connect(this.musicLP).connect(this.master);
    // a touch of room on the music too
    const musVerbSend = ctx.createGain();
    musVerbSend.gain.value = 0.12;
    this.musicLP.connect(musVerbSend).connect(this.reverb);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.7;
    this.ambienceBus.connect(this.master);
    // Category buses preserve one user-facing café control while giving the
    // mix intentional internal perspective and headroom.
    this.foleyBus = ctx.createGain();
    this.foleyBus.gain.value = 0.82;
    this.foleyBus.connect(this.ambienceBus);
    this.machineryBus = ctx.createGain();
    this.machineryBus.gain.value = 0.9;
    this.machineryBus.connect(this.ambienceBus);
    this.exteriorBus = ctx.createGain();
    this.exteriorBus.gain.value = 0.62;
    this.exteriorBus.connect(this.ambienceBus);
    this.ambVerbSend = ctx.createGain();
    this.ambVerbSend.gain.value = 0.35;
    this.ambienceBus.connect(this.ambVerbSend).connect(this.reverb);

    // people-talking layers get their own bus so the voices slider stays
    // audible even with the café ambience slider at zero
    this.voicesBus = ctx.createGain();
    this.voicesBus.gain.value = 0.7;
    this.voicesBus.connect(this.master);
    this.voicesBus.connect(this.ambVerbSend);

    this._noiseBuf = this._makeNoiseBuffer(2);
    this._brownBuf = this._makeBrownBuffer(4);

    this._startVinyl();
    this._startRoomTone();
    this._startMurmur();
    this.setTheme(theme);
    this._scheduleEvents();
    this._startMusic();

    // recorded assets stream in behind the synth and take over the beds
    loadSoundLibrary(ctx, SOUND_MANIFEST).then((buffers) => {
      this.buffers = buffers;
      this._applyRecordedBeds();
    });
  }

  // ---------- recorded-asset helpers ----------

  _buf(key) { return this.buffers.get(key) || null; }

  // play a recorded asset; opts: {out, vol, rate, offset, dur, loop, seamless, when}
  _playBuf(key, opts = {}) {
    const entry = this._buf(key);
    if (!entry || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.playbackRate.value = opts.rate ?? 1;
    if (!opts.loop) {
      // 'ended' listeners survive callers that assign src.onended directly
      this.activeOneShotSources += 1;
      src.addEventListener('ended', () => { this.activeOneShotSources -= 1; }, { once: true });
    }
    if (opts.loop) {
      src.loop = true;
      if (entry.buffer.duration > 4 && !opts.seamless) { // skip raw file edges
        src.loopStart = 0.4;
        src.loopEnd = entry.buffer.duration - 0.4;
      }
    }
    const g = this.ctx.createGain();
    g.gain.value = (opts.vol ?? 1) * (entry.gain ?? 1);
    src.connect(g).connect(opts.out ?? this.ambienceBus);
    const when = opts.when ?? this.ctx.currentTime;
    let offset = opts.offset ?? 0;
    if (opts.randomSlice) {
      // grab a random window from a longer recording, for one-shot variety
      const dur = opts.dur ?? 1;
      offset = rand(0, Math.max(0.01, entry.buffer.duration - dur - 0.1));
    }
    if (opts.dur) {
      // gentle edges so slices never click
      const v = g.gain.value;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(v, when + Math.min(0.04, opts.dur / 4));
      g.gain.setValueAtTime(v, when + opts.dur - Math.min(0.08, opts.dur / 4));
      g.gain.linearRampToValueAtTime(0, when + opts.dur);
      src.start(when, offset, opts.dur + 0.1);
    } else {
      src.start(when, offset);
    }
    return { src, gain: g };
  }

  // once assets are loaded: recorded chatter/traffic/rain beds fade in,
  // synth equivalents duck down to a supporting role
  _applyRecordedBeds() {
    const t = this.ctx.currentTime;

    // every available crowd recording runs as a loop behind its own gain;
    // each café's profile mixes them into a different-sounding room
    this.chatterBeds = {};
    const bedKeys = ['chatter', 'chatter2', 'chatter_busy', 'chatter_quiet'];
    if (bedKeys.some((k) => this._buf(k))) {
      this.chatterTone = this.ctx.createBiquadFilter();
      this.chatterTone.type = 'lowpass';
      this.chatterTone.frequency.value = 7500;
      this.chatterTone.connect(this.voicesBus);
      for (const k of bedKeys) {
        if (!this._buf(k)) continue;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        g.connect(this.chatterTone);
        const src = this._playBuf(k, { out: g, vol: 1, loop: true });
        this.chatterBeds[k] = { gain: g, src };
      }
      this._applyAmbienceProfile();
      void t;
    }

    // street heard from inside, localized at the shopfront
    if (this._buf('traffic_day') || this._buf('traffic_night')) {
      const front = this.anchors?.door ?? { x: 0, z: 5 };
      this.trafficDayGain = this.ctx.createGain();
      this.trafficNightGain = this.ctx.createGain();
      const muffle = this.ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 1500; // through the glass
      const pan = this._panner(front.x, 1.6, front.z + 1.5, this.exteriorBus);
      this.trafficDayGain.connect(muffle);
      this.trafficNightGain.connect(muffle);
      muffle.connect(pan);
      if (this._buf('traffic_day')) this._playBuf('traffic_day', { out: this.trafficDayGain, vol: 0.5, loop: true });
      if (this._buf('traffic_night')) this._playBuf('traffic_night', { out: this.trafficNightGain, vol: 0.35, loop: true });
      this._setTrafficMix();
      // the occasional single car driving past
      const carPass = () => {
        if (this.theme && Math.random() < 0.75) this.playCarPass();
        // busier street = more frequent cars
        const busy = this._profile().traffic;
        this._timer(carPass, rand(14000, 45000) / Math.max(0.4, busy));
      };
      this._timer(carPass, 8000);
    }

    // The recorded field ambience replaces the short synthetic fallback.
    if (this._buf('rain_window') && this.theme?.rain) this._startRain();
  }

  _setTrafficMix() {
    if (!this.trafficDayGain) return;
    const t = this.ctx.currentTime;
    const night = this.theme?.timeOfDay === 'night';
    const scale = this._profile().traffic;
    this.trafficDayGain.gain.setTargetAtTime(night ? 0 : scale, t, 1.5);
    this.trafficNightGain.gain.setTargetAtTime(night ? scale : 0, t, 1.5);
  }

  _profile() {
    return AMBIENCE_PROFILES[this.theme?.id] ?? AMBIENCE_PROFILES.goldenhour;
  }

  // retune the crowd + murmur + tone to the current café's character
  _applyAmbienceProfile() {
    if (!this.ctx) return;
    const p = this._profile();
    const t = this.ctx.currentTime;
    const beds = this.chatterBeds || {};
    const voices = (this.voicesLevel ?? 1) * (this.crowdFactor ?? 1);
    const occupancy = clamp(this.occupancy / Math.max(1, this.capacity), 0.08, 1);
    if (Object.keys(beds).length) {
      // desired mix, with weight falling back to the generic bed when a
      // café-specific recording didn't make it
      const want = { ...p.beds };
      if (!beds.chatter_busy && want.chatter_busy) { want.chatter += want.chatter_busy * 0.8; want.chatter_busy = 0; }
      if (!beds.chatter_quiet && want.chatter_quiet) { want.chatter += want.chatter_quiet * 0.5; want.chatter_quiet = 0; }
      for (const [k, bed] of Object.entries(beds)) {
        bed.gain.gain.setTargetAtTime((want[k] ?? 0) * voices * (0.3 + occupancy * 0.7), t, 0.8);
        bed.src?.src.playbackRate.setTargetAtTime(p.chatterRate * (k === 'chatter2' ? 0.97 : 1), t, 1.5);
      }
      this.chatterTone.frequency.setTargetAtTime(p.chatterLP, t, 1.5);
      // recorded crowd leads; synth murmur is per-café seasoning
      this.murmurGain.gain.setTargetAtTime(p.murmur * 0.18 * voices * occupancy, t, 0.8);
    } else {
      // synth-only fallback still gets scaled per café
      this.murmurGain?.gain.setTargetAtTime(Math.max(0.45, p.murmur * 2.4) * voices, t, 0.4);
    }
  }

  // the room's talk level follows the actual crowd: an emptying café gets
  // noticeably quieter, a filling one livelier. ratio = social NPCs / capacity
  setCrowdFactor(ratio) {
    const f = 0.35 + Math.min(1, Math.max(0, ratio)) * 0.75; // 0.35 empty → 1.1 packed
    if (Math.abs(f - (this.crowdFactor ?? 1)) < 0.03) return;
    this.crowdFactor = f;
    this._applyAmbienceProfile();
  }

  // ---------- listener / spatial ----------

  // called every frame from the render loop with the camera pose
  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  _panner(x, y, z, destination = this.ambienceBus) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.refDistance = 1.5;
    p.maxDistance = 22;
    p.rolloffFactor = 1;
    p.positionX?.setValueAtTime(x, this.ctx.currentTime);
    p.positionY?.setValueAtTime(y, this.ctx.currentTime);
    p.positionZ?.setValueAtTime(z, this.ctx.currentTime);
    if (!p.positionX && p.setPosition) p.setPosition(x, y, z);
    p.connect(destination);
    return p;
  }

  // world anchor points, provided by the scene when a café loads
  setAnchors({ counter, door }) {
    this.anchors = { counter, door };
  }

  setClinkSpots(spots) { this.clinkSpots = spots; }
  setTypingSpots(spots) { this.typingSpots = spots; }
  setPageSpots(spots) { this.pageSpots = spots; }
  setOccupancy(count, capacity) {
    this.occupancy = count;
    this.capacity = Math.max(1, capacity);
    this._applyAmbienceProfile();
  }

  _duckMusic(level, seconds) {
    if (this.recordedMusic) {
      this.recordedDuck = level;
      this._applyRecordedVolumes();
      this._timer(() => {
        this.recordedDuck = 1;
        this._applyRecordedVolumes();
      }, seconds * 1000);
    }
    if (!this.musicDucker || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicDucker.gain.cancelScheduledValues(t);
    this.musicDucker.gain.setTargetAtTime(level, t, 0.12);
    this.musicDucker.gain.setTargetAtTime(1, t + seconds, 0.55);
  }

  // ---------- volume / theme ----------

  setMusicVolume(v) {
    this.recordedVolume = v;
    this._applyRecordedVolumes();
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }
  setAmbienceVolume(v) {
    if (this.ambienceBus) this.ambienceBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  // scales just the people-talking layers (recorded crowd beds + synth murmur),
  // independent of the rest of the café ambience
  setVoicesVolume(v) {
    this.voicesLevel = v;
    this._applyAmbienceProfile();
  }

  setMusicOn(on) {
    this.musicOn = on;
    if (this.musicMuter) {
      const t = this.ctx.currentTime;
      this.musicMuter.gain.cancelScheduledValues(t);
      this.musicMuter.gain.setTargetAtTime(on ? 1 : 0, t, 0.4);
    }
    this._applyRecordedVolumes();
  }

  setTheme(theme) {
    this.theme = theme;
    if (!this.ctx) return;
    if (theme?.rain) this._startRain(); else this._stopRain();
    if (theme?.birds) this._startBirds(); else this._stopBirds();
    this._setTrafficMix();
    this._applyAmbienceProfile();
    const room = this._profile().room;
    if (room && this.reverb) {
      if (!this._irCache.has(theme.id)) {
        this._irCache.set(theme.id, this._makeImpulseResponse(room.seconds, room.decay));
      }
      this.reverb.buffer = this._irCache.get(theme.id);
      this.reverbGain.gain.setTargetAtTime(room.wet, this.ctx.currentTime, 0.8);
    }
    this.styleId = theme?.id in STYLES ? theme.id : 'goldenhour';
    this.recordTextureGain?.gain.setTargetAtTime(theme?.vinyl ? 1 : theme?.id === 'goldenhour' ? 0.12 : 0.02, this.ctx.currentTime, 1.2);
    if (this._musicStarted) {
      if (this.recordedMusic) {
        if (this._recordThemeId !== theme.id) {
          this._recordThemeId = theme.id;
          this._playRecordedTrack(true);
        }
      } else this._newSong();
    }
  }

  // ---------- buffers ----------

  _makeNoiseBuffer(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeBrownBuffer(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  _makeImpulseResponse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const len = sr * seconds;
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        // early reflections then smooth exponential tail
        const t = i / len;
        const early = i < sr * 0.05 && Math.random() < 0.002 ? rand(0.4, 0.9) : 0;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.35 + early * Math.pow(1 - t, 1.5);
      }
    }
    return buf;
  }

  _noiseSource(buf, loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    return src;
  }

  _timer(fn, ms) {
    let id = null;
    id = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, ms);
    this._timers.add(id);
    return id;
  }

  // Karplus-Strong plucked string, rendered into a buffer
  _pluckBuffer(f, dur = 2, damp = 0.996) {
    const sr = this.ctx.sampleRate;
    const N = Math.max(2, Math.round(sr / f));
    const len = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % N;
      line[idx] = (line[idx] + line[next]) * 0.5 * damp;
      d[i] = line[idx];
      idx = next;
    }
    return buf;
  }

  // ---------- ambience beds ----------

  _startRoomTone() {
    const src = this._noiseSource(this._brownBuf);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = this.ctx.createGain(); g.gain.value = 0.035;
    src.connect(lp).connect(g).connect(this.ambienceBus);
    src.start();
    // fridge/AC hum
    const hum = this.ctx.createOscillator();
    hum.frequency.value = 120; hum.type = 'triangle';
    const hg = this.ctx.createGain(); hg.gain.value = 0.0015;
    hum.connect(hg).connect(this.ambienceBus);
    hum.start();
  }

  _startMurmur() {
    this.murmurGain = this.ctx.createGain();
    this.murmurGain.gain.value = 0.9;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1000;
    this.murmurGain.connect(lp).connect(this.voicesBus);

    for (let v = 0; v < 7; v++) {
      const src = this._noiseSource(this._brownBuf);
      src.playbackRate.value = rand(0.8, 1.25);
      // two formant-ish bands per voice makes it read as speech, not wind
      const f1 = this.ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = rand(160, 380); f1.Q.value = rand(1.5, 2.6);
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = rand(700, 1400); f2.Q.value = rand(2, 4);
      const g1 = this.ctx.createGain(); g1.gain.value = 0;
      const g2 = this.ctx.createGain(); g2.gain.value = 0;
      const mix = this.ctx.createGain(); mix.gain.value = 1;
      src.connect(f1).connect(g1).connect(mix);
      src.connect(f2).connect(g2).connect(mix);
      mix.connect(this.murmurGain);
      src.start(this.ctx.currentTime + rand(0, 1));

      const talk = () => {
        if (!this.ctx) return;
        const talking = Math.random() < 0.6;
        const t = this.ctx.currentTime;
        if (talking) {
          const dur = rand(1.8, 6);
          const syllables = Math.floor(dur * rand(3, 5.5));
          const base = rand(0.03, 0.08);
          for (let s = 0; s < syllables; s++) {
            const st = t + (s / syllables) * dur;
            const a = base * rand(0.5, 1.3);
            g1.gain.setTargetAtTime(a, st, 0.045);
            g1.gain.setTargetAtTime(a * 0.15, st + rand(0.07, 0.16), 0.05);
            g2.gain.setTargetAtTime(a * 0.35, st, 0.03);
            g2.gain.setTargetAtTime(0.002, st + rand(0.05, 0.12), 0.04);
            // slight intonation wander
            f1.frequency.setTargetAtTime(rand(160, 380), st, 0.2);
          }
          this._timer(talk, dur * 1000 + rand(300, 1500));
        } else {
          g1.gain.setTargetAtTime(0.003, t, 0.3);
          g2.gain.setTargetAtTime(0.001, t, 0.3);
          this._timer(talk, rand(1000, 5000));
        }
      };
      this._timer(talk, rand(0, 3000));
    }
  }

  _startVinyl() {
    this.musicMuter = this.ctx.createGain();
    this.musicMuter.gain.value = this.musicOn ? 1 : 0;
    this.musicMuter.connect(this.musicBus);

    this.recordTextureGain = this.ctx.createGain();
    this.recordTextureGain.gain.value = this.theme?.vinyl ? 1 : 0.08;
    this.recordTextureGain.connect(this.musicMuter);

    const hiss = this._noiseSource(this._noiseBuf);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3200;
    const hg = this.ctx.createGain(); hg.gain.value = 0.005;
    hiss.connect(hp).connect(hg).connect(this.recordTextureGain);
    hiss.start();

    const pop = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const src = this._noiseSource(this._noiseBuf, false);
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = rand(1000, 4500); f.Q.value = 1.2;
      g.gain.setValueAtTime(rand(0.015, 0.08), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.02, 0.05));
      src.connect(f).connect(g).connect(this.recordTextureGain);
      src.start(t, rand(0, 1), 0.06);
      this._timer(pop, rand(2600, 9500));
    };
    this._timer(pop, 500);
  }

  // ---------- rain (layered) ----------

  // birdsong for the terrace: short synth chirp phrases, panned around the trees
  _startBirds() {
    if (this.birdsOn) return;
    this.birdsOn = true;
    const chirp = () => {
      if (!this.ctx || !this.birdsOn) return;
      const t = this.ctx.currentTime;
      const notes = Math.floor(rand(2, 6));
      const base = rand(2400, 4200);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      const out = this.ctx.createGain();
      out.gain.value = rand(0.35, 1);
      if (pan) { pan.pan.value = rand(-0.95, 0.95); out.connect(pan).connect(this.ambienceBus); }
      else out.connect(this.ambienceBus);
      let d = 0;
      for (let i = 0; i < notes; i++) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        const f = base * rand(0.9, 1.25);
        o.frequency.setValueAtTime(f, t + d);
        o.frequency.exponentialRampToValueAtTime(f * rand(0.75, 1.35), t + d + rand(0.04, 0.1));
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t + d);
        g.gain.linearRampToValueAtTime(rand(0.006, 0.014), t + d + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + rand(0.07, 0.16));
        o.connect(g).connect(out);
        o.start(t + d); o.stop(t + d + 0.2);
        d += rand(0.08, 0.22);
      }
      this._birdTimer = this._timer(chirp, rand(900, 5200));
    };
    chirp();
  }

  _stopBirds() {
    this.birdsOn = false;
    if (this._birdTimer) {
      clearTimeout(this._birdTimer);
      this._timers.delete(this._birdTimer);
      this._birdTimer = null;
    }
  }

  _mountRecordedRain() {
    const nodes = this.rainNodes;
    const entry = this._buf('rain_window');
    if (!nodes || !entry || nodes.recorded) return;

    // Rain heard from indoors loses sub-bass and the brittle top octave. Two
    // differently offset plays of the same mono buffer create a broad window
    // image without keeping a second decoded buffer in RAM.
    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 65;
    highpass.Q.value = 0.55;
    const throughGlass = this.ctx.createBiquadFilter();
    throughGlass.type = 'lowpass';
    throughGlass.frequency.value = 9200;
    throughGlass.Q.value = 0.35;
    highpass.connect(throughGlass).connect(nodes.master);

    const layerOut = (panValue) => {
      if (!this.ctx.createStereoPanner) return highpass;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = panValue;
      pan.connect(highpass);
      nodes.panners.push(pan);
      return pan;
    };
    const fadeIn = (node) => {
      if (!node) return node;
      const target = node.gain.gain.value;
      const t = this.ctx.currentTime;
      node.gain.gain.setValueAtTime(0, t);
      node.gain.gain.linearRampToValueAtTime(target, t + 2.2);
      return node;
    };
    nodes.recordedSources = [
      fadeIn(this._playBuf('rain_window', {
        out: layerOut(-0.34), vol: 0.5, loop: true, seamless: true, offset: 0.05,
      })),
      fadeIn(this._playBuf('rain_window', {
        out: layerOut(0.38), vol: 0.22, loop: true, seamless: true,
        offset: entry.buffer.duration * 0.43,
      })),
    ].filter(Boolean);
    nodes.highpass = highpass;
    nodes.throughGlass = throughGlass;
    nodes.recorded = true;
    nodes.fallbackGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
  }

  _startRain() {
    if (this.rainNodes) {
      const t = this.ctx.currentTime;
      this.rainNodes.master.gain.cancelScheduledValues(t);
      this.rainNodes.master.gain.setTargetAtTime(1, t, 1.5);
      this._mountRecordedRain();
      return;
    }
    const master = this.ctx.createGain();
    master.gain.value = 0;
    master.connect(this.ambienceBus);
    this.rainNodes = { master, panners: [], recordedSources: [] };

    // This exists only for the brief asset-load window (or an offline asset
    // failure). Keep it subdued and rain-coloured; white hiss and oscillator
    // droplets were the main source of the old digital/noise impression.
    const fallback = this._noiseSource(this._noiseBuf);
    const fallbackTone = this.ctx.createBiquadFilter();
    fallbackTone.type = 'bandpass';
    fallbackTone.frequency.value = 1800;
    fallbackTone.Q.value = 0.42;
    const fallbackGain = this.ctx.createGain();
    fallbackGain.gain.value = 0.028;
    fallback.connect(fallbackTone).connect(fallbackGain).connect(master);
    fallback.start();
    this.rainNodes.fallback = fallback;
    this.rainNodes.fallbackTone = fallbackTone;
    this.rainNodes.fallbackGain = fallbackGain;

    // far-off thunder, rarely — the rain leans in just before the sky answers
    const thunder = () => {
      if (!this.ctx || !this.rainNodes) return;
      if (this.rainNodes.master.gain.value > 0.05 && Math.random() < 0.5) {
        const t0 = this.ctx.currentTime;
        if (this._buf('thunder')) {
          this._playBuf('thunder', {
            out: master, vol: rand(0.32, 0.62), rate: rand(0.88, 1.04),
            when: t0 + rand(3, 4.5),
          });
          this._timer(thunder, rand(35000, 120000));
          return;
        }
        const t = this.ctx.currentTime;
        const src = this._noiseSource(this._brownBuf, false);
        src.loop = true;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(90, t);
        lp.frequency.linearRampToValueAtTime(45, t + 5);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        // keep the synth stand-in soft — at volume it reads as a passing train
        g.gain.linearRampToValueAtTime(rand(0.05, 0.1), t + rand(0.8, 1.6));
        g.gain.setTargetAtTime(0, t + 2.6, 1.2);
        src.connect(lp).connect(g).connect(master);
        src.start(t); src.stop(t + 8);
      }
      this._timer(thunder, rand(35000, 120000));
    };
    this._timer(thunder, 20000);

    master.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5);
    this._mountRecordedRain();
  }

  _stopRain() {
    if (!this.rainNodes) return;
    const t = this.ctx.currentTime;
    this.rainNodes.master.gain.cancelScheduledValues(t);
    this.rainNodes.master.gain.setTargetAtTime(0, t, 0.8);
  }

  // ---------- positional one-shots ----------

  playClink(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = pos ? this._panner(pos.x, 0.9, pos.z, this.foleyBus) : this.foleyBus;
    if (this._buf('cup_clinks')) {
      const entry = this._buf('cup_clinks');
      const offset = pick(CLINK_ONSETS);
      this._playBuf('cup_clinks', {
        out, vol: rand(0.35, 0.7), rate: rand(0.92, 1.1),
        offset: Math.max(0, offset - 0.025),
        dur: Math.min(rand(0.38, 0.7), entry.buffer.duration - offset - 0.02),
      });
      return;
    }
    // porcelain: two detuned high partials + tiny noise transient
    [rand(2100, 2500), rand(3300, 4100)].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(rand(0.01, 0.035), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.12, 0.3));
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.35);
    });
    const n = this._noiseSource(this._noiseBuf, false);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.02, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    n.connect(ng).connect(out);
    n.start(t, rand(0, 1), 0.03);
  }

  playChime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.anchors?.door
      ? this._panner(this.anchors.door.x, 2.2, this.anchors.door.z, this.foleyBus)
      : this.foleyBus;
    if (this._buf('door_open') && Math.random() < 0.8) {
      this._playBuf('door_open', { out, vol: 0.45, rate: rand(0.95, 1.05) });
    }
    if (this._buf('door_bell')) {
      this._playBuf('door_bell', { out, vol: 0.5, rate: rand(0.96, 1.06), when: this.ctx.currentTime + 0.15 });
      return;
    }
    [1190, 1580, 1985].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * rand(0.99, 1.01);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.03 / (i + 1), t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 1.4);
      o.connect(g).connect(out);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 1.5);
    });
  }

  // the full ritual: knock the portafilter, grind, pump, steam
  playEspresso() {
    if (!this.ctx) return;
    const a = this.anchors?.counter;
    const out = a ? this._panner(a.x, 1.1, a.z, this.machineryBus) : this.machineryBus;
    this._duckMusic(0.58, this._buf('espresso') ? 15.8 : 14.5);
    if (this._buf('espresso')) {
      // real machine recording, then real milk steaming, then the cup goes down
      const e = this._buf('espresso');
      this._playBuf('espresso', { out, vol: 0.55, rate: rand(0.97, 1.03) });
      let end = e.buffer.duration;
      if (this._buf('steam_milk')) {
        this._playBuf('steam_milk', { out, vol: 0.5, when: this.ctx.currentTime + end + 0.4 });
        end += this._buf('steam_milk').buffer.duration + 0.4;
      }
      this._timer(() => this.playClink(a), (end + 0.6) * 1000);
      return;
    }
    let t = this.ctx.currentTime + 0.1;

    // two knocks
    for (let k = 0; k < 2; k++) {
      const kt = t + k * 0.28;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(190, kt);
      o.frequency.exponentialRampToValueAtTime(80, kt + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.09, kt);
      g.gain.exponentialRampToValueAtTime(0.001, kt + 0.12);
      o.connect(g).connect(out);
      o.start(kt); o.stop(kt + 0.15);
      const n = this._noiseSource(this._noiseBuf, false);
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'lowpass'; nf.frequency.value = 900;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.05, kt);
      ng.gain.exponentialRampToValueAtTime(0.001, kt + 0.05);
      n.connect(nf).connect(ng).connect(out);
      n.start(kt, rand(0, 1), 0.06);
    }
    t += 0.9;

    // grinder: wobbling band of noise + low motor tone
    const grind = this._noiseSource(this._noiseBuf, false);
    grind.loop = true;
    const gbp = this.ctx.createBiquadFilter();
    gbp.type = 'bandpass'; gbp.Q.value = 1.1;
    gbp.frequency.setValueAtTime(520, t);
    const wob = this.ctx.createOscillator();
    wob.frequency.value = 6.5;
    const wobG = this.ctx.createGain(); wobG.gain.value = 130;
    wob.connect(wobG).connect(gbp.frequency);
    wob.start(t); wob.stop(t + 2.4);
    const gg = this.ctx.createGain();
    gg.gain.setValueAtTime(0, t);
    gg.gain.linearRampToValueAtTime(0.06, t + 0.08);
    gg.gain.setValueAtTime(0.06, t + 2.0);
    gg.gain.linearRampToValueAtTime(0, t + 2.2);
    grind.connect(gbp).connect(gg).connect(out);
    grind.start(t); grind.stop(t + 2.4);
    const motor = this.ctx.createOscillator();
    motor.type = 'sawtooth'; motor.frequency.value = 92;
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(0, t);
    mg.gain.linearRampToValueAtTime(0.012, t + 0.08);
    mg.gain.setValueAtTime(0.012, t + 2.0);
    mg.gain.linearRampToValueAtTime(0, t + 2.2);
    motor.connect(mg).connect(out);
    motor.start(t); motor.stop(t + 2.4);
    t += 3.0;

    // pump / extraction: low hum + gentle trickle
    const pump = this.ctx.createOscillator();
    pump.type = 'triangle'; pump.frequency.value = 52;
    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(0, t);
    pg.gain.linearRampToValueAtTime(0.05, t + 0.2);
    pg.gain.setValueAtTime(0.05, t + 3.4);
    pg.gain.linearRampToValueAtTime(0, t + 3.8);
    pump.connect(pg).connect(out);
    pump.start(t); pump.stop(t + 4);
    const trickle = this._noiseSource(this._noiseBuf, false);
    trickle.loop = true;
    const tf = this.ctx.createBiquadFilter();
    tf.type = 'bandpass'; tf.frequency.value = 2600; tf.Q.value = 2;
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0, t + 0.6);
    tg.gain.linearRampToValueAtTime(0.015, t + 1);
    tg.gain.setTargetAtTime(0, t + 3.2, 0.3);
    trickle.connect(tf).connect(tg).connect(out);
    trickle.start(t + 0.6); trickle.stop(t + 4.2);
    t += 4.2;

    // steam wand: sputtering start, then a screechy milk sweep
    const steam = this._noiseSource(this._noiseBuf, false);
    steam.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2400;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    // sputter: three quick bursts then sustained
    for (let b = 0; b < 3; b++) {
      sg.gain.setValueAtTime(0.05, t + b * 0.18);
      sg.gain.setValueAtTime(0.005, t + b * 0.18 + 0.09);
    }
    sg.gain.linearRampToValueAtTime(0.045, t + 0.7);
    sg.gain.setValueAtTime(0.045, t + 2.6);
    sg.gain.linearRampToValueAtTime(0, t + 3.1);
    steam.connect(hp).connect(sg).connect(out);
    steam.start(t); steam.stop(t + 3.2);
    // milk screech: resonant sweep rising as the milk heats
    const scr = this._noiseSource(this._noiseBuf, false);
    scr.loop = true;
    const sbp = this.ctx.createBiquadFilter();
    sbp.type = 'bandpass'; sbp.Q.value = 12;
    sbp.frequency.setValueAtTime(700, t + 0.8);
    sbp.frequency.exponentialRampToValueAtTime(2300, t + 2.8);
    const scg = this.ctx.createGain();
    scg.gain.setValueAtTime(0, t + 0.8);
    scg.gain.linearRampToValueAtTime(0.02, t + 1.2);
    scg.gain.setTargetAtTime(0, t + 2.6, 0.2);
    scr.connect(sbp).connect(scg).connect(out);
    scr.start(t + 0.8); scr.stop(t + 3.4);

    // a final cup set-down
    this._timer(() => this.playClink(a), (t - this.ctx.currentTime + 3.4) * 1000);
  }

  playChairScrape(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = pos ? this._panner(pos.x, 0.3, pos.z, this.foleyBus) : this.foleyBus;
    if (this._buf('chair_scrape')) {
      this._playBuf('chair_scrape', { out, vol: rand(0.35, 0.6), rate: rand(0.9, 1.1) });
      return;
    }
    const src = this._noiseSource(this._noiseBuf, false);
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 4;
    bp.frequency.setValueAtTime(rand(200, 300), t);
    bp.frequency.linearRampToValueAtTime(rand(350, 500), t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.03, 0.06), t + 0.06);
    g.gain.setTargetAtTime(0, t + 0.28, 0.06);
    src.connect(bp).connect(g).connect(out);
    src.start(t, rand(0, 1)); src.stop(t + 0.6);
  }

  playPageTurn(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = pos ? this._panner(pos.x, 0.9, pos.z, this.foleyBus) : this.foleyBus;
    if (this._buf('page_turn')) {
      this._playBuf('page_turn', { out, vol: rand(0.3, 0.5), rate: rand(0.92, 1.08) });
      return;
    }
    const src = this._noiseSource(this._noiseBuf, false);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(hp).connect(g).connect(out);
    src.start(t, rand(0, 1), 0.35);
  }

  playFootstep(pos, vol = 0.5) {
    if (!this.ctx) return;
    const p = this._profile();
    vol *= p.stepVol;
    const out = pos ? this._panner(pos.x, 0.1, pos.z, this.foleyBus) : this.foleyBus;
    if (this._buf('footsteps')) {
      this._footstepIndex = ((this._footstepIndex ?? Math.floor(rand(0, FOOTSTEP_ONSETS.length))) + 1) % FOOTSTEP_ONSETS.length;
      const offset = FOOTSTEP_ONSETS[this._footstepIndex];
      // Onset-marked step from the walking recording; per-café playback rate
      // supplies floor character without chopping into an impact.
      this._playBuf('footsteps', {
        out, vol: vol * rand(0.7, 1.1), rate: p.stepRate * rand(0.94, 1.08),
        offset: Math.max(0, offset - 0.025), dur: 0.34,
      });
      return;
    }
    // synth fallback: soft heel thump
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(140, 190), t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.04 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.12);
  }

  playCarPass() {
    if (!this.ctx || !this._buf('carpass')) return;
    // a car sweeping across the street outside: pan the panner while it plays
    const front = this.anchors?.door ?? { x: 0, z: 5 };
    const p = this._panner(-16, 1.2, front.z + 2.5, this.exteriorBus);
    const muffle = this.ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 1300;
    muffle.connect(p);
    const entry = this._buf('carpass');
    const rate = rand(0.92, 1.05);
    const dur = entry.buffer.duration / rate;
    const played = this._playBuf('carpass', { out: muffle, vol: 0.5, rate });
    if (played && p.positionX) {
      const t = this.ctx.currentTime;
      const dir = Math.random() < 0.5 ? 1 : -1;
      p.positionX.setValueAtTime(-16 * dir, t);
      p.positionX.linearRampToValueAtTime(16 * dir, t + dur);
    }
  }

  playRegister() {
    if (!this.ctx) return;
    const a = this.anchors?.counter;
    const out = a ? this._panner(a.x + 3.6, 1.1, a.z, this.machineryBus) : this.machineryBus;
    if (this._buf('register')) {
      this._playBuf('register', { out, vol: 0.4, rate: rand(0.97, 1.03) });
      return;
    }
    // synth: two soft beeps + drawer
    const t = this.ctx.currentTime;
    [0, 0.18].forEach((d) => {
      const o = this.ctx.createOscillator();
      o.type = 'square'; o.frequency.value = 1245;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.012, t + d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.09);
      o.connect(g).connect(out);
      o.start(t + d); o.stop(t + d + 0.1);
    });
  }

  playPour(pos) {
    if (!this.ctx || !this._buf('pour')) return;
    const out = pos ? this._panner(pos.x, 1.0, pos.z, this.machineryBus) : this.machineryBus;
    this._playBuf('pour', { out, vol: 0.4, rate: rand(0.95, 1.05) });
  }

  // coffee grinder: motor growl + beans rattling through the burrs
  playGrinder(pos) {
    if (!this.ctx) return;
    const out = pos ? this._panner(pos.x, 1.1, pos.z) : this.ambienceBus;
    if (this._buf('grinder')) {
      this._playBuf('grinder', {
        out, vol: rand(0.3, 0.45), rate: rand(0.95, 1.05),
        randomSlice: true, dur: rand(1.6, 2.6),
      });
      return;
    }
    const t = this.ctx.currentTime;
    const dur = rand(1.4, 2.4);
    const motor = this.ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(82, t);
    motor.frequency.linearRampToValueAtTime(rand(96, 110), t + 0.25);
    motor.frequency.setValueAtTime(88, t + dur - 0.15);
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(0, t);
    mg.gain.linearRampToValueAtTime(0.016, t + 0.08);
    mg.gain.setValueAtTime(0.016, t + dur - 0.12);
    mg.gain.linearRampToValueAtTime(0, t + dur);
    motor.connect(mg).connect(out);
    motor.start(t); motor.stop(t + dur + 0.05);
    const beans = this._noiseSource(this._noiseBuf);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.05, t + 0.12);
    bg.gain.linearRampToValueAtTime(0.02, t + dur * 0.7); // hopper empties out
    bg.gain.linearRampToValueAtTime(0, t + dur);
    beans.connect(bp).connect(bg).connect(out);
    beans.start(t); beans.stop(t + dur + 0.05);
  }

  // dishes being washed behind the counter: a couple of soft ceramic knocks
  playDishes(pos) {
    if (!this.ctx) return;
    const out = pos ? this._panner(pos.x, 0.8, pos.z) : this.ambienceBus;
    if (this._buf('dishes')) {
      // a real sink: porcelain knocks, running water, cutlery
      this._playBuf('dishes', {
        out, vol: rand(0.28, 0.42), rate: rand(0.92, 1.04),
        randomSlice: true, dur: rand(1.6, 3.2),
      });
      return;
    }
    if (this._buf('cup_clinks')) {
      this._playBuf('cup_clinks', {
        out, vol: rand(0.25, 0.45), rate: rand(0.8, 0.92),
        randomSlice: true, dur: rand(1.2, 2.4),
      });
      return;
    }
    let t = this.ctx.currentTime;
    for (let k = 0; k < Math.floor(rand(2, 5)); k++) {
      t += rand(0.1, 0.5);
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = rand(1400, 2600);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(rand(0.006, 0.015), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.12);
    }
  }

  // "order up!" — a bright two-note counter bell when a drink is ready
  playOrderUp(pos) {
    if (!this.ctx) return;
    const out = pos ? this._panner(pos.x, 1.2, pos.z) : this.ambienceBus;
    const t = this.ctx.currentTime;
    [[1560, 0], [2080, 0.16]].forEach(([f, d]) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const o2 = this.ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = f * 2.7; // bell partial
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.02, t + d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.7);
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(0.006, t + d);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
      o.connect(g).connect(out);
      o2.connect(g2).connect(out);
      o.start(t + d); o.stop(t + d + 0.75);
      o2.start(t + d); o2.stop(t + d + 0.35);
    });
  }

  // A distinct focus-timer alarm: two warm three-note strikes that remain
  // audible over the café mix without sounding like a harsh phone buzzer.
  playTimerAlarm() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._duckMusic(0.28, 4.5);
    const start = this.ctx.currentTime + 0.04;
    const notes = [784, 988, 1175];
    for (const repeat of [0, 1.15]) {
      notes.forEach((frequency, index) => {
        const when = start + repeat + index * 0.18;
        const fundamental = this.ctx.createOscillator();
        const overtone = this.ctx.createOscillator();
        fundamental.type = 'sine';
        overtone.type = 'sine';
        fundamental.frequency.value = frequency;
        overtone.frequency.value = frequency * 2.01;
        const gain = this.ctx.createGain();
        const overtoneGain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.075, when);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.05);
        overtoneGain.gain.setValueAtTime(0.018, when);
        overtoneGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
        fundamental.connect(gain).connect(this.master);
        overtone.connect(overtoneGain).connect(this.master);
        fundamental.start(when); fundamental.stop(when + 1.1);
        overtone.start(when); overtone.stop(when + 0.46);
      });
    }
  }

  _typeBurst(pos, volumeScale = 1, trackPlayer = false) {
    if (!this.ctx) return;
    const out = pos ? this._panner(pos.x, 0.9, pos.z, this.foleyBus) : this.foleyBus;
    if (this._buf('typing')) {
      const node = this._playBuf('typing', {
        out, vol: rand(0.2, 0.4) * volumeScale, rate: rand(0.95, 1.05),
        randomSlice: true, dur: rand(1.2, 3),
      });
      if (trackPlayer && node) this._playerTypingNodes = [node.src];
      return;
    }
    let t = this.ctx.currentTime;
    const keys = Math.floor(rand(4, 14));
    const nodes = [];
    for (let k = 0; k < keys; k++) {
      t += rand(0.05, 0.17);
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = rand(1800, 2600);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(rand(0.002, 0.007) * volumeScale, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.02);
      nodes.push(o);
    }
    if (trackPlayer) this._playerTypingNodes = nodes;
  }

  playPlayerTyping(pos) {
    this.stopPlayerTyping();
    // Same spatial and recorded/synth pipeline as NPC laptops, but tucked well
    // underneath the room bed so it reads as the player's nearby keyboard.
    this._typeBurst(pos, 0.34, true);
    this.playerTypingBursts = (this.playerTypingBursts ?? 0) + 1;
  }

  stopPlayerTyping() {
    for (const node of this._playerTypingNodes ?? []) {
      try { node.stop(); } catch { /* source already ended */ }
    }
    this._playerTypingNodes = [];
  }

  _scheduleEvents() {
    const clinks = () => {
      if (this.clinkSpots.length) this.playClink(pick(this.clinkSpots));
      const [a, b] = this._profile().clinkMs;
      this._timer(clinks, rand(a, b));
    };
    // somebody's always washing up behind the counter
    const dishes = () => {
      if (Math.random() < 0.7) {
        const c = this.anchors?.counter;
        this.playDishes(c ? { x: c.x + rand(-1.5, 1.5), z: c.z } : null);
      }
      this._timer(dishes, rand(24000, 70000));
    };
    this._timer(dishes, 15000);
    const typing = () => {
      if (this.typingSpots.length) this._typeBurst(pick(this.typingSpots));
      const [a, b] = this._profile().typeMs;
      this._timer(typing, rand(a, b));
    };
    // human texture: a table breaks into laughter now and then, and once in a
    // while somebody coughs — both from real seated-patron positions
    const laughter = () => {
      if (this._buf('laughter') && this.clinkSpots.length && Math.random() < 0.65) {
        const spot = pick(this.clinkSpots);
        this._playBuf('laughter', {
          out: this._panner(spot.x, 1.1, spot.z, this.voicesBus),
          vol: rand(0.16, 0.3), rate: rand(0.94, 1.06),
          randomSlice: true, dur: rand(2.4, 4.2),
        });
      }
      this._timer(laughter, rand(38000, 95000) / Math.max(0.4, this.occupancy / Math.max(1, this.capacity) + 0.4));
    };
    this._timer(laughter, rand(15000, 35000));
    const cough = () => {
      if (this._buf('cough') && this.clinkSpots.length && Math.random() < 0.5) {
        const spot = pick(this.clinkSpots);
        this._playBuf('cough', {
          out: this._panner(spot.x, 1.1, spot.z, this.voicesBus),
          vol: rand(0.14, 0.24), rate: rand(0.9, 1.08),
          randomSlice: true, dur: rand(1.1, 2.0),
        });
      }
      this._timer(cough, rand(70000, 170000));
    };
    this._timer(cough, rand(30000, 80000));
    const pages = () => {
      if (this.pageSpots.length && Math.random() < 0.65) this.playPageTurn(pick(this.pageSpots));
      this._timer(pages, rand(9000, 25000));
    };
    this._timer(clinks, 4000);
    this._timer(typing, 6000);
    this._timer(pages, 12000);
  }

  // ---------- music engine ----------

  _startMusic() {
    this._musicStarted = true;
    if (MUSIC_MANIFEST[this.styleId]?.length) {
      this._startRecordedMusic();
      return;
    }
    this._startGenerativeMusic();
  }

  _startRecordedMusic() {
    this.recordedMusic = true;
    this._recordThemeId = this.styleId;
    this._recordBags = {};
    this._recordDeckIndex = -1;
    this._musicDecks = [0, 1].map(() => {
      const el = new Audio();
      el.preload = 'metadata';
      el.playsInline = true;
      el.hidden = true;
      document.body.appendChild(el);
      return { el, mix: 0 };
    });
    this._playRecordedTrack(false);
  }

  _nextRecordedTrack(themeId) {
    const pool = MUSIC_MANIFEST[themeId] ?? [];
    if (!pool.length) return null;
    let bag = this._recordBags[themeId];
    if (!bag?.length) {
      bag = pool.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && pool[bag[bag.length - 1]].id === this._lastRecordedId) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      this._recordBags[themeId] = bag;
    }
    const track = pool[bag.pop()];
    this._lastRecordedId = track.id;
    return track;
  }

  async _playRecordedTrack(themeChange = false) {
    if (!this.recordedMusic || !this.ctx) return;
    const themeId = this.styleId || 'goldenhour';
    const track = this._nextRecordedTrack(themeId);
    if (!track) return;
    const token = (this._recordToken ?? 0) + 1;
    this._recordToken = token;
    const oldIndex = this._recordDeckIndex;
    const nextIndex = (oldIndex + 1) % this._musicDecks.length;
    const next = this._musicDecks[nextIndex];
    const old = oldIndex >= 0 ? this._musicDecks[oldIndex] : null;
    const fade = old ? (themeChange ? 4.5 : 7) : 2.2;

    next.mix = 0;
    this._applyRecordedVolumes();
    next.el.src = track.url;
    try {
      await next.el.play();
    } catch (error) {
      // A blocked media element should not leave the café silent: retain the
      // synth playlist as an automatic local fallback.
      console.warn(`[music] recorded playback unavailable (${error?.name}: ${error?.message})`);
      this.recordedMusic = false;
      this._startGenerativeMusic();
      return;
    }
    if (token !== this._recordToken) { next.el.pause(); return; }
    this._recordDeckIndex = nextIndex;
    this._crossfadeRecorded(old, next, fade, oldIndex);

    window.dispatchEvent(new CustomEvent('cafe-track-change', {
      detail: { title: track.title, artist: track.artist, recorded: true },
    }));
    const lead = 7;
    this._timer(() => {
      if (this.recordedMusic && this._recordToken === token) this._playRecordedTrack(false);
    }, Math.max(1000, (track.duration - lead) * 1000));
  }

  _applyRecordedVolumes() {
    if (!this._musicDecks) return;
    const master = (this.musicOn ? 1 : 0) * this.recordedVolume * this.recordedDuck;
    for (const deck of this._musicDecks) deck.el.volume = clamp(deck.mix * master, 0, 1);
  }

  _crossfadeRecorded(old, next, seconds, oldIndex) {
    if (this._recordFadeTimer) clearInterval(this._recordFadeTimer);
    const started = performance.now();
    const oldStart = old?.mix ?? 0;
    const tick = () => {
      const p = clamp((performance.now() - started) / (seconds * 1000), 0, 1);
      next.mix = p;
      if (old) old.mix = oldStart * (1 - p);
      this._applyRecordedVolumes();
      if (p >= 1) {
        clearInterval(this._recordFadeTimer);
        this._recordFadeTimer = null;
        if (old && this._recordDeckIndex !== oldIndex) old.el.pause();
      }
    };
    tick();
    this._recordFadeTimer = setInterval(tick, 50);
  }

  _startGenerativeMusic() {
    this.recordedMusic = false;
    this.styleId = this.theme?.id in STYLES ? this.theme.id : 'goldenhour';
    this._newSong();
    this._nextNoteTime = this.ctx.currentTime + 0.3;
    this.beat = 0;
    this.songPaused = false;

    const scheduler = () => {
      if (!this.ctx) return;
      while (!this.songPaused && this._nextNoteTime < this.ctx.currentTime + 0.25) {
        this._scheduleStep(this.beat, this._nextNoteTime);
        const sw = this.song.swing;
        const swing = this.beat % 2 === 0 ? 1 + sw : 1 - sw;
        this._nextNoteTime += (30 / this.song.bpm) * swing;
        this.beat++;
        // song over? take a breath, then drop a new record on
        if (this.beat >= this.song.totalSteps) {
          this.songPaused = true;
          this.beat = 0;
          this._timer(() => {
            this._newSong();
            this._nextNoteTime = this.ctx.currentTime + 0.2;
            this.songPaused = false;
          }, rand(2500, 5000));
        }
      }
      this._timer(scheduler, 60);
    };
    scheduler();
  }

  _newSong() {
    const pool = STYLES[this.styleId || 'goldenhour'];
    this._styleBags ??= {};
    let bag = this._styleBags[this.styleId];
    if (!bag?.length) {
      bag = pool.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[bag.length - 1] === this._lastStyleIndex) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      this._styleBags[this.styleId] = bag;
    }
    const styleIndex = bag.pop();
    this._lastStyleIndex = styleIndex;
    const style = pool[styleIndex];
    const hasDrums = style.drums !== 'none';
    const prog = pick(style.progressions);
    const progB = pick(style.progressions);
    // sections: intro (sparse) / A / B / A' / outro — A' sometimes modulates up
    const modulate = Math.random() < 0.35 ? 2 : 0;
    const sections = [
      { bars: 4, drums: false, prog, density: 0.5, pad: true, keyShift: 0 },
      { bars: 8, drums: hasDrums, prog, density: 1, pad: false, keyShift: 0 },
      { bars: 8, drums: hasDrums, prog: progB, density: 1.2, pad: style.padChance > 0.4, keyShift: 0 },
      { bars: 8, drums: hasDrums, prog, density: 0.9, pad: false, keyShift: modulate },
      { bars: 4, drums: false, prog, density: 0.4, pad: true, keyShift: modulate },
    ];
    let total = 0;
    for (const s of sections) { s.startStep = total; total += s.bars * 8; }
    this.song = {
      style,
      key: pick(style.key),
      bpm: rand(style.bpm[0], style.bpm[1]),
      swing: style.swing ?? 0.12,
      sections,
      totalSteps: total,
      motif: this._makeMotif(style.scale),
      usePluckComp: Math.random() < style.pluckChance,
    };
    window.dispatchEvent(new CustomEvent('cafe-track-change', {
      detail: { style: style.name, bpm: Math.round(this.song.bpm) },
    }));
  }

  _makeMotif(scale) {
    // a short melodic idea the song keeps returning to, with variations
    const m = [];
    let idx = Math.floor(rand(2, 6));
    for (let i = 0; i < 6; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.round(rand(-2, 2))));
      m.push({ deg: idx, on: Math.random() < 0.7 });
    }
    return m;
  }

  _sectionAt(step) {
    const s = this.song.sections;
    for (let i = s.length - 1; i >= 0; i--) if (step >= s[i].startStep) return s[i];
    return s[0];
  }

  _scheduleStep(step, t) {
    const song = this.song;
    const style = song.style;
    const sec = this._sectionAt(step);
    const stepInSec = step - sec.startStep;
    const eighth = stepInSec % 8;
    const bar = Math.floor(stepInSec / 8);
    const chord = sec.prog[bar % sec.prog.length];
    const root = 60 + song.key + (sec.keyShift || 0);

    // little drum fill at the end of a drummed section
    const sectionEndStep = sec.startStep + sec.bars * 8 - 1;
    if (sec.drums && step === sectionEndStep && Math.random() < 0.7) {
      this._snare(t, 0.03);
      this._snare(t + (30 / song.bpm) * 0.5, 0.045);
    }

    // comping
    if (eighth === 0) {
      if (song.usePluckComp && style.comp === 'pluck') {
        chord.slice(0, 4).forEach((off, i) => {
          this._pluck(root + off, t + i * rand(0.02, 0.05), 0.05);
        });
      } else {
        this._chordRoll(chord, root, t, 0.036 * sec.density);
      }
      if (sec.pad) this._pad(chord, root - 12, t, (30 / song.bpm) * 16);
    }
    // extra comp hit mid-bar for bossa
    if (style.drums === 'bossa' && eighth === 3 && Math.random() < 0.6) {
      chord.slice(1, 4).forEach((off, i) => this._pluck(root + off, t + i * 0.02, 0.03));
    }

    // bass
    this._bassStep(style.bassStyle, chord, root, eighth, bar, t, sec);

    // drums
    if (sec.drums) this._drumStep(style.drums, eighth, t);

    // melody: motif-driven, on the lead instrument
    const dens = style.melodyDensity * sec.density;
    if (eighth % 2 === 1 && Math.random() < dens * 2) {
      const mi = song.motif[(Math.floor(step / 2)) % song.motif.length];
      if (mi.on) {
        const midi = root + 12 + style.scale[mi.deg] + (Math.random() < 0.1 ? 12 : 0);
        if (style.lead === 'pluck') this._pluck(midi, t, 0.05);
        else this._epTone(midi, t, rand(0.5, 1.4), 0.026);
      }
    }
  }

  _bassStep(kind, chord, root, eighth, bar, t, sec) {
    const b = root - 24;
    if (kind === 'walking') {
      // quarter notes wandering through chord tones
      if (eighth % 2 === 0) {
        const tones = [chord[0], chord[1] ?? chord[0] + 3, chord[2] ?? chord[0] + 7, (chord[0] + (Math.random() < 0.5 ? 2 : -1))];
        const note = tones[(eighth / 2 + bar) % tones.length] + (Math.random() < 0.15 ? 12 : 0);
        this._bassNote(b + note, t, 0.9, 0.075, true);
      }
    } else if (kind === 'bossa') {
      if (eighth === 0) this._bassNote(b + chord[0], t, 0.7, 0.08);
      if (eighth === 3) this._bassNote(b + chord[0] + 7, t, 0.5, 0.06);
      if (eighth === 4) this._bassNote(b + chord[0], t, 0.7, 0.07);
    } else if (kind === 'blues') {
      // classic root-5-6-b7 shuffle line, quarter notes
      if (eighth % 2 === 0) {
        const line = [0, 7, 9, 10];
        this._bassNote(b + chord[0] + line[(eighth / 2 + bar * 4) % 4], t, 0.8, 0.08, true);
      }
    } else { // roots
      if (eighth === 0 && Math.random() < 0.9) this._bassNote(b + chord[0], t, 1.2, 0.085);
      if (eighth === 4 && Math.random() < 0.4) this._bassNote(b + chord[0] + (Math.random() < 0.3 ? 7 : 0), t, 0.6, 0.06);
    }
    void sec;
  }

  _drumStep(kind, eighth, t) {
    if (kind === 'lofi') {
      if (eighth === 0 || (eighth === 5 && Math.random() < 0.45)) this._kick(t, 0.11);
      if (eighth === 2 || eighth === 6) this._snare(t, 0.05);
      if (Math.random() < 0.85) this._hat(t, eighth % 2 === 1, 0.02);
    } else if (kind === 'bossa') {
      if (eighth === 0 || eighth === 3 || eighth === 5) this._kick(t, 0.07);
      if (eighth === 2 || eighth === 6) this._rim(t);
      this._shaker(t, eighth % 2 === 0 ? 0.014 : 0.008);
    } else if (kind === 'brush') {
      if (eighth === 0 && Math.random() < 0.8) this._kick(t, 0.05);
      if (eighth === 2 || eighth === 6) this._brushSnare(t);
      if (eighth % 2 === 0) this._ride(t);
    } else if (kind === 'soul') {
      // lazy pocket: kick 1 and the and-of-3, rim on the backbeat
      if (eighth === 0 || (eighth === 5 && Math.random() < 0.35)) this._kick(t, 0.09);
      if (eighth === 2 || eighth === 6) { this._rim(t); this._snare(t, 0.02); }
      if (eighth % 2 === 1 && Math.random() < 0.55) this._hat(t, false, 0.013);
    } else if (kind === 'ride') {
      // uptempo swing: ride carries it, kick feathers
      if (eighth % 2 === 0) this._ride(t);
      if (eighth === 3 || eighth === 7) if (Math.random() < 0.6) this._ride(t);
      if (eighth === 0 && Math.random() < 0.5) this._kick(t, 0.04);
      if ((eighth === 2 || eighth === 6) && Math.random() < 0.6) this._brushSnare(t);
      if (eighth === 2 || eighth === 6) this._hat(t, false, 0.012); // pedal hat
    } else if (kind === 'latin') {
      if (eighth === 0 || eighth === 4) this._kick(t, 0.08);
      if (eighth === 0 || eighth === 3 || eighth === 6) this._rim(t);
      this._shaker(t, eighth % 2 === 0 ? 0.016 : 0.011);
    } else if (kind === 'shaker') {
      // just brushes of percussion under an acoustic tune
      if (eighth === 0 && Math.random() < 0.6) this._kick(t, 0.045);
      this._shaker(t, eighth % 2 === 0 ? 0.011 : 0.006);
    }
    // kind === 'none': silence
  }

  // ---------- instruments ----------

  _epTone(midi, t, dur, vol) {
    const detune = rand(-8, 8);
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.015);
    out.gain.setTargetAtTime(0, t + dur * 0.35, dur * 0.3);
    [[0, 1, 'sine'], [12, 0.26, 'triangle'], [19, 0.08, 'sine'], [28, 0.03, 'sine']].forEach(([off, amt, type]) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq(midi + off);
      o.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.value = amt;
      // subtle tremolo, like a worn rhodes
      const trem = this.ctx.createOscillator();
      trem.frequency.value = rand(4, 6);
      const tg = this.ctx.createGain(); tg.gain.value = amt * 0.18;
      trem.connect(tg).connect(g.gain);
      trem.start(t); trem.stop(t + dur + 1);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 1);
    });
    out.connect(this.musicMuter);
  }

  _chordRoll(chord, root, t, vol) {
    chord.forEach((off, i) => {
      this._epTone(root + off, t + i * rand(0.012, 0.045), rand(1.6, 2.6), vol);
    });
  }

  _pluck(midi, t, vol) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._pluckBuffer(freq(midi), 1.6, 0.995);
    const g = this.ctx.createGain();
    g.gain.value = vol * 1.6; // KS plucks read quieter than their peak suggests
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3800;
    src.connect(lp).connect(g).connect(this.musicMuter);
    src.start(t);
  }

  _pad(chord, root, t, dur) {
    chord.slice(0, 3).forEach((off) => {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq(root + off);
        o.detune.value = det;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012, t + dur * 0.3);
        g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.15);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 900;
        o.connect(lp).connect(g).connect(this.musicMuter);
        o.start(t); o.stop(t + dur * 1.3);
      }
    });
  }

  _bassNote(midi, t, dur, vol, upright = false) {
    const o = this.ctx.createOscillator();
    o.type = upright ? 'triangle' : 'sine';
    o.frequency.value = freq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + (upright ? 0.008 : 0.02));
    g.gain.setTargetAtTime(0, t + dur * 0.5, 0.2);
    o.connect(g).connect(this.musicMuter);
    o.start(t); o.stop(t + dur + 0.8);
    if (upright) {
      // finger thump
      const th = this.ctx.createOscillator();
      th.type = 'sine';
      th.frequency.setValueAtTime(freq(midi) * 2, t);
      th.frequency.exponentialRampToValueAtTime(freq(midi), t + 0.03);
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(vol * 0.5, t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      th.connect(tg).connect(this.musicMuter);
      th.start(t); th.stop(t + 0.1);
    }
  }

  _kick(t, vol) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g).connect(this.musicMuter);
    o.start(t); o.stop(t + 0.3);
  }

  _snare(t, vol) {
    const src = this._noiseSource(this._noiseBuf, false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(bp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.2);
  }

  _brushSnare(t) {
    const src = this._noiseSource(this._noiseBuf, false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.05);
    g.gain.setTargetAtTime(0, t + 0.08, 0.07);
    src.connect(bp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.3);
  }

  _rim(t) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 820;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.02, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g).connect(this.musicMuter);
    o.start(t); o.stop(t + 0.06);
  }

  _hat(t, open, vol) {
    const src = this._noiseSource(this._noiseBuf, false);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(open ? vol * 0.7 : vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.14 : 0.045));
    src.connect(hp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.16);
  }

  _shaker(t, vol) {
    const src = this._noiseSource(this._noiseBuf, false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 1.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(bp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.1);
  }

  _ride(t) {
    const src = this._noiseSource(this._noiseBuf, false);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.008, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(hp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.6);
  }
}
