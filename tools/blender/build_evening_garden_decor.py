"""Original Blender listening-corner and botanical-counter collections.

Exports metre-scale assemblies standing at Z=0, forward -Y. No room coordinates
or runtime placement are embedded. Run with -- --render for studio evidence.
"""
import bpy, math, json, sys, os, random
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models'; SOURCE=ROOT/'assets/blender/collection'; PROOF=ROOT/'docs/collection'
for directory in [SOURCE,PROOF,SOURCE/'textures']:directory.mkdir(parents=True,exist_ok=True)
REPORT={}; RNG=random.Random(719)


def material(name,color,rough=.5,metal=0,alpha=1,emission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if alpha<1:
        p.inputs['Alpha'].default_value=alpha;p.inputs['Transmission Weight'].default_value=0
        m.surface_render_method='DITHERED';m.use_backface_culling=False
        m['collectionGlass']=True
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m


def mesh(name,vertices,faces,mat,smooth=True,uv=None):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(mat)
    obj['collectionAsset']=True;obj['atelier']=True
    for f in data.polygons:f.use_smooth=smooth
    if uv:
        layer=data.uv_layers.new(name='CollectionUV')
        for loop in data.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
    return obj


def box(name,pos,size,mat,bevel=.004):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        modifier=o.modifiers.new('Finished edge radius','BEVEL');modifier.width=min(bevel,min(size)*.35);modifier.segments=3
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        modifier=o.modifiers.new('Corner normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=modifier.name)
    o.data.materials.append(mat);o['collectionAsset']=True;o['atelier']=True
    return o


def lathe(name,profile,mat,center=(0,0,0),segments=48,ribs=0):
    vertices=[];rings=[]
    for radius,z in profile:
        if radius<1e-6:
            rings.append([len(vertices)]);vertices.append((center[0],center[1],center[2]+z));continue
        ring=[]
        for j in range(segments):
            a=math.tau*j/segments;r=radius+(.0018*math.cos(a*ribs) if ribs else 0)
            ring.append(len(vertices));vertices.append((center[0]+r*math.cos(a),center[1]+r*math.sin(a),center[2]+z))
        rings.append(ring)
    faces=[]
    for first,second in zip(rings,rings[1:]):
        if len(first)==1:
            faces.extend((first[0],second[(j+1)%segments],second[j]) for j in range(segments))
        elif len(second)==1:
            faces.extend((first[j],first[(j+1)%segments],second[0]) for j in range(segments))
        else:
            faces.extend((first[j],first[(j+1)%segments],second[(j+1)%segments],second[j]) for j in range(segments))
    return mesh(name,vertices,faces,mat)


def tube(name,points,radius,mat,sides=8):
    points=[Vector(p) for p in points];vertices=[]
    radii=radius if isinstance(radius,(list,tuple)) else [radius]*len(points)
    previous=None
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        reference=Vector((0,0,1)) if abs(tangent.z)<.93 else Vector((1,0,0))
        a=tangent.cross(reference).normalized()
        if previous is not None and a.dot(previous)<0:a=-a
        previous=a;b=tangent.cross(a).normalized()
        vertices.extend(tuple(p+radii[i]*(math.cos(j*math.tau/sides)*a+math.sin(j*math.tau/sides)*b)) for j in range(sides))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(len(points)-1) for j in range(sides)]
    faces += [tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))]
    return mesh(name,vertices,faces,mat)



def woven_strip(name,points,width,mat):
    points=[Vector(p) for p in points];vertices=[]
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        side=tangent.cross(Vector((0,0,1))).normalized()*width/2
        vertices.extend([tuple(p-side),tuple(p+side)])
    return mesh(name,vertices,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(points)-1)],mat)


def ring(name,center,radius,thickness,mat,n=48):
    return tube(name,[(center[0]+radius*math.cos(i*math.tau/n),center[1]+radius*math.sin(i*math.tau/n),center[2]) for i in range(n+1)],thickness,mat,6)


