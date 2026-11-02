"""Original Blender botanical collection with curved, species-specific leaves.

All geometry, vein/pigmentation atlases and wheel-thrown pots are authored here.
The exported foliage retains the previous normalized placement envelope. Run
with Blender 4.3; VIBE_BOTANICAL limits generation to one key. -- --render makes
the family study after all eight source files exist.
"""
import bpy, math, json, os, random, sys
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'assets/blender/collection'
OUT=ROOT/'public/models'
TEX=SOURCE/'botanical-textures'
for directory in [SOURCE,TEX]:directory.mkdir(parents=True,exist_ok=True)
KEYS={'plant_monstera':('monstera',1.15),'plant_fern':('fern',.5),
      'plant_pothos':('pothos',.6),'plant_pothos_vine':('vine',.55),
      'plant_snake':('snake',.72),'plant_succulent':('succulent',.3),
      'plant_small':('peperomia',.35),'plant':('rubber',1.)}
REPORT={}
bpy.context.preferences.filepaths.save_version=0

def material(name,color,rough=.7,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m

def mesh(name,verts,faces,mat,smooth=True,uvs=None,colors=None):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    data.materials.append(mat);obj['atelier']=True;obj['collection_botanical']=True
    for polygon in data.polygons:polygon.use_smooth=smooth
    if uvs:
        uv=data.uv_layers.new(name='BotanicalUV')
        for loop in data.loops:uv.data[loop.index].uv=uvs[loop.vertex_index]
    if colors:
        layer=data.color_attributes.new(name='BotanicalTint',type='BYTE_COLOR',domain='CORNER')
        data.color_attributes.active_color=layer
        for loop in data.loops:layer.data[loop.index].color=(*colors[loop.vertex_index],1)
    return obj

def tube(name,points,radius,mat,sides=6):
    points=[Vector(p) for p in points];verts=[];previous=None
    if isinstance(radius,(int,float)):radius=[radius]*len(points)
    for i,point in enumerate(points):
        direction=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        reference=Vector((0,0,1)) if abs(direction.z)<.95 else Vector((1,0,0))
        cross=direction.cross(reference).normalized()
        if previous is not None and cross.dot(previous)<0:cross=-cross
        previous=cross;other=direction.cross(cross).normalized()
        for j in range(sides):
            a=j*math.tau/sides;verts.append(tuple(point+radius[i]*(cross*math.cos(a)+other*math.sin(a))))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j)
           for i in range(len(points)-1) for j in range(sides)]
    faces += [tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))]
    return mesh(name,verts,faces,mat)

