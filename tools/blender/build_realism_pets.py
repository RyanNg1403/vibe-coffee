"""Blender-sculpted café pets: continuous anatomy, baked fur and articulated gait.

All geometry and fur fields are original project artwork. Source scenes retain
procedural coat nodes, a deformable anatomical surface, and eight editable clips.
"""
import bpy, math, json, sys, os, shutil
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent))
from realism_pet_fur import make_fur_material,bake_fur
from realism_pet_rig import build_rig,animate_pet
OUT=ROOT/'public/models';SOURCE=ROOT/'assets/blender/realism'
SOURCE.mkdir(parents=True,exist_ok=True)
REPORT={}


def material(name,color,rough=.6,metal=0):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return mat


def ellipsoid(name,position,radius,mat=None,segments=24,rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings)
    obj=bpy.context.object;obj.name=name
    obj.data.transform(Matrix.Translation(Vector(position))@Matrix.Diagonal((*radius,1)))
    if mat:obj.data.materials.append(mat)
    for f in obj.data.polygons:f.use_smooth=True
    return obj


def mesh(name,vertices,faces,mat=None):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    if mat:data.materials.append(mat)
    for f in data.polygons:f.use_smooth=True
    return obj


def tube(name,points,radii,mat=None,sides=12):
    points=[Vector(p) for p in points];vertices=[];previous=None
    if isinstance(radii,(int,float)):radii=[radii]*len(points)
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        reference=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((1,0,0))
        a=tangent.cross(reference).normalized()
        if previous is not None and a.dot(previous)<0:a=-a
        previous=a;b=tangent.cross(a).normalized()
        for j in range(sides):
            angle=math.tau*j/sides;vertices.append(tuple(p+radii[i]*(a*math.cos(angle)+b*math.sin(angle))))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(len(points)-1) for j in range(sides)]
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name,vertices,faces,mat)


