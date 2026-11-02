"""Shared Blender modeling/export helpers for the complete atelier library."""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models'
SOURCE=ROOT/'assets/blender/rebuild'
OUT.mkdir(exist_ok=True,parents=True); SOURCE.mkdir(exist_ok=True,parents=True)
random.seed(1403)
bpy.context.preferences.filepaths.save_version=0
REPORT={}

def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def mat(name,color,rough=.6,metal=0):
    existing=bpy.data.materials.get('Atelier / '+name)
    if existing:return existing
    m=bpy.data.materials.new('Atelier / '+name); m.diffuse_color=(*color,1);m.use_nodes=True
    n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,1)
    n.inputs['Roughness'].default_value=rough;n.inputs['Metallic'].default_value=metal
    return m

def mesh(name,verts,faces,m,smooth=True):
    d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(m)
    for p in d.polygons:p.use_smooth=smooth
    return o

BOX_SEGMENTS=3

def box(name,pos,size,m,r=.01):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if r:
        b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=min(r,min(size)*.45);b.segments=BOX_SEGMENTS
        bpy.ops.object.modifier_apply(modifier=b.name)
        n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=n.name)
    o.data.materials.append(m);return o

def ellipsoid(name,pos,size,m,segments=24,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=pos)
    o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(m)
    for p in o.data.polygons:p.use_smooth=True
    return o

def lathe(name,profile,m,n=32):
    v=[(r*math.cos(j*math.tau/n),r*math.sin(j*math.tau/n),z) for r,z in profile for j in range(n)]
    f=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(profile)-1) for j in range(n)]
    return mesh(name,v,f,m)

def tube(name,points,r,m,sides=8):
    points=[Vector(p) for p in points];v=[];previous_axis=None
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        reference=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((1,0,0))
        a=(previous_axis-tangent*previous_axis.dot(tangent)).normalized() if previous_axis is not None else tangent.cross(reference).normalized()
        if a.length<.1:a=tangent.cross(reference).normalized()
        previous_axis=a;b=tangent.cross(a).normalized()
        radius=r[i] if isinstance(r,(list,tuple)) else r
        for j in range(sides):v.append(tuple(p+radius*(a*math.cos(j*math.tau/sides)+b*math.sin(j*math.tau/sides))))
    f=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(len(points)-1) for j in range(sides)]
    f.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name,v,f,m)

def loft(name,profile,m,n=24):
    # z, x radius, y radius, centre y
    v=[(rx*math.cos(j*math.tau/n),cy+ry*math.sin(j*math.tau/n),z) for z,rx,ry,cy in profile for j in range(n)]
    f=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(profile)-1) for j in range(n)]
    f.extend([tuple(range(n-1,-1,-1)),tuple((len(profile)-1)*n+j for j in range(n))])
    return mesh(name,v,f,m)

def move(o,x=0,y=0,z=0):o.location += Vector((x,y,z));return o

def ring(name,pos,radius,thickness,m,n=32):
    return tube(name,[(pos[0]+radius*math.cos(i*math.tau/n),pos[1]+radius*math.sin(i*math.tau/n),pos[2]) for i in range(n+1)],thickness,m)

def merge(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    return o

def export(name,rig=None):
    objs=list(bpy.context.scene.objects)
    meshes=[o for o in objs if o.type=='MESH']
    if not rig:
        batches={}
        for o in meshes:batches.setdefault(o.data.materials[0].name,[]).append(o)
        meshes=[merge(v,name+' / '+k) for k,v in batches.items()]
    for o in meshes:
        # Consistent metre-based box UVs for custom lathed/lofted surfaces.
        # Native primitive UVs are replaced too, so wood grain has the same
        # physical scale on chair legs, shelf boards and large tabletops.
        uv=o.data.uv_layers.active or o.data.uv_layers.new(name='AtelierUV')
        for face in o.data.polygons:
            axis=max(range(3),key=lambda i:abs(face.normal[i]))
            axes=[i for i in range(3) if i!=axis]
            for li in face.loop_indices:
                v=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
                uv.data[li].uv=(v[axes[0]]*2,v[axes[1]]*2)
        o['atelier']=True
        if not rig:
            bpy.context.view_layer.objects.active=o;o.select_set(True)
            bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes+([rig] if rig else []):o.select_set(True)
    path=OUT/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,
        export_apply=not bool(rig),export_animations=bool(rig),export_animation_mode='ACTIONS',
        export_frame_range=False,export_force_sampling=True,
        export_anim_single_armature=True,export_extras=True,export_cameras=False,export_lights=False)
    tris=0
    for o in meshes:o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles)
    REPORT[name]={'triangles':tris,'bytes':path.stat().st_size,'materials':len({m.name for o in meshes for m in o.data.materials}),'rigged':bool(rig)}
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')),compress=True)
    (SOURCE/'catalog.json').write_text(json.dumps(REPORT,indent=2)+'\n')
    print('ATELIER_ASSET',name,REPORT[name],flush=True)

WOOD=mat('smoked oak',(.18,.10,.055),.42)
LIGHTWOOD=mat('honey ash',(.38,.24,.12),.48)
LINEN=mat('linen upholstery',(.56,.50,.39),.88)
DARK=mat('charcoal powder coat',(.022,.031,.03),.53,.22)
BRASS=mat('satin brass',(.48,.30,.12),.3,.8)
STEEL=mat('brushed nickel',(.5,.54,.56),.28,.87)
GLAZE=mat('ivory porcelain',(.79,.75,.65),.24)
TERRACOTTA=mat('fired terracotta',(.35,.14,.075),.84)
GREEN=mat('leaf upper surface',(.055,.18,.075),.67)
LEAFLIGHT=mat('leaf new growth',(.16,.3,.10),.71)
SOIL=mat('potting soil',(.035,.025,.014),.98)
PAPER=mat('warm paper',(.77,.72,.59),.92)
BREAD=mat('golden crust',(.48,.23,.055),.82)
COFFEE=mat('espresso crema',(.14,.065,.024),.34)

# Portable PBR fields, authored in Blender by build_cafe_assets.py. All source
# images are packed into the editable files and embedded in the GLB exports.
def textured(material,surface,tint):
    nodes=material.node_tree.nodes;links=material.node_tree.links;bsdf=nodes.get('Principled BSDF')
    for channel in ['color','normal','roughness']:
        path=ROOT/'public/textures'/('studio_'+surface+'_'+channel+'.jpg')
        image=bpy.data.images.load(str(path),check_existing=True);image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color';image.pack()
        tex=nodes.new('ShaderNodeTexImage');tex.image=image
        if channel=='color':
            mul=nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.inputs[1].default_value=(*tint,1)
            links.new(tex.outputs['Color'],mul.inputs[2]);links.new(mul.outputs[0],bsdf.inputs['Base Color'])
        elif channel=='normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.45;links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],bsdf.inputs['Normal'])
        else:links.new(tex.outputs['Color'],bsdf.inputs['Roughness'])
textured(WOOD,'oak',(.6,.52,.44))
textured(LIGHTWOOD,'oak',(1,.94,.82))
textured(LINEN,'linen',(.65,.64,.57))
