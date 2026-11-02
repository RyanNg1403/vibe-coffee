"""Bake layout-accurate floor contact occlusion in Blender/Cycles for every café."""
import bpy,math,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];SOURCE=ROOT/'assets/blender/realism';OUT=ROOT/'public/textures'
layouts=json.loads((ROOT/'assets/blender/rebuild/layouts.json').read_text())
bpy.context.preferences.filepaths.save_version=0

def append_meshes(key):
 with bpy.data.libraries.load(str(ROOT/'assets/blender/rebuild'/(key+'.blend')),link=False) as (src,dst):dst.objects=[n for n in src.objects]
 result=[]
 for o in dst.objects:
  if o and o.type=='MESH':bpy.context.collection.objects.link(o);result.append(o)
 return result

def cube(pos,size):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return o

for key,layout in layouts.items():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=False
 tables=append_meshes('atelier_tables_'+key)
 templates=append_meshes('studio_chair')
 for seat in layout['seats']:
  if seat.get('isBar'):continue
  p=seat['pos'];angle=seat.get('facingYaw',0)
  for source in templates:
   o=source.copy();o.data=source.data;bpy.context.collection.objects.link(o)
   o.location=(p['x'],-p['z'],p.get('y',0));o.rotation_euler.z=angle
 for o in templates:bpy.data.objects.remove(o,do_unlink=True)
 # Only near-floor construction contributes to the one-metre AO radius.
 if key!='terrace':
  for x in [-8.58,8.58]:cube((x,0,1.9),(.16,13.5,3.8))
  for y in [-6.83,6.83]:cube((0,y,1.9),(17,.16,3.8))
 cube((-.6,5.55,.48),(13,.65,.96))
 bpy.ops.mesh.primitive_plane_add(size=2);floor=bpy.context.object;floor.name='Baked contact floor / '+key;floor.scale=(8.5,6.75,1);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 material=bpy.data.materials.new('Contact lighting / '+key);material.use_nodes=True;nodes=material.node_tree.nodes;nodes.clear();links=material.node_tree.links
 ao=nodes.new('ShaderNodeAmbientOcclusion');ao.inputs['Distance'].default_value=1.05;ao.samples=16
 mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[0].default_value=.73;mix.inputs[1].default_value=(1,1,1,1);links.new(ao.outputs['Color'],mix.inputs[2])
 emission=nodes.new('ShaderNodeEmission');links.new(mix.outputs[0],emission.inputs['Color']);output=nodes.new('ShaderNodeOutputMaterial');links.new(emission.outputs[0],output.inputs['Surface'])
 image=bpy.data.images.new('realism_contact_'+key,width=1024,height=1024);image.colorspace_settings.name='Non-Color'
 target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target
 floor.data.materials.append(material)
 bpy.ops.object.select_all(action='DESELECT');floor.select_set(True);bpy.context.view_layer.objects.active=floor
 scene.render.bake.margin=2;scene.render.bake.use_clear=True
 bpy.ops.object.bake(type='EMIT')
 image.filepath_raw=str(OUT/(image.name+'.jpg'));image.file_format='JPEG';image.save();image.pack()
 bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('contact-'+key+'.blend')),compress=True)
 print('CONTACT_BAKE',key,flush=True)
