"""Rebuild the original café assets with Blender 4.3+ (no downloads).

blender --background --threads 4 --python tools/blender/build_cafe_assets.py
Coordinates are metres, Z-up in Blender and Y-up in the exported GLBs.
"""
from pathlib import Path
import json
import math
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / 'public/models'
TEXTURE_DIR = ROOT / 'public/textures'
SOURCE_DIR = ROOT / 'assets/blender'
for directory in (MODEL_DIR, TEXTURE_DIR, SOURCE_DIR):
    directory.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)
REPORT = {'generator': 'tools/blender/build_cafe_assets.py', 'models': {}, 'textures': {}}


def surface_maps(name, kind, size=512):
    """Periodic, physically scaled surface fields; no runtime noise shaders."""
    rng = np.random.default_rng(1403 + len(name))
    y, x = np.mgrid[0:size, 0:size] / size

    def noise(sx, sy):
        # A periodic Fourier field keeps derivatives continuous at tile edges.
        field = rng.normal(size=(size, size))
        fx = np.fft.fftfreq(size)[None, :] * size
        fy = np.fft.fftfreq(size)[:, None] * size
        field = np.fft.ifft2(np.fft.fft2(field) * np.exp(-0.5 * ((fx / sx)**2 + (fy / sy)**2))).real
        return field / max(field.std(), 1e-6)

    fine = noise(95, 95)
    if kind == 'oak':
        broad = noise(5, 2)
        grain = np.sin(2 * math.pi * 118 * x + broad * 5 + np.sin(y * 2 * math.pi) * 2)
        pores = np.maximum(0, noise(110, 9) - 0.7)
        value = grain * 0.006 + broad * 0.012 + fine * 0.009 - pores * 0.024
        rgb = np.array([0.56, 0.425, 0.295]) + value[..., None] * np.array([1.0, 0.82, 0.58])
        height = grain * 0.000025 - pores * 0.00010
        roughness = np.clip(0.53 + broad * 0.045 - grain * 0.035, 0.35, 0.74)
        metres = 0.9
    elif kind == 'stone':
        broad = noise(6, 6)
        veins = np.exp(-np.abs(np.sin(x * 4 * math.pi + y * 2 * math.pi + noise(2, 3))) * 35)
        pores = np.maximum(0, fine - 1.7)
        value = broad * 0.016 + fine * 0.006 - veins * 0.03 - pores * 0.015
        rgb = np.array([0.79, 0.755, 0.685]) + value[..., None]
        height = broad * 0.00012 - pores * 0.00015
        roughness = np.clip(0.48 + broad * 0.035 + pores * 0.1, 0.36, 0.75)
        metres = 0.7
    else:
        warp = np.sin(x * 2 * math.pi * 128)
        weft = np.sin(y * 2 * math.pi * 128)
        weave = warp * weft
        value = weave * 0.025 + noise(18, 18) * 0.014 + fine * 0.008
        rgb = np.array([0.83, 0.805, 0.76]) + value[..., None]
        height = weave * 0.00008
        roughness = np.clip(0.9 + weave * 0.035, 0.8, 1)
        metres = 0.3
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * size / (2 * metres)
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * size / (2 * metres)
    normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1)[..., None]
    for suffix, pixels, color in (
        ('color', rgb, True), ('normal', normal * 0.5 + 0.5, False),
        ('roughness', np.repeat(roughness[..., None], 3, axis=-1), False),
    ):
        image = bpy.data.images.new(f'{name}_{suffix}', width=size, height=size)
        image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        rgba = np.concatenate((np.clip(pixels, 0, 1), np.ones((size, size, 1))), axis=-1)
        image.pixels.foreach_set(rgba.astype(np.float32).ravel())
        image.filepath_raw = str(TEXTURE_DIR / f'{name}_{suffix}.jpg')
        image.file_format = 'JPEG'
        image.save()
        REPORT['textures'][f'{name}_{suffix}.jpg'] = {'width': size, 'height': size, 'colorSpace': 'sRGB' if color else 'linear'}


surface_maps('studio_oak', 'oak')
surface_maps('studio_limestone', 'stone')
surface_maps('studio_linen', 'linen')


def material(name, color, roughness=0.5, metallic=0, coat=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = 0.17
    return mat


glaze = material('Studio / warm porcelain glaze', (0.79, 0.75, 0.65), 0.22, coat=0.28)
steel = material('Studio / brushed stainless steel', (0.54, 0.58, 0.61), 0.28, 0.92)
chrome = material('Studio / polished steel', (0.72, 0.76, 0.79), 0.16, 0.95)
enamel = material('Studio / ivory enamel', (0.70, 0.65, 0.54), 0.29, 0.08, 0.3)
walnut = material('Studio / oiled walnut', (0.13, 0.057, 0.024), 0.39)
rubber = material('Studio / graphite rubber', (0.018, 0.021, 0.022), 0.72)
brass = material('Studio / aged brass', (0.48, 0.29, 0.10), 0.31, 0.82)
shade = material('Studio / graphite spun metal', (0.047, 0.058, 0.055), 0.38, 0.55)
inside = material('Studio / warm reflector', (0.72, 0.62, 0.43), 0.38, 0.2)
linen = material('Studio / linen upholstery', (0.46, 0.32, 0.21), 0.92)


def finish(obj, mat, smooth=True):
    obj.data.materials.append(mat)
    if smooth:
        for face in obj.data.polygons:
            face.use_smooth = True
    return obj


def lathe(name, profile, mat, segments=32):
    vertices, faces = [], []
    for radius, z in profile:
        for j in range(segments):
            angle = j * math.tau / segments
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    for row in range(len(profile) - 1):
        for j in range(segments):
            a = row * segments + j
            b = row * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat)


