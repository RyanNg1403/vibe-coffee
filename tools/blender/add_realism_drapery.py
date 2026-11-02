"""Append gathered linen at Golden Hour's window columns in Blender.

Run after refine_realism_props.py. The table assembly keeps its world origin.
Pass -- --export to update the runtime GLB, or -- --render for a cloth study.
Repeated runs replace only objects tagged architectural_drapery.
"""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/blender/realism'
FILE = SOURCE / 'atelier_tables_goldenhour.blend'
KEY = 'architectural_drapery'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.open_mainfile(filepath=str(FILE))
for obj in list(bpy.context.scene.objects):
    if obj.get(KEY):
        bpy.data.objects.remove(obj, do_unlink=True)


def furniture_signature():
    """Check that app-authored table geometry and transforms survive intact."""
    geometry = []
    for obj in sorted(bpy.context.scene.objects, key=lambda item: item.name):
        if obj.type != 'MESH' or obj.get(KEY):
            continue
        geometry.append((obj.name, [list(row) for row in obj.matrix_world],
                         [list(vertex.co) for vertex in obj.data.vertices],
                         [list(face.vertices) for face in obj.data.polygons]))
    return hashlib.sha256(json.dumps(geometry).encode()).hexdigest()


original_furniture = furniture_signature()

linen = bpy.data.materials.get('Architectural / linen')
if not linen:
    with bpy.data.libraries.load(str(SOURCE / 'architectural-materials.blend'), link=False) as (source, target):
        target.materials = ['Architectural / linen']
    linen = target.materials[0]
linen.use_backface_culling = False
bronze = bpy.data.materials.get('Drapery / aged bronze') or bpy.data.materials.new('Drapery / aged bronze')
bronze.use_nodes = True
shader = bronze.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = (.13, .085, .045, 1)
shader.inputs['Metallic'].default_value = .75
shader.inputs['Roughness'].default_value = .42
added = []


def tag(obj):
    obj[KEY] = True
    obj['atelier'] = True
    obj['architectural_materials'] = True
    added.append(obj)
    return obj


def cylinder(name, start, end, radius, material, vertices=12):
    a, b = Vector(start), Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(a + b) * .5)
    obj = tag(bpy.context.object)
    obj.name = name
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return obj


def panel(name, center, tangent, inward, width=.53):
    """Measured 2.74 m drop with a restrained five-fold gathered heading."""
    center, tangent, inward = Vector(center), Vector(tangent), Vector(inward)
    nx, ny, pleats = 20, 16, 5
    top, bottom = 2.86, .12
    vertices, uv = [], []
    for j in range(ny + 1):
        v = j / ny
        # Slightly fuller lower fabric, without a scalloped/fantasy silhouette.
        spread = width * (.88 + .12 * v)
        for i in range(nx + 1):
            u = i / nx
            phase = u * math.tau * pleats + .09 * math.sin(v * math.pi * 1.6)
            fold = .037 * math.cos(phase) + .006 * math.cos(phase * 2 + .4)
            fold += .006 * math.sin(v * math.pi * 2 + u * math.pi)
            z = top + (bottom - top) * v + .007 * math.sin(phase) * v ** 4
            p = center + tangent * ((u - .5) * spread) + inward * fold
            p.z = z
            vertices.append(tuple(p))
            uv.append((u * width * 4, (1 - v) * (top - bottom) * 4))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = tag(bpy.data.objects.new(name, mesh))
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(linen)
    layer = mesh.uv_layers.new(name='Linen metre weave')
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            layer.data[loop].uv = uv[mesh.loops[loop].vertex_index]
    # A thin folded edge catches daylight; the cloth is a surface, not a tube.
    solid = obj.modifiers.new('Sewn cloth thickness', 'SOLIDIFY')
    solid.thickness = .0025
    solid.offset = 0
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solid.name)
    obj.select_set(False)
    # Bottom folded hem follows the actual pleated surface, slightly proud.
    hem_vertices = []
    for j in (0, 1):
        for i in range(nx + 1):
            p = Vector(vertices[ny * (nx + 1) + i]) + inward * .002
            p.z += .032 * j
            hem_vertices.append(tuple(p))
    hem_faces = [(i, i + 1, i + nx + 2, i + nx + 1) for i in range(nx)]
    hem_mesh = bpy.data.meshes.new(name + ' hem')
    hem_mesh.from_pydata(hem_vertices, [], hem_faces)
    hem_mesh.update()
    hem = tag(bpy.data.objects.new(name + ' / folded hem', hem_mesh))
    bpy.context.collection.objects.link(hem)
    hem_mesh.materials.append(linen)
    for polygon in hem_mesh.polygons:
        polygon.use_smooth = True
    # Five small hanging rings, each aligned perpendicular to the rod.
    for i in range(pleats):
        p = center + tangent * ((i + .5) / pleats - .5) * width * .88
        p.z = 2.89
        bpy.ops.mesh.primitive_torus_add(major_segments=10, minor_segments=4, location=p, major_radius=.024, minor_radius=.0035)
        ring = tag(bpy.context.object)
        ring.name = name + ' / heading ring'
        ring.rotation_euler = tangent.to_track_quat('Z', 'Y').to_euler()
        ring.data.materials.append(bronze)
        for polygon in ring.data.polygons:
            polygon.use_smooth = True