def text(name,body,pos,size,mat,vertical=True,align='CENTER'):
    curve=bpy.data.curves.new(name,'FONT');curve.body=body;curve.size=size;curve.align_x=align;curve.align_y='CENTER'
    curve.resolution_u=3;curve.extrude=0;curve.space_character=1.05
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj);obj.location=pos
    if vertical:obj.rotation_euler.x=math.pi/2
    curve.materials.append(mat);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.ops.object.convert(target='MESH')
    obj=bpy.context.object;obj['collectionAsset']=True;obj['atelier']=True
    return obj


def join(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    return o


def wood_material():
    m=material('Collection / oiled walnut',(.16,.10,.055),.44)
    image=bpy.data.images.load(str(ROOT/'public/textures/realism_walnut_color.jpg'))
    image.scale(512,512);image.filepath_raw=str(SOURCE/'textures/collection_walnut.jpg');image.file_format='JPEG';image.save();image.pack()
    node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return m


def wood_uv(obj):
    layer=obj.data.uv_layers.active or obj.data.uv_layers.new(name='GrainUV')
    world=obj.matrix_world
    for face in obj.data.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]))
        for li in face.loop_indices:
            p=world@obj.data.vertices[obj.data.loops[li].vertex_index].co
            layer.data[li].uv=(p.y*3,p.x*3) if axis==2 else (p.z*3,p.x*3) if axis==1 else (p.z*3,p.y*3)


