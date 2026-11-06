"""Hero-asset helpers: procedural PBR authoring, atlas baking, glTF export.

Hero props are modeled with real bevels and procedural Cycles materials, then
baked into one unique-UV atlas per asset: base color, tangent-space normal
(shader bump included), and ORM (R = ambient occlusion, G = roughness,
B = metalness). The exported GLB references those PNG maps; LOD chains and the
JPEG/KTX2 runtime variants are produced by tools/optimize-assets.mjs.
"""
import bpy, bmesh, math, json, os
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models'
SOURCE = ROOT / 'assets/blender/hero'
SOURCE.mkdir(parents=True, exist_ok=True)
REPORT_PATH = SOURCE / 'hero-report.json'


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.render.bake.margin_type = 'EXTEND'
    return scene


def link(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


# ---------------------------------------------------------------------------
# Procedural materials. Each records the sockets that feed base color,
# roughness, metalness and the bumped normal so bakes can re-route them.

class Pbr:
    registry = {}

    def __init__(self, name):
        self.mat = bpy.data.materials.new('Hero / ' + name)
        self.mat.use_nodes = True
        self.nodes = self.mat.node_tree.nodes
        self.links = self.mat.node_tree.links
        self.nodes.clear()
        self.out = self.nodes.new('ShaderNodeOutputMaterial')
        self.bsdf = self.nodes.new('ShaderNodeBsdfPrincipled')
        self.links.new(self.bsdf.outputs[0], self.out.inputs['Surface'])
        self.sockets = {}
        Pbr.registry[self.mat.name] = self

    def node(self, kind, **inputs):
        n = self.nodes.new(kind)
        for key, value in inputs.items():
            if hasattr(n, key) and not isinstance(getattr(n, key), bpy.types.bpy_struct):
                setattr(n, key, value)
            else:
                n.inputs[key].default_value = value
        return n

    def coords(self, scale=(1, 1, 1), rotation=(0, 0, 0)):
        tc = self.node('ShaderNodeTexCoord')
        mapping = self.node('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = scale
        mapping.inputs['Rotation'].default_value = rotation
        self.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
        return mapping.outputs['Vector']

    def set(self, channel, value):
        socket = {'color': 'Base Color', 'rough': 'Roughness', 'metal': 'Metallic', 'normal': 'Normal'}[channel]
        if isinstance(value, bpy.types.NodeSocket):
            self.links.new(value, self.bsdf.inputs[socket])
            self.sockets[channel] = value
        else:
            if channel == 'color':
                value = (*value, 1) if len(value) == 3 else value
            self.bsdf.inputs[socket].default_value = value
            self.sockets[channel] = value
        return self

    def bump(self, height, strength=0.2, distance=0.001):
        b = self.node('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = distance
        self.links.new(height, b.inputs['Height'])
        return self.set('normal', b.outputs['Normal'])


def noise(p, vec, scale, detail=6, roughness=0.55):
    n = p.node('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = roughness
    p.links.new(vec, n.inputs['Vector'])
    return n


def ramp(p, fac, stops):
    r = p.node('ShaderNodeValToRGB')
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    p.links.new(fac, r.inputs['Fac'])
    return r.outputs['Color']


def math_node(p, op, a, b=None, clamp=False):
    m = p.node('ShaderNodeMath')
    m.operation = op
    m.use_clamp = clamp
    for i, v in enumerate([a, b]):
        if v is None:
            continue
        if isinstance(v, bpy.types.NodeSocket):
            p.links.new(v, m.inputs[i])
        else:
            m.inputs[i].default_value = v
    return m.outputs[0]


def mix_rgb(p, fac, a, b, blend='MIX'):
    """Color mix; Mix node sockets share names across data types, so pick by type."""
    m = p.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
    sock = lambda name: next(s for s in m.inputs if s.name == name and s.type == 'RGBA')
    for name, value in (('A', a), ('B', b)):
        if isinstance(value, bpy.types.NodeSocket):
            p.links.new(value, sock(name))
        else:
            sock(name).default_value = (*value, 1) if len(value) == 3 else value
    if isinstance(fac, bpy.types.NodeSocket):
        p.links.new(fac, m.inputs['Factor'])
    else:
        m.inputs['Factor'].default_value = fac
    return next(s for s in m.outputs if s.type == 'RGBA')


def map_range(p, value, lo, hi):
    m = p.node('ShaderNodeMapRange')
    p.links.new(value, m.inputs['Value'])
    m.inputs['To Min'].default_value = lo
    m.inputs['To Max'].default_value = hi
    return m.outputs['Result']


def brushed_metal(name, color=(0.62, 0.62, 0.62), rough=0.26, axis='X', strength=0.06):
    p = Pbr(name)
    stretch = {'X': (2.5, 900, 900), 'Y': (900, 2.5, 900), 'Z': (900, 900, 2.5)}[axis]
    streak = noise(p, p.coords(stretch), 1.0, detail=3)
    p.set('color', color).set('metal', 1.0)
    # Brushing is finer than a runtime texel: it lives in roughness only, which
    # keeps the normal map smooth and compressible.
    p.set('rough', map_range(p, streak.outputs['Fac'], rough - strength, rough + strength))
    return p.mat


def polished_metal(name, color=(0.8, 0.8, 0.8), rough=0.07):
    p = Pbr(name)
    smudge = noise(p, p.coords(), 22, detail=4)
    p.set('color', color).set('metal', 1.0)
    p.set('rough', map_range(p, smudge.outputs['Fac'], rough * 0.6, rough * 1.9))
    return p.mat


def powder_coat(name, color=(0.025, 0.025, 0.027), rough=0.55, metal=0.0):
    p = Pbr(name)
    orange_peel = noise(p, p.coords(), 140, detail=2)
    p.set('color', color).set('metal', metal)
    p.set('rough', map_range(p, orange_peel.outputs['Fac'], rough - 0.06, rough + 0.06))
    return p.mat


def glaze(name, color, rough=0.12, speckle=0.0, crawl=0.0):
    """Fired ceramic glaze: low roughness, faint ripple, optional iron speckle."""
    p = Pbr(name)
    v = p.coords()
    ripple = noise(p, v, 35, detail=5)
    col = color
    if speckle:
        dots = p.node('ShaderNodeTexVoronoi')
        dots.inputs['Scale'].default_value = 260
        p.links.new(v, dots.inputs['Vector'])
        mask = math_node(p, 'LESS_THAN', dots.outputs['Distance'], speckle)
        col = mix_rgb(p, mask, color, (color[0] * 0.35, color[1] * 0.3, color[2] * 0.26))
    if crawl:
        variation = noise(p, v, 6, detail=3)
        tint = ramp(p, variation.outputs['Fac'], [(0.3, tuple(c * (1 - crawl) for c in color)), (0.7, color)])
        if isinstance(col, bpy.types.NodeSocket):
            col = mix_rgb(p, 1.0, col, tint, 'MULTIPLY')
        else:
            col = tint
    p.set('color', col).set('metal', 0.0)
    p.set('rough', map_range(p, ripple.outputs['Fac'], rough * 0.7, rough * 1.5))
    p.bump(ripple.outputs['Fac'], strength=0.05, distance=0.0006)
    return p.mat


def walnut(name, light=(0.21, 0.11, 0.052), dark=(0.085, 0.042, 0.022), rough=0.42, scale=1.0, axis='Z'):
    """Ring-porous hardwood: fine growth rings (~6 mm) running along `axis`,
    distorted into cathedral figure, with broad tonal drift and open pores."""
    p = Pbr(name)
    along = 0.08
    stretch = {'Z': (1, 1, along), 'X': (along, 1, 1), 'Y': (1, along, 1)}[axis]
    v = p.coords(tuple(s * scale for s in stretch))
    wave = p.node('ShaderNodeTexWave', wave_type='RINGS')
    wave.inputs['Scale'].default_value = 26
    wave.inputs['Distortion'].default_value = 9.0
    wave.inputs['Detail'].default_value = 3
    wave.inputs['Detail Scale'].default_value = 1.2
    p.links.new(v, wave.inputs['Vector'])
    drift = noise(p, v, 9, detail=2)
    pore_stretch = {'Z': (1, 1, 0.03), 'X': (0.03, 1, 1), 'Y': (1, 0.03, 1)}[axis]
    pores = noise(p, p.coords(tuple(s * scale for s in pore_stretch)), 900, detail=1)
    ring = math_node(p, 'POWER', wave.outputs['Fac'], 4.0)
    fac = math_node(p, 'ADD', math_node(p, 'MULTIPLY', ring, 0.3), math_node(p, 'MULTIPLY', drift.outputs['Fac'], 0.75))
    col = ramp(p, fac, [(0.25, dark), (0.5, tuple(a * 0.62 + b * 0.38 for a, b in zip(light, dark))), (0.75, light)])
    pore_dark = math_node(p, 'GREATER_THAN', pores.outputs['Fac'], 0.68)
    col = mix_rgb(p, math_node(p, 'MULTIPLY', pore_dark, 0.35), col, tuple(c * 0.45 for c in dark))
    p.set('color', col).set('metal', 0.0)
    p.set('rough', map_range(p, math_node(p, 'ADD', ring, pore_dark), rough - 0.05, rough + 0.12))
    p.bump(math_node(p, 'SUBTRACT', ring, pore_dark), strength=0.08, distance=0.0004)
    return p.mat


def matte(name, color, rough=0.85, metal=0.0, grain=0.0, grain_scale=300):
    p = Pbr(name)
    p.set('color', color).set('metal', metal).set('rough', rough)
    if grain:
        g = noise(p, p.coords(), grain_scale, detail=3)
        p.bump(g.outputs['Fac'], strength=grain, distance=0.0005)
    return p.mat


def perforated(name, color=(0.62, 0.62, 0.62), rough=0.3, pitch=180):
    """Stainless cup-warmer plate: round perforations baked into color/normal."""
    p = Pbr(name)
    vor = p.node('ShaderNodeTexVoronoi', voronoi_dimensions='2D', feature='F1')
    vor.inputs['Scale'].default_value = pitch
    vor.inputs['Randomness'].default_value = 0.0
    p.links.new(p.coords(), vor.inputs['Vector'])
    hole = math_node(p, 'LESS_THAN', vor.outputs['Distance'], 0.28)
    p.set('color', mix_rgb(p, hole, color, (0.01, 0.01, 0.01)))
    p.set('metal', math_node(p, 'SUBTRACT', 1.0, hole))
    p.set('rough', map_range(p, hole, rough, 0.9))
    p.bump(math_node(p, 'SUBTRACT', 1.0, hole), strength=0.6, distance=0.001)
    return p.mat


# ---------------------------------------------------------------------------
# Geometry helpers. Every helper returns a linked mesh object in metres.

def mesh_object(name, verts, faces, mat, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v) for v in verts], [], faces)
    data.update()
    obj = link(bpy.data.objects.new(name, data))
    data.materials.append(mat)
    for poly in data.polygons:
        poly.use_smooth = smooth
    return obj


def bevel(obj, width, segments=3, angle=35, harden=True):
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = harden
    mod.miter_outer = 'MITER_ARC'
    return obj


def weighted(obj):
    mod = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    return obj


def box(name, center, size, mat, radius=0.004, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if radius:
        bevel(obj, min(radius, min(size) * 0.45), segments)
    weighted(obj)
    return obj


def cylinder(name, center, radius, depth, mat, verts=32, bevel_width=0.0015, segments=2, axis='Z', cap=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=center,
                                        end_fill_type='NGON' if cap else 'NOTHING')
    obj = bpy.context.object
    obj.name = name
    if axis == 'X':
        obj.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        obj.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if bevel_width:
        bevel(obj, bevel_width, segments, angle=50)
    weighted(obj)
    return obj


def lathe(name, profile, mat, verts=48, center=(0, 0, 0), axis='Z', close_top=False, close_bottom=False):
    """Revolve (radius, height) pairs. Profiles run bottom-to-top."""
    co, faces = [], []
    n = verts
    for r, z in profile:
        for j in range(n):
            a = j * math.tau / n
            co.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(len(profile) - 1):
        for j in range(n):
            faces.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
    if close_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    if close_top:
        faces.append(tuple((len(profile) - 1) * n + j for j in range(n)))
    obj = mesh_object(name, co, faces, mat)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # profiles may start or end on the axis; weld those poles into cones
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if axis == 'Y':
        obj.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == 'X':
        obj.rotation_euler = (0, math.pi / 2, 0)
    obj.location = center
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    return obj


def tube(name, points, radius, mat, sides=16, caps=True, aspect=1.0):
    """Swept tube; `aspect` flattens the section across the path's bend plane."""
    pts = [Vector(p) for p in points]
    co, faces = [], []
    prev = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        a = (prev - t * prev.dot(t)).normalized() if prev is not None else t.cross(ref).normalized()
        prev = a
        b = t.cross(a).normalized()
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        for j in range(sides):
            ang = j * math.tau / sides
            co.append(p + r * (a * math.cos(ang) + b * aspect * math.sin(ang)))
    for i in range(len(pts) - 1):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    if caps:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple((len(pts) - 1) * sides + j for j in range(sides)))
    return mesh_object(name, co, faces, mat)


def arc_points(center, radius, start, end, steps, plane='XZ'):
    out = []
    for i in range(steps + 1):
        a = start + (end - start) * i / steps
        c, s = math.cos(a) * radius, math.sin(a) * radius
        if plane == 'XZ':
            out.append((center[0] + c, center[1], center[2] + s))
        elif plane == 'YZ':
            out.append((center[0], center[1] + c, center[2] + s))
        else:
            out.append((center[0] + c, center[1] + s, center[2]))
    return out


def torus(name, center, major, minor, mat, major_segments=48, minor_segments=12, axis='Z'):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_segments,
                                     minor_segments=minor_segments, location=center)
    obj = bpy.context.object
    obj.name = name
    if axis == 'Y':
        obj.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == 'X':
        obj.rotation_euler = (0, math.pi / 2, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def text_mesh(name, body, center, size, depth, mat, rotation=(math.pi / 2, 0, 0), font_bold=True):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.size = size
    curve.extrude = depth
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.resolution_u = 3
    obj = link(bpy.data.objects.new(name, curve))
    obj.location = center
    obj.rotation_euler = rotation
    activate(obj)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def apply_all(objects):
    for obj in objects:
        activate(obj)
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objects, name):
    if os.environ.get('VIBE_TRIANGLE_BREAKDOWN'):
        counts = {}
        for obj in objects:
            label = obj.name.split('.')[0]
            counts[label] = counts.get(label, 0) + triangles(obj)
        for label, count in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f'TRIANGLES {count:6d} {label}', flush=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    return obj


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


# ---------------------------------------------------------------------------
# Atlas baking

def _image(name, size, color_space, alpha=False):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = color_space
    return img


def unwrap(obj, uv_name='BakeUV', margin=0.004, angle=60):
    uv = obj.data.uv_layers.get(uv_name) or obj.data.uv_layers.new(name=uv_name)
    obj.data.uv_layers.active = uv
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    return uv


def _target(mat, img):
    nodes = mat.node_tree.nodes
    tex = nodes.get('BakeTarget') or nodes.new('ShaderNodeTexImage')
    tex.name = 'BakeTarget'
    tex.image = img
    for n in nodes:
        n.select = False
    tex.select = True
    nodes.active = tex


def _emit(mat, channel):
    """Route one recorded channel into an emission shader for an EMIT bake."""
    p = Pbr.registry[mat.name]
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    em = nodes.get('BakeEmission') or nodes.new('ShaderNodeEmission')
    em.name = 'BakeEmission'
    for l in list(em.inputs['Color'].links):
        links.remove(l)
    value = p.sockets.get(channel, {'color': (0.8, 0.8, 0.8, 1), 'rough': 0.5, 'metal': 0.0}[channel])
    if isinstance(value, bpy.types.NodeSocket):
        links.new(value, em.inputs['Color'])
    elif isinstance(value, (int, float)):
        em.inputs['Color'].default_value = (value, value, value, 1)
    else:
        em.inputs['Color'].default_value = tuple(value)
    links.new(em.outputs[0], p.out.inputs['Surface'])


def _restore(mat):
    p = Pbr.registry[mat.name]
    p.links.new(p.bsdf.outputs[0], p.out.inputs['Surface'])


def gltf_output_group():
    group = bpy.data.node_groups.get('glTF Material Output')
    if group:
        return group
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    group.nodes.new('NodeGroupInput')
    return group


def bake_atlas(obj, name, size=2048, ao_samples=96, ground=True, out_size=None):
    """Bake every procedural material on `obj` into one atlas material."""
    scene = bpy.context.scene
    unwrap(obj)
    mats = [s.material for s in obj.material_slots]
    color = _image(name + '_color', size, 'sRGB')
    normal = _image(name + '_normal', size, 'Non-Color')
    rough = _image(name + '_rough', size, 'Non-Color')
    metal = _image(name + '_metal', size, 'Non-Color')
    ao = _image(name + '_ao', size, 'Non-Color')
    plane = None
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, min((obj.matrix_world @ Vector(c)).z for c in obj.bound_box) - 0.0005))
        plane = bpy.context.object
        plane.data.materials.append(matte('bake ground', (0.5, 0.5, 0.5)))
    activate(obj)
    kwargs = dict(uv_layer='BakeUV', margin=max(4, size // 256), use_clear=True)
    scene.cycles.samples = 4
    for channel, img in (('color', color), ('rough', rough), ('metal', metal)):
        for m in mats:
            _emit(m, channel)
            _target(m, img)
        bpy.ops.object.bake(type='EMIT', **kwargs)
    for m in mats:
        _restore(m)
        _target(m, normal)
    scene.cycles.samples = 8
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', **kwargs)
    for m in mats:
        _target(m, ao)
    scene.cycles.samples = ao_samples
    bpy.ops.object.bake(type='AO', **kwargs)
    if plane:
        bpy.data.objects.remove(plane, do_unlink=True)

    final_size = out_size or size
    orm = _image(name + '_orm', size, 'Non-Color')
    px = lambda img: np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    a, r, m = px(ao), px(rough), px(metal)
    packed = np.ones((size, size, 4), dtype=np.float32)
    # Soften baked AO; real-time GTAO adds contact shadowing on top.
    packed[..., 0] = 0.25 + 0.75 * a[..., 0]
    packed[..., 1] = np.clip(r[..., 0], 0.03, 1)
    packed[..., 2] = np.clip(m[..., 0], 0, 1)
    orm.pixels[:] = packed.ravel()
    maps = {'color': color, 'normal': normal, 'orm': orm}
    for img in maps.values():
        if final_size != size:
            img.scale(final_size, final_size)
        img.file_format = 'PNG'
        img.pack()
    for img in (rough, metal, ao):
        bpy.data.images.remove(img)

    atlas = bpy.data.materials.new(f'Hero / {name} atlas')
    atlas.use_nodes = True
    nodes, links = atlas.node_tree.nodes, atlas.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    t_color = nodes.new('ShaderNodeTexImage'); t_color.image = color
    t_norm = nodes.new('ShaderNodeTexImage'); t_norm.image = normal
    t_orm = nodes.new('ShaderNodeTexImage'); t_orm.image = orm
    for t in (t_color, t_norm, t_orm):
        uvn = nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'BakeUV'
        links.new(uvn.outputs['UV'], t.inputs['Vector'])
    nmap = nodes.new('ShaderNodeNormalMap'); nmap.uv_map = 'BakeUV'
    sep = nodes.new('ShaderNodeSeparateColor')
    links.new(t_color.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(t_norm.outputs['Color'], nmap.inputs['Color'])
    links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(t_orm.outputs['Color'], sep.inputs['Color'])
    links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    group = nodes.new('ShaderNodeGroup'); group.node_tree = gltf_output_group()
    links.new(sep.outputs['Red'], group.inputs['Occlusion'])

    # keep the procedural sources in the .blend for re-baking
    obj.data.materials.clear()
    obj.data.materials.append(atlas)
    for uv in list(obj.data.uv_layers):
        if uv.name != 'BakeUV':
            obj.data.uv_layers.remove(uv)
    for m in mats:
        m.use_fake_user = True
    return atlas


def export(objects, key, extras=None):
    """Write the raw GLB for tools/optimize-assets.mjs and save the source."""
    for obj in objects:
        obj['atelier'] = True
        obj['hero_asset'] = key
        for k, v in (extras or {}).items():
            obj[k] = v
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    path = OUT / f'{key}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_image_format='AUTO', export_materials='EXPORT', export_animations=False)
    tris = sum(triangles(o) for o in objects)
    report = json.loads(REPORT_PATH.read_text()) if REPORT_PATH.exists() else {}
    dims = [max((o.matrix_world @ Vector(c))[i] for o in objects for c in o.bound_box) -
            min((o.matrix_world @ Vector(c))[i] for o in objects for c in o.bound_box) for i in range(3)]
    report[key] = {
        'sourceTriangles': tris,
        'dimensionsMetres': [round(d, 4) for d in dims],
        'materials': sorted({s.material.name for o in objects for s in o.material_slots if s.material}),
        'maps': sorted({n.image.name + f' {n.image.size[0]}px' for o in objects for s in o.material_slots
                        if s.material and s.material.use_nodes
                        for n in s.material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}),
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / f'{key}.blend'), compress=True)
    print('HERO_ASSET', key, report[key], flush=True)
    return report[key]
