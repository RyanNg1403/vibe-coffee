import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { defineConfig } from 'vite';
import { pagesDeploy } from './tools/pages/vite-plugin.mjs';

// Re-encodes GLB colour textures as KTX2 when `toktx` and ffmpeg are on PATH
// (CI installs both). As a Pages preprocess step its output is what ships in
// dist/models and what the service worker revisions describe.
const KTX2_STEP = 'tools/compress-textures.mjs';
const preprocess = existsSync(KTX2_STEP) ? [{
  dir: 'models',
  run: async (input, output) => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [KTX2_STEP, `--in=${input}`, `--out=${output}`]);
    process.stdout.write(stdout + stderr);
  },
}] : [];

// GitHub Pages serves this project site from https://<owner>.github.io/vibe-coffee/.
// VITE_BASE overrides the base of builds and `vite preview`: '/' for a custom
// domain or a root-hosted copy, './' for a relocatable build. The dev server
// stays at '/' unless VITE_BASE is set. See DEPLOYMENT.md.
const PAGES_BASE = '/vibe-coffee/';

function resolveBase(value, fallback) {
  if (value === undefined) return fallback;
  if (value === '.' || value === './') return './';
  const trimmed = value.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

export default defineConfig(({ command, mode, isPreview }) => {
  // tools/make-artifact.mjs inlines a single entry script into one HTML file,
  // so its build needs a root base, no chunk splitting and no service worker.
  const artifact = mode === 'artifact';
  const base = artifact ? '/' : resolveBase(process.env.VITE_BASE, command === 'build' || isPreview ? PAGES_BASE : '/');
  return {
    base,
    // The generated single-file artifact also lives under the repository root.
    // Keep Vite's development dependency scanner focused on the actual app
    // entry so it does not try to parse the already-bundled 15 MB deliverable.
    optimizeDeps: { entries: ['index.html'] },
    build: {
      // Three.js changes far less often than the app, so its own hashed chunk
      // stays cached (HTTP and service worker) across most deploys. Core
      // only: examples (loaders, passes) stay with the code that imports
      // them, so lazily imported ones remain lazy.
      chunkSizeWarningLimit: 800,
      rolldownOptions: {
        output: {
          codeSplitting: artifact ? false : {
            groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/](build|src)[\\/]/ }],
          },
        },
      },
    },
    plugins: artifact ? [] : [pagesDeploy({ preprocess })],
  };
});
