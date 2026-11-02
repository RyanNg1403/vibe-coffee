import bpy,math,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
KEY=os.environ.get("VIBE_CHARACTER_KEY","char_atelier_1")
OUT=ROOT/"docs/realism/portraits"
OUT.mkdir(parents=True,exist_ok=True)
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/realism'/(KEY+'.blend')))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=False
scene.render.resolution_x=720;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.color=(.18,.18,.18)
bpy.ops.mesh.primitive_plane_add(size=200)
plane=bpy.context.object;plane.location.z=-.01
mat=bpy.data.materials.new('Backdrop');mat.diffuse_color=(.12,.14,.14,1);plane.data.materials.append(mat)
bpy.ops.object.camera_add(location=(2.2,-3.6,1.75));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.86))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.25;scene.camera=cam
for pos,power,size in [((1,-3,4),450,4),((-3,-1,2),250,3),((1,2,3),550,2)]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/(KEY+'-standing.png'));bpy.ops.render.render(write_still=True)
rig=bpy.data.objects['CafePortraitRig'];rig.animation_data.action=bpy.data.actions['Sitting'];scene.frame_set(1)
scene.render.filepath=str(OUT/(KEY+'-seated.png'));bpy.ops.render.render(write_still=True)
