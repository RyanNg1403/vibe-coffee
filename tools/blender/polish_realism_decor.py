"""Blender finishing details for ceramics, coffee equipment, lighting and greenery.

Run after refine_realism_props.py. Added objects are tagged for idempotent reruns;
material colors are stored before the first finish pass.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from atelier_common import ring, tube, mesh, lathe
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'assets/blender/realism'
bpy.context.preferences.filepaths.save_version=0
KEYS=['studio_cup','cup','mug','latte','teapot','studio_espresso','espresso_machine',
      'studio_pendant','pendant_lamp','floor_lamp','table_lamp','lantern',
      'plant','plant_small','plant_monstera','plant_snake','plant_pothos','plant_pothos_vine',
      'plant_fern','plant_succulent','plant_cacti','cactus_pot','tree_park_a','tree_park_b',
      'croissant','muffin','cookie','cupcake','donut','cake','cakeSlice','pancakes','apple','sandwich','iceCream',
      'bookcase','wall_shelf','painting','radio','typewriter','coat_rack','crate','trashcan']
REPORT={}

def find_material(fragment):
    return next((m for m in bpy.data.materials if fragment in m.name.lower()),None)

def finish_colors(obj):
    if obj.type!='MESH' or not obj.data.materials:return
    material=obj.data.materials[0];name=material.name.lower()
    if not any(n in name for n in ['leaf upper','leaf new','golden crust','fired terracotta','apple skin']):return
    node=material.node_tree.nodes.get('Principled BSDF')
    original=material.get('finish_base_color') or list(node.inputs['Base Color'].default_value)
    material['finish_base_color']=original
    colors=obj.data.color_attributes.get('CraftFinish') or obj.data.color_attributes.new(name='CraftFinish',type='FLOAT_COLOR',domain='CORNER')
    obj.data.color_attributes.active_color=colors
    for index,loop in enumerate(obj.data.loops):
        p=obj.matrix_world@obj.data.vertices[loop.vertex_index].co
        if 'leaf' in name:
            # Broad leaves catch light differently along their curved length.
            value=.94+.055*math.sin(p.x*35+p.z*17)+.025*math.sin(p.y*71+p.z*29)
        elif 'crust' in name:value=.91+.075*math.sin(p.x*91+p.y*47)+.04*math.sin(p.z*193+p.x*51)
        elif 'terracotta' in name:value=.96+.025*math.sin(p.z*370)+.02*math.sin(p.x*97+p.y*83)
        else:value=.96+.035*math.sin(p.x*147+p.y*91+p.z*73)
        colors.data[index].color=(*[min(1,max(0,c*value)) for c in original[:3]],1)
    color=material.node_tree.nodes.get('Craft finish color')
    if not color:color=material.node_tree.nodes.new('ShaderNodeVertexColor');color.name='Craft finish color'
    color.layer_name='CraftFinish'
    material.node_tree.links.new(color.outputs['Color'],node.inputs['Base Color'])

for key in KEYS:
    path=SOURCE/(key+'.blend')
    input_path=path if path.exists() else ROOT/'assets/blender/rebuild'/(key+'.blend')
    if not input_path.exists():continue
    bpy.ops.wm.open_mainfile(filepath=str(input_path))
    for obj in list(bpy.context.scene.objects):
        if obj.get('realism_finish'):bpy.data.objects.remove(obj,do_unlink=True)
    original=set(bpy.context.scene.objects)
    ceramic=find_material('ivory porcelain');steel=find_material('brushed nickel');dark=find_material('charcoal powder');brass=find_material('satin brass')
    for material in bpy.data.materials:
        if not material.use_nodes:continue
        p=material.node_tree.nodes.get('Principled BSDF')
        if not p:continue
        name=material.name.lower()
        if 'porcelain' in name:
            p.inputs['Roughness'].default_value=.2;p.inputs['Coat Weight'].default_value=.22;p.inputs['Coat Roughness'].default_value=.15
        elif 'brushed nickel' in name:p.inputs['Roughness'].default_value=.31
        elif 'satin brass' in name:p.inputs['Roughness'].default_value=.34
        elif 'leaf ' in name:p.inputs['Roughness'].default_value=.53
    if key in ['studio_cup','cup','mug','latte'] and ceramic:
        h=.105 if key in ['mug','latte'] else .09
        ring('Polished rolled ceramic lip',(0,0,h),.0425,.0012,ceramic,48)
        ring('Thrown cup foot',(0,0,.009),.028,.0015,ceramic,40)
    if key=='teapot' and ceramic:
        ring('Lid seating bead',(0,0,.151),.045,.0013,ceramic,48)
        # A recessed dark mouth makes the modeled pouring spout read as hollow.
        m=bpy.data.materials.new('Unglazed spout interior');m.use_nodes=True
        p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.09,.075,.05,1);p.inputs['Roughness'].default_value=.83
        opening=lathe('Recessed pouring mouth',[(0,0),(.0098,0)],m,32)
        direction=Vector((.04,0,.06)).normalized();opening.rotation_euler=direction.to_track_quat('Z','Y').to_euler();opening.location=Vector((.14,0,.14))+direction*.0005
    if key in ['studio_espresso','espresso_machine'] and dark:
        for i in range(13):
            a=math.radians(-120+i*20)
            tube('Pressure gauge graduation',[(math.sin(a)*.023,-.224,.37+math.cos(a)*.023),(math.sin(a)*.020,-.224,.37+math.cos(a)*.020)],.00045,dark,4)
        for x in [-.265,.265]:
            for z in [.255,.405]:
                tube('Recessed fascia screw',[(x-.002,-.206,z),(x+.002,-.206,z)],.0007,dark,4)
    for obj in original:finish_colors(obj)
    for obj in set(bpy.context.scene.objects)-original:
        obj['realism_finish']=True;obj['atelier']=True
    bpy.ops.object.select_all(action='SELECT')
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models'/(key+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_cameras=False,export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    tris=0
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH':obj.data.calc_loop_triangles();tris+=len(obj.data.loop_triangles)
    REPORT[key]={'triangles':tris,'added_objects':len(set(bpy.context.scene.objects)-original)}
    print('FINISHED_DECOR',key,REPORT[key],flush=True)
(SOURCE/'decor-finish-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
