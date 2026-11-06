import { createRandom } from './random.js';

// Physically driven impact sounds. Each material is a handful of damped
// resonant modes plus a short filtered noise transient (the contact click).
// Impact speed sets loudness, brightness and ring time, so a gentle knock
// and a hard bump on the same table sound like the same object. Voices go
// through the café's HRTF panners and foley bus, so they share its reverb,
// sliders and master mute.

export const IMPACT_MATERIALS = Object.freeze({
  // tabletop/counter: low body modes, soft contact
  wood: { modes: [[172, 0.11], [395, 0.07], [890, 0.035], [1630, 0.015]], noise: [1100, 1.1, 0.05], ring: 0.13 },
  // a mug or saucer rattling on its base
  ceramic: { modes: [[2250, 0.045], [3480, 0.032], [5150, 0.018]], noise: [5200, 2.5, 0.03], ring: 0.2 },
  // book or laptop settling: dull, short
  soft: { modes: [[140, 0.06], [310, 0.035]], noise: [700, 0.8, 0.05], ring: 0.07 },
  // glazed door leaf: wooden frame thud plus a glass shiver
  door: { modes: [[92, 0.13], [205, 0.08], [540, 0.03], [1880, 0.02], [2930, 0.014]], noise: [800, 0.9, 0.06], ring: 0.22 },
});

const MAX_VOICES = 10;
const random = createRandom(0x51ed270b);
const MIN_GAP = 0.035; // seconds between voices of one material

export function impactLoudness(speed, reference = 1.2) {
  if (!(speed > 0)) return 0;
  // perceived loudness grows roughly with the square root of impact energy
  return Math.min(1, Math.pow(speed / reference, 1.1));
}

export class ImpactAudio {
  constructor(audio) {
    this.audio = audio;
    this.voices = 0;
    this.played = 0;
    this._lastAt = new Map();
  }

  get ready() {
    return !!(this.audio?.started && this.audio.ctx && this.audio.foleyBus);
  }

  play(material, position, intensity, y = 0.85) {
    if (!this.ready || !(intensity > 0.02)) return false;
    const spec = IMPACT_MATERIALS[material] ?? IMPACT_MATERIALS.wood;
    const audio = this.audio;
    const ctx = audio.ctx;
    const now = ctx.currentTime;
    if (this.voices >= MAX_VOICES) return false;
    if (now - (this._lastAt.get(material) ?? -1) < MIN_GAP) return false;
    // keep inaudible far-away impacts out of the audio graph entirely
    const listener = audio._listenerPos;
    if (listener && position) {
      const dx = position.x - listener.x;
      const dz = position.z - listener.z;
      if (dx * dx + dz * dz > 22 * 22) return false;
    }
    this._lastAt.set(material, now);
    const level = Math.min(1, intensity);
    const out = position && audio._panner
      ? audio._panner(position.x, position.y ?? y, position.z, audio.foleyBus)
      : audio.foleyBus;
    const gainScale = Math.pow(level, 1.3);
    const ring = spec.ring * (0.55 + level * 0.9);
    const stopAt = now + ring * 2.2 + 0.05;
    let pending = 0;
    const release = () => {
      pending -= 1;
      if (pending > 0) return;
      this.voices = Math.max(0, this.voices - 1);
      if (out !== audio.foleyBus) out.disconnect();
    };
    this.voices += 1;
    this.played += 1;
    const detune = 1 + (random() - 0.5) * 0.08;
    spec.modes.forEach(([frequency, amplitude], index) => {
      // harder hits excite the upper modes more strongly
      const brightness = index === 0 ? 1 : 0.35 + level * 0.65;
      const peak = amplitude * gainScale * brightness;
      if (peak < 0.0004) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency * detune * (1 + (random() - 0.5) * 0.03);
      const env = ctx.createGain();
      const decay = ring * Math.sqrt(spec.modes[0][0] / frequency) * 1.4;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peak, now + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.004 + decay);
      osc.connect(env).connect(out);
      pending += 1;
      osc.addEventListener('ended', () => { env.disconnect(); release(); }, { once: true });
      osc.start(now);
      osc.stop(stopAt);
    });
    if (audio._noiseBuf) {
      const [frequency, q, amplitude] = spec.noise;
      const noise = ctx.createBufferSource();
      noise.buffer = audio._noiseBuf;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = frequency * (0.7 + level * 0.6);
      band.Q.value = q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(amplitude * gainScale, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.012 + level * 0.012);
      noise.connect(band).connect(env).connect(out);
      pending += 1;
      noise.addEventListener('ended', () => { band.disconnect(); env.disconnect(); release(); }, { once: true });
      noise.start(now, random() * 1.5, 0.04);
    }
    if (pending === 0) release();
    return true;
  }
}
