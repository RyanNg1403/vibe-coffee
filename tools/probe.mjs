// Probe an audio file: prints JSON {ok, container, codec, durationSec, bitrate, sizeBytes}
// Usage: node tools/probe.mjs <file>
import { parseFile } from 'music-metadata';
import { statSync } from 'fs';

const file = process.argv[2];
try {
  const meta = await parseFile(file);
  const size = statSync(file).size;
  console.log(JSON.stringify({
    ok: true,
    container: meta.format.container ?? null,
    codec: meta.format.codec ?? null,
    durationSec: meta.format.duration ? Math.round(meta.format.duration * 10) / 10 : null,
    bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate) : null,
    sampleRate: meta.format.sampleRate ?? null,
    sizeBytes: size,
  }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
}