def rounded(name, pos, dimensions, mat, radius=0.005, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new('Manufactured edge radius', 'BEVEL')
    bevel.width = radius
    bevel.segments = segments
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    normal = obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=normal.name)
    return finish(obj, mat, False)


def tube(name, points, radius, mat, sides=8):
    # Small bevelled polyline tubes, converted once to portable mesh geometry.
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, xyz in zip(spline.points, points):
        p.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return finish(obj, mat)


def cylinder(name, pos, radius, depth, mat, vertices=24, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=pos)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    return finish(obj, mat)


def export_asset(name, builder, max_triangles):
    bpy.ops.object.select_all(action='DESELECT')
    previous = set(bpy.data.objects)
    builder()
    parts = sorted(set(bpy.data.objects) - previous, key=lambda obj: obj.name)
    # One mesh per material gives three draws for the cup, not one per part.
    batches = {}
    for obj in parts:
        batches.setdefault(obj.data.materials[0].name, []).append(obj)
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    merged = []
    for objects in batches.values():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = f'{name} / {obj.data.materials[0].name}'
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
        merged.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    triangles = 0
    for obj in merged:
        obj.select_set(True)
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    assert triangles <= max_triangles, f'{name}: {triangles} exceeds {max_triangles}'
    path = MODEL_DIR / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_animations=False,
                              export_extras=True, export_cameras=False, export_lights=False)
    REPORT['models'][name] = {'triangles': triangles, 'materials': len(merged), 'bytes': path.stat().st_size}
    # Arrange the editable source assets in a row after export.
    offset = (len(REPORT['models']) - 1) * 1.4
    for obj in merged:
        obj.location.x += offset


def cup():
    lathe('Turned porcelain / full inner wall and rolled lip', [
        (0, 0.011), (0.023, 0.011), (0.026, 0.015), (0.029, 0.023),
        (0.035, 0.035), (0.042, 0.056), (0.046, 0.079), (0.0465, 0.086),
        (0.046, 0.089), (0.0435, 0.090), (0.042, 0.087), (0.0415, 0.08),
        (0.038, 0.058), (0.031, 0.038), (0.024, 0.028), (0, 0.028),
    ], glaze)
    lathe('Saucer / recessed well, foot and raised rim', [
        (0, 0.001), (0.026, 0.001), (0.032, 0.002), (0.049, 0.005),
        (0.068, 0.009), (0.072, 0.013), (0.072, 0.015), (0.068, 0.016),
        (0.048, 0.009), (0.033, 0.008), (0, 0.008),
    ], glaze)
    points = [(0.043 + 0.020 * math.sin(a), 0, 0.053 + 0.025 * math.cos(a))
              for a in np.linspace(-0.18, math.pi + 0.18, 21)]
    tube('Pulled ceramic handle', points, 0.005, glaze)
    # The spoon rests tangentially on the saucer, inside its existing footprint.
    rounded('Teaspoon handle', (-0.038, 0.025, 0.017), (0.006, 0.067, 0.003), steel, 0.0014)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1,
                                       location=(-0.038, -0.018, 0.018))
    bowl = bpy.context.object
    bowl.name = 'Teaspoon bowl'
    bowl.scale = (0.011, 0.016, 0.0025)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(bowl, steel)