def join(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();obj=bpy.context.object;obj.name=name
    return obj


def smoothstep(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)


def distance_segment(p,a,b):
    a,b=Vector(a),Vector(b);d=b-a;t=max(0,min(1,(p-a).dot(d)/max(d.length_squared,1e-9)))
    return (p-a-d*t).length


def configuration(kind):
    cat=kind=='cat';h=.22 if cat else .36
    cfg={'kind':kind,'hip_height':h,'walk_duration':.6 if cat else .75,'runtime_speed':.5 if cat else .62,'runtime_height':.34 if cat else .55,
         'anatomical_height':.418 if cat else .635,
         'spine_back':(0,.12 if cat else .18,h),'spine_front':(0,-.115 if cat else -.15,h+.025),
         'neck':(0,-.16,.25) if cat else (0,-.20,.40),
         'head_head':(0,-.23,.315) if cat else (0,-.34,.54),
         'head_tip':(0,-.30,.30) if cat else (0,-.48,.515),
         'tail_base':(0,.17,.24) if cat else (0,.27,.41),
         'tail_mid':(.012,.30,.30) if cat else (.005,.42,.44),
         'tail_tip':(.028,.42,.325) if cat else (.025,.59,.47),
         'ears':{},'eyes':{},'legs':{}}
    for sign,side in [(-1,'L'),(1,'R')]:
        cfg['ears'][side]=((sign*.045,-.218,.35),(sign*.065,-.205,.413)) if cat else ((sign*.075,-.32,.585),(sign*.105,-.385,.47))
        eye=(sign*.034,-.265,.332) if cat else (sign*.055,-.396,.562)
        cfg['eyes'][side]=(eye,(eye[0],eye[1]-.02,eye[2]))
        cfg['legs']['Front'+side]={'hip':(sign*.049,-.11,.22),'knee':(sign*.05,-.09,.13),'ankle':(sign*.049,-.13,.043),'toe':(sign*.049,-.17,.023)} if cat else {'hip':(sign*.087,-.145,.36),'knee':(sign*.087,-.12,.23),'ankle':(sign*.09,-.17,.072),'toe':(sign*.09,-.235,.035)}
        cfg['legs']['Rear'+side]={'hip':(sign*.052,.115,.22),'knee':(sign*.056,.075,.13),'ankle':(sign*.054,.145,.055),'toe':(sign*.054,.105,.023)} if cat else {'hip':(sign*.09,.18,.36),'knee':(sign*.095,.09,.23),'ankle':(sign*.095,.20,.095),'toe':(sign*.095,.135,.035)}
    return cfg


def sculpt(kind,cfg):
    cat=kind=='cat';parts=[]
    def volume(name,p,r):parts.append(ellipsoid(name,p,r));return parts[-1]
    if cat:
        for name,p,r in [('Ribcage',(0,0,.225),(.073,.172,.087)),('Shoulder girdle',(0,-.102,.235),(.067,.076,.088)),('Pelvis and haunches',(0,.125,.223),(.076,.080,.092)),('Tapered abdomen',(0,.065,.212),(.061,.100,.070)),('Deep chest',(0,-.133,.211),(.061,.064,.095)),('Neck',(0,-.174,.278),(.048,.060,.066)),('Cranium',(0,-.228,.318),(.060,.055,.057)),('Jaw',(0,-.244,.286),(.045,.043,.033)),('Chin',(0,-.273,.274),(.025,.026,.016))]:volume(name,p,r)
        for sign in [-1,1]:
            volume('Cheek',(sign*.028,-.252,.298),(.035,.038,.033));volume('Whisker pad',(sign*.018,-.282,.289),(.024,.026,.020))
            x=sign
            front=[(x*.026,-.234,.348),(x*.075,-.224,.348),(x*.065,-.207,.415)]
            back=[(px,py+.022,pz-.002) for px,py,pz in front]
            parts.append(mesh('Triangular ear',[*front,*back],[(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)]))
    else:
        for name,p,r in [('Ribcage',(0,.01,.365),(.115,.235,.141)),('Pelvis',(0,.188,.363),(.105,.120,.125)),('Tapered abdomen',(0,.100,.337),(.090,.130,.107)),('Deep chest',(0,-.166,.352),(.117,.120,.163)),('Neck',(0,-.255,.463),(.081,.102,.136)),('Cranium',(0,-.342,.540),(.086,.080,.090)),('Muzzle bridge',(0,-.425,.515),(.057,.085,.047)),('Lower jaw',(0,-.423,.474),(.051,.068,.036)),('Chin',(0,-.468,.473),(.043,.035,.027))]:volume(name,p,r)
        for sign in [-1,1]:
            volume('Brow',(sign*.045,-.384,.584),(.029,.023,.019));volume('Soft jowl',(sign*.039,-.447,.490),(.035,.050,.031))
            rows=[(.575,.078,-.321,.026,.015),(.555,.103,-.334,.038,.014),(.520,.118,-.360,.039,.013),(.485,.112,-.393,.028,.011),(.468,.100,-.405,.007,.007)]
            vertices=[];n=16
            for z,x,y,w,d in rows:
                for j in range(n):
                    a=math.tau*j/n;vertices.append((sign*x+w*math.cos(a),y+d*math.sin(a),z))
            faces=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(rows)-1) for j in range(n)]
            faces.extend([tuple(range(n-1,-1,-1)),tuple((len(rows)-1)*n+j for j in range(n))]);parts.append(mesh('Soft ear flap',vertices,faces))
    for key,leg in cfg['legs'].items():
        fore=key.startswith('Front');sign=-1 if key.endswith('L') else 1
        hip,knee,ankle,toe=[Vector(leg[k]) for k in ['hip','knee','ankle','toe']]
        if cat:radii=[.031 if fore else .041,.023 if fore else .029,.015,.020]
        else:radii=[.052 if fore else .068,.037 if fore else .047,.023,.031]
        parts.append(tube(key+' anatomical leg',[hip,knee,ankle,toe],radii,sides=18))
        volume(key+' upper muscle',tuple(hip.lerp(knee,.30)),(.032 if cat else .055,.037 if cat else .060,.052 if cat else .082))
        paw=toe.copy();paw.y+=.012 if cat else .020;paw.z=.024 if cat else .037
        volume(key+' metacarpal paw',tuple(paw),(.025,.034,.023) if cat else (.041,.055,.035))
        # Four small toe lobes merge into the paw, retaining a readable forefoot.
        for digit in range(4):
            x=paw.x+(digit-1.5)*(.010 if cat else .016)
            volume(key+' toe '+str(digit),(x,paw.y-(.020 if cat else .034),.018 if cat else .027),(.009,.017,.015) if cat else (.014,.025,.023))
    points=[cfg['tail_base'],(0,.24,.272),cfg['tail_mid'],(.024,.37,.333),cfg['tail_tip']] if cat else [cfg['tail_base'],(0,.34,.42),cfg['tail_mid'],(.016,.52,.47),cfg['tail_tip']]
    parts.append(tube('Tapered expressive tail',points,[.019,.018,.015,.010,.0035] if cat else [.034,.032,.026,.017,.005],sides=18))
    body=join(parts,'Realism '+kind+' continuous anatomy')
    # Union the anatomical masses into one continuous surface, then relax the
    # transitions. This removes the visibly intersecting primitive-body look.
    remesh=body.modifiers.new('Sculpted anatomical union','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.0036 if cat else .0055;remesh.use_smooth_shade=True
    bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth=body.modifiers.new('Relax shoulder hip and muzzle transitions','SMOOTH');smooth.factor=.62;smooth.iterations=4;bpy.ops.object.modifier_apply(modifier=smooth.name)
    body.data.calc_loop_triangles();triangles=len(body.data.loop_triangles)
    dec=body.modifiers.new('Web silhouette budget','DECIMATE');dec.ratio=min(1,14500/triangles if cat else 16000/triangles);dec.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=dec.name)
    for f in body.data.polygons:f.use_smooth=True
    return body


