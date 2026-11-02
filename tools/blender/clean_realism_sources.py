"""Remove unused Blender datablocks without changing scene-owned assets.

This maintenance step saves editable sources only; runtime GLBs are untouched.
Run with Blender 4.3 from the repository root.
"""
import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/blender/realism'
bpy.context.preferences.filepaths.save_version = 0


def retained_state():
    """Check authored scene, rig, clip, and packed material image references."""
    objects = sorted((obj.name, obj.type) for obj in bpy.context.scene.objects)
    rigs = {
        obj.name: sorted(bone.name for bone in obj.data.bones)
        for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'
    }
    actions = sorted(
        action.name for action in bpy.data.actions
        if action.use_fake_user or action.users > 0
    )
    images = set()
    for material in bpy.data.materials:
        # Scene-owned mesh materials keep real users during the purge.
        if not material.users or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                image = node.image
                images.add((material.name, node.name, image.name,
                            tuple(image.size), bool(image.packed_file)))
    world = bpy.context.scene.world
    if world and world.use_nodes:
        for node in world.node_tree.nodes:
            if node.type == 'TEX_ENVIRONMENT' and node.image:
                image = node.image
                images.add((world.name, node.name, image.name,
                            tuple(image.size), bool(image.packed_file)))
    authored_materials = {
        material.name: {
            'nodes': sorted((node.name, node.bl_idname) for node in material.node_tree.nodes),
            'links': sorted((link.from_node.name, link.from_socket.name,
                             link.to_node.name, link.to_socket.name)
                            for link in material.node_tree.links),
        }
        for material in bpy.data.materials
        if material.use_fake_user and material.use_nodes
    }
    return {'objects': objects, 'rigs': rigs, 'actions': actions,
            'images': sorted(images), 'authored_materials': authored_materials}


report = {}
for path in sorted(SOURCE.glob('*.blend')):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    # Restrict the reference check to scene materials and explicitly retained
    # authored materials. Pet sources preserve the procedural fur node graph
    # with a fake user after switching the mesh to its baked runtime material.
    # Orphan meshes may still hold references to other unused materials.
    scene_materials = {
        slot.material for obj in bpy.context.scene.objects
        for slot in obj.material_slots if slot.material
    }
    retained_materials = scene_materials | {
        material for material in bpy.data.materials if material.use_fake_user
    }
    before = retained_state()
    before['images'] = [entry for entry in before['images']
                        if entry[0] in {m.name for m in retained_materials}
                        or (bpy.context.scene.world and entry[0] == bpy.context.scene.world.name)]
    size_before = path.stat().st_size
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    after = retained_state()
    if before != after:
        raise RuntimeError(f'Retained scene data changed while purging {path.name}')
    if path.stem.startswith('char_atelier_'):
        if set(after['actions']) != {'Idle', 'Walk', 'Working', 'Wave', 'Sitting'}:
            raise RuntimeError(f'Character actions missing in {path.name}')
        if len(after['rigs']) != 1 or len(next(iter(after['rigs'].values()))) != 24:
            raise RuntimeError(f'Character rig changed in {path.name}')
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    report[path.name] = {
        'before_bytes': size_before, 'after_bytes': path.stat().st_size,
        'actions': after['actions'],
        'rig_bones': {name: len(bones) for name, bones in after['rigs'].items()},
        'retained_images': len(after['images']),
        'retained_authored_materials': sorted(after['authored_materials']),
    }
    print('CLEAN_SOURCE', path.name, report[path.name], flush=True)

(SOURCE / 'source-cleanup-report.json').write_text(json.dumps(report, indent=2) + '\n')
print('SOURCE_BYTES', sum(item['before_bytes'] for item in report.values()),
      sum(item['after_bytes'] for item in report.values()), flush=True)
