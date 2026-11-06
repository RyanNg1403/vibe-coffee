// KTX2 / Basis Universal support for library models. Deployed builds carry
// ETC1S colour textures (tools/compress-textures.mjs); development serves the
// original JPEGs and never fetches the loader chunk or transcoder. The
// single-file artifact replaces this module with a null loader.
//
// The transcoder ships as content-hashed build assets (no fixed /basis/
// path), so it works under any base path and never goes stale in a cache.
import { LoadingManager } from 'three';

let renderer = null;
let loaderPromise = null;
let releasedTextures = 0;

// A KTX2 texture load can fail transiently: the blob read, the worker
// transcode, or the one-time transcoder fetch/initialisation (whose rejection
// KTX2Loader would otherwise cache for every later texture). GLTFLoader turns
// any of these into "Couldn't load texture blob:…" and drops the model, so
// each texture gets a couple of retries, with the reason logged as a warning.
export const KTX2_RETRIES = 2;
export const ktx2Stats = { retries: 0, recovered: 0, failed: 0, lastError: null };

// Runs attempt(onLoad, onError) until it succeeds or `retries` retries fail.
export function loadWithRetries(attempt, { retries = KTX2_RETRIES, delayMs = 60, beforeRetry = null, onRetry = null } = {}) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const run = () => attempt(resolve, async (error) => {
      if (tries >= retries) {
        reject(error);
        return;
      }
      tries += 1;
      onRetry?.(error, tries);
      try {
        await beforeRetry?.(error);
      } catch {
        // retry regardless
      }
      setTimeout(run, delayMs * tries);
    });
    run();
  });
}

function resilient(KTX2Loader) {
  return class ResilientKTX2Loader extends KTX2Loader {
    load(url, onLoad, onProgress, onError) {
      let retried = false;
      loadWithRetries((resolve, reject) => super.load(url, resolve, onProgress, reject), {
        onRetry: (error, attempt) => {
          retried = true;
          ktx2Stats.retries += 1;
          ktx2Stats.lastError = String(error?.message ?? error);
          console.warn(`[textures] KTX2 texture load failed (${ktx2Stats.lastError}); retry ${attempt}/${KTX2_RETRIES}`);
        },
        beforeRetry: () => this.resetFailedTranscoder(),
      }).then((texture) => {
        if (retried) ktx2Stats.recovered += 1;
        onLoad?.(texture);
      }, (error) => {
        ktx2Stats.failed += 1;
        onError?.(error);
      });
    }

    // A rejected transcoder load stays cached in KTX2Loader; clear it so the
    // next attempt fetches and initialises the transcoder again.
    async resetFailedTranscoder() {
      const pending = this.transcoderPending;
      if (!pending) return;
      try {
        await pending;
      } catch {
        if (this.transcoderPending === pending) this.transcoderPending = null;
      }
    }
  };
}

export function configureTextureCompression(webglRenderer) {
  renderer = webglRenderer;
  // Released block data cannot be re-uploaded after a GPU reset; a fresh
  // page load is the only faithful recovery.
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    if (releasedTextures > 0) window.location.reload();
  });
}

export function ktx2Loader() {
  if (!renderer) return Promise.resolve(null);
  loaderPromise ??= Promise.all([
    import('three/examples/jsm/loaders/KTX2Loader.js'),
    import('three/examples/jsm/libs/basis/basis_transcoder.js?url'),
    import('three/examples/jsm/libs/basis/basis_transcoder.wasm?url'),
  ]).then(([{ KTX2Loader }, { default: jsUrl }, { default: wasmUrl }]) => {
    // KTX2Loader requests fixed file names under its transcoder path.
    const manager = new LoadingManager();
    manager.setURLModifier((url) => (url.endsWith('basis_transcoder.js') ? jsUrl
      : url.endsWith('basis_transcoder.wasm') ? wasmUrl : url));
    const Loader = resilient(KTX2Loader);
    return new Loader(manager).detectSupport(renderer);
  }).catch((error) => {
    console.warn('[textures] KTX2 transcoding unavailable:', error.message);
    return null;
  });
  return loaderPromise;
}

// Library textures are uploaded once and never modified, so the transcoded
// mip chain (as large as its video memory) can leave the JS heap afterwards.
export function releaseAfterUpload(texture) {
  if (!texture.isCompressedTexture || texture.userData.releaseAfterUpload) return;
  texture.userData.releaseAfterUpload = true;
  texture.userData.gpuBytes = (texture.mipmaps ?? []).reduce((sum, mip) => sum + (mip.data?.byteLength ?? 0), 0);
  const previous = texture.onUpdate;
  texture.onUpdate = (uploaded) => {
    previous?.(uploaded);
    uploaded.mipmaps = [];
    uploaded.onUpdate = previous ?? null;
    releasedTextures += 1;
  };
}
