// Frame-accurate MP3 trimmer, pure JS (no ffmpeg).
// Walks MPEG audio frames and copies only those inside [start, start+duration].
// Usage: node tools/trim-mp3.mjs <in.mp3> <out.mp3> <startSec> <durationSec>
import { readFileSync, writeFileSync } from 'fs';

const [inFile, outFile, startArg, durArg] = process.argv.slice(2);
const startSec = parseFloat(startArg ?? '0');
const durSec = parseFloat(durArg ?? '30');

const buf = readFileSync(inFile);
let pos = 0;

// skip ID3v2 tag if present
if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  pos = 10 + size;
}

const BITRATES = { // kbps, [MPEG1 L3, MPEG2/2.5 L3]
  1: [32, 8], 2: [40, 16], 3: [48, 24], 4: [56, 32], 5: [64, 40], 6: [80, 48],
  7: [96, 56], 8: [112, 64], 9: [128, 80], 10: [160, 96], 11: [192, 112],
  12: [224, 128], 13: [256, 144], 14: [320, 160],
};
const SAMPLE_RATES = { 3: [44100, 22050, 11025], 2: [22050, 11025, 5512], 0: [11025, 5512, 2756] };

let t = 0;
const kept = [];
let frames = 0, keptFrames = 0;

while (pos + 4 <= buf.length) {
  if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) { pos++; continue; }
  const verBits = (buf[pos + 1] >> 3) & 0x3;      // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (buf[pos + 1] >> 1) & 0x3;    // 1=Layer3
  const brIdx = (buf[pos + 2] >> 4) & 0xf;
  const srIdx = (buf[pos + 2] >> 2) & 0x3;
  const padding = (buf[pos + 2] >> 1) & 0x1;
  if (layerBits !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3 || !(verBits in SAMPLE_RATES)) { pos++; continue; }
  const mpeg1 = verBits === 3;
  const bitrate = BITRATES[brIdx][mpeg1 ? 0 : 1] * 1000;
  const sampleRate = SAMPLE_RATES[verBits][srIdx];
  const samples = mpeg1 ? 1152 : 576;
  const frameLen = Math.floor((samples / 8) * bitrate / sampleRate) + padding;
  if (frameLen < 24 || pos + frameLen > buf.length) { pos++; continue; }
  const frameDur = samples / sampleRate;
  if (t >= startSec && t < startSec + durSec) {
    kept.push(buf.subarray(pos, pos + frameLen));
    keptFrames++;
  }
  t += frameDur;
  frames++;
  pos += frameLen;
  if (t >= startSec + durSec) break;
}

if (!keptFrames) {
  console.log(JSON.stringify({ ok: false, error: 'no frames in range', totalDur: Math.round(t * 10) / 10 }));
  process.exit(1);
}
writeFileSync(outFile, Buffer.concat(kept));
console.log(JSON.stringify({ ok: true, frames: keptFrames, outSec: Math.round(keptFrames / frames * t * 10) / 10, bytes: kept.reduce((a, b) => a + b.length, 0) }));
