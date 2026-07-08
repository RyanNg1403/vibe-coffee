// Loads the recorded sound library (see public/sounds + soundManifest.js).
// Every asset is optional: anything that fails to fetch or decode is simply
// absent from the map, and the synth engine covers for it.
//
// Assets arrive at wildly different recording levels, so each buffer is
// loudness-analyzed on load and given an auto gain that brings it to a
// common RMS target (peak-limited so nothing clips).

function analyze(buffer) {
  const d = buffer.getChannelData(0);
  let sum = 0, peak = 0;
  const stride = Math.max(1, Math.floor(d.length / 200000)); // sample large files
  let n = 0;
  for (let i = 0; i < d.length; i += stride) {
    const v = d[i];
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
    n++;
  }
  return { rms: Math.sqrt(sum / Math.max(1, n)), peak };
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
  const TARGET_RMS = 0.14;
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
      const buf = await ctx.decodeAudioData(ab);
      const { rms, peak } = analyze(buf);
      let gain = rms > 0.0001 ? TARGET_RMS / rms : 1;
      gain = Math.min(gain, 6, peak > 0.0001 ? 0.95 / peak : 6);
      buffers.set(key, { buffer: buf, ...def, gain: gain * (def.trim ?? 1) });
      onLoaded?.(key, buf);
    } catch (e) {
      console.warn(`[sounds] "${key}" unavailable (${e.message}) — synth fallback`);
    }
  }));
  return buffers;
}
