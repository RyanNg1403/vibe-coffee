"""Apply Blender's architectural materials to the existing modeled furniture."""
import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];SOURCE=ROOT/'assets/blender/realism';ORIGINAL=ROOT/'assets/blender/rebuild'
bpy.context.preferences.filepaths.save_version=0
report={}
for file in sorted(ORIGINAL.glob('*.blend')):
 key=file.stem
 if key.startswith('char_') or key in ['pet_cat','pet_dog']:continue
 bpy.ops.wm.open_mainfile(filepath=str(file))
 mats=list(bpy.data.materials)
 replacements={}
 for material in mats:
  name=material.name.lower()
  surface='walnut' if any(k in name for k in ['smoked oak','honey ash']) else 'linen' if 'linen' in name else None
  if not surface:continue
  if surface not in replacements:
   with bpy.data.libraries.load(str(SOURCE/'architectural-materials.blend'),link=False) as (src,dst):dst.materials=['Architectural / '+surface]
   replacements[surface]=dst.materials[0]
  material.user_remap(replacements[surface])
 if not replacements:continue
 for o in bpy.context.scene.objects:
  if o.type=='MESH':o['atelier']=True;o['architectural_materials']=True
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models'/(key+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_cameras=False,export_lights=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(key+'.blend')),compress=True)
 report[key]={'materials':list(replacements),'bytes':(ROOT/'public/models'/(key+'.glb')).stat().st_size}
 print('ARCHITECTURAL_PROP',key,flush=True)
(SOURCE/'props-report.json').write_text(json.dumps(report,indent=2)+'\n')
