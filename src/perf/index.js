// Performance layer: runtime LODs, pose-following actor culling, accelerated
// picking, shader pre-warming, frame-time driven quality scaling, hidden-tab
// pausing and the developer HUD. Everything attaches through
// `scene.onBeforeRender` (after Three's matrix update, before culling and the
// shadow pass), so the app's frame loop only reports frame boundaries.
//
// URL switches for A/B measurement: ?lod=0  ?cull=0  ?bvh=0  ?warmup=0
// ?adaptive=0  ?perf (show the HUD outside dev builds).
import * as THREE from 'three';
import { AdaptiveQualityController, buildQualityLadder } from './qualityController.js';
import { FrameStats } from './frameStats.js';
import { LodManager } from './lod/lodManager.js';
import { SkinnedCuller } from './skinnedCulling.js';
import { installAcceleratedRaycast, raycastStats } from './raycast.js';
import { configureTextureCompression } from './textureCompression.js';
import { ActorReveal } from './actorReveal.js';
import { compileScene } from './compile.js';

const SCAN_INTERVAL_MS = 1000;
const textureBytesCache = new WeakMap();

// Approximate video memory of one texture as uploaded: block-compressed data
// as stored, uncompressed images as RGBA8 (half-float for HDR) plus mips.
function textureBytes(texture) {
  if (textureBytesCache.has(texture)) return textureBytesCache.get(texture);
  let bytes = 0;
  if (texture.isCompressedTexture) {
    bytes = texture.userData.gpuBytes ?? 0;
    if (!bytes) for (const mip of texture.mipmaps ?? []) bytes += mip.data?.byteLength ?? 0;
  } else {
    const image = texture.image;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    const texel = texture.type === THREE.HalfFloatType ? 8 : texture.type === THREE.FloatType ? 16 : 4;
    bytes = width * height * texel * (texture.generateMipmaps ? 4 / 3 : 1);
  }
  if (bytes) textureBytesCache.set(texture, bytes);
  return bytes;
}

export function sceneTextureMemory(root) {
  const seen = new Set();
  let bytes = 0;
  let compressed = 0;
  root.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (!value?.isTexture || seen.has(value)) continue;
        seen.add(value);
        bytes += textureBytes(value);
        if (value.isCompressedTexture) compressed += 1;
      }
    }
  });
  return { textures: seen.size, compressed, megabytes: Number((bytes / 1048576).toFixed(1)) };
}
const WARMUP_HOLD_LIMIT_MS = 2500;

export { buildQualityLadder };