def midnight():
    wood=wood_material();vinyl=material('Collection / satin black vinyl',(.009,.014,.019),.28,.1)
    brass=material('Collection / aged satin brass',(.47,.285,.10),.27,.78)
    glass=material('Collection / ribbed amber glass',(.65,.43,.22),.16,.02,.23)
    paper=material('Collection / warm printed stock',(.79,.73,.61),.86)
    ink=material('Collection / nocturne ink',(.022,.065,.082),.74)
    ceramic=material('Collection / petrol ceramic glaze',(.032,.073,.077),.21)
    bulb=material('Collection / warm lamp filament',(.85,.58,.25),.28,emission=.65)
    # A compact record player with real isolation feet, recessed fascia and tonearm.
    cx=-.12;cy=-.005
    for x in [cx-.225,cx+.225]:
        for y in [-.125,.125]:lathe('Turntable isolation foot',[(0,0),(.025,0),(.026,.008),(.023,.021),(0,.021)],vinyl,(x,y,0),24)
    box('Walnut turntable plinth',(cx,cy,.055),(.55,.32,.076),wood,.010)
    box('Inset turntable fascia',(cx,-.167,.055),(.49,.002,.034),vinyl,.001)
    for x in [cx+.18,cx+.225]:
        o=lathe('Knurled front control',[(0,0),(.008,0),(.009,.010),(0,.010)],brass,(0,0,0),24)
        o.rotation_euler.x=math.pi/2;o.location=(x,-.168,.055)
    text('Player brand','NOCTURNE',(cx-.12,-.169,.055),.012,paper)
    lathe('Machined platter',[(0,0),(.144,0),(.147,.004),(.145,.010),(0,.010)],brass,(cx-.075,cy,.093),64)
    before=set(bpy.context.scene.objects)
    record_center=(cx-.075,cy,.104)
    lathe('LP disc',[(0,0),(.136,0),(.137,.001),(.136,.002),(0,.002)],vinyl,record_center,80)
    for i in range(22):
        r=.043+i*.0042
        lathe('Concentric vinyl groove',[(r,.00215),(r+.00035,.0023),(r+.0007,.00215)],vinyl,record_center,64)
    lathe('Original record label',[(0,.0024),(.037,.0024),(.037,.0026),(0,.0026)],paper,record_center,48)
    text('Record label name','N O C T U R N E',(record_center[0],record_center[1]-.009,.107),.007,ink,False)
    text('Record label speed','33 / A',(record_center[0],record_center[1]+.012,.107),.007,ink,False)
    disc=join(list(set(bpy.context.scene.objects)-before),'Collection / Midnight record disc')
    disc.data.transform(disc.matrix_world);disc.matrix_world=Matrix.Identity(4)
    disc.data.transform(Matrix.Translation(-Vector(record_center)));disc.location=record_center
    disc['collectionSpin']=True;disc['spinAxis']='y'
    lathe('Record spindle',[(0,0),(.003,0),(.003,.012),(0,.013)],brass,(record_center[0],record_center[1],.106),16)
    base=(cx+.19,.105,.094)
    lathe('Tonearm gimbal',[(0,0),(.018,0),(.018,.011),(.011,.014),(.011,.046),(0,.046)],brass,base,32)
    tube('Bent polished tonearm',[(cx+.19,.105,.142),(cx+.19,.060,.148),(cx+.17,.01,.150),(cx+.12,-.045,.145),(cx+.075,-.083,.129)],.0032,brass,10)
    box('Pickup cartridge',(cx+.072,-.087,.122),(.027,.013,.017),vinyl,.002)
    tube('Diamond stylus',[(cx+.068,-.094,.116),(cx+.063,-.096,.106)],.0009,brass,6)
    counter=lathe('Tonearm counterweight',[(0,0),(.012,0),(.012,.031),(0,.031)],vinyl,(0,0,0),24)
    counter.rotation_euler.x=math.pi/2;counter.location=(cx+.19,.145,.142)
    # An art-deco lamp: concentric foot, fluted stem, clear ribbed shade and bulb.
    lx=-.69;ly=.005
    lathe('Deco lamp foot',[(0,0),(.111,0),(.123,.010),(.123,.018),(.111,.027),(.040,.027),(.032,.034),(0,.034)],brass,(lx,ly,0),64)
    lathe('Deco lamp stem',[(0,0),(.014,0),(.014,.025),(.010,.029),(.010,.285),(.020,.295),(0,.295)],brass,(lx,ly,.03),32)
    for i in range(8):
        a=math.tau*i/8;tube('Fine stem flute',[(lx+.011*math.cos(a),ly+.011*math.sin(a),.07),(lx+.011*math.cos(a),ly+.011*math.sin(a),.30)],.0011,brass,5)
    lathe('Ribbed amber shade',[(.125,.32),(.135,.329),(.136,.35),(.126,.475),(.102,.513),(.085,.524),(.081,.524),(.098,.510),(.122,.474),(.132,.35),(.131,.331),(.122,.325)],glass,(lx,ly,0),96,32)
    for z,r in [(.325,.126),(.516,.097)]:ring('Shade brass binding',(lx,ly,z),r,.003,brass,64)
    lathe('Lamp bulb',[(0,0),(.018,0),(.033,.035),(.035,.075),(.028,.098),(0,.111)],bulb,(lx,ly,.335),40)
    lathe('Lamp finial',[(0,0),(.010,0),(.011,.018),(0,.027)],brass,(lx,ly,.524),24)
    # Original jazz print and sleeves, supported by a walnut display shoe.
    px=.40;py=.122
    box('Record sleeve display shoe',(px,.076,.028),(.39,.15,.056),wood,.006)
    for i in range(3):box('Collected record sleeve',(px-.012+i*.011,.141+i*.009,.215+i*.004),(.315,.008,.315),paper,.001)
    box('Nocturne print board',(px,py,.426),(.35,.016,.65),ink,.002)
    for x in [px-.180,px+.180]:box('Print side frame',(x,py,.426),(.013,.025,.676),brass,.002)
    for z in [.088,.764]:box('Print cross frame',(px,py,z),(.373,.025,.013),brass,.002)
    text('Album title','AFTER\nHOURS',(px,.111,.635),.046,paper)
    text('Album subtitle','N O C T U R N E',(px,.110,.535),.016,brass)
    text('Session imprint','SESSION 03  /  SIDE A',(px,.110,.179),.013,paper)
    text('Session location','MIDNIGHT JAZZ CORNER',(px,.110,.142),.010,paper)
    # Abstract original saxophone-like line motif and stepped art-deco rays.
    for i in range(9):
        x=px-.12+i*.03
        tube('Foil rhythm line',[(x,.109,.26),(x,.109,.34+.085*math.sin(i*.52))],.0014,brass,5)
    tube('Continuous jazz mark',[(px-.105,.107,.45),(px-.06,.107,.48),(px+.015,.107,.43),(px-.01,.107,.36),(px+.065,.107,.32),(px+.105,.107,.35)],.004,brass,8)
    # One sculptural glazed vessel balances the listening objects.
    lathe('Sculptural bud vessel',[(0,0),(.055,0),(.064,.009),(.067,.075),(.050,.115),(.025,.145),(.022,.217),(.026,.224),(.022,.229),(.016,.225),(.014,.153),(.044,.115),(.055,.07),(.043,.018),(0,.018)],ceramic,(.75,-.005,0),48)
    tube('Single brass botanical arc',[(.75,-.005,.20),(.743,.005,.29),(.77,.015,.36),(.79,.012,.40)],.002,brass,8)
    return {'theme':'midnight','concept':'A listening corner: walnut turntable, original jazz print, ribbed glass lamp and one glazed bud vessel','spin_node':disc.name,'spin_axis':'y','front':'glTF +Z'}


