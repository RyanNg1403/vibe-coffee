// Developer performance HUD. Loaded on demand (its own chunk) only in dev
// builds or with ?perf in the URL; production visitors never download it.
// Toggle with Shift+P.

const STYLE = `
#vibe-perf{position:fixed;top:8px;left:8px;z-index:9999;min-width:210px;padding:8px 10px;
  font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e9f1e6;
  background:rgba(12,14,16,.78);border:1px solid rgba(255,255,255,.12);border-radius:8px;
  pointer-events:none;white-space:pre}
#vibe-perf b{color:#ffd58a;font-weight:600}
#vibe-perf canvas{display:block;margin-top:6px}
`;

function fmt(value, digits = 1, unit = '') {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${Number(value).toFixed(digits)}${unit}`;
}

function compact(value) {
  if (value === null || value === undefined) return '—';
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
}

export function createPerfOverlay({ read, visible = true }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'vibe-perf';
  root.setAttribute('aria-hidden', 'true');
  const text = document.createElement('div');
  const graph = document.createElement('canvas');
  graph.width = 200;
  graph.height = 36;
  root.append(text, graph);
  document.body.append(root);
  const ctx = graph.getContext('2d');
  let shown = visible;
  root.hidden = !shown;

  const onKey = (event) => {
    if (event.code === 'KeyP' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      shown = !shown;
      root.hidden = !shown;
    }
  };
  window.addEventListener('keydown', onKey);

  function drawGraph(intervals, budgetMs) {
    ctx.clearRect(0, 0, graph.width, graph.height);
    const scaleMs = Math.max(budgetMs * 2, 34);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, graph.height - (budgetMs / scaleMs) * graph.height, graph.width, 1);
    const step = graph.width / Math.max(1, intervals.length);
    intervals.forEach((ms, index) => {
      const h = Math.min(graph.height, (ms / scaleMs) * graph.height);
      ctx.fillStyle = ms > budgetMs * 1.2 ? '#ff7a6b' : ms > budgetMs * 1.02 ? '#ffd58a' : '#8fd18b';
      ctx.fillRect(index * step, graph.height - h, Math.max(1, step - 0.5), h);
    });
  }

  const timer = setInterval(() => {
    if (!shown) return;
    const m = read();
    const heap = m.heapBytes ? `${(m.heapBytes / 1048576).toFixed(0)} MB` : '—';
    const lod = m.lod;
    text.innerHTML = [
      `<b>${fmt(m.fps, 1)}</b> fps   target ${m.targetFps ?? '—'}`,
      `frame ${fmt(m.frameMs, 1, 'ms')}  p95 ${fmt(m.frameP95Ms, 1, 'ms')}`,
      `cpu   ${fmt(m.cpuMs, 2, 'ms')}  gpu ${fmt(m.gpuMs, 2, 'ms')}`,
      `calls ${m.calls ?? '—'}  tris ${compact(m.triangles)}`,
      `geo ${m.geometries ?? '—'}  tex ${m.textures ?? '—'}  prog ${m.programs ?? '—'}`,
      `heap  ${heap}  gpu ${fmt(m.gpuMB, 0, ' MB')}`,
      m.memory ? `mem ~${fmt(m.memory.estimateMB, 0)}/${Number.isFinite(m.memory.budgetMB) ? m.memory.budgetMB : '∞'} MB  ${m.memory.pressure}  trims ${m.memory.trims}` : '',
      m.device ? `device <b>${m.device.tier}</b>  ${m.device.gpu}${m.device.mobile ? '  mobile' : ''}${m.device.deviceMemory ? `  ${m.device.deviceMemory} GB` : ''}` : '',
      m.pacing ? `pace ${m.pacing.interactiveFps}/${m.pacing.ambientFps} fps  thermal ${m.pacing.thermalLevel}${m.pacing.batterySaver ? '  battery saver' : ''}${m.pacing.userCap ? `  cap ${m.pacing.userCap}` : ''}` : '',
      `quality tier ${m.quality?.tier ?? '—'}  scale ${fmt(m.quality?.scale, 2)}  dpr ${fmt(m.pixelRatio, 2)}${m.qualityMode ? `  (${m.qualityMode})` : ''}`,
      lod ? `lod ${lod.ready}/${lod.managed}  [${lod.histogram.join(' ')}]  -${compact(lod.sourceTriangles - lod.drawnTriangles)} tris` : 'lod off',
      `culled actors ${m.culledActors ?? '—'}/${m.actors ?? '—'}${m.shadowlessActors ? `  no-shadow ${m.shadowlessActors}` : ''}`,
    ].filter(Boolean).join('\n');
    drawGraph(m.intervals ?? [], m.targetFps ? 1000 / m.targetFps : 16.7);
  }, 250);

  return {
    get visible() { return shown; },
    toggle(force = !shown) { shown = force; root.hidden = !shown; },
    dispose() {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      root.remove();
      style.remove();
    },
  };
}