export function installPerformance({
  renderer,
  scene,
  camera,
  quality = null,
  ladder = null,
  params = new URLSearchParams(window.location.search),
  dev = import.meta.env?.DEV ?? false,
} = {}) {
  const off = (name) => params.get(name) === '0';
  configureTextureCompression(renderer);
  const stats = new FrameStats(renderer.getContext());
  const lod = new LodManager();
  lod.enabled = !off('lod');
  const culler = new SkinnedCuller();
  culler.enabled = !off('cull');
  if (!off('bvh')) installAcceleratedRaycast({ skinnedProxy: (geometry) => lod.raycastProxy(geometry) });

  const controller = quality
    ? new AdaptiveQualityController(quality, { ladder: ladder ?? buildQualityLadder({ tierCount: quality.tierCount }) })
    : null;
  if (controller) controller.enabled = !off('adaptive');

  const reveal = new ActorReveal({ renderer, scene, camera });
  let renderWaiters = [];
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  let culledActors = 0;
  let scanAt = 0;
  let hold = null;
  let warmups = 0;
  let lastWarmupMs = null;
  let hiddenSince = null;

  const previousBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function onBeforeRender(r, s, cam, target) {
    previousBeforeRender.call(this, r, s, cam, target);
    if (!cam.isPerspectiveCamera || target?.isWebGLCubeRenderTarget) return;
    const now = performance.now();
    if (now >= scanAt) {
      scanAt = now + SCAN_INTERVAL_MS;
      culler.scan(s);
      lod.scan(s);
    }
    reveal.update();
    culler.update();
    lod.update(cam, r.domElement.height, (mesh) => culler.sphereFor(mesh));
    projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    culledActors = 0;
    for (const group of culler.groups) if (!frustum.intersectsSphere(group.sphere)) culledActors += 1;
  };

  // Rendering stops entirely while the page is hidden (some embedded
  // browsers keep firing requestAnimationFrame for background tabs). The
  // ambience audio keeps playing; it lives on the audio thread.
  const onVisibility = () => {
    if (document.hidden) hiddenSince = performance.now();
    else {
      hiddenSince = null;
      stats.resetInterval();
      controller?.reset();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  let overlay = null;
  if (dev || params.has('perf')) {
    import('./perfOverlay.js').then(({ createPerfOverlay }) => {
      overlay = createPerfOverlay({ read: () => api.overlayMetrics(), visible: params.has('perf') });
    }).catch((error) => console.warn('[perf] overlay unavailable:', error.message));
  }

  // Block-compressed library textures are cheap in video memory, so upload
  // all of them (one per frame) instead of when a patron first walks in: no
  // upload hitch at spawn, and their CPU-side copies are released.
  let uploadQueue = null;
  let preUploadedTextures = 0;
  function uploadCompressedLibraryTextures(models) {
    if (!models?.values || uploadQueue) return;
    const textures = new Set();
    for (const entry of models.values()) {
      entry.template?.traverse((object) => {
        for (const material of [object.material].flat()) {
          for (const value of Object.values(material ?? {})) {
            if (value?.isCompressedTexture && value.mipmaps?.length && !renderer.properties.get(value).__webglInit) textures.add(value);
          }
        }
      });
    }
    uploadQueue = [...textures];
    const step = () => {
      const texture = uploadQueue.shift();
      if (!texture) {
        uploadQueue = null;
        return;
      }
      if (texture.mipmaps?.length && !renderer.properties.get(texture).__webglInit) {
        renderer.initTexture(texture);
        preUploadedTextures += 1;
      }
      setTimeout(step, 16);
    };
    setTimeout(step, 250);
  }

  let externalMetrics = () => ({});

  const api = {
    lod,
    culler,
    stats,
    quality: controller,

    // Call once per animation frame before any simulation or rendering.
    // Returns false when this frame must be skipped entirely.
    frame(now = performance.now()) {
      if (document.hidden) return false;
      if (hold) {
        if (now < hold.until) return false;
        hold = null;
        stats.resetInterval();
        controller?.reset();
      }
      return true;
    },

    beginRender(now = performance.now()) { stats.begin(now); },
    endRender() {
      stats.end();
      if (renderWaiters.length) {
        const waiters = renderWaiters;
        renderWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    },

    // Resolves after the next completed frame (e.g. the new room's first).
    whenRendered() { return new Promise((resolve) => renderWaiters.push(resolve)); },

    // Snapshot the scene, add actors, then reveal() fades in what was added.
    snapshotActors() { return reveal.snapshot(); },
    revealActors(before) { return reveal.reveal(before); },

    // Report frame time to the adaptive controller. `eligible` lets the app
    // exclude intros, menus and manual quality modes.
    updateQuality(frameSeconds, targetFps, eligible = true) {
      if (!controller) return null;
      if (!eligible) {
        controller.reset();
        return null;
      }
      return controller.update(frameSeconds, targetFps, stats.gpuTimer.supported ? stats.gpu.average() : null);
    },

    // A new room is in the scene: refresh LOD/culling immediately and
    // compile every shader program it (and any patron or pet that may spawn
    // into it later) needs before the next frame draws, so first frames and
    // later arrivals never stall on synchronous program links.
    async sceneChanged({ models = null } = {}) {
      scanAt = 0;
      reveal.cancel();
      if (off('warmup')) return;
      const startedAt = performance.now();
      const token = { until: startedAt + WARMUP_HOLD_LIMIT_MS };
      hold = token;
      const staging = new THREE.Group();
      try {
        await compileScene(renderer, scene, camera);
        const templates = [];
        for (const entry of models?.values?.() ?? []) {
          if ((entry.character || entry.pet) && entry.template && !entry.template.parent) templates.push(entry.template);
        }
        if (templates.length) {
          templates.forEach((template) => staging.add(template));
          await compileScene(renderer, staging, camera, scene);
        }
      } catch (error) {
        console.warn('[perf] shader warm-up skipped:', error.message);
      } finally {
        for (const template of [...staging.children]) staging.remove(template);
        if (hold === token) hold = null;
        warmups += 1;
        lastWarmupMs = performance.now() - startedAt;
      }
      uploadCompressedLibraryTextures(models);
    },

    setExternalMetrics(read) { externalMetrics = read; },

    metrics() {
      const summary = stats.summary();
      return {
        fps: summary.fps === null ? null : Number(summary.fps.toFixed(1)),
        frameMs: summary.frameMs === null ? null : Number(summary.frameMs.toFixed(2)),
        frameP95Ms: summary.frameP95Ms === null ? null : Number(summary.frameP95Ms.toFixed(2)),
        cpuMs: summary.cpuMs === null ? null : Number(summary.cpuMs.toFixed(2)),
        gpuMs: summary.gpuMs === null ? null : Number(summary.gpuMs.toFixed(2)),
        programs: renderer.info.programs?.length ?? null,
        quality: controller?.snapshot() ?? null,
        lod: lod.enabled ? {
          ...lod.stats,
          histogram: [...lod.stats.histogram],
          workerFailed: lod.workerFailed,
          buildMs: Math.round(lod.buildMs),
        } : null,
        actors: culler.groups.length,
        culledActors,
        raycast: { ...raycastStats, buildMs: Number(raycastStats.buildMs.toFixed(1)) },
        textureMemory: sceneTextureMemory(scene),
        preUploadedTextures,
        warmups,
        lastWarmupMs: lastWarmupMs === null ? null : Math.round(lastWarmupMs),
        hidden: hiddenSince !== null,
      };
    },

    overlayMetrics() {
      const m = api.metrics();
      return {
        ...m,
        ...externalMetrics(),
        intervals: stats.intervals.toArray().slice(-60),
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    },

    dispose() {
      scene.onBeforeRender = previousBeforeRender;
      document.removeEventListener('visibilitychange', onVisibility);
      lod.dispose();
      culler.restore(scene);
      stats.gpuTimer.dispose();
      overlay?.dispose();
    },
  };
  return api;
}