def leaf_material():
    m=material('Collection / botanical leaf',(.09,.20,.052),.57)
    size=256;y,x=np.mgrid[0:size,0:size].astype(np.float32)/(size-1)
    central=np.exp(-((x-.5)/.018)**2)
    branch=np.exp(-(np.sin((y-abs(x-.5)*.65)*math.pi*10)/.13)**2)*(1-central)*.45
    rng=np.random.default_rng(42);vein=central*.65+branch
    color=np.array([.062,.145,.034])+vein[...,None]*np.array([.045,.065,.018])+rng.normal(0,.003,(size,size,1))
    height=central*.00007+branch*.000035
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))*size/.07;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*size/.10
    normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1)[...,None]
    for channel,array in [('color',color),('normal',normal*.5+.5)]:
        image=bpy.data.images.new('collection_botanical_'+channel,width=size,height=size)
        image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
        rgba=np.concatenate([np.clip(array,0,1),np.ones((size,size,1))],axis=-1).astype(np.float32)
        image.pixels.foreach_set(rgba.ravel());image.file_format='JPEG';image.filepath_raw=str(SOURCE/'textures'/(image.name+'.jpg'));image.save();image.pack()
        n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=image
        if channel=='color':m.node_tree.links.new(n.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
        else:
            normalnode=m.node_tree.nodes.new('ShaderNodeNormalMap');normalnode.inputs['Strength'].default_value=.45
            m.node_tree.links.new(n.outputs['Color'],normalnode.inputs['Color']);m.node_tree.links.new(normalnode.outputs['Normal'],m.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    return m


def leaf(name,base,tip,width,mat,twist=0):
    base,tip=Vector(base),Vector(tip);direction=tip-base
    side=direction.cross(Vector((0,0,1)))
    if side.length<.01:side=Vector((1,0,0))
    side.normalize();vertices=[];uv=[]
    if width<.008:
        middle=base.lerp(tip,.52)+Vector((0,0,.004))
        vertices=[tuple(base),tuple(middle-side*width/2),tuple(middle+Vector((0,0,.001))),tuple(middle+side*width/2),tuple(tip)]
        return mesh(name,vertices,[(0,1,2),(0,2,3),(1,4,2),(2,4,3)],mat,True,[(.5,0),(0,.52),(.5,.52),(1,.52),(.5,1)])
    for i in range(7):
        t=i/6;center=base+direction*t+Vector((0,0,math.sin(math.pi*t)*.014))
        half=width*.5*math.sin(math.pi*t)**.72
        for j in [-1,0,1]:
            point=center+side*half*j;point.z-=abs(j)*half*.32+twist*j*t
            vertices.append(tuple(point));uv.append(((j+1)/2,t))
    faces=[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(6) for j in range(2)]
    return mesh(name,vertices,faces,mat,True,uv)


def garden():
    wood=wood_material();clay=material('Collection / hand-thrown terracotta',(.40,.17,.083),.78)
    soil=material('Collection / potting soil',(.029,.019,.010),.98)
    green=leaf_material();paper=material('Collection / botanical label stock',(.78,.75,.65),.88)
    ink=material('Collection / plant-label ink',(.021,.050,.026),.78)
    glass=material('Collection / propagation glass',(.60,.76,.71),.08,.025,.12)
    glass.use_backface_culling=True
    # Low carved tray, woven insert and lifted feet share a controlled footprint.
    for x in [-.70,.70]:
        for y in [-.105,.105]:box('Tray drainage foot',(x,y,.004),(.11,.065,.008),wood,.003)
    box('Carved tray base',(0,0,.018),(1.70,.34,.028),wood,.010)
    for y in [-.165,.165]:box('Raised tray edge',(0,y,.038),(1.70,.012,.027),wood,.005)
    for x in [-.845,.845]:box('Tray end handle',(x,0,.043),(.016,.34,.038),wood,.005)
    # Alternating woven strips form a real rattan insert, not a flat printed grid.
    for i in range(70):
        x=-.80+i*.0232
        points=[(x,-.145+j*.018,.034+math.sin(j*math.pi/2+(i%2)*math.pi)*.0012) for j in range(17)]
        woven_strip('Rattan cross weave',points,.004,wood)
    for i in range(13):
        y=-.136+i*.0225
        points=[(-.81+j*.0232,y,.034+math.sin(j*math.pi/2+((i+1)%2)*math.pi)*.0012) for j in range(71)]
        woven_strip('Rattan long weave',points,.004,wood)
    def pot(name,x,r,h):
        floor=.037
        for i in range(3):
            a=math.tau*i/3;box(name+' drainage foot',(x+math.cos(a)*r*.58,math.sin(a)*r*.58,floor+.006),(.026,.025,.012),clay,.004)
        profile=[(0,.012),(r*.72,.012),(r*.76,.023),(r*.94,h-.022),(r,h-.012),(r,h-.005),(r*.96,h),(r*.89,h),(r*.87,h-.012),(r*.72,.035),(0,.035)]
        lathe(name+' rolled-rim vessel',profile,clay,(x,0,floor),48)
        for z in [.045,.075,.105]:
            if z<h-.04:ring(name+' wheel-thrown tooling',(x,0,floor+z),r*(.76+.18*(z-.023)/(h-.045)),.0008,clay,40)
        lathe(name+' recessed soil',[(0,0),(r*.86,0),(r*.86,.003),(0,.003)],soil,(x,0,floor+h-.020),40)
        for i in range(6):
            a=RNG.random()*math.tau;rr=math.sqrt(RNG.random())*r*.77
            box('Fine bark in soil',(x+math.cos(a)*rr,math.sin(a)*rr,floor+h-.015),(.009,.004,.003),wood,0)
        return floor+h-.014
    zsage=pot('Sage planter',-.58,.132,.225)
    zmint=pot('Mint planter',-.15,.108,.176)
    zrose=pot('Rosemary planter',.23,.09,.152)
    # Sage: opposite leaves on branching stems, with shaped tips and visible veins.
    for i in range(8):
        a=i*math.tau/8;root=Vector((-.58,0,zsage));top=root+Vector((math.cos(a)*.055,math.sin(a)*.040,.22+RNG.random()*.065))
        tube('Sage branch',[tuple(root),tuple(root.lerp(top,.52)+Vector((0,0,.014))),tuple(top)],[.0025,.0018,.001],green,6)
        for j in range(3):
            start=root.lerp(top,.30+j*.23)
            for sign in [-1,1]:
                endpoint=start+Vector((math.cos(a+sign*1.1)*.072,math.sin(a+sign*1.1)*.040,.028))
                leaf('Sage veined leaf',start,endpoint,.026,green,.002*sign)
    # Mint: a more upright, broad-leaf rhythm, spaced so the pot remains legible.
    for i in range(6):
        a=i*math.tau/6;root=Vector((-.15,0,zmint));top=root+Vector((math.cos(a)*.045,math.sin(a)*.035,.29+RNG.random()*.06))
        tube('Mint stem',[tuple(root),tuple(root.lerp(top,.55)),tuple(top)],[.002,.0015,.0008],green,6)
        for j in range(3):
            start=root.lerp(top,.34+j*.22)
            for sign in [-1,1]:
                endpoint=start+Vector((math.cos(a+sign*1.3)*.068,math.sin(a+sign*1.3)*.048,.035))
                leaf('Mint cupped leaf',start,endpoint,.041,green,-.003*sign)
    # Rosemary: slender woody sprigs and paired needle leaves.
    for i in range(7):
        a=i*math.tau/7;root=Vector((.23,0,zrose));top=root+Vector((math.cos(a)*.035,math.sin(a)*.026,.34+RNG.random()*.08))
        tube('Rosemary stem',[tuple(root),tuple(root.lerp(top,.60)),tuple(top)],[.0017,.0012,.0006],wood,5)
        for j in range(8):
            start=root.lerp(top,.17+j*.10)
            for sign in [-1,1]:
                tip=start+Vector((math.cos(a+sign*1.4)*.026,math.sin(a+sign*1.4)*.018,.014))
                leaf('Rosemary needle',start,tip,.0048,green)
    # Clear propagation bottle with visible cut stems, roots and water surface.
    bx=.61;by=-.015;bz=.037
    lathe('Propagation bottle',[(0,0),(.055,0),(.061,.009),(.061,.171),(.052,.194),(.034,.204),(.034,.240),(.038,.242),(.037,.247),(.030,.247),(.028,.239),(.028,.205),(.047,.188),(.056,.168),(.056,.015),(0,.015)],glass,(bx,by,bz),48)
    lathe('Still water meniscus',[(0,0),(.055,0),(.055,.001),(0,.001)],glass,(bx,by,bz+.13),40)
    for side in [-1,1]:
        tube('Cutting stem',[(bx+side*.012,by,bz+.045),(bx+side*.008,by,bz+.20),(bx+side*.035,by+.01,bz+.37)],.002,green,6)
        for i in range(5):
            tube('Visible propagation root',[(bx+side*.011,by,bz+.13),(bx+side*(.012+i*.004),by+(i-2)*.007,bz+.09),(bx+side*(.023+i*.004),by+(i-2)*.010,bz+.045+i*.004)],[.0008,.0005,.0002],paper,5)
        for j in range(3):
            start=Vector((bx+side*(.016+j*.006),by+.006,bz+.25+j*.055));tip=start+Vector((side*.060,(-1 if j%2 else 1)*.025,.032))
            leaf('Propagation cutting leaf',start,tip,.029,green)
    # Botanical labels are original editable typography, tied to actual species.
    for x,z,name,latin in [(-.58,zsage,'SAGE','SALVIA OFFICINALIS'),(-.15,zmint,'MINT','MENTHA SPICATA'),(.23,zrose,'ROSEMARY','SALVIA ROSMARINUS')]:
        box('Plant label stake',(x,-.095,z+.025),(.012,.008,.115),wood,.001)
        box('Botanical label',(x,-.105,z+.08),(.145,.004,.055),paper,.002)
        text(name+' name',name,(x,-.108,z+.09),.017,ink)
        text(name+' botanical name',latin,(x,-.108,z+.067),.0068,ink)
    # A restrained rear plaque unifies the propagation station.
    for x in [.48,.75]:box('Plaque upright',(x,.13,.322),(.012,.012,.574),wood,.002)
    box('Propagation station plaque',(.615,.13,.618),(.36,.012,.151),paper,.005)
    text('Garden plaque title','CUT  /  ROOT  /  GROW',(.615,.122,.642),.018,ink)
    text('Garden plaque subtitle','THE BOTANICAL BAR',(.615,.122,.605),.012,ink)
    text('Garden plaque footer','FRESH CUTTINGS  ·  DAILY',(.615,.122,.575),.008,ink)
    return {'theme':'terrace','concept':'A propagation station: three named culinary herbs, handmade terracotta, woven tray and rooted glass cuttings','front':'glTF +Z','glass':{'alpha':.12,'roughness':.08,'double_sided':False,'transmission':0}}


def finish(key,info):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('collectionAsset')]
    for o in objects:
        if any(m and 'walnut' in m.name.lower() for m in o.data.materials):wood_uv(o)
    batches={};preserved=[]
    for o in objects:
        if o.get('collectionSpin'):preserved.append(o);continue
        # Objects in these collections use one material until this merge.
        material=o.data.materials[0];batches.setdefault(material.name,[]).append(o)
    result=[]
    for name,group in batches.items():
        o=join(group,key+' / '+name);o['collectionAsset']=True;o['atelier']=True
        if o.data.materials[0].get('collectionGlass'):
            o['collectionGlass']=True;o['castShadow']=False
        result.append(o)
    result+=preserved
    bpy.context.view_layer.update();corners=[o.matrix_world@Vector(v) for o in result for v in o.bound_box]
    lo=[min(v[i] for v in corners) for i in range(3)];hi=[max(v[i] for v in corners) for i in range(3)];size=[hi[i]-lo[i] for i in range(3)]
    triangles=0
    for o in result:o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
    materials={m.name for o in result for m in o.data.materials}
    assert lo[2]>=-.0002,(key,lo)
    assert size[0]<1.95 and size[1]<.37 and size[2]<.9,(key,size)
    assert triangles<=25000,(key,triangles)
    assert len(materials)<=8,(key,len(materials))
    for o in result:
        o['collectionVenue']=info['theme'];o['collectionSupport']='countertop';o['collectionBounds']=[lo[0],lo[2],-hi[1],hi[0],hi[2],-lo[1]]
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in result:o.select_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(key+'.blend')),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(key+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_cameras=False,export_lights=False)
    record={**info,'triangles':triangles,'materials':len(materials),'objects':len(result),'blender_bounds':{'min':lo,'max':hi,'size':size},'gltf_bounds':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]],'size':[size[0],size[2],size[1]]},'unpacked_glb_bytes':(OUT/(key+'.glb')).stat().st_size,'source':str((SOURCE/(key+'.blend')).relative_to(ROOT)),'original_graphics':'Original geometric jazz artwork and botanical typography; built-in Blender font','texture_provenance':'Walnut finish derived from credited ambientCG Wood067; botanical maps authored in Blender'}
    REPORT[key]=record
    report_path=SOURCE/'evening-garden-report.json'
    previous=json.loads(report_path.read_text()) if report_path.exists() else {}
    previous.update(REPORT);report_path.write_text(json.dumps(previous,indent=2)+'\n')
    print('COLLECTION_ASSET',key,json.dumps(record),flush=True)
    return result