def atlas():
    """Four botanical fields: broad leaf, snake, succulent and fern pinna."""
    size=512;yy,xx=np.mgrid[0:size,0:size];u=(xx%256)/255;v=(yy%256)/255
    rng=np.random.default_rng(20261102)
    grain=rng.normal(0,.007,(size,size))
    broad=.021*np.sin(u*37+v*17)+.014*np.sin(v*67-u*21)
    mid=np.exp(-((u-.5)/.012)**2)
    veins=np.exp(-(np.sin((v-np.abs(u-.5)*.64)*math.pi*12)/.18)**2)*(.35+.65*np.abs(u-.5)*2)
    smooth=.95+.05*np.sin(v*math.pi)
    field=np.zeros((size,size,4),dtype=np.float32);height=np.zeros((size,size))
    for quadrant in range(4):
        mask=(xx//256+2*(yy//256))==quadrant
        if quadrant==0:
            base=np.stack([.064+broad*.28,.148+broad*.55,.052+broad*.2],axis=-1)
            variation=(.004*veins+.009*mid+grain*.27)
            base+=variation[:,:,None]*np.array([.9,1.4,.45])
            h=.28*mid+.13*veins+grain*.5
        elif quadrant==1:
            edge=np.clip((np.abs(u-.5)-.35)/.13,0,1)
            bars=.025*np.sin(v*math.pi*23+np.sin(u*22))
            green=np.stack([.055+bars*.4,.13+bars,.066+bars*.45],axis=-1)
            gold=np.array([.27,.31,.085]);base=green*(1-edge[:,:,None]) + gold*edge[:,:,None]
            base+=grain[:,:,None]*.2;h=.04*np.sin(u*45)+.08*mid+grain*.5
        elif quadrant==2:
            rim=np.clip((np.abs(u-.5)-.36)/.14,0,1)
            base=np.empty((size,size,3));base[:]=(.13,.22,.17)
            base=base*(1-rim[:,:,None]*.3)+np.array([.20,.12,.12])*rim[:,:,None]*.3
            base+=grain[:,:,None]*.4;h=.04*mid+grain*.3
        else:
            base=np.stack([.065+broad*.3,.17+broad*.7,.052+broad*.2],axis=-1)
            base+=(.006*veins+.006*mid+grain*.3)[:,:,None]*np.array([.8,1.3,.5]);h=.18*mid+.07*veins+grain*.4
        field[:,:,:3][mask]=np.clip(base[mask]*smooth[mask,None],0,1);height[mask]=h[mask]
    field[:,:,3]=1
    dx=np.gradient(height,axis=1);dy=np.gradient(height,axis=0)
    normal=np.dstack([-dx*1.6,-dy*1.6,np.ones_like(dx)]);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
    normal=np.dstack([normal*.5+.5,np.ones_like(dx)]).astype(np.float32)
    paths={}
    for channel,pixels in [('color',field),('normal',normal)]:
        image=bpy.data.images.new('Collection botanical '+channel,width=size,height=size,alpha=False)
        image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
        image.pixels.foreach_set(pixels.ravel());image.file_format='JPEG'
        path=TEX/('botanical_'+channel+'.jpg');image.filepath_raw=str(path);image.save();image.pack();paths[channel]=path
    return paths

def leaf_material():
    m=material('Collection / living foliage',(.12,.25,.08),.56)
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
    p.inputs['Coat Weight'].default_value=.06;p.inputs['Coat Roughness'].default_value=.4
    for channel in ['color','normal']:
        image=bpy.data.images.load(str(TEX/('botanical_'+channel+'.jpg')),check_existing=True)
        image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color';image.pack()
        texture=nodes.new('ShaderNodeTexImage');texture.image=image
        if channel=='color':
            vertex=nodes.new('ShaderNodeVertexColor');vertex.layer_name='BotanicalTint'
            mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
            links.new(texture.outputs['Color'],mix.inputs[1]);links.new(vertex.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],p.inputs['Base Color'])
        else:
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.55
            links.new(texture.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],p.inputs['Normal'])
    return m

def pot(radius,height,kind,clay,soil):
    # Hollow inner wall, rolled lip, recessed foot and fine wheel-throwing rings.
    profile=[(0,0),(radius*.69,0),(radius*.74,.012),(radius*.73,.024)]
    for i in range(1,13):
        t=i/12;profile.append((radius*(.73+.22*t)+math.sin(t*math.pi*12)*radius*.004,height*(.12+.78*t)))
    profile += [(radius*.99,height*.94),(radius,height*.98),(radius*.985,height),
                (radius*.92,height),(radius*.895,height*.97),(radius*.89,height*.89),
                (radius*.76,height*.20),(0,height*.20)]
    n=48;verts=[];colors=[]
    for row,(r,z) in enumerate(profile):
        for j in range(n):
            a=j*math.tau/n;irregular=1+.0025*math.sin(a*3+z*20)
            verts.append((r*math.cos(a)*irregular,r*math.sin(a)*irregular,z))
            base=(.39,.21,.13) if kind not in ['peperomia','succulent','snake'] else {'peperomia':(.55,.51,.42),'succulent':(.47,.37,.27),'snake':(.25,.29,.27)}[kind]
            shade=.98+.03*math.sin(a*13+row*1.3)+.015*math.sin(row*5)
            colors.append(tuple(c*shade for c in base))
    faces=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(profile)-1) for j in range(n)]
    mesh('Wheel-thrown planter / rim, wall and recessed foot',verts,faces,clay,colors=colors)
    z=height*.87
    soilverts=[(0,0,z)]+[(radius*.87*math.cos(j*math.tau/32),radius*.87*math.sin(j*math.tau/32),z) for j in range(32)]
    mesh('Dark recessed potting soil',soilverts,[(0,j+1,(j+1)%32+1) for j in range(32)],soil)
    rng=random.Random(931)
    for i in range(28):
        a=rng.random()*math.tau;r=math.sqrt(rng.random())*radius*.82
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(math.cos(a)*r,math.sin(a)*r,z+.001))
        o=bpy.context.object;o.name='Potting mix / perlite and bark';o.scale=(.005,.004,.0025) if i%4 else (.006,.003,.004)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(soil)
        o['atelier']=True;o['collection_botanical']=True

