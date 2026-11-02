"""Studio evidence rendered from the editable pet sources, including held rest poses."""
import bpy,math,os
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/realism/pets';OUT.mkdir(parents=True,exist_ok=True)
for kind in ['cat','dog']:
 if os.environ.get('VIBE_PET') and os.environ['VIBE_PET']!=kind:continue
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/realism'/('pet_'+kind+'.blend')))
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False
 scene.render.resolution_x=1100;scene.render.resolution_y=850;scene.render.resolution_percentage=100
 scene.view_settings.view_transform='AgX'
 if not scene.world:scene.world=bpy.data.worlds.new('Pet portrait studio')
 scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.15,.17,.18,1);scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.25
 rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH');bounds=body.get('pet_bounds');floor_z=bounds[1]-.001 if bounds else -.001
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,floor_z));floor=bpy.context.object
 mat=bpy.data.materials.new('Neutral studio floor');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.12,.14,.14,1);p.inputs['Roughness'].default_value=.92;floor.data.materials.append(mat)
 target=Vector((0,-.015,.20 if kind=='cat' else .30));campos=Vector((.76,-.88,.50)) if kind=='cat' else Vector((1.12,-1.35,.75))
 bpy.ops.object.camera_add(location=campos);cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=.91 if kind=='cat' else 1.36;scene.camera=cam
 for pos,power,size in [((.8,-1.1,1.8),80,1.4),((-1,-.4,.9),45,1.2),((.3,1.0,1.3),75,1.0)]:
  bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
 for label,action in [('standing','idle'),('resting','death')]:
  rig.animation_data.action=bpy.data.actions[action];scene.frame_set(0 if action=='idle' else int(bpy.data.actions[action].frame_range[1]));bpy.context.view_layer.update()
  scene.render.filepath=str(OUT/('pet-'+kind+'-'+label+'.png'));bpy.ops.render.render(write_still=True)
