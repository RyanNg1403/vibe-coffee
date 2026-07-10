import { defineConfig } from 'vite';

export default defineConfig({
  // The generated single-file artifact also lives under the repository root.
  // Keep Vite's development dependency scanner focused on the actual app
  // entry so it does not try to parse the already-bundled 15 MB deliverable.
  optimizeDeps: { entries: ['index.html'] },
});
