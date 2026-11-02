// Decode the credited source rigs for Blender's importer without changing them.
import {mkdir} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dequantize} from '@gltf-transform/functions';
import draco from 'draco3dgltf';
import {MeshoptDecoder} from 'meshoptimizer';
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule(),'meshopt.decoder':MeshoptDecoder});
await mkdir('/tmp/vibe-realism-input',{recursive:true});
for(const sex of ['female','male']) {
 const d=await io.read(`public/models/char_hero_${sex}.glb`);
 for(const e of d.getRoot().listExtensionsUsed()) if(['EXT_meshopt_compression','KHR_draco_mesh_compression'].includes(e.extensionName)) e.dispose();
 await d.transform(dequantize());await io.write(`/tmp/vibe-realism-input/${sex}.glb`,d);
}
