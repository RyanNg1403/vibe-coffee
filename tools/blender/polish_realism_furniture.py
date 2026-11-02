"""Blender furniture finishing, preserving café footprints and support heights.

Run after refine_realism_props.py and add_realism_drapery.py. This rebuilds the
three chair variants with finished joinery and adds upholstery/edge detailing
to the retained sofa and tables. Existing Golden Hour curtains are preserved.
VIBE_FURNITURE_KEY restricts work to one asset. -- --render makes a studio proof.
"""
import bpy
import bmesh
import json
import math
import os
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/blender/realism'
OUT = ROOT / 'public/models'
TAG = 'furniture_finish'
LAYOUTS = json.loads((ROOT / 'assets/blender/rebuild/layouts.json').read_text())
REPORT = {}
bpy.context.preferences.filepaths.save_version = 0


def mesh(name, vertices, faces, material, smooth=True, grain='horizontal'):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(material)
    obj[TAG] = True
    obj['atelier'] = True
    obj['grain_axis'] = grain
    for face in data.polygons:
        face.use_smooth = smooth
    return obj


def bevel_box(name, position, size, material, radius=.008, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel = obj.modifiers.new('Finished edge radius', 'BEVEL')
        bevel.width = min(radius, min(size) * .45)
        bevel.segments = segments
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        normal = obj.modifiers.new('Manufactured corner normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=normal.name)
    obj.data.materials.append(material)
    obj[TAG] = True
    obj['atelier'] = True
    return obj


def tube(name, points, radius, material, sides=8, grain='vertical'):
    points = [Vector(point) for point in points]
    vertices, previous = [], None
    for index, point in enumerate(points):
        tangent = (points[min(index + 1, len(points) - 1)] - points[max(index - 1, 0)]).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < .95 else Vector((1, 0, 0))
        a = (previous - tangent * previous.dot(tangent)).normalized() if previous is not None else tangent.cross(reference).normalized()
        if a.length < .1:
            a = tangent.cross(reference).normalized()
        previous = a
        b = tangent.cross(a).normalized()
        r = radius[index] if isinstance(radius, (tuple, list)) else radius
        for j in range(sides):
            vertices.append(tuple(point + r * (a * math.cos(j * math.tau / sides) + b * math.sin(j * math.tau / sides))))
    faces = [(i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
             for i in range(len(points) - 1) for j in range(sides)]
    faces += [tuple(range(sides - 1, -1, -1)), tuple((len(points) - 1) * sides + j for j in range(sides))]
    return mesh(name, vertices, faces, material, grain=grain)


def rounded_path(width, depth, radius, z, center=(0, 0), segments=4):
    result = []
    for x, y, start in [(1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)]:
        cx, cy = x * (width / 2 - radius) + center[0], y * (depth / 2 - radius) + center[1]
        for i in range(segments + 1):
            angle = math.radians(start + i * 90 / segments)
            result.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle), z))
    result.append(result[0])
    return result


def bent_back(seat, width, depth, walnut):
    # Rounded outline, five subtle height subdivisions and a true curved shell.
    # The maximum matches the previous .89 m café-chair back exactly.
    nx, nz = 16, 4
    half_width = (width + .025) * .5
    bottom, top, corner = seat + .20, seat + .43, .023
    vertices = []
    for side in (-1, 1):
        for j in range(nz + 1):
            v = j / nz
            for i in range(nx + 1):
                x = (i / nx - .5) * half_width * 2
                inset = max(0, abs(x) - (half_width - corner))
                trim = corner - math.sqrt(max(0, corner * corner - inset * inset))
                z = bottom + trim + (top - bottom - trim * 2) * v
                y = depth * .43 - .16 * (x / (width * .5)) ** 2 + side * .009
                vertices.append((x, y, z))
    faces = []
    layer = (nx + 1) * (nz + 1)
    for side in range(2):
        for j in range(nz):
            for i in range(nx):
                a = side * layer + j * (nx + 1) + i
                face = (a, a + 1, a + nx + 2, a + nx + 1)
                faces.append(tuple(reversed(face)) if side else face)
    boundary = list(range(nx + 1))
    boundary += [j * (nx + 1) + nx for j in range(1, nz + 1)]
    boundary += [nz * (nx + 1) + i for i in range(nx - 1, -1, -1)]
    boundary += [j * (nx + 1) for j in range(nz - 1, 0, -1)]
    for i, a in enumerate(boundary):
        b = boundary[(i + 1) % len(boundary)]
        faces.append((a + layer, b + layer, b, a))
    obj = mesh('Steam-bent walnut / radiused plywood edge', vertices, faces, walnut)
    closed = bmesh.new()
    closed.from_mesh(obj.data)
    assert closed.calc_volume(signed=True) > 0, 'Backrest shell winding must face outward'
    assert all(edge.is_manifold for edge in closed.edges), 'Backrest must be a closed plywood shell'
    closed.free()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bevel = obj.modifiers.new('Fine plywood edge radius', 'BEVEL')
    bevel.width = .003
    bevel.segments = 2
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = .45
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