def leaf(name,start,end,width,mat,stem,kind='broad',tint=(1,1,1),seed=0,rows=14):
    """Curved solid leaf with mapped pigmentation and a modeled attached midrib."""
    rng=random.Random(seed);a=Vector(start);axis=Vector(end)-a;length=axis.length
    direction=axis.normalized();side=direction.cross(Vector((0,0,1))).normalized()
    if side.length<.1:side=Vector((1,0,0))
    normal=side.cross(direction).normalized()
    if normal.z<0:normal=-normal
    cols=6 if kind in ['broad','heart','rubber'] else 4
    verts=[];uvs=[];colors=[];phase=rng.random()*math.tau
    quadrant=1 if kind=='snake' else 2 if kind=='succulent' else 3 if kind=='fern' else 0
    qx=quadrant%2;qy=quadrant//2
    def halfwidth(t):
        if kind=='snake':return width*(math.sin(math.pi*t)**.20)*(1-.35*t)
        if kind=='succulent':return width*(math.sin(math.pi*t)**.62)*(1-.32*t)
        if kind=='heart':return width*(math.sin(math.pi*t)**.48)*(1-.42*t)
        value=width*math.sin(math.pi*t)**(.58 if kind=='monstera' else .78)
        if kind=='monstera':
            for location in [.30,.45,.60,.73,.84]:value*=1-.54*math.exp(-((t-location)/.035)**2)
        return value
    def surface(x,t,z=0):
        edge=abs(x)/max(width,.001)
        curve=math.sin(math.pi*t)*width*(.26 if kind!='succulent' else .44)-edge*edge*width*.16
        twist=.035*math.sin(t*math.pi+phase)*x
        return a+axis*t+side*x+normal*(curve+twist+z)+Vector((0,0,-width*.22*t*t))
    for row in range(rows+1):
        t=row/rows;w=max(width*.001,halfwidth(t))
        for col in range(cols+1):
            s=col/cols*2-1;x=s*w
            verts.append((x,t*length,0));uvs.append(((qx+.025+.95*(s*.5+.5))/2,(qy+.025+.95*t)/2))
            shade=.94+.09*math.sin(math.pi*t)+.025*math.sin(t*17+phase)
            colors.append(tuple(min(1.35,max(.1,c*shade)) for c in tint))
    faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
    obj=mesh(name,verts,faces,mat,uvs=uvs,colors=colors)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    # Fern pinnae are paper-thin and rendered double-sided; their curved
    # surface needs no duplicated underside. Broad and fleshy leaves retain
    # a closed, modeled edge so their silhouettes hold up in close-ups.
    if kind!='fern':
        solid=obj.modifiers.new('Living leaf thickness','SOLIDIFY');solid.thickness=.0075 if kind=='succulent' else .001
        bpy.ops.object.modifier_apply(modifier=solid.name)
        if kind=='succulent':
            bevel=obj.modifiers.new('Soft fleshy leaf edge','BEVEL');bevel.width=.0011;bevel.segments=2
            bpy.ops.object.modifier_apply(modifier=bevel.name)
    # Real holes through the broad adult leaf, before the mesh is bent into its
    # final shape. Boolean silhouettes remain smooth and visible from both sides.
    if kind=='monstera':
        for sign in [-1,1]:
            for t in [.37,.56]:
                x=sign*halfwidth(t)*.45
                bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=1,depth=.025,location=(x,t*length,0))
                cutter=bpy.context.object;cutter.scale=(width*.065,length*.045,1)
                bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
                bpy.context.view_layer.objects.active=obj
                boolean=obj.modifiers.new('Natural leaf fenestration','BOOLEAN');boolean.operation='DIFFERENCE';boolean.solver='EXACT';boolean.object=cutter
                bpy.ops.object.modifier_apply(modifier=boolean.name);bpy.data.objects.remove(cutter,do_unlink=True)
    for vertex in obj.data.vertices:
        x,y,z=vertex.co;vertex.co=surface(x,y/length,z)
    for polygon in obj.data.polygons:polygon.use_smooth=True
    obj.select_set(False)
    if kind not in ['succulent','fern']:
        points=[surface(0,t,.0017) for t in [0,.15,.35,.55,.75,.95]]
        tube('Attached leaf midrib',points,[.0017,.0016,.0013,.001,.0007,.0002],stem,5)
    return obj

