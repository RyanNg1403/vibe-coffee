// Manifests list runtime assets root-relative ('/models/cup.glb'). The app is
// served from a sub-path on GitHub Pages (/vibe-coffee/), and production
// builds rename long-lived assets to content-hashed files, so every fetch,
// loader and media src must resolve its path here. data:/blob:/absolute URLs
// (the single-file artifact inlines assets as data: URIs) pass through.
//
// tools/pages/vite-plugin.mjs substitutes the hashed-name map below at build
// time; the dev server and `node --test` see an undefined identifier.
const BASE = import.meta.env?.BASE_URL ?? '/';
// eslint-disable-next-line no-undef
const HASHED = typeof __VIBE_ASSET_MAP__ === 'object' ? __VIBE_ASSET_MAP__ : {};

export function assetUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
  return BASE + (HASHED[path] ?? path.slice(1));
}
