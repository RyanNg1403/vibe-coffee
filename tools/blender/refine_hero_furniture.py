"""Hero furniture refinement on the collection sources.

The application tints these materials per venue (src/decor/furnitureFinish.js),
instances studio_chair with its own materials (src/decor/chairKit.js), and
multiplies the exported COLOR_0 into every finish. This pass therefore keeps
material names, metre UVs, seat heights and cushion geometry, and changes:

- hard-edged joinery (legs, collars, tenons, arm frames, dowels): chamfers
  with hardened normals, so edges catch highlights (single segment: the
  standard chair is instanced up to 64 times per room);
- contact occlusion: Cycles AO baked per corner and multiplied into the
  existing 'Finish variation' color, which every runtime path already uses.

    blender -b -t 8 --python-exit-code 1 --python tools/blender/refine_hero_furniture.py
"""
import bpy, math, os, sys, json
import numpy as np
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import hero_common as H

ROOT = H.ROOT
INPUT = ROOT / 'assets/blender/collection'
KEYS = os.environ.get('VIBE_HERO_FURNITURE', 'studio_chair,armchair,bar_stool,sofa,side_table').split(',')

# (name fragment, bevel width in metres)
BEVELS = [
    ('Tapered walnut leg', 0.0035),
    ('Turned leg-end collar', 0.0015),
    ('Back support / fitted tenon', 0.003),
    ('Shaped walnut arm frame', 0.003),
    ('upper joinery collar', 0.002),
    ('Flush backrest dowel plug', 0.001),
    ('side_table / Atelier / smoked oak', 0.003),
    ('sofa / Atelier / smoked oak', 0.004),
]
AO_FLOOR = 0.45   # GTAO adds screen-space contact shading on top at runtime
AO_DISTANCE = 0.25


def bevel_width(obj):
    for fragment, width in BEVELS:
        if fragment in obj.name:
            return width
    return None


def bake_vertex_ao(objects):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 256
    scene.render.bake.target = 'VERTEX_COLORS'
    if not scene.world:
        scene.world = bpy.data.worlds.new('AO bake world')
    # local contact occlusion only; the room's GTAO handles larger scales
    scene.world.light_settings.distance = AO_DISTANCE
    lo = min((o.matrix_world @ v.co).z for o in objects for v in o.data.vertices)
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, lo - 0.0005))
    ground = bpy.context.object
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        data = obj.data
        if not data.color_attributes.get('Finish variation'):
            fin = data.color_attributes.new(name='Finish variation', type='FLOAT_COLOR', domain='CORNER')
            fin.data.foreach_set('color', np.ones(len(data.loops) * 4, dtype=np.float32))
        old = data.color_attributes.get('AO bake')
        if old:
            data.color_attributes.remove(old)
        data.color_attributes.new(name='AO bake', type='FLOAT_COLOR', domain='CORNER')
        data.color_attributes.active_color = data.color_attributes['AO bake']
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type='AO')
    stats = []
    for obj in objects:
        data = obj.data
        n = len(data.loops)
        ao = np.empty(n * 4, dtype=np.float32)
        data.color_attributes['AO bake'].data.foreach_get('color', ao)
        fin_attr = data.color_attributes['Finish variation']
        fin = np.empty(n * 4, dtype=np.float32)
        fin_attr.data.foreach_get('color', fin)
        occlusion = AO_FLOOR + (1 - AO_FLOOR) * ao.reshape(n, 4)[:, 0]
        fin = fin.reshape(n, 4)
        fin[:, :3] *= occlusion[:, None]
        fin_attr.data.foreach_set('color', fin.ravel())
        data.color_attributes.remove(data.color_attributes['AO bake'])
        data.color_attributes.active_color = data.color_attributes['Finish variation']
        data.color_attributes.render_color_index = data.color_attributes.active_color_index
        stats.append(float(occlusion.mean()))
    bpy.data.objects.remove(ground, do_unlink=True)
    return round(sum(stats) / len(stats), 3)


report_path = H.SOURCE / 'furniture-refinement-report.json'
report = json.loads(report_path.read_text()) if report_path.exists() else {}
for key in KEYS:
    bpy.ops.wm.open_mainfile(filepath=str(INPUT / f'{key}.blend'))
    bpy.context.preferences.filepaths.save_version = 0
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    before = sum(H.triangles(o) for o in objects)
    beveled = 0
    for obj in objects:
        width = bevel_width(obj)
        if not width:
            continue
        H.activate(obj)
        H.bevel(obj, width, segments=1, angle=30)
        H.weighted(obj)
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        beveled += 1
    mean_ao = bake_vertex_ao(objects)
    for obj in objects:
        obj['atelier'] = True
        obj['hero_refined'] = True
    after = sum(H.triangles(o) for o in objects)
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(H.SOURCE / f'{key}.blend'), compress=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(H.OUT / f'{key}.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_animations=False, export_extras=True,
                              export_cameras=False, export_lights=False)
    report[key] = {'sourceTrianglesBefore': before, 'sourceTrianglesAfter': after, 'beveledParts': beveled,
                   'meanCornerOcclusion': mean_ao, 'aoFloor': AO_FLOOR, 'aoDistanceMetres': AO_DISTANCE}
    print('HERO_FURNITURE', key, report[key], flush=True)
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
