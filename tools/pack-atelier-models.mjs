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
// Re-exporting one asset should not recompress every other embedded JPEG.
const keysArg=process.argv.slice(2).find(arg=>arg.startsWith('--keys='));
const selected=keysArg?new Set(keysArg.slice(7).split(',')):null;
if(selected)for(const key of selected)if(!MODEL_MANIFEST[key])throw new Error(`Unknown model: ${key}`);
const packedMaps=new Set();
for(const key of Object.keys(MODEL_MANIFEST)){
  const path=`public/models/${key}.glb`;const original=await readFile(path);const d=await io.readBinary(original);
  let result=original;
  if(!selected || selected.has(key)){
  for(const texture of d.getRoot().listTextures()){
    const data=texture.getImage();
    const limit=key.startsWith('char_atelier_') || ['cat','pet_cat','pet_dog'].includes(key)?1024:512;
    const dimensions=texture.getSize();
    const size=dimensions?Math.min(limit,Math.max(...dimensions)):limit;
    const hash=createHash('sha256').update(data).update(String(size)).digest('hex');
    if(!images.has(hash)){
      const input=`${cache}/${hash}.input`;const output=`${cache}/${hash}.jpg`;
      await writeFile(input,data);
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-vf',`scale=${size}:${size}:force_original_aspect_ratio=decrease`,'-q:v','2',output]);
      images.set(hash,await readFile(output));
    }
    texture.setImage(images.get(hash)).setMimeType('image/jpeg').setName('asset-texture-'+createHash('sha256').update(images.get(hash)).digest('hex'));
  }
  await d.transform(meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:14,quantizeNormal:10,quantizeTexcoord:12,quantizeWeight:10}));
  result=await io.writeBinary(d);await writeFile(path,result);
  }
  for(const texture of d.getRoot().listTextures())packedMaps.add(createHash('sha256').update(texture.getImage()).digest('hex'));
  report[key]={bytes:result.length,triangles:d.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((n,p)=>n+p.getIndices().getCount()/3,0),0),materials:d.getRoot().listMaterials().length,animations:d.getRoot().listAnimations().map(a=>a.getName())};
}
await writeFile('assets/blender/realism/runtime-report.json',JSON.stringify(report,null,2)+'\n');
console.log(`${Object.keys(report).length} Blender assets; ${(Object.values(report).reduce((n,a)=>n+a.bytes,0)/1048576).toFixed(2)} MiB total; ${packedMaps.size} unique packed surface maps.${selected?` Repacked only: ${[...selected].join(', ')}.`:''}`);
