"""Hero ceramics: studio_cup, mug, latte.

Wheel-thrown profiles with foot rings, rolled lips, saucer wells, and swept
oval-section handles; glazes are baked into one 512px atlas per piece.

Runtime contracts (src/cafe.js):
- studio_cup is normalized to 0.09 m and receives a 0.0415 m latte-art disc at
  0.0837 m, centered on the model bounds. The handle stays inside the saucer
  radius so the bounds stay centered on the cup axis, and the inner wall meets
  the disc at that height.
- mug and latte are decor without a runtime liquid: their coffee is modeled.
- The former `cup` key was a byte-identical copy of studio_cup, reachable only
  when studio_cup fails to load; it is no longer exported.

    blender -b -t 8 --python-exit-code 1 --python tools/blender/build_hero_cups.py
"""
import bpy, math, os, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import hero_common as H

ONLY = os.environ.get('VIBE_HERO_CUP')


def handle(name, mat, cup_radius_at, z_top, z_bottom, reach, width=0.0045, thickness=0.0029, sides=12):
    """C-shaped strap handle in the XZ plane on +X, ends buried in the wall."""
    pts = []
    steps = 14
    for i in range(steps + 1):
        t = i / steps
        a = math.pi / 2 - t * math.pi
        z = (z_top + z_bottom) / 2 + math.sin(a) * (z_top - z_bottom) / 2
        base = cup_radius_at(z) - 0.002
        bulge = math.cos(a) ** 0.8 if math.cos(a) > 0 else 0
        x = base + (reach - base) * bulge
        # slight upward thumb rest near the top attachment
        z += 0.003 * math.sin(t * math.pi) * (1 - t)
        pts.append((x, 0, z))
    return H.tube(name, pts, width, mat, sides=sides, aspect=thickness / width)


def profile_radius(profile):
    def at(z):
        pts = sorted(profile, key=lambda p: p[1])
        for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
            if z0 <= z <= z1:
                return r0 + (r1 - r0) * (z - z0) / max(1e-9, z1 - z0)
        return pts[-1][0]
    return at


def assign_by_height(obj, mat, below=None, above=None, inside_radius=None):
    """Give faces in a height band (and optionally inside a radius) another material."""
    if mat.name not in [m.name for m in obj.data.materials]:
        obj.data.materials.append(mat)
    index = [m.name for m in obj.data.materials].index(mat.name)
    for poly in obj.data.polygons:
        c = poly.center
        ok = True
        if below is not None:
            ok &= c.z < below
        if above is not None:
            ok &= c.z > above
        if inside_radius is not None:
            ok &= math.hypot(c.x, c.y) < inside_radius
        if ok:
            poly.material_index = index


def saucer(name, glaze_mat, bisque_mat, R=0.062, well=0.034, z_top=0.0125, verts=40):
    s = R / 0.062
    prof = [(0.0, 0.002), (0.033 * s, 0.002), (0.035 * s, 0.0), (0.040 * s, 0.0), (0.042 * s, 0.0022),
            (0.056 * s, 0.0068), (R - 0.0003, z_top - 0.0025), (R, z_top - 0.001), (R - 0.0012, z_top),
            (R - 0.006 * s, z_top - 0.001), (0.044 * s, 0.0078), (well + 0.002, 0.0064), (well, 0.0062), (0.0, 0.0062)]
    obj = H.lathe(name, prof, glaze_mat, verts=verts)
    assign_by_height(obj, bisque_mat, below=0.0012)
    return obj, 0.0062


