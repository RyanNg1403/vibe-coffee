"""Render the actual editable Blender cast as a labeled studio contact sheet."""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent))
from portrait_variations import PROFILES
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=False
scene.render.resolution_x=2400;scene.render.resolution_y=2250;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Neutral studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.12,.13,.14,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35
text_material=bpy.data.materials.new('Cast labels');text_material.use_nodes=True
shader=text_material.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.55,.59,.57,1);shader.inputs['Roughness'].default_value=.9
for index,spec in enumerate(PROFILES):
 path=ROOT/'assets/blender/realism'/('char_atelier_'+str(index+1)+'.blend')
 with bpy.data.libraries.load(str(path),link=False) as (src,dst):dst.objects=list(src.objects)
 objects=[o for o in dst.objects if o]
 for obj in objects:scene.collection.objects.link(obj)
 rig=next(o for o in objects if o.type=='ARMATURE')
 col=index%6;row=index//6;x=(col-2.5)*1.12;z=(2-row)*2.04
 rig.location+=Vector((x,0,z))
 # Compact, useful labels identify the individual asset without claiming new
 # source identities. The runtime and .blend share these exact characters.
 font=bpy.data.curves.new('Portrait label','FONT');font.body=f'{index+1:02d}  '+spec['name'].split(' / ')[-1]
 font.size=.065;font.align_x='CENTER';font.space_character=1.04
 label=bpy.data.objects.new('Asset '+str(index+1)+' label',font);scene.collection.objects.link(label)
 label.location=(x,-.23,z-.17);label.rotation_euler.x=math.pi/2;label.data.materials.append(text_material)
 if len(font.body)>30:font.size=.052
scene.frame_set(1)
bpy.ops.object.camera_add(location=(0,-12,2.89));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,2.89))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=6.9;scene.camera=camera
for location,power,size in [((-3,-4,7),1800,7),((4,-3,5),1200,6),((0,3,7),1800,5)]:
 bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size
 light.rotation_euler=(Vector((0,0,3))-light.location).to_track_quat('-Z','Y').to_euler()
scene.view_settings.view_transform='AgX'
scene.render.filepath=str(ROOT/'docs/realism/portraits/cast-sheet.png')
bpy.ops.render.render(write_still=True)
