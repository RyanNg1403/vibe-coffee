import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetUrl } from '../src/assetUrl.js';

test('manifest paths resolve against the root base outside a Vite build', () => {
  assert.equal(assetUrl('/models/cup.glb'), '/models/cup.glb');
  assert.equal(assetUrl('/draco/'), '/draco/');
});

test('resolving twice is harmless', () => {
  assert.equal(assetUrl(assetUrl('/sounds/espresso.mp3')), assetUrl('/sounds/espresso.mp3'));
});

test('inlined, absolute and protocol-relative URLs pass through', () => {
  for (const url of ['data:model/gltf-binary;base64,AAAA', 'blob:http://x/1', 'https://cdn.example/a.glb', '//cdn.example/a.glb']) {
    assert.equal(assetUrl(url), url);
  }
});

// GitHub Pages serves the app from /vibe-coffee/: a root-relative literal
// handed straight to a network API 404s there (see DEPLOYMENT.md).
test('source never requests a root-relative path without assetUrl()', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.js'));
  const direct = /(?:\bfetch|\.load(?:Async)?|\.setDecoderPath|\.setTranscoderPath|\.setPath|\bnew (?:Shared)?Worker|\bimportScripts|\bnew Audio)\(\s*['"`]\/(?!\/)|\.src\s*=\s*['"`]\/(?!\/)/;
  const offenders = [];
  for (const file of files) {
    const lines = (await readFile(join(root, file), 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (direct.test(line)) offenders.push(`src/${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});
