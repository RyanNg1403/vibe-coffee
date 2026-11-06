"""Seamless honed-marble counter-top set (realism_stone_color/normal/roughness).

The service counter samples these maps 6 x 2 times across its 8.4 x 0.85 m
top, so one tile spans about 1.4 x 0.43 m. Procedural fields are evaluated on
a 4D torus (u and v each wrap around a circle) so the tile repeats without
seams, and the u radius is larger so veins keep real-world proportions after
the anisotropic repeat. The application tints the near-white base per venue.

    blender -b -t 8 --python-exit-code 1 --python tools/blender/build_hero_surfaces.py
"""
import bpy, math, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import hero_common as H

SIZE = 1024
TEXTURES = H.ROOT / 'public/textures'
H.reset()
scene = bpy.context.scene

bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
plane = bpy.context.object
p = H.Pbr('honed marble')
nodes, links = p.nodes, p.links

uv = p.node('ShaderNodeTexCoord')
sep = p.node('ShaderNodeSeparateXYZ')
links.new(uv.outputs['UV'], sep.inputs['Vector'])


def periodic(radius_u, radius_v):
    """Map UV onto a 4D torus: returns (vector xyz socket, w socket)."""
    def trig(src, op, radius):
        angle = H.math_node(p, 'MULTIPLY', src, math.tau)
        return H.math_node(p, 'MULTIPLY', H.math_node(p, op, angle), radius)
    x, y = trig(sep.outputs['X'], 'COSINE', radius_u), trig(sep.outputs['X'], 'SINE', radius_u)
    z, w = trig(sep.outputs['Y'], 'COSINE', radius_v), trig(sep.outputs['Y'], 'SINE', radius_v)
    comb = p.node('ShaderNodeCombineXYZ')
    links.new(x, comb.inputs['X']); links.new(y, comb.inputs['Y']); links.new(z, comb.inputs['Z'])
    return comb.outputs['Vector'], w


def noise4d(vec, w, scale, detail, roughness=0.55, distortion=0.0):
    n = p.node('ShaderNodeTexNoise', noise_dimensions='4D')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = roughness
    n.inputs['Distortion'].default_value = distortion
    links.new(vec, n.inputs['Vector']); links.new(w, n.inputs['W'])
    return n.outputs['Fac']


def vein(field, frequency, sharpness):
    s = H.math_node(p, 'SINE', H.math_node(p, 'MULTIPLY', field, frequency))
    return H.math_node(p, 'POWER', H.math_node(p, 'SUBTRACT', 1.0, H.math_node(p, 'ABSOLUTE', s)), sharpness)


vec, w = periodic(0.95, 0.32)
clouds = noise4d(vec, w, 1.6, 4, 0.5)
field = noise4d(vec, w, 0.7, 6, 0.62, distortion=0.6)
primary = vein(field, 14.0, 6.0)
halo = vein(field, 14.0, 1.6)
secondary = vein(noise4d(vec, w, 1.8, 8, 0.66, distortion=1.0), 26.0, 22.0)
pitting = noise4d(vec, w, 60.0, 2, 0.5)
# broad vein-free regions keep the slab from reading as a contour map
mask = H.map_range(p, noise4d(vec, w, 0.9, 2, 0.4), -0.6, 1.6)
veins = H.math_node(p, 'ADD', H.math_node(p, 'MULTIPLY', primary, 0.7), H.math_node(p, 'MULTIPLY', secondary, 0.3), clamp=True)
veins = H.math_node(p, 'MULTIPLY', H.math_node(p, 'ADD', veins, H.math_node(p, 'MULTIPLY', halo, 0.12)), mask, clamp=True)

base = H.ramp(p, clouds, [(0.3, (0.80, 0.79, 0.76)), (0.7, (0.90, 0.89, 0.86))])
color = H.mix_rgb(p, veins, base, (0.36, 0.37, 0.39))
p.set('color', color).set('metal', 0.0)
p.set('rough', H.map_range(p, H.math_node(p, 'ADD', H.math_node(p, 'MULTIPLY', veins, 0.5), H.math_node(p, 'MULTIPLY', pitting, 0.3)), 0.26, 0.5))
p.bump(H.math_node(p, 'SUBTRACT', H.math_node(p, 'MULTIPLY', pitting, 0.4), H.math_node(p, 'MULTIPLY', veins, 0.25)), strength=0.18, distance=0.0008)
plane.data.materials.append(p.mat)

images = {name: H._image('stone_' + name, SIZE, cs) for name, cs in
          (('color', 'sRGB'), ('roughness', 'Non-Color'), ('normal', 'Non-Color'))}
H.activate(plane)
kwargs = dict(margin=0, use_clear=True)
scene.cycles.samples = 4
for channel, key in (('color', 'color'), ('rough', 'roughness')):
    H._emit(p.mat, channel)
    H._target(p.mat, images[key])
    bpy.ops.object.bake(type='EMIT', **kwargs)
H._restore(p.mat)
H._target(p.mat, images['normal'])
scene.cycles.samples = 8
bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', **kwargs)

for key, img in images.items():
    png = Path(f'/tmp/realism_stone_{key}.png')
    img.filepath_raw = str(png)
    img.file_format = 'PNG'
    img.save()
    img.pack()
    out = TEXTURES / f'realism_stone_{key}.jpg'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(png), '-q:v', '3', str(out)], check=True)
    print('HERO_SURFACE', out.name, out.stat().st_size, flush=True)
plane['hero_surface'] = 'realism_stone'
bpy.ops.wm.save_as_mainfile(filepath=str(H.SOURCE / 'counter-stone.blend'), compress=True)
