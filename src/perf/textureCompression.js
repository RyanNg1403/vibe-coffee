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
    return new KTX2Loader(manager).detectSupport(renderer);
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