def cup_body(name, glaze_mat, bisque_mat, z0, height, r_rim, r_foot=0.024, wall=0.0032, verts=40, belly=0.0):
    """Tulip cup from foot (z0) to rim (z0 + height). Returns object and outer radius lookup."""
    zt = z0 + height
    h = height
    outer = [(0.0, z0 + 0.0015), (r_foot - 0.005, z0 + 0.0015), (r_foot - 0.003, z0), (r_foot, z0),
             (r_foot + 0.001, z0 + 0.003)]
    for t in (0.1, 0.25, 0.45, 0.65, 0.82, 0.93):
        # flare from foot to rim with an optional belly
        r = r_foot + 0.004 + (r_rim - r_foot - 0.004) * (1 - (1 - t) ** 2.2) + belly * math.sin(t * math.pi)
        outer.append((r, z0 + 0.003 + (h - 0.006) * t))
    outer += [(r_rim + 0.0006, zt - 0.0018), (r_rim + 0.0004, zt - 0.0006), (r_rim - 0.0008, zt)]
    inner = [(r_rim - wall + 0.0006, zt - 0.0012), (r_rim - wall, zt - 0.006)]
    for t in (0.85, 0.65, 0.42, 0.22, 0.1):
        r = r_foot + 0.004 + (r_rim - r_foot - 0.004) * (1 - (1 - t) ** 2.2) + belly * math.sin(t * math.pi) - wall * 1.15
        inner.append((max(0.004, r), z0 + 0.005 + (h - 0.012) * t))
    inner += [(0.012, z0 + 0.0072), (0.0, z0 + 0.0068)]
    obj = H.lathe(name, outer + inner, glaze_mat, verts=verts)
    assign_by_height(obj, bisque_mat, below=z0 + 0.0012)
    return obj, profile_radius(outer), profile_radius(inner)


def liquid_disc(name, mat, z, radius, verts=40):
    return H.lathe(name, [(radius, z - 0.0015), (radius, z), (radius * 0.7, z + 0.0004), (0.0, z + 0.0006)], mat, verts=verts)


def latte_art_image(size=512):
    """Original rosetta-and-heart pour: white microfoam over hazelnut crema."""
    y, x = (np.mgrid[0:size, 0:size] + 0.5) / size * 2 - 1
    r = np.hypot(x, y)
    crema = np.stack([0.30 + 0.12 * r, 0.16 + 0.07 * r, 0.07 + 0.03 * r], -1)
    rng = np.random.default_rng(7)
    crema *= (0.93 + 0.07 * rng.random((size, size)))[..., None]
    def heart(scale, drop):
        # implicit heart (x^2 + y^2 - 1)^3 - x^2 y^3 < 0, point toward -y
        hx, hy = x / scale, (-y - drop) / scale * 1.05 + 0.15
        return ((hx ** 2 + hy ** 2 - 1) ** 3 - hx ** 2 * hy ** 3) < 0
    # a "wing" heart: three nested pours pulled through by one stroke
    foam = heart(0.62, -0.02).astype(float)
    foam = np.where(heart(0.47, 0.07), 0.0, foam)
    foam = np.where(heart(0.33, 0.13), 1.0, foam)
    foam = np.where(heart(0.19, 0.19), 0.0, foam)
    foam = np.where(heart(0.09, 0.23), 1.0, foam)
    stroke = (np.abs(x) < 0.008 + 0.012 * np.clip(y + 0.55, 0, 1)) & (y > -0.6) & (y < 0.5)
    foam = np.where(stroke & (foam > 0.5), 0.35, foam)
    # soften edges
    k = np.exp(-np.linspace(-2, 2, 9) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        foam = np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), axis, foam)
    milk = np.array([0.86, 0.80, 0.70])
    col = crema * (1 - foam[..., None]) + milk * foam[..., None]
    rim = np.clip((r - 0.86) / 0.14, 0, 1)[..., None]
    col = col * (1 - rim) + np.array([0.42, 0.24, 0.11]) * rim
    img = bpy.data.images.new('latte art pour', size, size)
    img.pixels[:] = np.concatenate([col, np.ones((size, size, 1))], -1)[::-1].astype(np.float32).ravel()
    img.pack()
    return img


