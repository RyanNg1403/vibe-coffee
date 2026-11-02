"""Read-only Blender studio proofs of the authored daytime countertop displays."""
import bpy,os
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/collection';OUT.mkdir(parents=True,exist_ok=True)
for venue in ['goldenhour','roastery']:
    if os.environ.get('VIBE_DECOR') and os.environ['VIBE_DECOR']!=venue:continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/collection'/('atelier_decor_'+venue+'.blend')))
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=False
    scene.cycles.max_bounces=10;scene.cycles.transmission_bounces=8
    # Cycles does not apply the viewport/glTF backface-culling switch. Mirror
    # that material setting in this temporary render graph so hollow alpha
    # glass does not acquire extra back-wall opacity in the studio proof.
    for material in bpy.data.materials:
        if not material.use_nodes or not material.use_backface_culling:continue
        nodes,links=material.node_tree.nodes,material.node_tree.links
        shader=nodes.get('Principled BSDF');output=nodes.get('Material Output')
        if not shader or not output:continue
        geometry=nodes.new('ShaderNodeNewGeometry');transparent=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader')
        links.new(geometry.outputs['Backfacing'],mix.inputs[0]);links.new(shader.outputs[0],mix.inputs[1]);links.new(transparent.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs['Surface'])
    scene.render.resolution_x=1500;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    if not scene.world:scene.world=bpy.data.worlds.new('Countertop daylight studio')
    scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.19,.21,.22,1);scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.45
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001));floor=bpy.context.object
    mat=bpy.data.materials.new('Neutral limestone studio surface');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.25,.24,.215,1);p.inputs['Roughness'].default_value=.83;floor.data.materials.append(mat)
    target=Vector((0,0,.29));bpy.ops.object.camera_add(location=(1.0,-3.3,1.35));camera=bpy.context.object;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=1.97;scene.camera=camera
    for location,power,size in [((-1.5,-1.7,2.6),170,2.0),((1.2,-.7,1.7),85,1.4),((.3,1.1,2.2),190,1.5)]:
        bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/(venue+'-countertop-studio.png'));bpy.ops.render.render(write_still=True)
