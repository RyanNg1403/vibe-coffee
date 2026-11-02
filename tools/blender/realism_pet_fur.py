"""Original Blender fur shading, baked to portable albedo and tangent-normal atlases.

The fur body is one mesh with identity transforms, facing -Y and standing on Z=0.
Eyes, noses and whiskers should remain separate objects. No external textures.
"""
import bpy
from pathlib import Path


def make_fur_material(kind, dimensions=None):
    if kind not in ('cat', 'dog'):
        raise ValueError('kind must be cat or dog')
    material = bpy.data.materials.new('Realism / procedural ' + kind + ' fur')
    material.use_nodes = True
    material.use_fake_user = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    def node(type_, name):
        n = nodes.new(type_)
        n.label = name
        n.name = name
        return n

    def connect(value, socket):
        if isinstance(value, (int, float, tuple, list)):
            socket.default_value = value
        else:
            links.new(value, socket)

    def math(operation, a, b=0, name=''):
        n = node('ShaderNodeMath', name or operation)
        n.operation = operation
        connect(a, n.inputs[0]); connect(b, n.inputs[1])
        return n.outputs[0]

    def ramp(value, low, high, name):
        n = node('ShaderNodeMapRange', name)
        n.clamp = True
        n.interpolation_type = 'SMOOTHERSTEP'
        connect(value, n.inputs['Value'])
        n.inputs['From Min'].default_value = low
        n.inputs['From Max'].default_value = high
        return n.outputs['Result']

    def mix(factor, a, b, name):
        n = node('ShaderNodeMixRGB', name)
        n.blend_type = 'MIX'
        connect(factor, n.inputs[0]); connect(a, n.inputs[1]); connect(b, n.inputs[2])
        return n.outputs[0]

    tex = node('ShaderNodeTexCoord', 'Model coordinates')
    separate = node('ShaderNodeSeparateXYZ', 'Coat anatomy')
    links.new(tex.outputs['Object'], separate.inputs[0])
    x, y, z = separate.outputs
    # The masks match the authored species anatomy; bounds affect frequency,
    # so a wider/longer pet keeps the same approximate hair density.
    dimensions = tuple(dimensions or ((.32, .78, .48) if kind == 'cat' else (.38, 1.0, .72)))
    reference = (.32, .78, .48) if kind == 'cat' else (.38, 1.0, .72)
    scale = tuple(reference[i] / max(.01, abs(dimensions[i])) for i in range(3))
    coordinates = node('ShaderNodeVectorMath', 'Physical fur density')
    coordinates.operation = 'MULTIPLY'
    links.new(tex.outputs['Object'], coordinates.inputs[0])
    coordinates.inputs[1].default_value = scale
    noise = node('ShaderNodeTexNoise', 'Soft coat variation')
    links.new(coordinates.outputs['Vector'], noise.inputs['Vector'])
    noise.inputs['Scale'].default_value = 7
    noise.inputs['Detail'].default_value = 3
    noise.inputs['Roughness'].default_value = .65

    if kind == 'cat':
        coat = mix(noise.outputs['Fac'], (.16, .115, .079, 1), (.29, .235, .17, 1), 'Warm tabby undercoat')
        stripes = node('ShaderNodeTexWave', 'Irregular tabby bands')
        stripes.wave_type = 'BANDS'; stripes.bands_direction = 'Y'
        links.new(coordinates.outputs['Vector'], stripes.inputs['Vector'])
        stripes.inputs['Scale'].default_value = 7.5
        stripes.inputs['Distortion'].default_value = 7
        stripes.inputs['Detail'].default_value = 4
        stripes.inputs['Detail Scale'].default_value = 1.5
        stripe = ramp(stripes.outputs['Fac'], .48, .86, 'Soft stripe edges')
        # Muzzle and forehead retain subdued markings instead of bold tiger stripes.
        face = ramp(math('MULTIPLY', y, -1), .17, .30, 'Face stripe reduction')
        strength = math('MULTIPLY', stripe, math('SUBTRACT', .60, math('MULTIPLY', face, .34)))
        coat = mix(strength, coat, (.065, .047, .035, 1), 'Tabby markings')
        belly = math('SUBTRACT', 1, ramp(z, .12, .235, 'Belly transition'))
        chest = math('MULTIPLY', ramp(math('MULTIPLY', y, -1), .14, .27, 'Cream chest'),
                     math('SUBTRACT', 1, ramp(z, .255, .34, 'Chest height')))
        muzzle = math('MULTIPLY', ramp(math('MULTIPLY', y, -1), .31, .355, 'Cream muzzle'),
                      math('SUBTRACT', 1, ramp(z, .32, .355, 'Muzzle height')))
        cream = (.46, .42, .34, 1)
        fur_distance = .0016
    else:
        coat = mix(noise.outputs['Fac'], (.22, .115, .043, 1), (.40, .26, .11, 1), 'Golden sable coat')
        back = math('MULTIPLY', ramp(z, .34, .48, 'Sable back height'),
                    math('SUBTRACT', 1, ramp(math('MULTIPLY', y, -1), .24, .37, 'Back excludes face')))
        coat = mix(math('MULTIPLY', back, .48), coat, (.105, .065, .033, 1), 'Soft sable saddle')
        belly = math('SUBTRACT', 1, ramp(z, .20, .34, 'Belly transition'))
        chest = math('MULTIPLY', ramp(math('MULTIPLY', y, -1), .20, .35, 'Cream chest'),
                     math('SUBTRACT', 1, ramp(z, .38, .50, 'Chest height')))
        muzzle = math('MULTIPLY', ramp(math('MULTIPLY', y, -1), .47, .55, 'Cream muzzle'),
                      math('SUBTRACT', 1, ramp(z, .54, .60, 'Muzzle height')))
        cream = (.53, .43, .28, 1)
        fur_distance = .0024
    mask = math('MAXIMUM', math('MAXIMUM', belly, chest), muzzle, 'Cream anatomy mask')
    coat = mix(math('MULTIPLY', mask, .85), coat, cream, 'Belly chest and muzzle')

    # Anisotropic noise creates short, tapered-looking strands. This is baked
    # into the normal map; no particle fur or view-dependent shader is required.
    grain_vector = node('ShaderNodeVectorMath', 'Directional hair grain')
    grain_vector.operation = 'MULTIPLY'
    links.new(coordinates.outputs['Vector'], grain_vector.inputs[0])
    grain_vector.inputs[1].default_value = (115, 24, 150) if kind == 'cat' else (85, 22, 110)
    grain = node('ShaderNodeTexNoise', 'Fine individual hairs')
    links.new(grain_vector.outputs['Vector'], grain.inputs['Vector'])
    grain.inputs['Scale'].default_value = 1
    grain.inputs['Detail'].default_value = 2
    grain.inputs['Roughness'].default_value = .72
    # Keep light hairs restrained: their contrast should remain photographic.
    fur_color = mix(math('MULTIPLY', ramp(grain.outputs['Fac'], .38, .75, 'Hair color variation'), .15),
                    coat, (.52, .46, .36, 1) if kind == 'cat' else (.62, .43, .19, 1), 'Coat albedo')
    bump = node('ShaderNodeBump', 'Short fur normal')
    bump.inputs['Strength'].default_value = .38
    bump.inputs['Distance'].default_value = fur_distance
    links.new(grain.outputs['Fac'], bump.inputs['Height'])
    shader = node('ShaderNodeBsdfPrincipled', 'Fur surface')
    links.new(fur_color, shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .88
    shader.inputs['Sheen Weight'].default_value = .25
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    output = node('ShaderNodeOutputMaterial', 'Material Output')
    links.new(shader.outputs[0], output.inputs['Surface'])
    # Named nodes make the bake entry points explicit and editable in Blender.
    depths = {}
    def depth(n):
        if n.name not in depths:
            parents = [link.from_node for socket in n.inputs for link in socket.links]
            depths[n.name] = 1 + max((depth(parent) for parent in parents), default=-1)
        return depths[n.name]
    rows = {}
    for n in nodes:
        column = depth(n)
        n.location = (column * 230, -rows.get(column, 0) * 250)
        rows[column] = rows.get(column, 0) + 1
    material['fur_kind'] = kind
    material['fur_original_art'] = True
    return material


def bake_fur(obj, material, output_dir, kind, samples=16):
    """Smart-project the fur body, bake original shading, assign packed maps."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 12
    scene.render.bake.normal_space = 'TANGENT'
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for face in obj.data.polygons:
        face.material_index = 0
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.151917, island_margin=.02, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes['Fur surface']
    output = nodes['Material Output']
    albedo_output = nodes['Coat albedo'].outputs[0]
    target = nodes.new('ShaderNodeTexImage')
    target.name = 'Fur bake target'
    emission = nodes.new('ShaderNodeEmission')
    links.new(albedo_output, emission.inputs['Color'])
    images = {}
    for channel, size, bake_type in [('color', 1024, 'EMIT'), ('normal', 512, 'NORMAL')]:
        image = bpy.data.images.new('realism_pet_' + kind + '_' + channel, width=size, height=size)
        image.colorspace_settings.name = 'sRGB' if channel == 'color' else 'Non-Color'
        target.image = image
        nodes.active = target
        for n in nodes:
            n.select = n == target
        links.new(emission.outputs[0] if channel == 'color' else shader.outputs[0], output.inputs['Surface'])
        bpy.ops.object.bake(type=bake_type)
        image.file_format = 'JPEG'
        image.filepath_raw = str(output_dir / (image.name + '.jpg'))
        image.save()
        image.pack()
        images[channel] = image
    links.new(shader.outputs[0], output.inputs['Surface'])
    nodes.remove(emission)
    nodes.remove(target)
    material.use_fake_user = True

    runtime = bpy.data.materials.new('Realism / baked ' + kind + ' fur')
    runtime.use_nodes = True
    n, l = runtime.node_tree.nodes, runtime.node_tree.links
    p = n.get('Principled BSDF')
    p.inputs['Roughness'].default_value = .88
    p.inputs['Sheen Weight'].default_value = .25
    albedo = n.new('ShaderNodeTexImage'); albedo.image = images['color']
    l.new(albedo.outputs['Color'], p.inputs['Base Color'])
    normal = n.new('ShaderNodeTexImage'); normal.image = images['normal']
    normal_map = n.new('ShaderNodeNormalMap')
    normal_map.inputs['Strength'].default_value = .7
    l.new(normal.outputs['Color'], normal_map.inputs['Color'])
    l.new(normal_map.outputs['Normal'], p.inputs['Normal'])
    obj.data.materials[0] = runtime
    return runtime
