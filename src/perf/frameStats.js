// Rolling frame statistics plus optional GPU timing.
//
// GPU time comes from EXT_disjoint_timer_query_webgl2 when the browser exposes
// it (most desktop Chrome/Edge builds; not Safari or software GL). Queries are
// read back a few frames later so measuring never stalls the pipeline.

export class RollingWindow {
  constructor(size = 120) {
    this.values = new Float64Array(size);
    this.size = size;
    this.count = 0;
    this.head = 0;
  }

  push(value) {
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
  }

  toArray() {
    const out = [];
    for (let i = 0; i < this.count; i += 1) out.push(this.values[(this.head - this.count + i + this.size) % this.size]);
    return out;
  }

  average() {
    if (!this.count) return null;
    let sum = 0;
    for (let i = 0; i < this.count; i += 1) sum += this.values[i];
    return sum / this.count;
  }

  percentile(p) {
    if (!this.count) return null;
    const sorted = this.toArray().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  }
}

export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    this.pending = [];
    this.active = null;
    this.lastMs = null;
  }

  get supported() { return !!this.ext; }

  begin() {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const query = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll() {
    if (!this.ext) return this.lastMs;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const query = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) this.lastMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      this.pending.shift();
    }
    return this.lastMs;
  }

  dispose() {
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
  }
}

export class FrameStats {
  constructor(gl, windowSize = 120) {
    this.intervals = new RollingWindow(windowSize);
    this.cpu = new RollingWindow(windowSize);
    this.gpu = new RollingWindow(windowSize);
    this.gpuTimer = new GpuTimer(gl);
    this.lastFrameAt = null;
    this.frameStartedAt = 0;
    this.frames = 0;
  }

  begin(now = performance.now()) {
    if (this.lastFrameAt !== null) this.intervals.push(now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frameStartedAt = performance.now();
    this.gpuTimer.begin();
  }

  end() {
    this.gpuTimer.end();
    this.cpu.push(performance.now() - this.frameStartedAt);
    const gpu = this.gpuTimer.poll();
    if (gpu !== null) this.gpu.push(gpu);
    this.frames += 1;
  }

  // A pause (hidden tab, scene hold) must not read as one giant frame.
  resetInterval() {
    this.lastFrameAt = null;
  }

  summary() {
    const interval = this.intervals.percentile(0.5);
    return {
      fps: interval ? 1000 / interval : null,
      frameMs: interval,
      frameP95Ms: this.intervals.percentile(0.95),
      cpuMs: this.cpu.average(),
      gpuMs: this.gpuTimer.supported ? this.gpu.average() : null,
    };
  }
}
