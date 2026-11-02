"""Small, rigged portrait accessories modeled in metres and joined to the source skin.

add_portrait_accessories(body, rig, spec) accepts eyewear ('round'/'angular'),
headwear ('beanie'/'cap'), hat_color and frame_color (linear RGB), hair_bun,
and hair_color. All are optional. Call while the imported rig is in rest pose.
"""
import bpy
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _material(name, color, roughness=.8, metal=0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    if roughness > .75:
        shader.inputs['Sheen Weight'].default_value = .22
    return material


def _mesh(name, vertices, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    uv = mesh.uv_layers.new(name='AccessoryUV')
    for face in mesh.polygons:
        face.use_smooth = True
        for loop_index in face.loop_indices:
            p = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (p.x * 8, p.z * 8)
    return obj


def _tube(name, points, radius, material, sides=6):
    points = [Vector(p) for p in points]
    vertices = []
    previous = None
    for i, p in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < .95 else Vector((1, 0, 0))
        a = tangent.cross(reference).normalized()
        if previous is not None and a.dot(previous) < 0:
            a = -a
        previous = a
        b = tangent.cross(a).normalized()
        for j in range(sides):
            angle = math.tau * j / sides
            vertices.append(tuple(p + radius * (a * math.cos(angle) + b * math.sin(angle))))
    faces = [(i * sides + j, i * sides + (j + 1) % sides,
              (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
             for i in range(len(points) - 1) for j in range(sides)]
    return _mesh(name, vertices, faces, material)


def add_portrait_accessories(body, rig, spec):
    if not any(spec.get(key) for key in ('eyewear', 'headwear', 'hair_bun')):
        return []
    world = body.matrix_world.copy()
    inverse = world.inverted()
    coordinates = [world @ vertex.co for vertex in body.data.vertices]
    head = rig.matrix_world @ rig.data.bones['Head'].head_local
    crown_points = [p for p in coordinates if p.z > head.z + .07]
    top = max(p.z for p in crown_points)
    # The upper skull stays useful for both the short male hair and longer
    # female hair, without including shoulder-length locks in hat dimensions.
    ring = [p for p in crown_points if top - .10 < p.z < top - .035]
    center_x = (min(p.x for p in ring) + max(p.x for p in ring)) / 2
    center_y = (min(p.y for p in ring) + max(p.y for p in ring)) / 2
    rx = (max(p.x for p in ring) - min(p.x for p in ring)) / 2 + .007
    ry = (max(p.y for p in ring) - min(p.y for p in ring)) / 2 + .009
    parts = []

    eyewear = spec.get('eyewear')
    if eyewear in ('round', 'angular'):
        frame = _material('Portrait / ' + eyewear + ' spectacle frames',
                          spec.get('frame_color', (.035, .026, .019)), .34, .45 if eyewear == 'round' else .05)
        surface = BVHTree.FromPolygons(coordinates, [list(p.vertices) for p in body.data.polygons], all_triangles=True)
        eye_z = head.z + .057
        centers = [center_x - .032, center_x + .032]
        face_hits = [surface.ray_cast(Vector((x, -1, eye_z)), Vector((0, 1, 0)))[0] for x in centers]
        front_y = min(hit.y for hit in face_hits if hit is not None) - .012
        for sign, x in zip((-1, 1), centers):
            points = []
            for i in range(33):
                a = math.tau * i / 32
                if eyewear == 'round':
                    dx, dz = .025 * math.cos(a), .022 * math.sin(a)
                else:
                    dx = .026 * math.copysign(abs(math.cos(a)) ** .45, math.cos(a))
                    dz = .017 * math.copysign(abs(math.sin(a)) ** .45, math.sin(a))
                points.append((x + dx, front_y + .06 * abs(dx), eye_z + dz))
            parts.append(_tube('Spectacle ' + ('left' if sign < 0 else 'right') + ' rim', points,
                               .0014 if eyewear == 'round' else .0022, frame))
            outer_x = x + sign * .026
            parts.append(_tube('Spectacle temple', [(outer_x, front_y, eye_z + .006),
                (center_x + sign * (rx + .002), front_y + .025, eye_z + .004),
                (center_x + sign * (rx + .004), center_y + .025, eye_z -.004),
                (center_x + sign * (rx -.003), center_y + .043, eye_z -.025)], .0019, frame))
        parts.append(_tube('Spectacle arched bridge', [(center_x -.008, front_y, eye_z + .006),
            (center_x -.004, front_y -.003, eye_z + .010), (center_x + .004, front_y -.003, eye_z + .010),
            (center_x + .008, front_y, eye_z + .006)], .0015, frame))

    hat = spec.get('headwear')
    if hat in ('beanie', 'cap'):
        fabric = _material('Portrait / ' + hat + ' cloth', spec.get('hat_color', (.06, .075, .065)), .91)
        seam_color = tuple(v * .72 for v in spec.get('hat_color', (.06, .075, .065)))
        seam = _material('Portrait / ' + hat + ' seams', seam_color, .95)
        base_z = top - (.075 if hat == 'beanie' else .065)
        height = .13 if hat == 'beanie' else .10
        n, rows = 64, 17
        vertices = []
        for row in range(rows):
            t = row / (rows - 1)
            radius = max(.002, math.cos(t * math.pi / 2))
            for j in range(n):
                a = math.tau * j / n
                rib = .0015 * math.cos(a * 32) * (1-t) if hat == 'beanie' else 0
                vertices.append((center_x + (rx * radius + rib) * math.cos(a),
                                 center_y + (ry * radius + rib) * math.sin(a),
                                 base_z + height * math.sin(t * math.pi / 2)))
        faces = [(r*n+j, r*n+(j+1)%n, (r+1)*n+(j+1)%n, (r+1)*n+j)
                 for r in range(rows-1) for j in range(n)]
        parts.append(_mesh('Ribbed knit crown' if hat == 'beanie' else 'Six panel cap crown', vertices, faces, fabric))
        if hat == 'beanie':
            vertices = []
            for row in range(5):
                z = base_z + row * .009
                for j in range(n):
                    a=math.tau*j/n;rib=.0018*math.cos(a*32)
                    vertices.append((center_x+(rx+.003+rib)*math.cos(a),center_y+(ry+.003+rib)*math.sin(a),z))
            faces=[(r*n+j,r*n+(j+1)%n,(r+1)*n+(j+1)%n,(r+1)*n+j) for r in range(4) for j in range(n)]
            parts.append(_mesh('Turned knit cuff',vertices,faces,fabric))
        else:
            # A shallow curved visor sits in front of the forehead; a sewn
            # top edge and crown panel seams keep it looking like soft cloth.
            vertices=[]
            for row in range(5):
                t=row/4
                for j in range(25):
                    a=math.pi + math.pi*j/24
                    vertices.append((center_x+(rx+.005*t)*math.cos(a),
                                     center_y+(ry+.075*t)*math.sin(a),
                                     base_z+.003-.014*t-.006*abs(math.cos(a))))
            faces=[(r*25+j,r*25+j+1,(r+1)*25+j+1,(r+1)*25+j) for r in range(4) for j in range(24)]
            parts.append(_mesh('Curved fabric visor',vertices,faces,fabric))
            parts.append(_tube('Visor stitched edge',vertices[-25:],.0013,seam))
            for panel in range(6):
                a=math.tau*panel/6
                points=[]
                for row in range(16):
                    t=row/16;radius=math.cos(t*math.pi/2)
                    points.append((center_x+(rx*radius+.0008)*math.cos(a),center_y+(ry*radius+.0008)*math.sin(a),base_z+height*math.sin(t*math.pi/2)+.0005))
                parts.append(_tube('Cap panel seam',points,.0009,seam,sides=5))

    if spec.get('hair_bun'):
        hair = _material('Portrait / gathered hair', spec.get('hair_color', (.055,.028,.012)), .72)
        vertices=[];faces=[];n=32;rows=17
        for row in range(rows):
            p=math.pi*row/(rows-1)
            for j in range(n):
                a=math.tau*j/n;ridge=1+.03*math.cos(a*16+p*4)
                vertices.append((center_x+.052*math.sin(p)*math.cos(a)*ridge,
                    center_y+ry*.88+.048*math.sin(p)*math.sin(a)*ridge,
                    top-.035+.048*math.cos(p)))
        faces=[(r*n+j,r*n+(j+1)%n,(r+1)*n+(j+1)%n,(r+1)*n+j) for r in range(rows-1) for j in range(n)]
        parts.append(_mesh('Gathered hair knot',vertices,faces,hair))

    if not parts:
        return []
    for part in parts:
        for vertex in part.data.vertices:
            vertex.co = inverse @ vertex.co
        head_group = part.vertex_groups.new(name='Head')
        head_group.add(list(range(len(part.data.vertices))), 1, 'REPLACE')
        part.parent = body.parent
        part.matrix_parent_inverse = body.matrix_parent_inverse.copy()
        part.matrix_basis = body.matrix_basis.copy()
        modifier = part.modifiers.new('Head accessory skin', 'ARMATURE')
        modifier.object = rig
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = body
    names = [part.name for part in parts]
    bpy.ops.object.join()
    return names