def chairs(key, walnut, linen, brass):
    stool, arm = key == 'bar_stool', key == 'armchair'
    seat = .67 if stool else .46
    width, depth = (.54, .47) if arm else (.44, .43)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * width * .47, sy * depth * .48
            upper = (sx * width * .38, sy * depth * .36, seat - .055)
            tube('Tapered walnut leg / longitudinal grain', [(x, y, .008), upper], [.018, .024], walnut, 10)
            # A small turned collar provides a clean termination and protects
            # the end grain without enlarging the existing leg footprint.
            tube('Turned leg-end collar', [(x, y, .003), (x, y, .014)], .018, walnut, 10)
            tube('Flush floor glide', [(x, y, 0), (x, y, .003)], .015, walnut, 8)
    bevel_box('Rounded solid-walnut seat rail', (0, 0, seat - .028), (width, depth, .055), walnut, .024)
    bevel_box('Fitted woven-linen cushion', (0, -.009, seat + .017), (width - .035, depth - .035, .052), linen, .025)
    tube('Cushion perimeter / sewn linen welt', rounded_path(width - .043, depth - .043, .028, seat + .025, (0, -.009)), .0026, linen, 4, 'horizontal')
    bent_back(seat, width, depth, walnut)
    for x in (-width * .37, width * .37):
        # The support's hidden join is closed with a flush, grain-matched dowel.
        # Match the actual tessellated front face, including its local slope;
        # sampling the analytic arc leaves a sub-millimetre intersection and
        # an artificial bright sliver on the plug cap.
        step = (width + .025) / 16
        edge = math.floor((x + (width + .025) * .5) / step)
        xa = -(width + .025) * .5 + edge * step
        xb = xa + step
        ya = depth * .43 - .16 * (xa / (width * .5)) ** 2
        yb = depth * .43 - .16 * (xb / (width * .5)) ** 2
        slope = (yb - ya) / step
        y = ya + (x - xa) * slope - .009
        center = Vector((x, y, seat + .29))
        normal = Vector((slope, -1, 0)).normalized()
        # Sink only 3 mm of the post into the shell from its rear. Offsetting
        # by a fixed Y distance pierces a strongly curved wing at its inner edge.
        rear = Vector((x, y + .018, seat + .30)) - normal * .013
        support = tube('Back support / fitted tenon', [(x, depth * .32, seat - .04), rear], .016, walnut, 10)
        clearances = [vertex.co.y - (depth * .43 - .16 * (vertex.co.x / (width * .5)) ** 2 - .009)
                      for vertex in support.data.vertices if vertex.co.z > seat + .20]
        assert min(clearances) > .003, 'Back support must remain behind the front veneer'
        support['front_veneer_clearance_m'] = min(clearances)
        tube('Flush backrest dowel plug', [center - normal * .003, center + normal * .0006], .0065, walnut, 10, 'horizontal')
    if stool:
        points = [(.2 * math.cos(i * math.tau / 40), .2 * math.sin(i * math.tau / 40), .26) for i in range(41)]
        tube('Satin-brass foot rail', points, .012, brass, 8, 'horizontal')
    if arm:
        for side in (-1, 1):
            tube('Shaped walnut arm frame', [(side * .25, -.16, seat - .02), (side * .25, -.16, seat + .18), (side * .25, .075, seat + .20)], .02, walnut, 10)
            bevel_box('Upholstered arm cap', (side * .25, -.055, seat + .19), (.07, .27, .065), linen, .025)
            tube('Arm cap / stitched edge', rounded_path(.061, .258, .026, seat + .20, (side * .25, -.055)), .002, linen, 4)