def weight_body(body,rig,cfg):
    cat=cfg['kind']=='cat';h=cfg['hip_height'];groups={bone.name:body.vertex_groups.new(name=bone.name) for bone in rig.data.bones}
    for vertex in body.data.vertices:
        p=vertex.co;x,y,z=p;weights={'Spine':1.0}
        if y>cfg['tail_base'][1] and z>h-.045:
            amount=smoothstep(cfg['tail_base'][1],cfg['tail_base'][1]+(.055 if cat else .07),y)
            tip=smoothstep(cfg['tail_mid'][1]-.04,cfg['tail_mid'][1]+.07,y)
            weights={'Spine':1-amount,'Tail':amount*(1-tip),'TailTip':amount*tip}
        elif z<h+.02 and abs(x)>(.022 if cat else .040):
            key=('Front' if y<0 else 'Rear')+('L' if x<0 else 'R');leg=cfg['legs'][key];prefix=key[:-1];side=key[-1]
            bones=[key,prefix+'Lower'+side,prefix+'Paw'+side];segments=[('hip','knee'),('knee','ankle'),('ankle','toe')]
            distances=[distance_segment(p,leg[a],leg[b]) for a,b in segments]
            values=[1/(.008+d)**3 for d in distances];total=sum(values)
            blend=1-smoothstep(h*.65,h+.015,z)
            weights={'Spine':1-blend,**{bone:blend*value/total for bone,value in zip(bones,values)}}
            if z<(.048 if cat else .075):weights={prefix+'Paw'+side:1.0}
        if y<(-.12 if cat else -.18) and z>(.215 if cat else .35):
            neck=smoothstep(-.12 if cat else -.18,-.20 if cat else -.31,y)
            head=smoothstep(-.18 if cat else -.28,-.235 if cat else -.355,y)
            weights={'Spine':1-neck,'Neck':neck*(1-head),'Head':neck*head}
        side='L' if x<0 else 'R';ear_head,ear_tip=cfg['ears'][side]
        if cat and z>.349 and abs(x)>.025:
            amount=smoothstep(.349,.383,z);weights={'Head':1-amount,'Ear'+side:amount}
        elif not cat and abs(x)>.081 and -.44<y<-.28 and .45<z<.60:
            amount=smoothstep(.080,.11,abs(x));weights={'Head':1-amount,'Ear'+side:amount}
        weights={key:value for key,value in weights.items() if value>1e-5};total=sum(weights.values())
        for key,value in weights.items():groups[key].add([vertex.index],value/total,'REPLACE')
    body.parent=rig;modifier=body.modifiers.new('Anatomical skin','ARMATURE');modifier.object=rig


