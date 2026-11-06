import RAPIER from '@dimforge/rapier3d-compat';
import { createTableScene } from './tablePropSim.js';

// Off-main-thread Rapier host. Idle until a bump arrives; each bumped table
// simulates in its own tiny world at 120 Hz and streams transforms at 60 Hz
// until every prop sleeps, then the world is freed.

const FRAME_MS = 1000 / 60;
const scenes = new Map();
let timer = null;

const ready = RAPIER.init().then(
  () => { self.postMessage({ type: 'ready', version: RAPIER.version() }); return true; },
  (error) => { self.postMessage({ type: 'error', message: String(error?.message ?? error) }); return false; },
);

function tick() {
  for (const [id, scene] of scenes) {
    const result = scene.step(FRAME_MS / 1000);
    const transforms = result.transforms.slice();
    self.postMessage({
      type: 'frame', scene: id, transforms, contacts: result.contacts.slice(0, 24), done: result.done,
    }, [transforms.buffer]);
    if (result.done) {
      scene.dispose();
      scenes.delete(id);
    }
  }
  if (!scenes.size) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = async ({ data }) => {
  if (!(await ready)) return;
  if (data.type === 'bump') {
    scenes.get(data.scene)?.dispose();
    scenes.set(data.scene, createTableScene(RAPIER, data.description));
    timer ??= setInterval(tick, FRAME_MS);
  } else if (data.type === 'cancel') {
    scenes.get(data.scene)?.dispose();
    scenes.delete(data.scene);
  }
};
