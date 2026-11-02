"""Original countertop geometry and eight reusable, bake-ready Blender materials.

Metres, Z-up, forward -Y. Text and cards lie in XZ and face -Y.
Palette keys: ceramic, dark, copper, linen, paper, olive, brown, glass.
"""
import bpy
import math
from mathutils import Vector


def _procedural_material(name, color, roughness, *, metal=0, grain='ceramic'):
    material = bpy.data.materials.new('Countertop / ' + name)
    material.use_nodes = True
    material.use_fake_user = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    shader.location = (500, 0)
    nodes.get('Material Output').location = (760, 0)
    coordinates = nodes.new('ShaderNodeNewGeometry')
    coordinates.location = (-800, 50)
    direction = nodes.new('ShaderNodeVectorMath')
    direction.operation = 'MULTIPLY'
    direction.location = (-600, 50)
    frequencies = {'ceramic': (170,170,170), 'wood': (20,180,180),
                   'copper': (5,420,420), 'linen': (260,260,260),
                   'paper': (200,200,200), 'leaf': (75,140,75),
                   'bread': (125,125,125)}
    direction.inputs[1].default_value = frequencies[grain]
    links.new(coordinates.outputs['Position'], direction.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-390, 50)
    noise.inputs['Scale'].default_value = 1
    noise.inputs['Detail'].default_value = 2
    noise.inputs['Roughness'].default_value = .7
    links.new(direction.outputs[0], noise.inputs['Vector'])
    variation = nodes.new('ShaderNodeMixRGB')
    variation.location = (-140, 160)
    variation.blend_type = 'MIX'
    variation.inputs[1].default_value = (*[v*.92 for v in color], 1)
    variation.inputs[2].default_value = (*[min(1,v*1.06) for v in color], 1)
    links.new(noise.outputs['Fac'], variation.inputs[0])
    links.new(variation.outputs[0], shader.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.location = (210,-150)
    bump.inputs['Strength'].default_value = .16 if grain != 'linen' else .27
    bump.inputs['Distance'].default_value = {'ceramic': .0008, 'wood': .0004,
        'copper': .00009, 'linen': .00065, 'paper': .00025, 'leaf': .0002, 'bread': .0012}[grain]
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    if grain == 'linen':
        shader.inputs['Sheen Weight'].default_value = .28
        shader.inputs['Sheen Roughness'].default_value = .8
    if grain == 'ceramic':
        shader.inputs['Coat Weight'].default_value = .13
        shader.inputs['Coat Roughness'].default_value = .32
    if grain == 'copper':
        shader.inputs['Anisotropic'].default_value = .45
    material['countertop_original_material'] = True
    material['countertop_roughness'] = roughness
    material['countertop_metalness'] = metal
    return material


def make_palette():
    palette = {
        'ceramic': _procedural_material('warm stoneware', (.60,.555,.46), .40),
        'dark': _procedural_material('walnut and ink', (.045,.029,.018), .56, grain='wood'),
        'copper': _procedural_material('brushed copper', (.43,.205,.095), .30, metal=.88, grain='copper'),
        'linen': _procedural_material('washed flax linen', (.53,.49,.405), .94, grain='linen'),
        'paper': _procedural_material('natural kraft paper', (.41,.295,.17), .91, grain='paper'),
        'olive': _procedural_material('olive foliage', (.065,.12,.047), .76, grain='leaf'),
        'brown': _procedural_material('toasted crust and beans', (.20,.085,.029), .77, grain='bread'),
    }
    glass = bpy.data.materials.new('Countertop / clear borosilicate')
    glass.use_nodes = True
    glass.use_fake_user = True
    shader = glass.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.94,.975,1,1)
    shader.inputs['Roughness'].default_value = .08
    # Thin tinted glass uses ordinary alpha blending in the real-time scene;
    # transmission would add an unnecessary refraction render pass.
    shader.inputs['Transmission Weight'].default_value = 0
    # The vessel has both outer and inner walls. Backface culling plus low
    # alpha avoids stacking four bright surfaces over its opaque contents.
    shader.inputs['Alpha'].default_value = .12
    shader.inputs['IOR'].default_value = 1.46
    glass.diffuse_color = (.94,.975,1,.12)
    glass.surface_render_method = 'BLENDED'
    glass.use_backface_culling = True
    glass['countertop_glass'] = True
    palette['glass'] = glass
    return palette