def details(kind,cfg,rig,body):
    from mathutils.bvhtree import BVHTree
    surface=BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],[tuple(p.vertices) for p in body.data.polygons],all_triangles=True)
    cat=kind=='cat';parts=[]
    dark=material(kind+' nose and pupil',(.012,.009,.007),.28)
    eye=material(kind+' iris',(.19,.23,.065) if cat else (.065,.035,.012),.22)
    warm=material(kind+' eyelids',(.07,.045,.025),.68)
    inner=material(kind+' inner ear',(.18,.095,.085) if cat else (.16,.075,.05),.88)
    whisker=material(kind+' fine whiskers',(.58,.55,.48),.76)
    claw=material(kind+' claws',(.27,.24,.18),.60)
    def add(obj,bone):
        group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE');parts.append(obj);return obj
    for side,(position,tip) in cfg['eyes'].items():
        sign=-1 if side=='L' else 1;x,y,z=position
        add(ellipsoid('Inset '+side+' eye',(x,y-.005,z),(.0115,.0045,.0088) if cat else (.0105,.005,.0085),eye,28,18),'Eye'+side)
        add(ellipsoid(side+' pupil',(x,y-.0095 if cat else y-.0115,z),(.0014,.0012,.0065) if cat else (.0055,.0015,.0058),dark,20,12),'Eye'+side)
        for upper in [True,False]:
            points=[]
            for i in range(13):
                t=math.pi*i/12;a=t if upper else -t
                points.append((x+(.012 if cat else .0112)*math.cos(a),y-(.009 if cat else .011)+.0012*abs(math.cos(a)),z+(.0085 if cat else .008)*math.sin(a)))
            add(tube(side+' '+('upper' if upper else 'lower')+' eyelid',points,.0009 if cat else .0012,warm,6),'Eye'+side)
        # Pinna lining follows the actual remeshed ear surface. A narrow
        # inset leaves a fur margin and avoids a flat card floating in front.
        if cat:
            anchors=[Vector((sign*.039,0,.363)),Vector((sign*.065,0,.362)),Vector((sign*.060,0,.397))]
            vertices=[];faces=[];rows=9;indices={}
            for row in range(rows):
                t=row/(rows-1)
                for col in range(rows-row):
                    u=col/(rows-1);p=anchors[0]*(1-t-u)+anchors[1]*u+anchors[2]*t
                    hit=surface.ray_cast(Vector((p.x,-1,p.z)),Vector((0,1,0)))[0]
                    if hit is None:hit=Vector((p.x,-.219,p.z))
                    indices[(row,col)]=len(vertices);vertices.append((p.x,hit.y-.0005,p.z))
            for row in range(rows-1):
                for col in range(rows-row-1):
                    faces.append((indices[(row,col)],indices[(row,col+1)],indices[(row+1,col)]))
                    if col<rows-row-2:faces.append((indices[(row,col+1)],indices[(row+1,col+1)],indices[(row+1,col)]))
            patch=mesh(side+' recessed ear cartilage',vertices,faces,inner);parts.append(patch)
            ear_group=patch.vertex_groups.new(name='Ear'+side);head_group=patch.vertex_groups.new(name='Head')
            for vertex in patch.data.vertices:
                amount=smoothstep(.349,.383,vertex.co.z);ear_group.add([vertex.index],amount,'REPLACE');head_group.add([vertex.index],1-amount,'REPLACE')
        # A floppy dog's outer ear is fur-covered. Its small inner fold is
        # hidden on the back surface instead of exposed as a pink outer patch.
        else:
            vertices=[]
            for x,z in [(sign*.105,.532),(sign*.122,.529),(sign*.110,.497)]:
                hit=surface.ray_cast(Vector((x,1,z)),Vector((0,-1,0)))[0]
                if hit is not None:vertices.append((x,hit.y+.0004,z))
            if len(vertices)==3:add(mesh(side+' inside ear fold',vertices,[(0,1,2)],inner),'Ear'+side)
    nosepos=(0,-.308,.294) if cat else (0,-.510,.515)
    add(ellipsoid('Nose leather',nosepos,(.009,.006,.0055) if cat else (.030,.018,.022),inner if cat else dark,24,16),'Head')
    if not cat:
        for sign in [-1,1]:add(ellipsoid('Nostril',(sign*.014,-.525,.516),(.007,.003,.006),dark,16,10),'Head')
    chin_y=-.308 if cat else -.502;chin_z=.283 if cat else .488
    add(tube('Philtrum',[(0,nosepos[1]-.006,nosepos[2]-.005),(0,chin_y,chin_z)],.0008 if cat else .0015,warm,6),'Head')
    for sign in [-1,1]:
        add(tube('Soft mouth corner',[(0,chin_y,chin_z),(sign*(.015 if cat else .026),chin_y+.004,chin_z-.004),(sign*(.027 if cat else .042),chin_y+.014,chin_z+.002)],.00075 if cat else .0013,warm,6),'Head')
        for i in range(4 if cat else 3):
            base=(sign*(.022 if cat else .047),-.296 if cat else -.478,(.286 if cat else .486)+i*(.003 if cat else .005))
            tip=(sign*(.096 if cat else .102),base[1]-.018+i*.007,base[2]+(i-1.5)*.011)
            midpoint=(base[0]*.45+tip[0]*.55,base[1]*.55+tip[1]*.45-.006,base[2]*.6+tip[2]*.4)
            add(tube('Tapered tactile whisker',[base,midpoint,tip],[.00065 if cat else .0008,.0004,.00012],whisker,5),'Head')
        for i in range(3):
            add(ellipsoid('Whisker follicle',(sign*(.017+i*.005 if cat else .036+i*.007),-.307+i*.002 if cat else -.491+i*.003,.291 if cat else .494),(.0009,.0006,.0009) if cat else (.0013,.001,.0013),warm,8,6),'Head')
    for key,leg in cfg['legs'].items():
        side=key[-1];prefix=key[:-1];toe=leg['toe']
        if not cat:
            for digit in range(4):
                x=toe[0]+(digit-1.5)*.016
                add(tube('Natural claw',[(x,toe[1]-.007,.023),(x,toe[1]-.019,.021),(x,toe[1]-.027,.016)],[.003,.002,.0008],claw,7),prefix+'Paw'+side)
        # Fine separations between toe lobes make the paws read as anatomy.
        for digit in range(3):
            x=toe[0]+(digit-1)*(.010 if cat else .016)
            add(tube('Toe crease',[(x,toe[1]-.003,.033 if cat else .052),(x,toe[1]-.012,.022 if cat else .035)],.00045 if cat else .00065,warm,5),prefix+'Paw'+side)
    for obj in parts:
        obj.parent=rig;modifier=obj.modifiers.new('Face and paw skin','ARMATURE');modifier.object=rig
    return parts


