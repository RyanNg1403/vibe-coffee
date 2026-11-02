"""Anatomical 22-joint café pet rigs and sampled, ground-aware actions.

All coordinates are metres, Z up, forward -Y. Call build_rig(cfg), skin the
body to its named joints, then animate_pet(rig,cfg) before glTF export.
"""
import bpy
import math
from mathutils import Vector, Matrix, Quaternion

LEGS = ('FrontL', 'FrontR', 'RearL', 'RearR')


def _leg_names(name):
    region, side = name[:-1], name[-1]
    return name, region + 'Lower' + side, region + 'Paw' + side


def build_rig(cfg):
    armature = bpy.data.armatures.new('Realism ' + cfg['kind'] + ' deform skeleton')
    rig = bpy.data.objects.new('RealismPetRig', armature)
    bpy.context.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    def bone(name, head, tail, parent=None):
        result = armature.edit_bones.new(name)
        result.head = head
        result.tail = tail
        if (result.tail - result.head).length < .001:
            result.tail.z += .01
        if parent:
            result.parent = armature.edit_bones[parent]
        return result
    bone('Root', (0, 0, 0), (0, 0, .08))
    bone('Spine', cfg['spine_back'], cfg['spine_front'], 'Root')
    bone('Neck', cfg['neck'], cfg['head_head'], 'Spine')
    bone('Head', cfg['head_head'], cfg['head_tip'], 'Neck')
    bone('Tail', cfg['tail_base'], cfg['tail_mid'], 'Root')
    bone('TailTip', cfg['tail_mid'], cfg['tail_tip'], 'Tail')
    for side in ('L', 'R'):
        bone('Ear' + side, *cfg['ears'][side], 'Head')
        bone('Eye' + side, *cfg['eyes'][side], 'Head')
    for name in LEGS:
        leg = cfg['legs'][name]
        upper, lower, paw = _leg_names(name)
        bone(upper, leg['hip'], leg['knee'], 'Root')
        bone(lower, leg['knee'], leg['ankle'], upper)
        bone(paw, leg['ankle'], leg['toe'], lower)
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in rig.pose.bones:
        p.rotation_mode = 'QUATERNION'
    rig['realism_pet'] = cfg['kind']
    return rig


def _update():
    bpy.context.view_layer.update()


def _rotate(rig, name, axis, angle):
    p = rig.pose.bones[name]
    location, rotation, scale = p.matrix.decompose()
    p.matrix = Matrix.LocRotScale(location, Quaternion(Vector(axis), angle) @ rotation, scale)
    _update()


def _aim(rig, name, direction):
    p = rig.pose.bones[name]
    current = p.tail - p.head
    target = Vector(direction)
    if current.length < .00001 or target.length < .00001:
        return
    turn = current.normalized().rotation_difference(target.normalized())
    location, rotation, scale = p.matrix.decompose()
    p.matrix = Matrix.LocRotScale(location, turn @ rotation, scale)
    _update()


def _root_height(rig, z):
    p = rig.pose.bones['Root']
    matrix = p.matrix.copy()
    matrix.translation.z += z
    p.matrix = matrix
    _update()


def _plant_leg(rig, cfg, name, target):
    upper, lower, paw = _leg_names(name)
    a, b, c = [rig.pose.bones[key] for key in (upper, lower, paw)]
    leg = cfg['legs'][name]
    l1 = (Vector(leg['knee']) - Vector(leg['hip'])).length
    l2 = (Vector(leg['ankle']) - Vector(leg['knee'])).length
    h = a.head.copy()
    delta = Vector(target) - h
    d = min(l1 + l2 - .0003, max(abs(l1 - l2) + .0003, delta.length))
    direction = delta.normalized()
    along = (l1*l1 - l2*l2 + d*d) / (2*d)
    radius = math.sqrt(max(0, l1*l1 - along*along))
    preferred = Vector((0, 1 if name.startswith('Front') else -1, 0))
    bend = preferred - direction * preferred.dot(direction)
    if bend.length < .01:
        bend = Vector((0, 0, 1)) - direction * direction.z
    bend.normalize()
    knee = h + direction * along + bend * radius
    end = h + direction * d
    _aim(rig, upper, knee - h)
    _aim(rig, lower, end - rig.pose.bones[lower].head)
    # Preserve the authored paw pitch: sole and toe stay nearly level through
    # stance, instead of inheriting the tibia's changing angle.
    _aim(rig, paw, Vector(leg['toe']) - Vector(leg['ankle']))


def _smooth(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)