# Front columns are outside the door's ±0.7 m arrival lane. The rods sit above
# the window headers and all fabric lies behind the window-counter rear edge.
for side in (-1, 1):
    panel('Front inner linen ' + str(side), (side * .99, -6.57, 0), (1, 0, 0), (0, 1, 0), .46)
    panel('Front outer linen ' + str(side), (side * 7.95, -6.57, 0), (1, 0, 0), (0, 1, 0))
    cylinder('Front bronze curtain rod', (side * .75, -6.57, 2.915), (side * 8.22, -6.57, 2.915), .012, bronze)
    for x in (side * .79, side * 8.17):
        cylinder('Front rod wall bracket', (x, -6.75, 2.915), (x, -6.57, 2.915), .009, bronze)

# The long side window keeps the central view open. Narrow end panels stay
# within 0.27 m of the wall and away from the writing desk and lounge chairs.
for y in (-5.94, 5.94):
    panel('Side linen ' + str(y), (-8.27, y, 0), (0, 1, 0), (1, 0, 0))
cylinder('Side bronze curtain rod', (-8.27, -6.24, 2.915), (-8.27, 6.24, 2.915), .012, bronze)
for y in (-6.15, 0, 6.15):
    cylinder('Side rod wall bracket', (-8.5, y, 2.915), (-8.27, y, 2.915), .009, bronze)

bpy.context.view_layer.update()
triangles = 0
for obj in added:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
points = [obj.matrix_world @ Vector(corner) for obj in added for corner in obj.bound_box]
report = {
    'panels': 6,
    'addedTriangles': triangles,
    'boundsBlender': {
        'min': [min(p[i] for p in points) for i in range(3)],
        'max': [max(p[i] for p in points) for i in range(3)],
    },
    'frontFabricNearestDoorX': .99 - .46 / 2,
    'frontFabricNearestRoomZ': 6.57 - .049,
    'tableGeometryPreserved': furniture_signature() == original_furniture,
}
assert report['tableGeometryPreserved'], 'Drapery generation modified table geometry'
(SOURCE / 'drapery-report.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(FILE), compress=True)
print('DRAPERY_REPORT', json.dumps(report), flush=True)

if '--export' in sys.argv:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/atelier_tables_goldenhour.glb'), export_format='GLB', use_selection=True, export_yup=True, export_animations=False, export_extras=True, export_cameras=False, export_lights=False)

if '--render' in sys.argv:
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.world.color = (.2, .2, .2)
    # This isolated Blender cloth study is explicitly separate from app shots.
    for obj in list(scene.objects):
        obj.hide_render = not obj.name.startswith('Front inner linen -1')
    bpy.ops.object.camera_add(location=(.1, -3.9, 1.9))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((-.99, -6.57, 1.5)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 3.25
    scene.camera = camera
    for position, power, size in [((1, -4, 3.2), 350, 3), ((-2, -6, 3), 100, 2)]:
        bpy.ops.object.light_add(type='AREA', location=position)
        light = bpy.context.object
        light.data.energy = power
        light.data.size = size
        light.rotation_euler = (Vector((-.99, -6.57, 1.5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = '/tmp/vibe-linen-study.png'
    bpy.ops.render.render(write_still=True)