def studio(key,objects):
    # Cycles ignores viewport backface culling. Match glTF's single-sided
    # surfaces in this temporary proof scene without saving shader changes.
    materials={m for o in objects for m in o.data.materials if m and m.use_nodes}
    for m in materials:
        if not m.use_backface_culling:continue
        nodes,links=m.node_tree.nodes,m.node_tree.links
        output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output),None)
        if not output or not output.inputs['Surface'].links:continue
        front=output.inputs['Surface'].links[0].from_socket
        geometry=nodes.new('ShaderNodeNewGeometry');geometry.name='Proof-only facing'
        transparent=nodes.new('ShaderNodeBsdfTransparent');transparent.name='Proof-only culled back'
        switch=nodes.new('ShaderNodeMixShader');switch.name='Proof-only single-sided surface'
        links.new(geometry.outputs['Backfacing'],switch.inputs[0]);links.new(front,switch.inputs[1]);links.new(transparent.outputs[0],switch.inputs[2]);links.new(switch.outputs[0],output.inputs['Surface'])
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False
    scene.render.resolution_x=1500;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    if not scene.world:scene.world=bpy.data.worlds.new('Collection studio')
    scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.24,.25,.24,1);scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.28
    floor=material('Studio warm limestone',(.28,.29,.27),.83)
    box('Studio support',(0,0,-.025),(200,200,.05),floor,0)
    target=Vector((0,0,.30));position=Vector((1.55,-2.65,1.45))
    bpy.ops.object.camera_add(location=position);camera=bpy.context.object;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.15;scene.camera=camera
    for pos,power,area in [((-.8,-1.4,2.3),160,2),((1.8,-.3,1.4),105,1.4),((-.5,1.2,1.9),180,1.3)]:
        bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=area;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(PROOF/(key+'-studio.png'));bpy.ops.render.render(write_still=True)


for venue,build in [('midnight',midnight),('terrace',garden)]:
    if os.environ.get('VIBE_COLLECTION') and os.environ['VIBE_COLLECTION']!=venue:continue
    key='atelier_decor_'+venue
    if '--proof-only' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(key+'.blend')))
        studio(key,[o for o in bpy.context.scene.objects if o.type=='MESH']);continue
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
    info=build();objects=finish(key,info)
    if '--render' in sys.argv:studio(key,objects)
report_path=SOURCE/'evening-garden-report.json'
if report_path.exists():
    previous=json.loads(report_path.read_text());previous.update(REPORT);REPORT=previous
report_path.write_text(json.dumps(REPORT,indent=2)+'\n')