def lathe(name, profile, material, count=48):
    vertices = [(r * math.cos(j * math.tau / count), r * math.sin(j * math.tau / count), z) for r, z in profile for j in range(count)]
    faces = [(i * count + j, i * count + (j + 1) % count, (i + 1) * count + (j + 1) % count, (i + 1) * count + j)
             for i in range(len(profile) - 1) for j in range(count)]
    return mesh(name, vertices, faces, material)


def table_edges(key, walnut):
    if key == 'side_table':
        lathe('Side table / routed underside', [(.212, .448), (.229, .451), (.235, .458), (.23, .46), (.212, .448)], walnut)
        for i in range(3):
            angle = i * math.tau / 3
            x, y = math.cos(angle) * .15, math.sin(angle) * .15
            tube('Side table / upper joinery collar', [(x, y, .425), (x, y, .44)], .026, walnut, 12)
        return
    venue = key.removeprefix('atelier_tables_')
    for table in LAYOUTS[venue]['tables']:
        if table.get('isBar'):
            continue
        height = table['surfaceY'] - table.get('baseY', 0)
        shape = table['shape']
        before = set(bpy.context.scene.objects)
        if shape in ['disc', 'circle', 'round', 'ellipse', 'oval']:
            rx, ry = table.get('rx', table.get('radius', 1)), table.get('rz', table.get('radius', 1))
            edge = lathe('Table underside / recessed cove', [(.94, height - .075), (.961, height - .073), (.977, height - .064), (.98, height - .056), (.955, height - .056), (.94, height - .075)], walnut)
            edge.scale = (rx, ry, 1)
        else:
            width, depth = table['width'], table['depth']
            bevel_box('Table underside / recessed edge moulding', (0, 0, height - .065), (width - .035, depth - .035, .026), walnut, .009)
        angle = table.get('rotation', 0)
        for obj in set(bpy.context.scene.objects) - before:
            x, y = obj.location.x, obj.location.y
            obj.location.x = math.cos(angle) * x - math.sin(angle) * y + table['center']['x']
            obj.location.y = math.sin(angle) * x + math.cos(angle) * y - table['center']['z']
            obj.location.z += table.get('baseY', 0)
            obj.rotation_euler.z += angle


def sofa_seams(linen):
    # Keep the cushion forms and seat height; complete the previously open welt.
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and obj.data.materials and all('ivory porcelain' in mat.name for mat in obj.data.materials):
            bpy.data.objects.remove(obj, do_unlink=True)
    for i in range(3):
        x = (i - 1) * .52
        for z in (.315, .445):
            tube('Sofa cushion / continuous sewn welt', rounded_path(.493, .619, .060, z, (x, -.035)), .0028, linen, 5)
        # Back-cushion edge follows its original 0.12-radian recline.
        points = rounded_path(.506, .425, .063, 0, segments=5)
        transformed = []
        for px, py, _ in points:
            # Local cushion x/z plane, slightly ahead of the front surface.
            dz, dy = py, -.092
            transformed.append((x + px, .25 + math.cos(-.12) * dy - math.sin(-.12) * dz, .65 + math.sin(-.12) * dy + math.cos(-.12) * dz))
        tube('Back cushion / tailored perimeter', transformed, .0025, linen, 5)


def map_uv(obj):
    if not obj.get(TAG):
        return
    uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='Furniture metre UV')
    for face in obj.data.polygons:
        normal = obj.matrix_world.to_3x3() @ face.normal
        dominant = max(range(3), key=lambda i: abs(normal[i]))
        axes = [i for i in range(3) if i != dominant]
        if obj.get('grain_axis') == 'vertical' and dominant != 2:
            axes = [2, 1 if dominant == 0 else 0]
        for loop in face.loop_indices:
            point = obj.matrix_world @ obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv = (point[axes[0]] * 2, point[axes[1]] * 2)


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return {'min': [min(point[i] for point in points) for i in range(3)], 'max': [max(point[i] for point in points) for i in range(3)]}


