// Procedural audio v2: positional café soundscape + generative music engine.
// Everything is synthesized with WebAudio — no audio files anywhere.
//
// Realism techniques used here:
//  - a ConvolverNode with a procedurally generated impulse response puts
//    every sound "inside the room"
//  - PannerNodes + the AudioContext listener give true 3D positions: the
//    espresso machine sounds from the counter, the chime from the door,
//    clinks from whichever table they happen at
//  - events are multi-stage (knock -> grind -> pump -> steam) instead of
//    single noise bursts

const MIDI_A4 = 69;
const freq = (midi) => 440 * Math.pow(2, (midi - MIDI_A4) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- per-café music styles ----------

const STYLES = {
  goldenhour: {
    bpm: [68, 80], key: [-2, 0, 2, 3],
    progressions: [
      [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]],   // IVmaj7 iii7 ii7 Imaj7
      [[-3, 0, 4, 7], [5, 9, 12, 16], [0, 4, 7, 11], [-5, -1, 2, 5]],   // vi IV I V7
      [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]],  // I vi IV V
      [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [0, 4, 7, 11]],   // ii V I I
    ],
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    drums: 'lofi', lead: 'ep', comp: 'ep', pluckChance: 0.5, padChance: 0.35,
    bassStyle: 'roots', melodyDensity: 0.16,
  },
  roastery: {
    bpm: [86, 98], key: [0, 2, 5, 7],
    progressions: [
      [[0, 4, 7, 11], [2, 5, 9, 12], [4, 7, 11, 14], [2, 5, 9, 12]],
      [[5, 9, 12, 16], [4, 8, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]],
      [[0, 4, 7, 11], [0, 3, 7, 10], [5, 9, 12, 16], [5, 8, 12, 15]],   // maj -> min color shifts
    ],
    scale: [0, 2, 4, 7, 9, 11, 12, 14],
    drums: 'bossa', lead: 'pluck', comp: 'pluck', pluckChance: 1, padChance: 0.15,
    bassStyle: 'bossa', melodyDensity: 0.2,
  },
  midnight: {
    bpm: [56, 66], key: [-5, -3, -1],
    progressions: [
      [[0, 3, 7, 10, 14], [5, 8, 12, 15], [-2, 2, 5, 8], [0, 3, 7, 10]],       // minor 9 colors
      [[0, 3, 7, 10], [-4, 0, 3, 7], [-2, 1, 5, 8], [-7, -3, 0, 3]],
      [[0, 3, 7, 10, 14], [0, 3, 7, 10, 14], [-4, -1, 3, 6], [-2, 2, 5, 9]],
    ],
    scale: [0, 3, 5, 7, 10, 12, 15, 17],
    drums: 'brush', lead: 'ep', comp: 'ep', pluckChance: 0.2, padChance: 0.6,
    bassStyle: 'walking', melodyDensity: 0.12,
  },
};