def build(kind):
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
    cfg=configuration(kind);body=sculpt(kind,cfg)
    # Bake before the rig is posed. All maps remain packed in the source and GLB.
    procedural=make_fur_material(kind,tuple(body.dimensions));bake_fur(body,procedural,SOURCE/'pet-textures',kind,samples=16)
    zmin=min(v.co.z for v in body.data.vertices);zmax=max(v.co.z for v in body.data.vertices)
    cfg['anatomical_height']=zmax-zmin
    rig=build_rig(cfg);weight_body(body,rig,cfg);parts=details(kind,cfg,rig,body)
    body=join([body,*parts],'Realism '+kind+' skinned anatomy and features')
    body.parent=rig
    if not any(m.type=='ARMATURE' for m in body.modifiers):modifier=body.modifiers.new('Pet skin','ARMATURE');modifier.object=rig
    body['atelier']=True;body['realism_pet']=True;body['source_license']='Original Vibe Coffee Blender artwork'
    radius=.32 if kind=='cat' else .54
    width=max(abs(v.co.x) for v in body.data.vertices)
    body['pet_bounds']=[-width,zmin,-radius,width,zmax,radius]
    body['pet_walk_speed']=cfg['runtime_speed']
    actions=animate_pet(rig,cfg)
    walk=next(action for action in actions if action.name=='walk')
    cfg['walk_duration']=(walk.frame_range[1]-walk.frame_range[0])/bpy.context.scene.render.fps
    body['pet_walk_duration']=cfg['walk_duration']
    rig.animation_data.action=None
    for p in rig.pose.bones:p.matrix_basis.identity()
    bpy.context.view_layer.update()
    # Baked color and normal maps have explicit UVs. Face detail meshes use
    # simple untextured materials and share the same animated skin.
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True)
    path=OUT/('pet_'+kind+'.glb')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('pet_'+kind+'.blend')),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=True,export_anim_single_armature=True,export_extras=True,export_cameras=False,export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/('pet_'+kind+'.blend')),compress=True)
    body.data.calc_loop_triangles()
    REPORT['pet_'+kind]={'triangles':len(body.data.loop_triangles),'materials':len(body.data.materials),'bones':len(rig.data.bones),'clips':[a.name for a in bpy.data.actions],'source_height_metres':cfg['anatomical_height'],'runtime_height_metres':cfg['runtime_height'],'walk_duration_seconds':cfg['walk_duration'],'runtime_walk_speed_metres_per_second':cfg['runtime_speed'],'bytes':path.stat().st_size,'provenance':'Original Blender geometry and procedural coat; no third-party pet assets'}
    print('REALISM_PET',kind,REPORT['pet_'+kind],flush=True)
    if kind=='cat':shutil.copyfile(path,OUT/'cat.glb')
    (SOURCE/'pets-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')

selection=os.environ.get('VIBE_PET')
for kind in ['cat','dog']:
    if selection and selection!=kind:continue
    build(kind)
