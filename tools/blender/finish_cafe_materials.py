"""Quiet satin timber and tailored linen for the four café collections.

Uses the approved realism furniture as immutable input. All geometry, seating
heights, and Golden Hour curtains are retained. Blender authors the shared
surface fields, per-board UVs/vertex finish, material palettes, and GLB exports.
Run with -- --render to make the four-finish studio proof.
"""
import bpy
import faulthandler
faulthandler.enable()
import hashlib
import json
import math
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / 'assets/blender/realism'
SOURCE = ROOT / 'assets/blender/collection'
TEXTURES = SOURCE / 'textures'
PUBLIC = ROOT / 'public/textures'
SOURCE.mkdir(parents=True, exist_ok=True)
TEXTURES.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
LAYOUTS = json.loads((ROOT / 'assets/blender/rebuild/layouts.json').read_text())
PALETTES = {
    'goldenhour': {'timber': [.76, .55, .35], 'linen': [.84, .87, .90], 'roughness': .97},
    'roastery': {'timber': [.52, .43, .34], 'linen': [.18, .22, .24], 'roughness': .93},
    'midnight': {'timber': [.25, .19, .15], 'linen': [.25, .055, .065], 'roughness': .90},
    'terrace': {'timber': [.82, .83, .72], 'linen': [.48, .60, .46], 'roughness': 1.0},
}
KEYS = ['studio_chair', 'bar_stool', 'armchair', 'sofa', 'side_table'] + ['atelier_tables_' + venue for venue in PALETTES]


def image_field(name, rgb, color):
    height, width = rgb.shape[:2]
    image = bpy.data.images.new(name, width=width, height=height, float_buffer=True)
    image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    rgba = np.concatenate((np.clip(rgb, 0, 1), np.ones((height, width, 1))), axis=-1).astype(np.float32)
    image.pixels.foreach_set(rgba.ravel())
    image.file_format = 'JPEG'
    image.filepath_raw = str(PUBLIC / (name + '.jpg'))
    image.save()
    # A source-local copy makes the collection independently inspectable.
    (TEXTURES / (name + '.jpg')).write_bytes((PUBLIC / (name + '.jpg')).read_bytes())
    image.pack()
    return image


def author_timber_fields():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    size = 1024
    scan = bpy.data.images.load(str(PUBLIC / 'wood_dark.jpg'))
    scan.scale(size, size)
    raw = np.empty(size * size * 4, np.float32)
    scan.pixels.foreach_get(raw)
    rgb = raw.reshape(size, size, 4)[..., :3]
    luminance = np.maximum(rgb @ np.array([.2126, .7152, .0722]), .0001)
    # Retain actual scanned pores while suppressing broad orange/black bands.
    frequency = np.fft.fftfreq(size)
    lowpass = np.exp(-2 * math.pi ** 2 * 18 ** 2 * (frequency[:, None] ** 2 + frequency[None, :] ** 2))
    broad = np.fft.ifft2(np.fft.fft2(luminance) * lowpass).real
    pores = luminance - broad
    broad = (broad - broad.mean()) / max(broad.std(), 1e-6)
    pores = pores / max(pores.std(), 1e-6)
    grain = np.clip(broad * .016 + pores * .017, -.055, .055)
    color = np.array([.23, .205, .175]) * (1 + grain[..., None])
    roughness = np.clip(.64 + broad * .014 + pores * .011, .59, .69)
    # The finish relief is measured in tens of micrometres, not deep ridges.
    height = np.clip(pores, -2, 2) * .000012 + broad * .000005
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * size / 2
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * size / 2
    normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1)[..., None]
    image_field('collection_timber_color', color, True)
    image_field('collection_timber_normal', normal * .5 + .5, False)
    image_field('collection_timber_roughness', np.repeat(roughness[..., None], 3, axis=-1), False)


