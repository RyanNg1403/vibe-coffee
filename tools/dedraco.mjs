// Decompress the two Draco hero GLBs into artifact-friendly copies:
// decode → drop authored normals (they block welding) → weld → simplify →
// recompute smooth vertex normals in place (keeps the index) → quantize.
// Output uses only KHR_mesh_quantization, which GLTFLoader parses natively —
// no wasm decoder fetch, so it survives the artifact CSP.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import { mkdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = fileURLToPath(new URL('./.artifact-cache/', import.meta.url));


await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

function smoothNormals(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const p = pos.getArray();
      const ix = idx.getArray();
      const n = new Float32Array(pos.getCount() * 3);
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
        const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
        const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
        const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
        for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
      }
      for (let v = 0; v < n.length; v += 3) {
        const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
        n[v] /= l; n[v + 1] /= l; n[v + 2] /= l;
      }
      const acc = doc.createAccessor().setType('VEC3').setArray(n);
      prim.setAttribute('NORMAL', acc);
    }
  }
}

mkdirSync(`${CACHE}artifact-models`, { recursive: true });
for (const name of ['char_hero_male', 'char_hero_female', 'patron_seated_female']) {
  const src = `${ROOT}public/models/${name}.glb`;
  const doc = await io.read(src);
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  }
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const n = prim.getAttribute('NORMAL');
      if (n) { prim.setAttribute('NORMAL', null); n.dispose(); }
    }
  }
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.02 }),
  );
  smoothNormals(doc);
  await doc.transform(quantize({
    quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8,
  }));
  const out = `${CACHE}artifact-models/${name}.glb`;
  await io.write(out, doc);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) {
    tris += (pr.getIndices()?.getCount() ?? 0) / 3;
  }
  console.log(name, statSync(src).size, '→', statSync(out).size, 'bytes,', Math.round(tris), 'tris,',
    'skins:', doc.getRoot().listSkins().length, 'anims:', doc.getRoot().listAnimations().length);
}