def build_species(kind,foliage,stem,clay,soil):
    if kind=='vine':
        for i in range(5):
            angle=i*1.17;points=[]
            for j in range(10):
                t=j/9;points.append((math.cos(angle)*.09+math.sin(t*4+i)*.035,math.sin(angle)*.035+t*.06,.55-t*(.40+.03*(i%3))))
            tube('Pothos trailing internodes',points,[.0035-j*.00018 for j in range(10)],stem,6)
            for j in range(1,10):
                a=Vector(points[j]);sign=(-1)**j
                petiole=a+Vector((sign*.015,0,-.006));tube('Pothos attached petiole',[a,petiole],.0018,stem,5)
                leaf('Trailing heart leaf',petiole,petiole+Vector((sign*(.060+.004*(j%3)),.022,-.035)),.032,foliage,stem,'heart',(.93+(j%3)*.035,1,.87),i*31+j,10)
        return
    radius=.14 if kind in ['monstera','rubber','fern'] else .12 if kind in ['snake','pothos'] else .095
    height=.20 if kind in ['monstera','rubber','fern'] else .17 if kind in ['snake','pothos'] else .125
    pot(radius,height,kind,clay,soil)
    if kind=='monstera':
        for i in range(7):
            angle=i*2.399;h=.36+(i%4)*.135;reach=.12+(i%3)*.035
            base=Vector((.025*math.cos(angle),.025*math.sin(angle),height*.86))
            joint=Vector((math.cos(angle)*reach,math.sin(angle)*reach,h))
            stempts=[base,base.lerp(joint,.38)+Vector((0,0,.04)),base.lerp(joint,.75)+Vector((0,0,.025)),joint]
            tube('Monstera arched petiole',stempts,[.005,.005,.004,.0035],stem,7)
            end=joint+Vector((math.cos(angle)*(.24+.025*(i%3)),math.sin(angle)*(.24+.025*(i%3)),-.055))
            leaf('Adult split and fenestrated monstera leaf',joint,end,.14+(i%2)*.012,foliage,stem,'monstera',(.85+i%3*.035,.94+i%3*.02,.83),i,64)
        tube('Emerging rolled monstera spear',[(.01,0,height),(.025,.025,.42),(.035,.035,.53)],[.006,.009,.002],stem,7)
    elif kind=='rubber':
        points=[(0,0,height*.87),(.006,0,.38),(-.008,.01,.60),(.012,.015,.81)]
        tube('Rubber plant upright branching trunk',points,[.012,.010,.008,.004],stem,9)
        for i in range(11):
            angle=i*2.399;z=.29+i*.045;start=Vector((.003,0,z));base=start+Vector((math.cos(angle)*.035,math.sin(angle)*.035,.015))
            tube('Rubber plant petiole',[start,base],.003,stem,6)
            leaf('Rubber plant waxy elliptic leaf',base,base+Vector((math.cos(angle)*(.20+(i%3)*.025),math.sin(angle)*(.20+(i%3)*.025),.025)),.065,foliage,stem,'rubber',(.65,.78,.65),100+i,16)
        tube('Red protective leaf stipule',[(.01,.015,.78),(.012,.015,.86)],[.009,.0015],stem,7)
    elif kind=='pothos':
        for i in range(8):
            angle=i*2.399;length=.15+(i%3)*.035;points=[]
            for j in range(6):
                t=j/5;points.append((math.cos(angle)*length*t,math.sin(angle)*length*t,height*.87+math.sin(t*math.pi)*.12+.035*t))
            tube('Pothos branching vine',points,.003,stem,6)
            for j in [2,4,5]:
                a=Vector(points[j]);yaw=angle+(-1 if j%2 else 1)*.6
                end=a+Vector((math.cos(yaw)*.105,math.sin(yaw)*.105,-.018))
                leaf('Pothos heart leaf',a,end,.048,foliage,stem,'heart',(.86+(i%3)*.05,.98,.73),150+i*10+j,12)
    elif kind=='fern':
        for i in range(13):
            angle=i*2.399;length=.24+(i%3)*.016;points=[]
            arch=.15+(i%3)*.012
            for j in range(17):
                t=j/16;points.append(Vector((math.cos(angle)*length*t,math.sin(angle)*length*t,height*.87+.05*t+math.sin(t*math.pi*.95)*arch)))
            tube('Fern arching rachis',points,[.0024*(1-j/19) for j in range(17)],stem,5)
            for j in range(1,16):
                t=j/16;point=points[j]
                for sign in [-1,1]:
                    reach=.070*math.sin(math.pi*t)**.65
                    tip_z=(.05+math.cos(t*math.pi*.95)*math.pi*.95*arch)*.070
                    vector=Vector((-math.sin(angle)*sign*reach+math.cos(angle)*.018,math.cos(angle)*sign*reach+math.sin(angle)*.018,tip_z))
                    leaf('Overlapping paired fern pinna',point,point+vector,.011*(1-t*.40),foliage,stem,'fern',(.88,1,.82),i*37+j,4)
            leaf('Fern tapered terminal pinna',points[-2],points[-1]+Vector((math.cos(angle)*.015,math.sin(angle)*.015,-.01)),.006,foliage,stem,'fern',(.88,1,.82),700+i,4)
        for i in range(3):
            a=i*2.1;points=[(.025*math.cos(a),.025*math.sin(a),height),(.035*math.cos(a),.035*math.sin(a),.30)]
            tube('Young curled fern crozier',points,.0028,stem,6)
    elif kind=='snake':
        for i in range(11):
            angle=i*2.399;start=Vector((.055*math.cos(angle),.055*math.sin(angle),height*.86));h=.36+(i%4)*.08
            end=Vector((.09*math.cos(angle+.18),.09*math.sin(angle+.18),height+h))
            leaf('Variegated upright Sansevieria blade',start,end,.026+(i%2)*.005,foliage,stem,'snake',(.96,1,.9),200+i,20)
    elif kind=='succulent':
        for ring,count in enumerate([12,10,7,5]):
            for i in range(count):
                angle=i*math.tau/count+ring*.34;reach=.093-ring*.019;start=Vector((0,0,height+.006+ring*.012))
                end=start+Vector((math.cos(angle)*reach,math.sin(angle)*reach,.008+ring*.01))
                leaf('Echeveria fleshy rosette leaf',start,end,.023-ring*.003,foliage,stem,'succulent',(.93,1,.96),300+ring*20+i,9)
    else:
        for i in range(9):
            angle=i*2.399;z=.18+(i%3)*.028;end=Vector((math.cos(angle)*.06,math.sin(angle)*.06,z))
            start=Vector((0,0,height*.87));tube('Peperomia slender petiole',[start,start.lerp(end,.6),end],.0024,stem,6)
            leaf('Peperomia rounded waxy leaf',end,end+Vector((math.cos(angle)*.055,math.sin(angle)*.055,.008)),.033,foliage,stem,'heart',(.75,.91,.7),400+i,12)

