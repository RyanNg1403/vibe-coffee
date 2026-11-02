"""Blender-authored matte oak finish and textured garden ground cover.

Oak retains the checked-in CC0 ambientCG WoodFloor051 scan. The garden field
is original procedural artwork. Maps and material nodes remain packed in the
editable source scene, alongside physical-scale preview planes.
"""
import bpy, json, math
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/textures'
SOURCE = ROOT / 'assets/blender/collection'
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
S = 1024
rng = np.random.default_rng(14032026)
y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S

scan = bpy.data.images.load(str(OUT / 'floor_wood.jpg'))
scan.scale(S, S)
pixels = np.empty(S * S * 4, dtype=np.float32)
scan.pixels.foreach_get(pixels)
rgb = pixels.reshape(S, S, 4)[:, :, :3]
luminance = rgb @ np.array([.2126, .7152, .0722])
mean = max(.01, float(np.mean(luminance)))
# Keep joints and pore detail, quiet the oversized contrast of the old finish.
grain = np.clip(luminance / mean - 1, -.8, 1.0)
oak = np.array([.29, .255, .205]) * (1 + grain[:, :, None] * .34)
oak += (rgb - luminance[:, :, None]) * .12
floor_roughness = np.clip(.83 + grain * .035, .76, .89)

# Seamless multiscale soil/moss variation, with individual small leaf flecks.
field = np.zeros((S, S), dtype=np.float32)
for frequency, amplitude in [(1, .35), (3, .22), (7, .13), (19, .06), (57, .025)]:
    for i in range(4):
        a, b = rng.integers(-frequency, frequency + 1, 2)
        if a == 0 and b == 0: a = 1
        field += amplitude * np.sin(math.tau * (a*x+b*y) + rng.uniform(0, math.tau)) / 4
field += rng.normal(0, .018, (S, S))
garden = np.array([.105, .135, .065]) + field[:, :, None] * np.array([.08, .09, .045])
height = field * .003
for i in range(4200):
    cx, cy = rng.integers(0, S, 2)
    rx, ry = rng.uniform(1, 3.0), rng.uniform(2.5, 7.0)
    angle = rng.uniform(0, math.tau)
    radius = 9
    yy, xx = np.mgrid[-radius:radius+1, -radius:radius+1]
    u, v = xx*np.cos(angle)+yy*np.sin(angle), -xx*np.sin(angle)+yy*np.cos(angle)
    mask = np.clip(1 - (u/rx)**2 - (v/ry)**2, 0, 1)
    yi, xi = (cy+yy) % S, (cx+xx) % S
    shade = np.array([.10, .14, .055]) if i % 5 else np.array([.17, .13, .07])
    garden[yi, xi] = garden[yi, xi]*(1-mask[:, :, None]*.45) + shade*mask[:, :, None]*.45
    height[yi, xi] += mask*.0012
dx = (np.roll(height, -1, 1)-np.roll(height, 1, 1))*S/8
dy = (np.roll(height, -1, 0)-np.roll(height, 1, 0))*S/8
normal = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1)[:, :, None]

def image(name, data, color):
    if data.ndim == 2: data = np.repeat(data[:, :, None], 3, axis=-1)
    im = bpy.data.images.new(name, width=S, height=S)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    rgba = np.concatenate([np.clip(data, 0, 1), np.ones((S, S, 1))], axis=-1).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel())
    im.file_format = 'JPEG'
    im.filepath_raw = str(OUT / (name + '.jpg'))
    im.save(); im.pack()
    return im

maps = {
    'collection_floor_color': image('collection_floor_color', oak, True),
    'collection_floor_roughness': image('collection_floor_roughness', floor_roughness, False),
    'collection_garden_color': image('collection_garden_color', garden, True),
    'collection_garden_normal': image('collection_garden_normal', normal*.5+.5, False),
}
for index, kind in enumerate(['floor', 'garden']):
    material = bpy.data.materials.new('Collection / ' + kind)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = .94
    tex = nodes.new('ShaderNodeTexImage'); tex.image = maps['collection_'+kind+'_color']
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    detail = nodes.new('ShaderNodeTexImage')
    detail.image = maps['collection_floor_roughness' if kind == 'floor' else 'collection_garden_normal']
    if kind == 'floor': links.new(detail.outputs['Color'], bsdf.inputs['Roughness'])
    else:
        n = nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value = .4
        links.new(detail.outputs['Color'], n.inputs['Color']); links.new(n.outputs['Normal'], bsdf.inputs['Normal'])
    bpy.ops.mesh.primitive_plane_add(size=4, location=(index*4.5, 0, 0))
    bpy.context.object.name = kind+' physical-scale finish study'
    bpy.context.object.data.materials.append(material)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'ground-materials.blend'), compress=True)
(SOURCE/'ground-materials-report.json').write_text(json.dumps({
    'resolution': S, 'floorSource': 'ambientCG WoodFloor051 (CC0), retained project scan',
    'gardenSource': 'Original Blender procedural soil and ground-cover field',
    'floorRoughnessRange': [float(floor_roughness.min()), float(floor_roughness.max())],
    'maps': list(maps),
}, indent=2)+'\n')