def animate_pet(rig, cfg):
    if not rig.animation_data:
        rig.animation_data_create()
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 0
    cat = cfg['kind'] == 'cat'
    clips = [('idle', 4), ('walk', cfg['walk_duration']), ('idle_eating', 2),
             ('headbutt', 2), ('death', 1.8), ('idle_2_headlow', 4),
             ('idle_2', 4), ('eating', 2)]
    phase_offset = {'FrontL': 0, 'RearR': .25, 'FrontR': .5, 'RearL': .75}
    actions = []
    for name, seconds in clips:
        frames = max(2, round(seconds * 30))
        duration = frames / 30
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig.animation_data.action = action
        for frame in range(frames + 1):
            phase = frame / frames
            angle = phase * math.tau
            for p in rig.pose.bones:
                p.matrix_basis.identity()
            _update()
            root = 0
            neck_pitch = .012 * math.sin(angle)
            head_pitch = .012 * math.sin(angle + .7)
            tail_wag = .04 * math.sin(angle)
            if name == 'walk':
                root = (-.046 if cat else -.046) + (.0025 if cat else .004) * math.sin(angle * 2)
                neck_pitch = .012 * math.sin(angle * 2 + .4)
                head_pitch = -.018 * math.sin(angle * 2)
                tail_wag = (.07 if cat else .11) * math.sin(angle)
            elif name in ('idle_eating', 'eating'):
                root = -.015 if cat else -.025
                neck_pitch = .92 + .025 * math.sin(angle * 2)
                head_pitch = .20 + .045 * math.sin(angle * 3)
                tail_wag = .025 * math.sin(angle)
            elif name == 'headbutt':
                # Approach and return to the starting posture without a jump.
                gesture = math.sin(math.pi * phase) ** 2
                neck_pitch = -.16 * gesture
                head_pitch = .29 * gesture
            elif name == 'idle_2_headlow':
                neck_pitch = .30 + .025 * math.sin(angle)
                head_pitch = .08 + .02 * math.sin(angle * 2)
            elif name == 'idle_2':
                neck_pitch = .02 * math.sin(angle)
                head_pitch = -.04 * math.sin(angle)
                tail_wag = .10 * math.sin(angle)
            elif name == 'death':
                # The runtime uses this source clip for lying down. It is a
                # controlled sternum-rest transition, not a collapse/death.
                settle = _smooth(phase / .82)
                root = (-.11 if cat else -.18) * settle
                neck_pitch = .12 * settle
                head_pitch = .05 * settle
                tail_wag = -.12 * settle
            if name not in ('walk', 'death'):
                root += .0015 * math.sin(angle)
            _root_height(rig, root)
            _rotate(rig, 'Spine', (0, 1, 0), .006 * math.sin(angle))
            _rotate(rig, 'Neck', (1, 0, 0), neck_pitch)
            _rotate(rig, 'Head', (1, 0, 0), head_pitch)
            if name == 'idle_2':
                _rotate(rig, 'Head', (0, 0, 1), .16 * math.sin(angle))
            _rotate(rig, 'Tail', (0, 0, 1), tail_wag)
            _rotate(rig, 'TailTip', (0, 0, 1), tail_wag * .55)
            for side, offset in [('L', 0), ('R', 1.8)]:
                _rotate(rig, 'Ear' + side, (0, 1, 0), .025 * math.sin(angle * 2 + offset))
            # A brief blink every idle cycle; endpoints remain fully open.
            blink = max(0, 1 - abs(phase - .63) / .027)
            if name != 'walk':
                for side in ('L', 'R'):
                    rig.pose.bones['Eye' + side].scale.z = 1 - .88 * _smooth(blink)
            _update()
            for leg_name in LEGS:
                ankle = Vector(cfg['legs'][leg_name]['ankle'])
                if name == 'walk':
                    u = (phase + phase_offset[leg_name]) % 1
                    normalized_scale = cfg['runtime_height'] / cfg['anatomical_height']
                    stride = cfg['runtime_speed'] / normalized_scale * duration * .60
                    if u < .60:
                        ankle.y += stride * (u / .60 - .5)
                    else:
                        swing = (u - .60) / .40
                        ankle.y += stride * (.5 - _smooth(swing))
                        ankle.z += (.025 if cat else .04) * math.sin(math.pi * swing) ** 1.35
                elif name == 'death':
                    settle = _smooth(phase / .82)
                    ankle.y -= (.025 if leg_name.startswith('Front') else .045) * settle
                _plant_leg(rig, cfg, leg_name, ankle)
            for p in rig.pose.bones:
                p.keyframe_insert('location', frame=frame, group=p.name)
                p.keyframe_insert('rotation_quaternion', frame=frame, group=p.name)
                p.keyframe_insert('scale', frame=frame, group=p.name)
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
        action['nominal_seconds'] = seconds
        action['looping'] = name != 'death'
        actions.append(action)
    rig.animation_data.action = next(action for action in actions if action.name == 'idle')
    scene.frame_set(0)
    _update()
    return actions
