// Resolves root-relative asset paths ('/models/x.glb') against the deployed
// base path (e.g. GitHub Pages' /vibe-coffee/). Idempotent: data:, blob:,
// absolute and already-prefixed URLs pass through unchanged.
const BASE = import.meta.env?.BASE_URL ?? '/';

export function assetUrl(url) {
  if (!url || /^(?:[a-z]+:)/i.test(url) || !url.startsWith('/')) return url;
  if (BASE !== '/' && url.startsWith(BASE)) return url;
  return BASE + url.slice(1);
}