def bounds(objects):
    points=[obj.matrix_world@vertex.co for obj in objects if obj.type=='MESH' for vertex in obj.data.vertices]
    return [min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]

def normalized_envelope(lo,hi,target):
    scale=target/(hi[2]-lo[2]);center=[(lo[i]+hi[i])*.5 for i in range(2)]
    return {'height':target,'width':(hi[0]-lo[0])*scale,'depth':(hi[1]-lo[1])*scale,
            'radius':math.hypot((hi[0]-lo[0])*.5,(hi[1]-lo[1])*.5)*scale}

def build(key):
    kind,target=KEYS[key]
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/realism'/(key+'.blend')))
    oldlo,oldhi=bounds(list(bpy.context.scene.objects));old=normalized_envelope(oldlo,oldhi,target)
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
    foliage=leaf_material();stem=material('Collection / plant stems and midribs',(.065,.145,.037),.66)
    clay=material('Collection / hand-thrown planter',(.39,.21,.13),.82)
    vertex=clay.node_tree.nodes.new('ShaderNodeVertexColor');vertex.layer_name='BotanicalTint'
    clay.node_tree.links.new(vertex.outputs['Color'],clay.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    soil=material('Collection / potting soil and bark',(.033,.024,.016),.98)
    build_species(kind,foliage,stem,clay,soil)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];lo,hi=bounds(objects)
    factor=(oldhi[2]-oldlo[2])/(hi[2]-lo[2]);center=Vector(((lo[0]+hi[0])*.5,(lo[1]+hi[1])*.5,lo[2]))
    for obj in objects:
        obj.data.transform(obj.matrix_world);obj.matrix_world=Matrix.Identity(4)
        for vertex in obj.data.vertices:vertex.co=(vertex.co-center)*factor
    lo,hi=bounds(objects)
    # Keep each normalized width and depth no larger than its existing envelope.
    sx=min(1,(oldhi[0]-oldlo[0])*.995/(hi[0]-lo[0]));sy=min(1,(oldhi[1]-oldlo[1])*.995/(hi[1]-lo[1]))
    for obj in objects:
        for vertex in obj.data.vertices:vertex.co.x*=sx;vertex.co.y*=sy
    lo,hi=bounds(objects);after=normalized_envelope(lo,hi,target)
    assert after['width']<=old['width']+.00001 and after['depth']<=old['depth']+.00001
    # One object per material reduces draw calls without changing the authored
    # topology, UVs, or corner tint attributes.
    batches={}
    for obj in objects:batches.setdefault(obj.data.materials[0].name,[]).append(obj)
    for name,batch in batches.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in batch:obj.select_set(True)
        bpy.context.view_layer.objects.active=batch[0];bpy.ops.object.join();obj=bpy.context.object
        obj.name=key+' / '+name;obj['atelier']=True;obj['collection_botanical']=kind
    bpy.ops.object.select_all(action='SELECT')
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(key+'.blend')),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(key+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_cameras=False,export_lights=False)
    triangles=0
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH':obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    REPORT[key]={'species':kind,'triangles':triangles,'materials':len(batches),'before_normalized':old,'after_normalized':after,'source_bounds':{'min':lo,'max':hi},'bytes_before_runtime_packing':(OUT/(key+'.glb')).stat().st_size,'original_art':True}
    print('COLLECTION_BOTANICAL',key,REPORT[key],flush=True)

