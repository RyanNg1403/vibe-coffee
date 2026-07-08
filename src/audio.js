// Procedural audio: generated lo-fi music + coffee shop ambience.
// Everything is synthesized with WebAudio — no audio files needed.

const MIDI_A4 = 69;
const freq = (midi) => 440 * Math.pow(2, (midi - MIDI_A4) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class CafeAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.musicOn = true;
    this.theme = null;
    this._timers = [];
  }

  // Must be called from a user gesture.
  start(theme) {
    if (this.started) return;
    this.started = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    // gentle lo-fi lowpass on the whole music bus
    this.musicLP = this.ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 3200;
    this.musicBus.connect(this.musicLP).connect(this.master);

    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.gain.value = 0.7;
    this.ambienceBus.connect(this.master);

    this._noiseBuf = this._makeNoiseBuffer(2);
    this._brownBuf = this._makeBrownBuffer(4);

    this._startVinyl();
    this._startRoomTone();
    this._startMurmur();
    this._scheduleEvents();
    this._startMusic();

    this.setTheme(theme);
  }

  setMusicVolume(v) { if (this.musicBus) this.musicBus.gain.value = v; }
  setAmbienceVolume(v) { if (this.ambienceBus) this.ambienceBus.gain.value = v; }

  setMusicOn(on) {
    this.musicOn = on;
    if (this.musicMuter) {
      const t = this.ctx.currentTime;
      this.musicMuter.gain.cancelScheduledValues(t);
      this.musicMuter.gain.setTargetAtTime(on ? 1 : 0, t, 0.4);
    }
  }

  setTheme(theme) {
    this.theme = theme;
    if (!this.ctx) return;
    // rain layer only for rainy themes
    if (theme && theme.rain) this._startRain(); else this._stopRain();
    if (this.songKey !== undefined && theme) {
      this.songKey = theme.musicKey ?? 0;
    }
  }

  // ---------- helpers ----------

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

  _noiseSource(buf, loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    return src;
  }

  _timer(fn, ms) {
    const id = setTimeout(() => { fn(); }, ms);
    this._timers.push(id);
    return id;
  }

  // ---------- ambience layers ----------

  _startRoomTone() {
    // low rumbly room tone: HVAC + fridge hum feel
    const src = this._noiseSource(this._brownBuf);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0.16;
    src.connect(lp).connect(g).connect(this.ambienceBus);
    src.start();
  }

  _startMurmur() {
    // crowd babble: several band-passed brown-noise "voices",
    // each amplitude-modulated at speech-like rates.
    this.murmurGain = this.ctx.createGain();
    this.murmurGain.gain.value = 0.9;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.murmurGain.connect(lp).connect(this.ambienceBus);

    for (let v = 0; v < 6; v++) {
      const src = this._noiseSource(this._brownBuf);
      src.playbackRate.value = rand(0.85, 1.2);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = rand(170, 420);
      bp.Q.value = rand(1.2, 2.4);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.murmurGain);
      src.start(this.ctx.currentTime + rand(0, 1));

      // speech-rhythm envelope: bursts of "talking", pauses between
      const talk = () => {
        if (!this.ctx) return;
        const talking = Math.random() < 0.65;
        const t = this.ctx.currentTime;
        if (talking) {
          const dur = rand(1.5, 5);
          const syllables = Math.floor(dur * rand(3, 5));
          for (let s = 0; s < syllables; s++) {
            const st = t + (s / syllables) * dur;
            g.gain.setTargetAtTime(rand(0.02, 0.075), st, 0.04);
            g.gain.setTargetAtTime(rand(0.005, 0.02), st + rand(0.06, 0.14), 0.05);
          }
          this._timer(talk, dur * 1000 + rand(200, 1200));
        } else {
          g.gain.setTargetAtTime(0.004, t, 0.3);
          this._timer(talk, rand(800, 4000));
        }
      };
      this._timer(talk, rand(0, 2500));
    }
  }

  _startVinyl() {
    // hiss + pops, part of the music bus so it mutes with music
    this.musicMuter = this.ctx.createGain();
    this.musicMuter.gain.value = this.musicOn ? 1 : 0;
    this.musicMuter.connect(this.musicBus);

    const hiss = this._noiseSource(this._noiseBuf);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.006;
    hiss.connect(hp).connect(hg).connect(this.musicMuter);
    hiss.start();

    const pop = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const src = this._noiseSource(this._noiseBuf, false);
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = rand(1200, 4500);
      f.Q.value = 1;
      g.gain.setValueAtTime(rand(0.02, 0.09), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(f).connect(g).connect(this.musicMuter);
      src.start(t, rand(0, 1), 0.05);
      this._timer(pop, rand(150, 2200));
    };
    this._timer(pop, 500);
  }

  _startRain() {
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(0.32, this.ctx.currentTime, 1.5);
      return;
    }
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    const src = this._noiseSource(this._noiseBuf);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5500;
    bp.Q.value = 0.4;
    src.connect(bp).connect(this.rainGain).connect(this.ambienceBus);
    src.start();
    // slow swell LFO
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.05;
    lfo.connect(lfoG).connect(this.rainGain.gain);
    lfo.start();
    this.rainGain.gain.setTargetAtTime(0.32, this.ctx.currentTime, 1.5);
  }

  _stopRain() {
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
  }

  // ---------- one-shot café sounds ----------

  playClink() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = rand(1800, 3400);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(rand(0.015, 0.05), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.08, 0.2));
    o.connect(g).connect(this.ambienceBus);
    o.start(t); o.stop(t + 0.25);
  }

  playChime() {
    // door bell when someone walks in
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [rand(1150, 1250), rand(1520, 1620)].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.035, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.9);
      o.connect(g).connect(this.ambienceBus);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 1);
    });
  }

  playEspresso() {
    // grinder burst then steam hiss
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const grind = this._noiseSource(this._noiseBuf, false);
    grind.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.linearRampToValueAtTime(700, t + 1.4);
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.1);
    g.gain.setValueAtTime(0.055, t + 1.3);
    g.gain.linearRampToValueAtTime(0, t + 1.5);
    grind.connect(bp).connect(g).connect(this.ambienceBus);
    grind.start(t); grind.stop(t + 1.6);

    const steam = this._noiseSource(this._noiseBuf, false);
    steam.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2800;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0, t + 2);
    sg.gain.linearRampToValueAtTime(0.04, t + 2.2);
    sg.gain.setTargetAtTime(0, t + 3.6, 0.25);
    steam.connect(hp).connect(sg).connect(this.ambienceBus);
    steam.start(t + 2); steam.stop(t + 4.6);
  }

  _scheduleEvents() {
    const clinks = () => { this.playClink(); this._timer(clinks, rand(4000, 16000)); };
    const espresso = () => { this.playEspresso(); this._timer(espresso, rand(25000, 70000)); };
    this._timer(clinks, 3000);
    this._timer(espresso, 9000);
  }

  // ---------- lo-fi music ----------

  _startMusic() {
    this.songKey = this.theme?.musicKey ?? 0;
    this.bpm = 74;
    this.beat = 0; // running 8th-note counter
    this._nextNoteTime = this.ctx.currentTime + 0.2;

    // chord progressions as semitone offsets from key root (C=60)
    this.progressions = [
      // Fmaj7 Em7 Dm7 Cmaj7 feel
      [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]],
      // Am7 Fmaj7 Cmaj7 G7 feel
      [[-3, 0, 4, 7], [5, 9, 12, 16], [0, 4, 7, 11], [-5, -1, 2, 5]],
    ];
    this.progression = pick(this.progressions);
    this.barInProg = 0;

    const scheduler = () => {
      if (!this.ctx) return;
      while (this._nextNoteTime < this.ctx.currentTime + 0.25) {
        this._scheduleStep(this.beat, this._nextNoteTime);
        const swing = this.beat % 2 === 0 ? 1.12 : 0.88; // swung 8ths
        this._nextNoteTime += (30 / this.bpm) * swing;
        this.beat++;
      }
      this._timer(scheduler, 60);
    };
    scheduler();
  }

  _scheduleStep(step, t) {
    const eighth = step % 8;      // position in bar (4/4, 8ths)
    const bar = Math.floor(step / 8);

    if (eighth === 0) {
      this.barInProg = bar % this.progression.length;
      // new chord each bar
      const chord = this.progression[this.barInProg];
      this._playChord(chord, t);
      if (Math.random() < 0.85) this._playBass(chord[0] - 12, t);
    }
    if (eighth === 4 && Math.random() < 0.4) {
      const chord = this.progression[this.barInProg];
      this._playBass(chord[0] - 12 + (Math.random() < 0.3 ? 7 : 0), t, 0.5);
    }

    // drums
    if (eighth === 0 || (eighth === 5 && Math.random() < 0.5)) this._kick(t);
    if (eighth === 2 || eighth === 6) this._snare(t);
    if (Math.random() < 0.8) this._hat(t, eighth % 2 === 1);

    // sparse melody on off-beats
    if (Math.random() < 0.16) {
      const scale = [0, 2, 4, 7, 9, 12, 14, 16]; // major pentatonic-ish
      this._playKeyNote(60 + this.songKey + pick(scale) + 12, t, rand(0.4, 1.2), 0.028);
    }
  }

  _epTone(midi, t, dur, vol) {
    // electric-piano-ish: sine + soft octave partial, slight random detune (tape wobble)
    const detune = rand(-9, 9);
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.015);
    out.gain.setTargetAtTime(0, t + dur * 0.35, dur * 0.3);
    [[0, 1], [12, 0.28], [19, 0.09]].forEach(([off, amt]) => {
      const o = this.ctx.createOscillator();
      o.type = off === 0 ? 'sine' : 'triangle';
      o.frequency.value = freq(midi + off);
      o.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.value = amt;
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 1);
    });
    out.connect(this.musicMuter);
  }

  _playChord(chord, t) {
    const root = 60 + this.songKey;
    // roll the chord slightly, like a relaxed player
    chord.forEach((off, i) => {
      this._epTone(root + off, t + i * rand(0.01, 0.04), rand(1.6, 2.4), 0.038);
    });
  }

  _playKeyNote(midi, t, dur, vol) { this._epTone(midi, t, dur, vol); }

  _playBass(off, t, dur = 1.1) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq(48 + this.songKey + off);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.setTargetAtTime(0, t + dur * 0.5, 0.25);
    o.connect(g).connect(this.musicMuter);
    o.start(t); o.stop(t + dur + 0.8);
  }

  _kick(t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.musicMuter);
    o.start(t); o.stop(t + 0.3);
  }

  _snare(t) {
    const src = this._noiseSource(this._noiseBuf, false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(bp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.2);
  }

  _hat(t, open) {
    const src = this._noiseSource(this._noiseBuf, false);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = this.ctx.createGain();
    const v = open ? 0.016 : 0.024;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.12 : 0.04));
    src.connect(hp).connect(g).connect(this.musicMuter);
    src.start(t, rand(0, 1), 0.15);
  }
}
