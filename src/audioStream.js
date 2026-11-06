// Long looping beds (crowd chatter, street, rain) played from their compressed
// bytes through <audio> elements and MediaElementAudioSourceNodes, instead of
// fully decoded AudioBuffers: a 35 s mono bed costs ~250 KB as MP3 versus
// ~3.2 MB as 24 kHz float PCM. Short one-shots stay decoded (they overlap,
// are sliced and spatialized, and must start sample-accurately).
//
// Each loop runs two elements and crossfades between them (equal power)
// before the loop end, so encoder padding at the file edges never clicks and
// the trimmed window matches the buffer path (0.4 s skipped at each edge).
// `el.loop` stays on as a safety net when a timeupdate arrives late.

const FADE_POINTS = 32;
const FADE_IN = new Float32Array(FADE_POINTS);
const FADE_OUT = new Float32Array(FADE_POINTS);
for (let i = 0; i < FADE_POINTS; i += 1) {
  const p = i / (FADE_POINTS - 1);
  FADE_IN[i] = Math.sin((p * Math.PI) / 2);
  FADE_OUT[i] = Math.cos((p * Math.PI) / 2);
}

// 8 kHz, 16-bit, 20 ms of silence: used to unlock elements inside a gesture.
function silentWavUri() {
  const samples = 160;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples * 2, true);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function mediaStreamingSupported(ctx) {
  return typeof document !== 'undefined' && typeof Audio === 'function'
    && typeof ctx?.createMediaElementSource === 'function' && typeof URL?.createObjectURL === 'function';
}

// A MediaElementAudioSourceNode can be created once per element, so elements
// are pooled together with their node. iOS only lets script start elements
// that a user gesture has played once: bless() runs inside the click.
export class MediaElementPool {
  constructor(ctx) {
    this.ctx = ctx;
    this.free = [];
    this.created = 0;
  }

  _create() {
    const el = new Audio();
    el.preload = 'auto';
    el.playsInline = true;
    el.loop = true;
    el.preservesPitch = false;
    el.mozPreservesPitch = false;
    el.webkitPreservesPitch = false;
    this.created += 1;
    return { el, node: null };
  }

  bless(count) {
    const uri = silentWavUri();
    for (let i = 0; i < count; i += 1) {
      const item = this._create();
      item.el.src = uri;
      item.el.play()?.then(() => item.el.pause()).catch(() => {});
      this.free.push(item);
    }
  }

  acquire() {
    const item = this.free.pop() ?? this._create();
    item.node ??= this.ctx.createMediaElementSource(item.el);
    return item;
  }

  release(item) {
    item.el.pause();
    item.node?.disconnect();
    // Dropping the source frees the element's buffered data and decoder.
    item.el.removeAttribute('src');
    item.el.load();
    this.free.push(item);
  }
}

// Compressed source of one recording. The object URL keeps the Blob alive,
// so it is revoked once nothing plays it.
export class StreamSource {
  constructor(bytes, { type = 'audio/mpeg', duration = 0 } = {}) {
    this.url = URL.createObjectURL(new Blob([bytes], { type }));
    this.bytes = bytes.byteLength;
    this.duration = duration;
    this.users = 0;
    this.released = false;
  }

  retain() { this.users += 1; }

  unretain() {
    this.users -= 1;
    if (this.released && this.users <= 0) this._revoke();
  }

  release() {
    this.released = true;
    if (this.users <= 0) this._revoke();
  }