def foam_material(radius, center_z):
    p = H.Pbr('latte microfoam')
    tc = p.node('ShaderNodeTexCoord')
    mapping = p.node('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.5 / radius, 0.5 / radius, 1)
    mapping.inputs['Location'].default_value = (0.5, 0.5, 0)
    p.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
    tex = p.node('ShaderNodeTexImage')
    tex.image = latte_art_image()
    tex.extension = 'EXTEND'
    p.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    bubbles = H.noise(p, p.coords(), 1400, detail=1)
    p.set('color', tex.outputs['Color']).set('metal', 0.0).set('rough', 0.42)
    p.bump(bubbles.outputs['Fac'], strength=0.05, distance=0.0002)
    return p.mat


def coffee_material():
    p = H.Pbr('black coffee')
    v = p.coords()
    swirl = H.noise(p, v, 60, detail=3)
    col = H.ramp(p, swirl.outputs['Fac'], [(0.35, (0.035, 0.016, 0.008)), (0.7, (0.075, 0.036, 0.016))])
    p.set('color', col).set('metal', 0.0).set('rough', 0.06)
    return p.mat


def finish(objects, key, atlas_name):
    H.apply_all(objects)
    obj = H.join(objects, key)
    print('CUP_SOURCE_TRIANGLES', key, H.triangles(obj), flush=True)
    H.bake_atlas(obj, atlas_name, size=1024, out_size=512, ao_samples=64)
    H.export([obj], key)


if not ONLY or ONLY == 'studio_cup':
    H.reset()
    H.Pbr.registry.clear()
    BISQUE = H.matte('unglazed stoneware foot', (0.62, 0.52, 0.42), rough=0.88, grain=0.15, grain_scale=900)
    PORCELAIN = H.glaze('speckled porcelain glaze', (0.86, 0.84, 0.79), rough=0.1, speckle=0.06, crawl=0.04)
    plate, well_z = saucer('Saucer', PORCELAIN, BISQUE, R=0.0625)
    body, outer_r, inner_r = cup_body('Tulip cup', PORCELAIN, BISQUE, well_z, 0.088 - well_z, r_rim=0.0452, wall=0.0042)
    # The runtime disc (0.0406 m in source units) should meet the inner wall.
    print('STUDIO_CUP_INNER_RADIUS_AT_DISC', round(inner_r(0.0818), 4), flush=True)
    grip = handle('Strap handle', PORCELAIN, outer_r, well_z + 0.068, well_z + 0.03, reach=0.0592)
    finish([plate, body, grip], 'studio_cup', 'studio_cup')

if not ONLY or ONLY == 'mug':
    H.reset()
    H.Pbr.registry.clear()
    BISQUE = H.matte('raw speckled clay', (0.55, 0.43, 0.32), rough=0.9, grain=0.2, grain_scale=900)
    TEAL = H.glaze('reactive teal glaze', (0.06, 0.2, 0.22), rough=0.16, speckle=0.05, crawl=0.25)
    COFFEE = coffee_material()
    body, outer_r, inner_r = cup_body('Stoneware mug', TEAL, BISQUE, 0.0, 0.098, r_rim=0.0425, r_foot=0.036,
                                      wall=0.004, belly=0.0035)
    # dipped glaze: the lower body stays raw clay below a soft drip line
    assign_by_height(body, BISQUE, below=0.026)
    grip = handle('Mug handle', TEAL, outer_r, 0.082, 0.026, reach=0.071, width=0.0062, thickness=0.0042)
    surface = 0.098 * 0.86
    coffee = liquid_disc('Coffee surface', COFFEE, surface, inner_r(surface) + 0.0006)
    finish([body, grip, coffee], 'mug', 'mug')

if not ONLY or ONLY == 'latte':
    H.reset()
    H.Pbr.registry.clear()
    BISQUE = H.matte('unglazed stoneware foot', (0.62, 0.52, 0.42), rough=0.88, grain=0.15, grain_scale=900)
    CREAM = H.glaze('oatmeal glaze', (0.78, 0.71, 0.60), rough=0.14, speckle=0.08, crawl=0.08)
    BAND = H.glaze('iron-brown rim glaze', (0.24, 0.12, 0.06), rough=0.12)
    plate, well_z = saucer('Latte saucer', CREAM, BISQUE, R=0.075)
    body, outer_r, inner_r = cup_body('Latte bowl', CREAM, BISQUE, well_z, 0.103 - well_z, r_rim=0.056,
                                      r_foot=0.026, wall=0.0035, belly=0.002)
    assign_by_height(body, BAND, above=0.097)
    grip = handle('Latte handle', CREAM, outer_r, well_z + 0.078, well_z + 0.038, reach=0.0745, width=0.005, thickness=0.0032)
    surface = 0.103 - 0.0065
    foam = liquid_disc('Microfoam', foam_material(inner_r(surface) + 0.0006, surface), surface, inner_r(surface) + 0.0006, verts=40)
    finish([plate, body, grip, foam], 'latte', 'latte')
