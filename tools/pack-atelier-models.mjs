// Preserve editable Blender sources; ship compact geometry and embedded PBR maps.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { MODEL_MANIFEST } from '../src/modelManifest.js';
const run=promisify(execFile);
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const cache='/tmp/vibe-atelier-textures';await mkdir(cache,{recursive:true});
const images=new Map();const report={};
for(const key of Object.keys(MODEL_MANIFEST)){
  const path=`public/models/${key}.glb`;const original=await readFile(path);const d=await io.readBinary(original);
  for(const texture of d.getRoot().listTextures()){
    const data=texture.getImage();const hash=createHash('sha256').update(data).digest('hex');
    if(!images.has(hash)){
      const input=`${cache}/${hash}.input`;const output=`${cache}/${hash}.jpg`;
      await writeFile(input,data);
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-vf','scale=256:256:force_original_aspect_ratio=decrease','-q:v','3',output]);
      images.set(hash,await readFile(output));
    }
    texture.setImage(images.get(hash)).setMimeType('image/jpeg');
  }
  await d.transform(meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:14,quantizeNormal:10,quantizeTexcoord:12,quantizeWeight:10}));
  const result=await io.writeBinary(d);await writeFile(path,result);
  report[key]={bytes:result.length,triangles:d.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((n,p)=>n+p.getIndices().getCount()/3,0),0),materials:d.getRoot().listMaterials().length,animations:d.getRoot().listAnimations().map(a=>a.getName())};
}
await writeFile('assets/blender/rebuild/runtime-report.json',JSON.stringify(report,null,2)+'\n');
console.log(`${Object.keys(report).length} Blender assets; ${(Object.values(report).reduce((n,a)=>n+a.bytes,0)/1048576).toFixed(2)} MiB total; ${images.size} unique packed surface maps.`);
