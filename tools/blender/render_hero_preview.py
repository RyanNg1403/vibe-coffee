"""Studio preview of exported GLBs, re-imported so the shipped data is checked.

    blender -b --python tools/blender/render_hero_preview.py -- <glb> <png> [yaw_degrees] [elevation_degrees]
"""
import bpy, math, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
yaw = math.radians(float(args[2]) if len(args) > 2 else 35)
elevation = math.radians(float(args[3]) if len(args) > 3 else 18)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in scene.objects if o.type == 'MESH']
lo = Vector((min((o.matrix_world @ Vector(c))[i] for o in objs for c in o.bound_box) for i in range(3)))
hi = Vector((max((o.matrix_world @ Vector(c))[i] for o in objs for c in o.bound_box) for i in range(3)))
center, size = (lo + hi) / 2, (hi - lo)
radius = size.length / 2

bpy.ops.mesh.primitive_plane_add(size=radius * 40, location=(center.x, center.y, lo.z))
floor = bpy.context.object
m = bpy.data.materials.new('floor'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.3, 0.28, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
floor.data.materials.append(m)

world = bpy.data.worlds.new('studio'); scene.world = world; world.use_nodes = True
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'NISHITA'; sky.sun_elevation = math.radians(35); sky.sun_rotation = math.radians(140)
sky.sun_intensity = 0.25
world.node_tree.links.new(sky.outputs[0], world.node_tree.nodes['Background'].inputs[0])
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25

def area(name, loc, power, size_m, color=(1, 0.95, 0.88)):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = power; d.size = size_m; d.color = color
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = loc
    direction = center - Vector(loc); o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

r = max(radius, 0.05)
area('key', (center.x - r * 2.5, center.y - r * 3.2, center.z + r * 3.0), 120 * r * r, r * 2.5)
area('fill', (center.x + r * 3.5, center.y - r * 1.5, center.z + r * 1.2), 35 * r * r, r * 3, (0.85, 0.9, 1))
area('rim', (center.x + r * 1.5, center.y + r * 3.5, center.z + r * 2.5), 80 * r * r, r * 2)

cam_d = radius * 2.9
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
cam.data.lens = 50
cam.location = center + Vector((math.sin(yaw) * math.cos(elevation), -math.cos(yaw) * math.cos(elevation), math.sin(elevation))) * cam_d
cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 960, 720
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