KEYS = ['studio_chair', 'bar_stool', 'armchair', 'sofa', 'side_table'] + ['atelier_tables_' + venue for venue in LAYOUTS]
selection = os.environ.get('VIBE_FURNITURE_KEY')
for key in KEYS:
    if selection and key != selection:
        continue
    file = SOURCE / (key + '.blend')
    bpy.ops.wm.open_mainfile(filepath=str(file))
    for obj in list(bpy.context.scene.objects):
        if obj.get(TAG):
            bpy.data.objects.remove(obj, do_unlink=True)
    original = bounds([obj for obj in bpy.context.scene.objects if obj.type == 'MESH']) if key not in ['studio_chair', 'bar_stool', 'armchair'] else None
    walnut = bpy.data.materials.get('Architectural / walnut')
    linen = bpy.data.materials.get('Architectural / linen')
    for name, material in [('walnut', walnut), ('linen', linen)]:
        if not material:
            with bpy.data.libraries.load(str(SOURCE / 'architectural-materials.blend'), link=False) as (source, target):
                target.materials = ['Architectural / ' + name]
            if name == 'walnut':
                walnut = target.materials[0]
            else:
                linen = target.materials[0]
    brass = bpy.data.materials.get('Atelier / satin brass')
    if not brass:
        brass = bpy.data.materials.new('Furniture / satin brass')
        brass.use_nodes = True
        shader = brass.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (.36, .24, .12, 1)
        shader.inputs['Metallic'].default_value = .8
        shader.inputs['Roughness'].default_value = .35
    if key in ['studio_chair', 'bar_stool', 'armchair']:
        chairs(key, walnut, linen, brass)
    elif key == 'sofa':
        sofa_seams(linen)
    else:
        table_edges(key, walnut)
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    for obj in objects:
        map_uv(obj)
    current = bounds(objects)
    if original:
        assert max(abs(current['max'][i] - original['max'][i]) for i in range(3)) < .004, (key, original, current)
        assert max(abs(current['min'][i] - original['min'][i]) for i in range(3)) < .004, (key, original, current)
    triangles = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    if key == 'studio_chair':
        assert triangles <= 2500, triangles
        assert abs(current['min'][2]) < .0001 and abs(current['max'][2] - .89) < .004, current
    bpy.ops.object.select_all(action='SELECT')
    # Keep meshes separate and named in the editable file; runtime static
    # batching/instancing reuses the two ordinary-chair material groups.
    bpy.ops.wm.save_as_mainfile(filepath=str(file), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / (key + '.glb')), export_format='GLB', use_selection=True, export_yup=True, export_animations=False, export_extras=True, export_cameras=False, export_lights=False)
    REPORT[key] = {'triangles': triangles, 'boundsBlender': current, 'originalBounds': original, 'finishedInBlender': True}
    print('FURNITURE_FINISH', key, json.dumps(REPORT[key]), flush=True)
(SOURCE / 'furniture-finish-report.json').write_text(json.dumps(REPORT, indent=2) + '\n')

if '--render' in sys.argv:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for key, position, angle in [('studio_chair', (-.58, -.12, 0), -.12), ('side_table', (.22, .05, 0), 0), ('armchair', (.95, .40, 0), .22)]:
        with bpy.data.libraries.load(str(SOURCE / (key + '.blend')), link=False) as (source, target):
            target.objects = list(source.objects)
        for obj in target.objects:
            if not obj or obj.type != 'MESH':
                continue
            bpy.context.collection.objects.link(obj)
            x, y = obj.location.x, obj.location.y
            obj.location.x = math.cos(angle) * x - math.sin(angle) * y + position[0]
            obj.location.y = math.sin(angle) * x + math.cos(angle) * y + position[1]
            obj.rotation_euler.z += angle
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.18, .20, .22, 1)
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.location.z = -.003
    floor_material = bpy.data.materials.new('Studio / warm mineral floor')
    floor_material.diffuse_color = (.44, .42, .38, 1)
    floor.data.materials.append(floor_material)
    bpy.ops.object.camera_add(location=(2.3, -3.5, 2.0))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((.12, .1, .42)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.65
    scene.camera = camera
    for position, power, size in [((-2, -3, 4), 600, 4), ((2, 2, 3), 400, 3)]:
        bpy.ops.object.light_add(type='AREA', location=position)
        light = bpy.context.object
        light.data.energy = power
        light.data.size = size
        light.rotation_euler = (Vector((0, 0, .4)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(ROOT / 'docs/realism/furniture-study.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'furniture-study.blend'), compress=True)
    bpy.ops.render.render(write_still=True)
