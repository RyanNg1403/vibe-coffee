// Loads the recorded sound library (see public/sounds + soundManifest.js).
// Every asset is optional: anything that fails to fetch or decode is simply
// absent from the map, and the synth engine covers for it.
//
// Assets arrive at wildly different recording levels, so each buffer is
// loudness-analyzed on load and given an auto gain that brings it to a
// common RMS target (peak-limited so nothing clips).

function analyze(buffer) {
  let sum = 0, peak = 0;
  const stride = Math.max(1, Math.floor(buffer.length / 200000)); // sample large files
  let n = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i += stride) {
      const v = d[i];
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
      n++;
    }
  }
  return { rms: Math.sqrt(sum / Math.max(1, n)), peak };
}

const BED_KEYS = new Set(['chatter', 'chatter2', 'chatter_busy', 'chatter_quiet']);
const EXTERIOR_KEYS = new Set(['traffic_day', 'traffic_night', 'rain_window']);
const MACHINE_KEYS = new Set(['espresso', 'steam_milk', 'pour', 'grinder', 'dishes']);
const HUMAN_BG_KEYS = new Set(['laughter', 'cough']); // sit under the chatter bed
const LONG_ONE_SHOTS = new Set(['carpass', 'espresso', 'footsteps', 'thunder', 'typing', 'grinder', 'dishes']);

function decodeRate(key, contextRate) {
  if (BED_KEYS.has(key) || EXTERIOR_KEYS.has(key) || LONG_ONE_SHOTS.has(key)) return 24000;
  return Math.min(32000, contextRate);
}

function targetRms(key, def) {
  if (def.targetRms) return def.targetRms;
  if (BED_KEYS.has(key)) return 0.075;
  if (EXTERIOR_KEYS.has(key)) return 0.055;
  if (MACHINE_KEYS.has(key)) return 0.1;
  if (HUMAN_BG_KEYS.has(key)) return 0.065;
  return 0.115;
}

// data: URIs must bypass fetch(): strict CSPs (like the Claude artifact
// sandbox) refuse fetch on data URLs, but plain base64 decoding is just JS.
function dataUriToArrayBuffer(uri) {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function loadSoundLibrary(ctx, manifest, onLoaded) {
  const buffers = new Map();
  const decoderContexts = new Map();
  await Promise.all(Object.entries(manifest).map(async ([key, def]) => {
    try {
      let ab;
      if (def.url.startsWith('data:')) {
        ab = dataUriToArrayBuffer(def.url);
      } else {
        const res = await fetch(def.url);
        if (!res.ok) throw new Error(`http ${res.status}`);
        ab = await res.arrayBuffer();
      }
      // AudioContext.decodeAudioData() otherwise resamples every file to the
      // output device (usually 48 kHz), undoing the RAM benefit of our 24 kHz
      // ambience masters. Decode through a rate-specific OfflineAudioContext;
      // AudioBufferSourceNode resamples the compact buffer only while playing.
      const rate = def.decodeRate ?? decodeRate(key, ctx.sampleRate);
      let decoder = decoderContexts.get(rate);
      if (!decoder) {
        const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        decoder = OfflineContext ? new OfflineContext(1, 1, rate) : ctx;
        decoderContexts.set(rate, decoder);
      }
      const buf = await decoder.decodeAudioData(ab);
      const { rms, peak } = analyze(buf);
      let gain = rms > 0.0001 ? targetRms(key, def) / rms : 1;
      gain = Math.min(gain, 6, peak > 0.0001 ? 0.95 / peak : 6);
      buffers.set(key, { buffer: buf, ...def, gain: gain * (def.trim ?? 1) });
      onLoaded?.(key, buf);
    } catch (e) {
      console.warn(`[sounds] "${key}" unavailable (${e.message}) — synth fallback`);
    }
  }));
  return buffers;
}