  _revoke() {
    if (!this.url) return;
    URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

/**
 * A looping bed. Mirrors the handle `_playBuf` returns for buffer loops:
 * `gain` (the caller automates it) and `src` with stop(when) and a
 * playbackRate whose setTargetAtTime/value apply to both elements.
 *
 * @param fallback async () => AudioBuffer, used when an element cannot play
 *                 (autoplay policy, decoder error); the loop then continues
 *                 as a buffer source into the same gain.
 */
export class StreamedLoop {
  constructor(ctx, pool, source, {
    out, volume = 1, loopStart = null, loopEnd = null, offset = null, crossfade = 1.6, fallback = null,
  }) {
    this.ctx = ctx;
    this.pool = pool;
    this.source = source;
    this.fallback = fallback;
    const duration = source.duration;
    const trim = duration > 4 ? 0.4 : 0;
    this.loopStart = Math.max(0, loopStart ?? trim);
    this.loopEnd = Math.min(duration, loopEnd ?? duration - trim);
    if (this.loopEnd - this.loopStart < 1) {
      this.loopStart = 0;
      this.loopEnd = duration;
    }
    this.crossfade = Math.min(crossfade, (this.loopEnd - this.loopStart) / 3);
    this.offset = offset ?? this.loopStart;
    this.rate = 1;
    this.stopped = false;
    this.mode = 'stream';
    this.decks = [];
    this.active = 0;
    this.switching = false;
    this.bufferSource = null;
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(out);
    source.retain();
    const loop = this;
    this.src = {
      playbackRate: {
        get value() { return loop.rate; },
        set value(rate) { loop.setRate(rate); },
        setTargetAtTime(rate) { loop.setRate(rate); },
        setValueAtTime(rate) { loop.setRate(rate); },
      },
      stop: (when) => loop.stop(when),
    };
    this.ready = this._start();
  }

  _deck() {
    const item = this.pool.acquire();
    const xf = this.ctx.createGain();
    xf.gain.value = 0;
    item.node.connect(xf).connect(this.gain);
    item.el.src = this.source.url;
    item.el.playbackRate = this.rate;
    const deck = { item, xf, onTime: null };
    deck.onTime = () => this._onTime(deck);
    item.el.addEventListener('timeupdate', deck.onTime);
    return deck;
  }

  async _start() {
    try {
      this.decks = [this._deck(), this._deck()];
      const first = this.decks[0];
      first.item.el.currentTime = this.offset;
      await first.item.el.play();
      if (this.stopped) return true;
      first.xf.gain.setValueAtTime(1, this.ctx.currentTime);
      return true;
    } catch (error) {
      this._releaseDecks();
      if (this.stopped || !this.fallback) return false;
      return this._startFallback(error);
    }
  }

  async _startFallback(error) {
    console.warn(`[sounds] streamed bed unavailable (${error?.name ?? error}); decoding instead`);
    const buffer = await this.fallback().catch(() => null);
    if (!buffer || this.stopped) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = Math.min(this.loopStart, buffer.duration);
    src.loopEnd = Math.min(this.loopEnd, buffer.duration);
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    src.start(this.ctx.currentTime, Math.min(this.offset, buffer.duration - 0.05));
    this.bufferSource = src;
    this.mode = 'buffer';
    return true;
  }

  _onTime(deck) {
    if (this.stopped || this.switching || this.decks[this.active] !== deck) return;
    const el = deck.item.el;
    // timeupdate arrives every ~250 ms of media time: start early enough.
    const lead = this.crossfade * this.rate + 0.35;
    if (el.currentTime < this.loopEnd - lead && el.currentTime >= this.loopStart - 0.05) return;
    this._crossfade();
  }

  async _crossfade() {
    this.switching = true;
    const current = this.decks[this.active];
    const nextIndex = 1 - this.active;
    const next = this.decks[nextIndex];
    try {
      next.item.el.currentTime = this.loopStart;
      await next.item.el.play();
    } catch {
      // Keep the current element looping on its own (el.loop) rather than
      // going silent; a later timeupdate retries.
      this.switching = false;
      return;
    }
    if (this.stopped) return;
    const t = this.ctx.currentTime;
    const fade = this.crossfade;
    next.xf.gain.cancelScheduledValues(t);
    current.xf.gain.cancelScheduledValues(t);
    next.xf.gain.setValueCurveAtTime(FADE_IN, t, fade);
    current.xf.gain.setValueCurveAtTime(FADE_OUT, t, fade);
    this.active = nextIndex;
    setTimeout(() => {
      if (!this.stopped && this.decks[this.active] !== current) current.item.el.pause();
      this.switching = false;
    }, fade * 1000 + 120);
  }

  setRate(rate) {
    if (!(rate > 0)) return;
    this.rate = rate;
    for (const deck of this.decks) deck.item.el.playbackRate = rate;
    this.bufferSource?.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 1.5);
  }

  // Same contract as AudioBufferSourceNode.stop(when): callers fade the gain
  // themselves first.
  stop(when = this.ctx.currentTime) {
    if (this.stopped) return;
    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    setTimeout(() => this.dispose(), delayMs);
  }

  _releaseDecks() {
    for (const deck of this.decks) {
      deck.item.el.removeEventListener('timeupdate', deck.onTime);
      deck.xf.disconnect();
      this.pool.release(deck.item);
    }
    this.decks = [];
  }

  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this._releaseDecks();
    try { this.bufferSource?.stop(); } catch { /* already stopped */ }
    this.bufferSource?.disconnect();
    this.bufferSource = null;
    this.gain.disconnect();
    this.source.unretain();
  }
}