def material(name, surface, tint, roughness=1):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['IOR'].default_value = 1.46
    mat.diffuse_color = (*tint, 1)
    maps = {}
    for channel in ('color', 'normal', 'roughness'):
        filename = 'collection_timber_' + channel + '.jpg' if surface == 'timber' else 'realism_linen_' + channel + '.jpg'
        path = PUBLIC / filename
        image = bpy.data.images.load(str(path), check_existing=True)
        image.colorspace_settings.name = 'sRGB' if channel == 'color' else 'Non-Color'
        image.pack()
        node = nodes.new('ShaderNodeTexImage')
        node.image = image
        maps[channel] = node
    # Blender 4's glTF exporter reads factor × attribute × texture from the
    # modern Mix node; the legacy MixRGB node silently drops the color factor.
    color_tint = nodes.new('ShaderNodeMix')
    color_tint.data_type = 'RGBA'
    color_tint.blend_type = 'MULTIPLY'
    color_tint.inputs[0].default_value = 1
    color_tint.inputs[7].default_value = (*tint, 1)
    links.new(maps['color'].outputs['Color'], color_tint.inputs[6])
    vertex = nodes.new('ShaderNodeVertexColor')
    vertex.layer_name = 'Finish variation'
    finish = nodes.new('ShaderNodeMix')
    finish.data_type = 'RGBA'
    finish.blend_type = 'MULTIPLY'
    finish.inputs[0].default_value = 1
    links.new(color_tint.outputs[2], finish.inputs[6])
    links.new(vertex.outputs['Color'], finish.inputs[7])
    links.new(finish.outputs[2], bsdf.inputs['Base Color'])
    rough = nodes.new('ShaderNodeMath')
    rough.operation = 'MULTIPLY'
    rough.inputs[1].default_value = roughness
    links.new(maps['roughness'].outputs['Color'], rough.inputs[0])
    links.new(rough.outputs[0], bsdf.inputs['Roughness'])
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = .24 if surface == 'timber' else .38
    links.new(maps['normal'].outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs[0], bsdf.inputs['Normal'])
    if surface == 'timber':
        bsdf.inputs['Coat Weight'].default_value = .03
        bsdf.inputs['Coat Roughness'].default_value = .6
    else:
        bsdf.inputs['Sheen Weight'].default_value = .35
        bsdf.inputs['Sheen Roughness'].default_value = .8
    mat['collection_surface'] = surface
    mat['linear_tint'] = tint
    return mat


