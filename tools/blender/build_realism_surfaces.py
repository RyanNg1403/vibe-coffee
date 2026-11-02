"""Blender-authored walnut, linen and stone fields; editable material studio."""
import bpy,math,json
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'public/textures';SOURCE=ROOT/'assets/blender/realism'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
S=1024
rng=np.random.default_rng(1403)
y,x=np.mgrid[0:S,0:S].astype(np.float32)/S
# Keep the scan's pores and grain. Blender resamples the retained CC0 source,
# then adds only fine, physically scaled finish variation and a normal field.
scan=bpy.data.images.load(str(OUT/'wood_dark.jpg'));scan.scale(S,S)
p=np.empty(S*S*4,dtype=np.float32);scan.pixels.foreach_get(p);walnut=p.reshape(S,S,4)[:,:,:3]
walnut=np.clip(walnut*np.array([2.6,2.3,2.05]),0,1)
# A matte walnut finish has quiet grain, rather than high-contrast orange knots.
walnut=walnut*.52+np.array([.105,.071,.046])*.48
warp=np.sin(2*math.pi*(x*256+np.sin(y*math.tau*5)*.09));weft=np.sin(2*math.pi*(y*256+np.sin(x*math.tau*7)*.09));weave=warp*weft
linen=np.array([.57,.535,.475])+weave[...,None]*.035+rng.normal(0,.003,(S,S,1))
stone=np.array([.66,.63,.56])+(.008*np.sin(x*math.tau*8)*np.sin(y*math.tau*11)+rng.normal(0,.003,(S,S)))[...,None]
fields={
 'walnut':(walnut, .39+.055*np.sin(x*math.tau*3+np.sin(y*math.tau*2))+.025*rng.random((S,S)),.00004*np.sin(y*math.tau*140+x*math.tau*2)),
 'linen':(linen,.91+weave*.035,weave*.000075),
 'stone':(stone,.52+.04*rng.random((S,S)),rng.normal(0,.000015,(S,S)))
}
for name,(color,rough,height) in fields.items():
 dx=(np.roll(height,-1,1)-np.roll(height,1,1))*S/2;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*S/2
 normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1)[...,None]
 maps={'color':color,'roughness':np.repeat(rough[...,None],3,axis=-1),'normal':normal*.5+.5}
 material=bpy.data.materials.new('Architectural / '+name);material.use_nodes=True;nodes=material.node_tree.nodes;links=material.node_tree.links;bsdf=nodes.get('Principled BSDF')
 for channel,pixels in maps.items():
  im=bpy.data.images.new('realism_'+name+'_'+channel,width=S,height=S)
  im.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
  # Blender image pixels are scene-linear. Color output is encoded as sRGB.
  rgba=np.concatenate([np.clip(pixels,0,1),np.ones((S,S,1))],axis=-1).astype(np.float32)
  im.pixels.foreach_set(rgba.ravel());im.file_format='JPEG';im.filepath_raw=str(OUT/(im.name+'.jpg'));im.save();im.pack()
  n=nodes.new('ShaderNodeTexImage');n.image=im
  if channel=='color':links.new(n.outputs['Color'],bsdf.inputs['Base Color'])
  elif channel=='roughness':links.new(n.outputs['Color'],bsdf.inputs['Roughness'])
  else:
   bump=nodes.new('ShaderNodeNormalMap');bump.inputs['Strength'].default_value=.6;links.new(n.outputs['Color'],bump.inputs['Color']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
 if name=='linen':bsdf.inputs['Sheen Weight'].default_value=.25;bsdf.inputs['Sheen Roughness'].default_value=.75
 if name=='walnut':bsdf.inputs['Coat Weight'].default_value=.15;bsdf.inputs['Coat Roughness'].default_value=.3
 bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=32,location=(list(fields).index(name)*2.3,0,1));o=bpy.context.object;o.name=name+' material study';o.data.materials.append(material)
 for f in o.data.polygons:f.use_smooth=True
world=bpy.context.scene.world;world.use_nodes=True;env=world.node_tree.nodes.new('ShaderNodeTexEnvironment');env.image=bpy.data.images.load(str(ROOT/'public/environment/courtyard.hdr'));env.image.pack();world.node_tree.links.new(env.outputs[0],world.node_tree.nodes.get('Background').inputs['Color'])
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=32
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'architectural-materials.blend'),compress=True)
compact=env.image.copy();compact.scale(512,256);compact.file_format='HDR';compact.filepath_raw=str(SOURCE/'courtyard-compact.hdr');compact.save()
print('REALISM_SURFACES: nine 1024px maps and editable Blender materials')