def render():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    labels={'plant_monstera':'MONSTERA','plant':'RUBBER PLANT','plant_pothos':'POTHOS','plant_fern':'FERN','plant_snake':'SNAKE PLANT','plant_succulent':'ECHEVERIA','plant_small':'PEPEROMIA','plant_pothos_vine':'TRAILING POTHOS'}
    order=['plant_monstera','plant','plant_snake','plant_fern','plant_pothos','plant_small','plant_succulent','plant_pothos_vine']
    black=material('Studio typography',(.12,.13,.11),.9)
    for index,key in enumerate(order):
        with bpy.data.libraries.load(str(SOURCE/(key+'.blend')),link=False) as (source,data):data.objects=source.objects
        objects=[]
        for obj in data.objects:
            if obj:bpy.context.collection.objects.link(obj);objects.append(obj)
        lo,hi=bounds(objects);height=hi[2]-lo[2];scale=.98/height
        col=index%4;row=index//4;x=(col-1.5)*1.65;y=(row-.5)*1.7
        for obj in objects:
            obj.scale*=scale;obj.location+=Vector((x,y,-lo[2]*scale+.11))
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.58,depth=.08,location=(x,y,.04));plinth=bpy.context.object
        plinth.data.materials.append(material('Studio plinth '+key,(.50,.46,.39),.86))
        bpy.ops.object.text_add(location=(x-.58,y-.64,.012));label=bpy.context.object;label.name='Species label';label.data.body=labels[key];label.data.size=.083;label.data.extrude=.0002;label.data.materials.append(black)
    bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.data.materials.append(material('Studio warm limestone',(.36,.35,.31),.9))
    target=Vector((0,0,.48));bpy.ops.object.camera_add(location=(5.8,-8.9,7.7));camera=bpy.context.object
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=7.9;bpy.context.scene.camera=camera
    for location,power,size in [((1,-3,7),800,5),((-5,-1,4),500,4),((2,5,5),650,4)]:
        bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.data.energy=power;light.data.size=size;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=False
    scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Botanical studio');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.24,.25,.22,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.25;scene.world=world
    output=ROOT/'docs/collection';output.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(output/'botanical-study.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'botanical-study.blend'),compress=True);bpy.ops.render.render(write_still=True)

if '--render-only' not in sys.argv:
    atlas()
    selection=os.environ.get('VIBE_BOTANICAL')
    if selection and (SOURCE/'botanical-report.json').exists():
        REPORT=json.loads((SOURCE/'botanical-report.json').read_text())
    for key in KEYS:
        if selection and key!=selection:continue
        build(key)
    (SOURCE/'botanical-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
if '--render' in sys.argv or '--render-only' in sys.argv:render()
