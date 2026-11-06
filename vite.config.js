import { defineConfig } from 'vite';

export default defineConfig({
  // The generated single-file artifact also lives under the repository root.
  // Keep Vite's development dependency scanner focused on the actual app
  // entry so it does not try to parse the already-bundled 15 MB deliverable.
  // Rapier is only imported by the lazily created physics worker, which the
  // scanner never sees; pre-bundle it so the first stand-up cannot trigger a
  // dependency re-optimisation and a full page reload.
  optimizeDeps: { entries: ['index.html'], include: ['@dimforge/rapier3d-compat'] },
});