def mesh(name, vertices, faces, material, *, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(material)
    for face in data.polygons:
        face.use_smooth = smooth and len(face.vertices) <= 4
    return obj


def lathe(name, profile, material, location=(0,0,0), *, segments=48, ribs=0, rib_depth=.0007, caps=False):
    """Turn a (z,radius) profile; include an inner return profile for open pottery.

    ribs adds subtle vertical fluting; wheel-thrown horizontal rings can be
    authored directly as small radius variations in the profile. UV V follows
    profile arc length, U follows the circumference with a duplicated seam.
    """
    profile = [(float(z),float(r)) for z,r in profile]
    distances = [0]
    for (z0,r0),(z1,r1) in zip(profile,profile[1:]):
        distances.append(distances[-1] + math.hypot(z1-z0,r1-r0))
    length = max(.00001,distances[-1])
    vertices=[]
    for i,(z,r) in enumerate(profile):
        weight = math.sin(math.pi*distances[i]/length) ** .5
        for j in range(segments+1):
            angle=math.tau*j/segments
            radius=max(.00001,r + (rib_depth*math.cos(angle*ribs)*weight if ribs and r>.003 else 0))
            vertices.append((radius*math.cos(angle),radius*math.sin(angle),z))
    stride=segments+1
    faces=[(i*stride+j,i*stride+j+1,(i+1)*stride+j+1,(i+1)*stride+j)
           for i in range(len(profile)-1) for j in range(segments)]
    if caps:
        faces.extend([tuple(range(segments-1,-1,-1)),tuple((len(profile)-1)*stride+j for j in range(segments))])
    obj=mesh(name,vertices,faces,material)
    uv=obj.data.uv_layers.new(name='Turned pottery UV')
    for polygon in obj.data.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index=obj.data.loops[loop_index].vertex_index
            row,column=divmod(vertex_index,stride)
            uv.data[loop_index].uv=(column/segments,distances[row]/length)
    obj.location=location
    return obj


def beveled_box(name, size, location, material, bevel=.002, *, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    obj=bpy.context.object;obj.name=name;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(material)
    width=min(bevel,min(abs(v) for v in size)*.35)
    if width>0:
        modifier=obj.modifiers.new('Soft manufactured edges','BEVEL')
        modifier.width=width;modifier.segments=segments
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        for face in obj.data.polygons:face.use_smooth=True
        modifier=obj.modifiers.new('Weighted face normals','WEIGHTED_NORMAL')
        modifier.keep_sharp=True;modifier.weight=50
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def _catmull_points(points, subdivisions):
    if subdivisions<2 or len(points)<3:return points
    result=[]
    for i in range(len(points)-1):
        p0=points[max(0,i-1)];p1=points[i];p2=points[i+1];p3=points[min(len(points)-1,i+2)]
        for step in range(subdivisions):
            t=step/subdivisions
            result.append((p1*2+(p2-p0)*t+(p0*2-p1*5+p2*4-p3)*t*t+(-p0+p1*3-p2*3+p3)*t*t*t)*.5)
    result.append(points[-1]);return result


def tube(name, points, radius, material, *, sides=10, smooth=3):
    points=_catmull_points([Vector(p) for p in points],smooth)
    vertices=[];last_axis=None
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        reference=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((1,0,0))
        a=(last_axis-tangent*last_axis.dot(tangent)).normalized() if last_axis is not None else tangent.cross(reference).normalized()
        if a.length<.01:a=tangent.cross(reference).normalized()
        last_axis=a;b=tangent.cross(a).normalized()
        for j in range(sides):
            angle=math.tau*j/sides
            vertices.append(tuple(p+radius*(a*math.cos(angle)+b*math.sin(angle))))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j)
           for i in range(len(points)-1) for j in range(sides)]
    if (points[0]-points[-1]).length>.000001:
        faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    obj=mesh(name,vertices,faces,material)
    uv=obj.data.uv_layers.new(name='Tube length UV')
    distances=[0]
    for a,b in zip(points,points[1:]):distances.append(distances[-1]+(b-a).length)
    for face in obj.data.polygons:
        columns=[obj.data.loops[li].vertex_index%sides for li in face.loop_indices]
        seam=0 in columns and sides-1 in columns
        for li in face.loop_indices:
            row,column=divmod(obj.data.loops[li].vertex_index,sides)
            u=1 if seam and column==0 else column/sides
            uv.data[li].uv=(u,distances[row]/max(.00001,distances[-1]))
    return obj


def ring(name, center, radius, thickness, material, *, segments=48, sides=8, plane='XY'):
    points=[]
    for i in range(segments+1):
        a=math.tau*i/segments
        p=(radius*math.cos(a),radius*math.sin(a),0) if plane=='XY' else (radius*math.cos(a),0,radius*math.sin(a))
        points.append(tuple(Vector(center)+Vector(p)))
    return tube(name,points,thickness,material,sides=sides,smooth=0)


def text_mesh(name, text, location, size, material, *, align='CENTER', extrude=.00004):
    curve=bpy.data.curves.new(name,'FONT')
    curve.body=text;curve.align_x=align;curve.size=size
    curve.resolution_u=4;curve.extrude=extrude
    curve.space_character=1.05
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj)
    obj.location=location;obj.rotation_euler=(math.pi/2,0,0)
    curve.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def framed_card(name, location, width, height, palette, *, frame_material=None, border=.005):
    """Return frame/backboard meshes. location is card centre; no print added.

    The visible paper plane is y=location.y-.004, inset by border on all sides.
    Place authored print geometry slightly in front at y=location.y-.0041.
    """
    x,y,z=location;frame_material=frame_material or palette['dark']
    parts=[beveled_box(name+' backing',(width,.006,height),(x,y,z),frame_material,.0008),
           beveled_box(name+' paper',(width-border*2,.002,height-border*2),(x,y-.003,z),palette['paper'],.0003)]
    for sign in (-1,1):
        parts.append(beveled_box(name+' side moulding',(border,.011,height),(x+sign*(width-border)/2,y-.001,z),frame_material,.0009))
        parts.append(beveled_box(name+' end moulding',(width-border*2,.011,border),(x,y-.001,z+sign*(height-border)/2),frame_material,.0009))
    return parts