def geometry_signature(objects, include_uv=False):
    data = []
    for obj in sorted(objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        item = (obj.name, [list(row) for row in obj.matrix_world], [list(v.co) for v in obj.data.vertices], [list(face.vertices) for face in obj.data.polygons])
        if include_uv:
            item += ([list(loop.uv) for layer in obj.data.uv_layers for loop in layer.data], [mat.name for mat in obj.data.materials])
        data.append(item)
    return hashlib.sha256(json.dumps(data).encode()).hexdigest()


def components(data):
    parent = list(range(len(data.vertices)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for edge in data.edges:
        a, b = (find(int(i)) for i in edge.vertices)
        parent[b] = a
    groups = {}
    for vertex in data.vertices:
        groups.setdefault(find(vertex.index), []).append(vertex.index)
    return list(groups.values())


def finish_mesh(obj, key, surface):
    data = obj.data
    if not data.uv_layers.active:
        data.uv_layers.new(name='Furniture metre UV')
    if not data.color_attributes.get('Finish variation'):
        data.color_attributes.new(name='Finish variation', type='FLOAT_COLOR', domain='CORNER')
    # Adding a generic color attribute can reallocate Blender's custom-data
    # layer array. Fetch both RNA handles only after all layers exist.
    uv = data.uv_layers.active
    color = data.color_attributes['Finish variation']
    data.color_attributes.active_color = color
    vertex_group, groups = {}, components(data)
    world = [obj.matrix_world @ vertex.co for vertex in data.vertices]
    venue = key.removeprefix('atelier_tables_') if key.startswith('atelier_tables_') else None
    specifications = []
    for group_index, indices in enumerate(groups):
        points = [world[i] for i in indices]
        center = sum(points, Vector()) / len(points)
        salt = int(hashlib.sha256((key + ':' + obj.name + ':' + str(group_index)).encode()).hexdigest()[:8], 16)
        offset = ((salt % 997) / 997, ((salt // 997) % 991) / 991)
        variation = .958 + ((salt // 31) % 101) / 101 * .026
        angle, anchor = 0, center
        if venue:
            table = min((table for table in LAYOUTS[venue]['tables'] if not table.get('isBar')),
                        key=lambda table: (table['center']['x'] - center.x) ** 2 + (-table['center']['z'] - center.y) ** 2)
            angle = table.get('rotation', 0)
            anchor = Vector((table['center']['x'], -table['center']['z'], table.get('baseY', 0)))
        specifications.append((variation, offset, angle, anchor))
        for i in indices:
            vertex_group[i] = group_index
    # Smoothly brighten only genuine radiused borders, without painted scratches.
    face_normals = [[] for _ in data.vertices]
    for face in data.polygons:
        for i in face.vertices:
            face_normals[i].append(face.normal)
    curvature = []
    for normals in face_normals:
        average = sum(normals, Vector()) / max(1, len(normals))
        curvature.append(min(1, max(0, 1 - average.length) * 5))
    for face in data.polygons:
        dominant = max(range(3), key=lambda i: abs(face.normal[i]))
        for loop in face.loop_indices:
            vertex = data.loops[loop].vertex_index
            variation, offset, angle, anchor = specifications[vertex_group[vertex]]
            point = world[vertex] - anchor
            x = math.cos(angle) * point.x + math.sin(angle) * point.y
            y = -math.sin(angle) * point.x + math.cos(angle) * point.y
            z = point.z
            vertical = obj.get('grain_axis') == 'vertical' or ('leg' in obj.name.lower() and dominant != 2)
            if surface == 'linen':
                axes = [i for i in range(3) if i != dominant]
                coordinate = (x, y, z)
                uv.data[loop].uv = (coordinate[axes[0]] * 1.35, coordinate[axes[1]] * 1.35)
                shade = .98 + (variation - .958) * .4
            else:
                if dominant == 2:
                    u, v = x * .92, y * 1.15
                elif vertical:
                    u, v = z * 1.1, (y if dominant == 0 else x) * 1.15
                elif dominant == 1:
                    u, v = x * .92, z * 1.15
                else:
                    u, v = y * .92, z * 1.15
                uv.data[loop].uv = (u + offset[0], v + offset[1])
                shade = min(1, variation + curvature[vertex] * .018)
            color.data[loop].color = (shade, shade, shade, 1)


render_only = '--render-only' in sys.argv
if not render_only:
    author_timber_fields()
    print('TIMBER_FIELDS_READY',flush=True)
report = {
    'timberMapMeanLinearRGB': [.23, .205, .175], 'timberContrastLimit': .055,
    'timberRoughnessMean': .64, 'timberNormalStrength': .24, 'clearcoat': .03,
    'clearcoatRoughness': .6, 'linenNormalStrength': .38, 'linenSheen': .35,
    'linenSheenRoughness': .8, 'palettesLinearRGB': PALETTES,
    'textureSource': 'Derived from retained ambientCG Wood067 (wood_dark.jpg); see CREDITS.md',
    'models': {},
}
for key in ([] if render_only else KEYS):
    print('OPEN_COLLECTION_INPUT',key,flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(INPUT / (key + '.blend')))
    bpy.context.preferences.filepaths.save_version = 0
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.context.view_layer.update()
    geometry_before = geometry_signature(objects)
    curtains = [obj for obj in objects if obj.get('architectural_drapery')]
    curtains_before = geometry_signature(curtains, include_uv=True)
    venue = key.removeprefix('atelier_tables_') if key.startswith('atelier_tables_') else 'goldenhour'
    palette = PALETTES[venue]
    wood = material('Collection / ' + venue + ' timber', 'timber', palette['timber'], palette['roughness'])
    linen = material('Collection / linen upholstery', 'linen', palette['linen'])
    print('MATERIALS_READY',key,flush=True)
    modified = 0
    for obj in objects:
        if obj in curtains:
            continue
        surfaces = set()
        for index, old in enumerate(obj.data.materials):
            name = old.name.lower()
            surface = 'timber' if any(term in name for term in ['walnut', 'smoked oak', 'honey ash']) else 'linen' if 'linen' in name else None
            if surface:
                obj.data.materials[index] = wood if surface == 'timber' else linen
                surfaces.add(surface)
        if surfaces:
            assert len(surfaces) == 1, 'Furniture input must separate timber and linen primitives'
            finish_mesh(obj, key, next(iter(surfaces)))
            modified += 1
    assert geometry_signature(objects) == geometry_before, 'Surface finishing changed geometry'
    assert geometry_signature(curtains, include_uv=True) == curtains_before, 'Golden Hour curtains changed'
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / (key + '.blend')), compress=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models' / (key + '.glb')), export_format='GLB',
                             use_selection=True, export_yup=True, export_animations=False, export_extras=True,
                             export_cameras=False, export_lights=False)
    report['models'][key] = {'palette': venue, 'finishedMeshes': modified, 'geometryUnchanged': True,
                             'curtainsUnchanged': True, 'bytesBeforePacking': (ROOT / 'public/models' / (key + '.glb')).stat().st_size}
    print('COLLECTION_FURNITURE', key, json.dumps(report['models'][key]), flush=True)
if not render_only:
    (SOURCE / 'furniture-material-report.json').write_text(json.dumps(report, indent=2) + '\n')

if '--render' in sys.argv or render_only:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    for index, (venue, palette) in enumerate(PALETTES.items()):
        center = (index - 1.5) * 1.55
        for key, dx, dy in [('studio_chair', -.25, .12), ('side_table', .43, -.16)]:
            with bpy.data.libraries.load(str(SOURCE / (key + '.blend')), link=False) as (source, target):
                target.objects = list(source.objects)
            for obj in target.objects:
                if obj is None or obj.type != 'MESH':
                    continue
                bpy.context.collection.objects.link(obj)
                obj.location.x += center + dx
                obj.location.y += dy
                for slot, old in enumerate(obj.data.materials):
                    if 'timber' in old.name:
                        obj.data.materials[slot] = material('Study / ' + venue + ' timber', 'timber', palette['timber'], palette['roughness'])
                    elif 'linen' in old.name:
                        obj.data.materials[slot] = material('Study / ' + venue + ' linen', 'linen', palette['linen'])
        bpy.ops.object.text_add(location=(center - .45, -.82, .009))
        label = bpy.context.object
        label.data.body = {'goldenhour': 'GOLDEN HOUR', 'roastery': 'ROASTERY', 'midnight': 'MIDNIGHT', 'terrace': 'TERRACE'}[venue]
        label.data.size = .11
        label.rotation_euler = (0, 0, 0)
        label_material = bpy.data.materials.new('Study label / ' + venue)
        label_material.diffuse_color = (.12, .105, .085, 1)
        label.data.materials.append(label_material)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    if not scene.world:
        scene.world = bpy.data.worlds.new('Collection studio daylight')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.22, .23, .25, 1)
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.location.z = -.004
    floor_material = bpy.data.materials.new('Study / mineral floor')
    floor_material.diffuse_color = (.52, .50, .46, 1)
    floor.data.materials.append(floor_material)
    bpy.ops.object.camera_add(location=(3.4, -8, 4.4))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, .36)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 7.3
    scene.camera = camera
    for position, power, size in [((-2, -3, 5), 850, 5), ((3, 2, 4), 550, 4)]:
        bpy.ops.object.light_add(type='AREA', location=position)
        light = bpy.context.object
        light.data.energy = power
        light.data.size = size
        light.rotation_euler = (Vector((0, 0, .5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    proof = ROOT / 'docs/collection/furniture-study.png'
    proof.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(proof)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'furniture-study.blend'), compress=True)
    bpy.ops.render.render(write_still=True)