export class CafeAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.musicOn = true;
    this.theme = null;
    this._timers = [];
    this.clinkSpots = [];   // world positions where seated people are
    this.typingSpots = [];  // world positions of laptop users
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
    this.reverb.buffer = this._makeImpulseResponse(1.7, 3.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 3400;
    this.musicBus.connect(this.musicLP).connect(this.master);
    // a touch of room on the music too
    const musVerbSend = ctx.createGain();
    musVerbSend.gain.value = 0.12;
    this.musicLP.connect(musVerbSend).connect(this.reverb);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.7;
    this.ambienceBus.connect(this.master);
    this.ambVerbSend = ctx.createGain();
    this.ambVerbSend.gain.value = 0.35;
    this.ambienceBus.connect(this.ambVerbSend).connect(this.reverb);

    this._noiseBuf = this._makeNoiseBuffer(2);
    this._brownBuf = this._makeBrownBuffer(4);

    this._startVinyl();
    this._startRoomTone();
    this._startMurmur();
    this._scheduleEvents();
    this._startMusic();
    this.setTheme(theme);
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

  _panner(x, y, z) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'linear';
    p.refDistance = 1.5;
    p.maxDistance = 22;
    p.rolloffFactor = 1;
    p.positionX?.setValueAtTime(x, this.ctx.currentTime);
    p.positionY?.setValueAtTime(y, this.ctx.currentTime);
    p.positionZ?.setValueAtTime(z, this.ctx.currentTime);
    if (!p.positionX && p.setPosition) p.setPosition(x, y, z);
    p.connect(this.ambienceBus);
    return p;
  }

  // world anchor points, provided by the scene when a café loads
  setAnchors({ counter, door }) {
    this.anchors = { counter, door };
  }

  setClinkSpots(spots) { this.clinkSpots = spots; }
  setTypingSpots(spots) { this.typingSpots = spots; }

  // ---------- volume / theme ----------

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
    if (theme?.rain) this._startRain(); else this._stopRain();
    this.styleId = theme?.id in STYLES ? theme.id : 'goldenhour';
    this._newSong(); // switching cafés changes the record
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
    const id = setTimeout(fn, ms);
    this._timers.push(id);
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
    const g = this.ctx.createGain(); g.gain.value = 0.14;
    src.connect(lp).connect(g).connect(this.ambienceBus);
    src.start();
    // fridge/AC hum
    const hum = this.ctx.createOscillator();
    hum.frequency.value = 120; hum.type = 'triangle';
    const hg = this.ctx.createGain(); hg.gain.value = 0.006;
    hum.connect(hg).connect(this.ambienceBus);
    hum.start();
  }

  _startMurmur() {
    this.murmurGain = this.ctx.createGain();
    this.murmurGain.gain.value = 0.9;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1000;
    this.murmurGain.connect(lp).connect(this.ambienceBus);

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

    const hiss = this._noiseSource(this._noiseBuf);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3200;
    const hg = this.ctx.createGain(); hg.gain.value = 0.005;
    hiss.connect(hp).connect(hg).connect(this.musicMuter);
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
      src.connect(f).connect(g).connect(this.musicMuter);
      src.start(t, rand(0, 1), 0.06);
      this._timer(pop, rand(180, 2600));
    };
    this._timer(pop, 500);
  }

  // ---------- rain (layered) ----------

  _startRain() {
    if (this.rainNodes) {
      this.rainNodes.master.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5);
      return;
    }
    const master = this.ctx.createGain();
    master.gain.value = 0;
    master.connect(this.ambienceBus);
    this.rainNodes = { master };

    // wash layer: broadband hiss shaped like distant rain
    const wash = this._noiseSource(this._noiseBuf);
    const washBP = this.ctx.createBiquadFilter();
    washBP.type = 'bandpass'; washBP.frequency.value = 4800; washBP.Q.value = 0.3;
    const washG = this.ctx.createGain(); washG.gain.value = 0.2;
    wash.connect(washBP).connect(washG).connect(master);
    wash.start();

    // mid patter: lower band with jittery gain — the "on the awning" texture
    const patter = this._noiseSource(this._noiseBuf);
    patter.playbackRate.value = 0.7;
    const patBP = this.ctx.createBiquadFilter();
    patBP.type = 'bandpass'; patBP.frequency.value = 1400; patBP.Q.value = 0.8;
    const patG = this.ctx.createGain(); patG.gain.value = 0.05;
    patter.connect(patBP).connect(patG).connect(master);
    patter.start();
    const jitter = () => {
      if (!this.ctx || !this.rainNodes) return;
      patG.gain.setTargetAtTime(rand(0.03, 0.09), this.ctx.currentTime, 0.4);
      this._timer(jitter, rand(600, 2400));
    };
    jitter();

    // individual droplets ticking on the window glass
    const drop = () => {
      if (!this.ctx || !this.rainNodes || this.rainNodes.master.gain.value < 0.05) {
        this._timer(drop, 800); return;
      }
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(rand(3200, 6800), t);
      o.frequency.exponentialRampToValueAtTime(rand(1800, 3000), t + 0.02);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(rand(0.004, 0.02), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.015, 0.05));
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = rand(-0.9, 0.9);
        o.connect(g).connect(pan).connect(master);
      } else {
        o.connect(g).connect(master);
      }
      o.start(t); o.stop(t + 0.08);
      this._timer(drop, rand(30, 350));
    };
    drop();

    // far-off thunder, rarely
    const thunder = () => {
      if (!this.ctx || !this.rainNodes) return;
      if (this.rainNodes.master.gain.value > 0.05 && Math.random() < 0.5) {
        const t = this.ctx.currentTime;
        const src = this._noiseSource(this._brownBuf, false);
        src.loop = true;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(90, t);
        lp.frequency.linearRampToValueAtTime(45, t + 5);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(rand(0.1, 0.2), t + rand(0.4, 1.2));
        g.gain.setTargetAtTime(0, t + 2.2, 1.4);
        src.connect(lp).connect(g).connect(master);
        src.start(t); src.stop(t + 8);
      }
      this._timer(thunder, rand(35000, 120000));
    };
    this._timer(thunder, 20000);

    master.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5);
  }

  _stopRain() {
    if (this.rainNodes) this.rainNodes.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
  }

  // ---------- positional one-shots ----------

  playClink(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = pos ? this._panner(pos.x, 0.9, pos.z) : this.ambienceBus;
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
      ? this._panner(this.anchors.door.x, 2.2, this.anchors.door.z)
      : this.ambienceBus;
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
    const out = a ? this._panner(a.x, 1.1, a.z) : this.ambienceBus;
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
    const out = pos ? this._panner(pos.x, 0.3, pos.z) : this.ambienceBus;
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
    const out = pos ? this._panner(pos.x, 0.9, pos.z) : this.ambienceBus;
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

  _typeBurst(pos) {
    if (!this.ctx) return;
    const out = pos ? this._panner(pos.x, 0.9, pos.z) : this.ambienceBus;
    let t = this.ctx.currentTime;
    const keys = Math.floor(rand(4, 14));
    for (let k = 0; k < keys; k++) {
      t += rand(0.05, 0.17);
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = rand(1800, 2600);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(rand(0.002, 0.007), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.02);
    }
  }

  _scheduleEvents() {
    const clinks = () => {
      const spot = this.clinkSpots.length ? pick(this.clinkSpots) : null;
      this.playClink(spot);
      this._timer(clinks, rand(5000, 18000));
    };
    const typing = () => {
      if (this.typingSpots.length) this._typeBurst(pick(this.typingSpots));
      this._timer(typing, rand(1500, 7000));
    };
    const pages = () => {
      const spot = this.clinkSpots.length ? pick(this.clinkSpots) : null;
      if (Math.random() < 0.5) this.playPageTurn(spot);
      this._timer(pages, rand(9000, 25000));
    };
    const scrapes = () => {
      if (Math.random() < 0.4) this.playChairScrape(this.clinkSpots.length ? pick(this.clinkSpots) : null);
      this._timer(scrapes, rand(20000, 60000));
    };
    this._timer(clinks, 4000);
    this._timer(typing, 6000);
    this._timer(pages, 12000);
    this._timer(scrapes, 30000);
  }

  // ---------- music engine ----------

  _startMusic() {
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
    const style = STYLES[this.styleId || 'goldenhour'];
    const prog = pick(style.progressions);
    const progB = pick(style.progressions);
    // sections: intro (sparse) / A / B / A / outro (drums fade)
    const sections = [
      { bars: 4, drums: false, prog, density: 0.5, pad: true },
      { bars: 8, drums: true, prog, density: 1, pad: false },
      { bars: 8, drums: true, prog: progB, density: 1.2, pad: style.padChance > 0.4 },
      { bars: 8, drums: true, prog, density: 0.9, pad: false },
      { bars: 4, drums: false, prog, density: 0.4, pad: true },
    ];
    let total = 0;
    for (const s of sections) { s.startStep = total; total += s.bars * 8; }
    this.song = {
      style,
      key: pick(style.key),
      bpm: rand(style.bpm[0], style.bpm[1]),
      swing: this.styleId === 'roastery' ? 0.06 : 0.13,
      sections,
      totalSteps: total,
      motif: this._makeMotif(style.scale),
      usePluckComp: Math.random() < style.pluckChance,
    };
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
    const root = 60 + song.key;

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
    }
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
    g.gain.value = vol;
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