def espresso_machine():
    for x in (-0.28, 0.28):
        for y in (-0.16, 0.16):
            cylinder('Rubber foot', (x, y, 0.022), 0.027, 0.044, rubber, 12)
    rounded('Lower steel chassis', (0, 0, 0.071), (0.72, 0.43, 0.07), steel, 0.012)
    rounded('Ivory boiler housing', (0, 0.045, 0.314), (0.69, 0.32, 0.33), enamel, 0.035, 3)
    rounded('Recessed group fascia', (0, -0.127, 0.301), (0.59, 0.019, 0.16), steel, 0.006)
    rounded('Cup warming rail', (0, 0.04, 0.488), (0.71, 0.34, 0.026), chrome, 0.008)
    for x in (-0.355, 0.355):
        rounded('Walnut end cheek', (x, 0.05, 0.30), (0.025, 0.30, 0.30), walnut, 0.009)
    rounded('Drip tray recess', (0, -0.07, 0.113), (0.64, 0.27, 0.018), rubber, 0.008)
    for x in np.linspace(-0.30, 0.30, 19):
        rounded('Drain grate slat', (x, -0.07, 0.126), (0.009, 0.25, 0.007), chrome, 0.002, 1)
    for x in (-0.16, 0.16):
        cylinder('Chrome group head', (x, -0.154, 0.247), 0.045, 0.066, chrome)
        cylinder('Portafilter basket', (x, -0.164, 0.207), 0.038, 0.024, steel)
        tube('Portafilter walnut grip', [(x, -0.175, 0.207), (x, -0.28, 0.195), (x, -0.32, 0.195)], 0.014, walnut)
        for dx in (-0.012, 0.012):
            tube('Dual coffee spout', [(x, -0.163, 0.195), (x + dx, -0.17, 0.18)], 0.005, chrome)
        rounded('Group rocker', (x, -0.146, 0.354), (0.056, 0.018, 0.025), rubber, 0.004)
    # Front faces point toward -Y, which exports toward the customer (+Z).
    rotation = (math.pi / 2, 0, 0)
    cylinder('Pressure gauge bezel', (0, -0.149, 0.30), 0.034, 0.013, brass, 32, rotation)
    cylinder('Pressure gauge dial', (0, -0.157, 0.30), 0.0275, 0.003, glaze, 32, rotation)
    for i in range(11):
        angle = -math.pi * 0.8 + i * math.pi * 1.6 / 10
        mark = rounded('Dial graduation', (math.sin(angle) * 0.023, -0.16, 0.30 + math.cos(angle) * 0.023),
                       (0.0018, 0.001, 0.0045), rubber, 0.0003, 1)
        mark.rotation_euler.y = angle
    needle = rounded('Gauge needle', (0.003, -0.162, 0.307), (0.0015, 0.001, 0.022), rubber, 0.0004, 1)
    needle.rotation_euler.y = 0.55
    for side in (-1, 1):
        tube('Steam wand', [(side * 0.29, -0.13, 0.27), (side * 0.32, -0.18, 0.23),
                           (side * 0.32, -0.22, 0.14), (side * 0.29, -0.235, 0.13)], 0.006, chrome)
        cylinder('Steam control', (side * 0.28, -0.15, 0.35), 0.022, 0.032, walnut, 20, rotation)
    tube('Warming tray back rail', [(-0.32, 0.18, 0.50), (-0.32, 0.18, 0.52),
                                    (0.32, 0.18, 0.52), (0.32, 0.18, 0.50)], 0.005, chrome)


def pendant():
    # A continuous double-walled spun shade: believable rim from below.
    lathe('Spun shade / rolled edge', [
        (0.022, 0.195), (0.027, 0.185), (0.04, 0.169), (0.067, 0.145),
        (0.102, 0.105), (0.142, 0.061), (0.18, 0.026), (0.184, 0.018),
        (0.182, 0.013), (0.178, 0.014),
    ], shade, 32)
    lathe('Warm interior reflector', [
        (0.178, 0.015), (0.174, 0.027), (0.136, 0.062), (0.097, 0.106),
        (0.062, 0.146), (0.034, 0.173), (0.023, 0.179),
    ], inside, 32)
    lathe('Brass socket', [(0.014, 0.115), (0.018, 0.115), (0.018, 0.163), (0.014, 0.17)], brass, 16)


def chair():
    # Bentwood café chair: tapered, splayed legs and a continuous curved back.
    # Seat/cushion heights match the existing player and patron seat contract.
    seat = lathe('Shaped oak seat', [(0, 0.427), (0.18, 0.427), (0.205, 0.435),
                                    (0.211, 0.451), (0.202, 0.469), (0, 0.469)], walnut, 28)
    seat.scale.y = 0.94
    rounded('Tailored linen cushion', (0, -0.008, 0.484), (0.366, 0.345, 0.045), linen, 0.020, 3)
    for sign in (-1, 1):
        tube('Splayed front leg', [(sign * 0.181, -0.182, 0.016),
                                  (sign * 0.16, -0.145, 0.435)], 0.019, walnut)
        tube('Continuous rear leg and back post', [(sign * 0.181, 0.192, 0.016),
                                                   (sign * 0.155, 0.153, 0.43),
                                                   (sign * 0.18, 0.18, 0.823)], 0.018, walnut)
    points = []
    for angle in np.linspace(-1.10, 1.10, 29):
        points.append((0.235 * math.sin(angle), 0.035 + 0.20 * math.cos(angle),
                       0.855 - 0.024 * (abs(angle) / 1.1)**2))
    tube('Steam-bent top rail', points, 0.023, walnut)
    for x in (-0.105, 0, 0.105):
        tube('Back spindle', [(x, 0.166, 0.46), (x, 0.21, 0.83)], 0.009, walnut)
    tube('Front foot stretcher', [(-0.17, -0.17, 0.18), (0.17, -0.17, 0.18)], 0.012, walnut)


export_asset('studio_cup', cup, 2600)
export_asset('studio_espresso', espresso_machine, 9500)
export_asset('studio_pendant', pendant, 1400)
export_asset('studio_chair', chair, 2200)
bpy.ops.object.select_all(action='DESELECT')
SOURCE_DIR.joinpath('asset-report.json').write_text(json.dumps(REPORT, indent=2) + '\n')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_DIR / 'cafe-studio.blend'), compress=True)
print('CAFE_ASSET_REPORT ' + json.dumps(REPORT))
