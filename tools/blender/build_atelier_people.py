"""Original anatomically proportioned café cast; one common deform rig and authored clips."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from atelier_common import *

def weights(o,bone):
    g=o.vertex_groups.new(name=bone);g.add(list(range(len(o.data.vertices))),1,'REPLACE');return o

def deform_z(o,upper,lower,joint,width=.065):
    a=o.vertex_groups.new(name=upper);b=o.vertex_groups.new(name=lower)
    for v in o.data.vertices:
        z=(o.matrix_world@v.co).z;t=max(0,min(1,(z-joint+width)/(2*width)))
        if t:a.add([v.index],t,'REPLACE')
        if t<1:b.add([v.index],1-t,'REPLACE')
    return o

def person(index,role=None):
    reset()
    for action in list(bpy.data.actions):bpy.data.actions.remove(action)
    female=index%2==0
    skin_colors=[(.54,.30,.19),(.22,.105,.06),(.69,.45,.30),(.38,.18,.095),(.77,.55,.39),(.45,.25,.13)]
    skin=mat('skin '+str(index),skin_colors[index],.57)
    lip=mat('lip '+str(index),tuple(c*.72 for c in skin_colors[index]),.63)
    hair=mat('hair '+str(index),[(.035,.019,.012),(.015,.012,.01),(.13,.068,.029),(.035,.028,.024),(.22,.13,.055),(.08,.065,.055)][index],.76)
    cloth=mat('wardrobe '+str(index),[(.18,.29,.24),(.10,.16,.22),(.51,.37,.22),(.29,.18,.13),(.42,.23,.20),(.22,.26,.29)][index],.86)
    trouser=mat('tailored trousers '+str(index),[(.13,.12,.105),(.055,.065,.075),(.20,.21,.18)][index%3],.89)
    shirt=mat('cotton shirt '+str(index),(.67,.63,.53),.88)
    eye=mat('eye white',(.71,.70,.61),.30)
    iris=mat('iris',(.075,.052,.029),.36)
    pupil=mat('pupil',(.006,.007,.006),.19)
    leather=mat('shoe leather',(.035,.028,.021),.40)
    parts=[]
    def add(o,bone):parts.append(weights(o,bone));return o
    # Continuous sculpted torso and shaped shoulder line; garments have hems,
    # collars, cuffs and real thickness rather than painted primitive blocks.
    torso=loft('Tailored jacket',[(.91,.105,.075,0),(.95,.133,.081,0),(1.04,.125,.076,0),(1.13,.12,.073,0),(1.24,.16,.086,0),(1.33,.19,.085,0),(1.37,.175,.069,0),(1.40,.06,.052,0)],cloth,24)
    parts.append(deform_z(torso,'Chest','Hips',1.11,.16))
    add(loft('Trouser waistband',[(.84,.12,.075,0),(.94,.132,.083,0),(.99,.12,.075,0)],trouser,24),'Hips')
    add(loft('Neck',[(1.35,.043,.043,0),(1.46,.041,.042,0),(1.49,.047,.046,0)],skin,20),'Neck')
    if index%2 or role:add(box('Shirt inset',(0,-.077,1.30),(.078,.008,.17),shirt,.008),'Chest')
    for sign in ([-1,1] if index in [3,5] and not role else []):
        lapel=mesh('Notched jacket lapel',[(sign*.044,-.084,1.39),(sign*.10,-.09,1.32),(sign*.035,-.094,1.18),(sign*.022,-.085,1.32)],[(0,1,2,3)],cloth)
        add(lapel,'Chest')
        tubeobj=tube('Collar edge',[(sign*.045,-.043,1.4),(sign*.055,-.085,1.36),(sign*.033,-.088,1.33)],.006,shirt)
        add(tubeobj,'Chest')
    for z in [1.09,1.17]:add(ellipsoid('Horn button',(0,-.084,z),(.004,.002,.004),leather,10,6),'Chest')
    # Hands have separate fingers and thumbs. Limb weights blend across the
    # elbows and knees to keep the silhouette continuous in seated poses.
    for sign,side in [(-1,'Left'),(1,'Right')]:
        x=sign*.084
        leg=tube(side+' trouser leg',[(sign*.067,0,.91),(x,0,.82),(x,.006,.64),(x,.005,.50),(x,0,.34),(x,-.003,.075)],[.061,.065,.052,.047,.048,.031],trouser,16)
        parts.append(deform_z(leg,side+'UpLeg',side+'Leg',.5,.075))
        add(box(side+' shoe sole',(x,-.054,.027),(.087,.22,.038),leather,.018),side+'Foot')
        add(ellipsoid(side+' fitted shoe',(x,-.063,.065),(.044,.113,.041),leather,24,12),side+'Foot')
        for j in range(3):add(tube('Lace',[(x-.024,-.035-j*.014,.098),(x+.024,-.043-j*.014,.098)],.0015,shirt,5),side+'Foot')
        sleeve=tube(side+' shaped sleeve',[(sign*.145,0,1.335),(sign*.195,0,1.30),(sign*.22,.002,1.17),(sign*.232,-.003,1.08),(sign*.238,-.014,.96)],[.049,.051,.043,.040,.030],cloth,16)
        parts.append(deform_z(sleeve,side+'Arm',side+'ForeArm',1.13,.07))
        add(tube('Shirt cuff',[(sign*.237,-.014,.965),(sign*.239,-.016,.94)],[.034,.031],shirt,16),side+'ForeArm')
        add(ellipsoid('Palm',(sign*.24,-.018,.904),(.032,.020,.045),skin,20,12),side+'Hand')
        for j in range(4):
            fx=sign*(.218+j*.014);length=[.043,.052,.049,.038][j]
            add(tube('Finger',[(fx,-.022,.885),(fx,-.028,.861),(fx,-.038,.885-length)],[.007,.006,.0045],skin,8),side+'Hand')
        add(tube('Opposed thumb',[(sign*.215,-.02,.92),(sign*.197,-.034,.90),(sign*.196,-.046,.883)],[.009,.008,.006],skin,8),side+'Hand')
    # Eight-head proportions with a jaw, cheek volume, nose bridge, eyelids,
    # small irises, lips and ears. Smooth normals are authored in Blender.
    head=loft('Sculpted head',[(1.455,.032,.04,-.007),(1.47,.045,.05,-.012),(1.49,.059,.062,-.006),(1.525,.075,.076,0),(1.565,.08,.08,.003),(1.605,.078,.079,.005),(1.645,.072,.071,.009),(1.68,.052,.052,.01),(1.70,.012,.014,.01)],skin,32)
    sub=head.modifiers.new('Sculpted facial smoothing','SUBSURF');sub.levels=1
    bpy.context.view_layer.objects.active=head;bpy.ops.object.modifier_apply(modifier=sub.name)
    add(head,'Head')
    add(loft('Nose bridge',[(1.535,.012,.014,-.083),(1.545,.014,.018,-.089),(1.555,.012,.019,-.088),(1.585,.009,.010,-.075),(1.60,.008,.006,-.072)],skin,16),'Head')
    for sign in [-1,1]:
        add(ellipsoid('Nostril wing',(sign*.012,-.086,1.541),(.008,.01,.006),skin,16,8),'Head')
        add(ellipsoid('Ear',(sign*.079,.005,1.559),(.014,.018,.030),skin,20,12),'Head')
        add(ellipsoid('Ear concha',(sign*.088,-.002,1.559),(.004,.011,.019),lip,12,8),'Head')
        x=sign*.030;cy=-.067
        add(ellipsoid('Almond eye',(x,cy,1.586),(.013,.0025,.0048),eye,20,10),'Head')
        add(ellipsoid('Hazel iris',(x,cy-.0025,1.586),(.0045,.0008,.0045),iris,16,10),'Head')
        add(ellipsoid('Pupil',(x,cy-.0033,1.586),(.0024,.0006,.0028),pupil,12,8),'Head')
        add(ellipsoid('Eye catchlight',(x-.0018,cy-.004,1.589),(.0008,.0004,.0008),eye,8,6),'Head')
        for upper in [True,False]:
            pts=[(x+math.cos(t)*.014,cy-.001+abs(math.cos(t))*.002,1.586+math.sin(t)*(.0055 if upper else -.0045)) for t in [j*math.pi/12 for j in range(13)]]
            add(tube('Eyelid',pts,.0021,skin,6),'Head')
        add(tube('Eyebrow',[(x-.019,-.072,1.606),(x-.006,-.077,1.61),(x+.009,-.075,1.608),(x+.019,-.069,1.604)],.0022,hair,6),'Head')
    add(tube('Upper lip',[(-.023,-.072,1.516),(-.009,-.077,1.519),(0,-.079,1.517),(.009,-.077,1.519),(.023,-.072,1.516)],.0027,lip,7),'Head')
    add(tube('Lower lip',[(-.02,-.073,1.515),(0,-.078,1.512),(.02,-.073,1.515)],.003,lip,7),'Head')
    # Fitted scalp with combed locks, plus distinct silhouettes for each design.
    v=[];f=[]
    for row in range(9):
        for j in range(40):
            a=j*math.tau/40
            boundary=1.62+.016*math.cos(a+index*.4) if math.sin(a)<-.1 else (1.55 if female else 1.575)
            z=1.71-(1.71-boundary)*row/8
            t=(z-1.59)/.12;radius=math.sqrt(max(0,1-t*t))
            v.append((math.cos(a)*.081*radius,.009+math.sin(a)*.082*radius,z))
    for i in range(8):
        for j in range(40):f.append((i*40+j,i*40+(j+1)%40,(i+1)*40+(j+1)%40,(i+1)*40+j))
    add(mesh('Groomed hair cap',v,f,hair),'Head')
    for j in range(12):
        a=j*math.tau/12
        pts=[]
        for k in range(8):
            t=k/7;z=1.698-t*(.085 if math.sin(a)<0 else .12);r=math.sqrt(max(.035,1-((z-1.59)/.12)**2))
            pts.append((math.cos(a+.16*t)*.082*r,.009+math.sin(a+.16*t)*.083*r,z))
        add(tube('Combed hair lock',pts,.0008,hair,5),'Head')
    if female:
        if index==0:
            add(ellipsoid('Low tied bun',(0,.095,1.555),(.043,.037,.041),hair,24,14),'Head')
        elif index==2:
            add(tube('Ponytail',[(0,.08,1.61),(.015,.115,1.56),(.025,.12,1.45),(.015,.10,1.37)],[.026,.035,.026,.008],hair,14),'Head')
        else:
            for sign in [-1,1]:add(tube('Shoulder-length hair',[(sign*.068,.025,1.63),(sign*.086,.03,1.55),(sign*.08,.035,1.44)],[.029,.034,.017],hair,14),'Head')
    elif index==3:
        for i in range(23):
            a=i*2.399;r=.065*math.sqrt((i+.5)/23);add(ellipsoid('Short curl',(r*math.cos(a),r*math.sin(a),1.687-r*.2),(.018,.018,.018),hair,10,8),'Head')
    if index in [1,4]:
        for sign in [-1,1]:
            add(tube('Glasses rim',[(sign*.031+math.cos(t)*.022,-.083,1.586+math.sin(t)*.014) for t in [i*math.tau/24 for i in range(25)]],.0018,leather,5),'Head')
            add(tube('Glasses temple',[(sign*.05,-.082,1.588),(sign*.08,-.01,1.585)],.0018,leather,5),'Head')
        add(tube('Glasses bridge',[(-.009,-.084,1.589),(0,-.088,1.593),(.009,-.084,1.589)],.0015,leather,5),'Head')
    for label,selected in [
        ('Sculpted jacket',[o for o in parts if o.name.startswith('Tailored jacket') or 'shaped sleeve' in o.name]),
        ('Sculpted trousers',[o for o in parts if 'Trouser waistband' in o.name or 'trouser leg' in o.name]),
    ]:
        for o in selected:parts.remove(o)
        garment=merge(selected,label)
        bpy.context.view_layer.objects.active=garment
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        remesh=garment.modifiers.new('Unified garment sculpt','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.008
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        smooth=garment.modifiers.new('Relax tailoring seams','SMOOTH');smooth.factor=.75;smooth.iterations=3
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        decimate=garment.modifiers.new('Game topology','DECIMATE');decimate.ratio=.18
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        garment.vertex_groups.clear()
        for v in garment.data.vertices:
            x,y,z=v.co
            if label.endswith('trousers'):
                side='Left' if x<0 else 'Right'
                if z>.85:values={'Hips':max(0,min(1,(z-.85)/.09)),side+'UpLeg':1-max(0,min(1,(z-.85)/.09))}
                else:
                    t=max(0,min(1,(z-.425)/.15));values={side+'UpLeg':t,side+'Leg':1-t}
            elif abs(x)>.15 and z<1.34:
                side='Left' if x<0 else 'Right';t=max(0,min(1,(z-1.06)/.14));values={side+'Arm':t,side+'ForeArm':1-t}
                shoulder=max(0,min(1,(z-1.26)/.08))
                values={k:w*(1-shoulder) for k,w in values.items()};values['Chest']=shoulder
            else:
                t=max(0,min(1,(z-.95)/.30));values={'Chest':t,'Hips':1-t}
            for name,value in values.items():
                if value>0:(garment.vertex_groups.get(name) or garment.vertex_groups.new(name=name)).add([v.index],value,'REPLACE')
        for poly in garment.data.polygons:poly.use_smooth=True
        parts.append(garment)

    if role:
        apron_mat=mat(role+' canvas apron',(.12,.17,.15) if role=='barista' else (.24,.18,.12),.92)
        profile=[(.77,.14),(.88,.145),(1.01,.13),(1.10,.13),(1.20,.105),(1.29,.085)]
        verts=[(width*(j/8*2-1),-.10+.018*(j/8*2-1)**2,z) for z,width in profile for j in range(9)]
        faces=[(r*9+j,r*9+j+1,(r+1)*9+j+1,(r+1)*9+j) for r in range(5) for j in range(8)]
        apron=mesh('Tailored canvas apron',verts,faces,apron_mat)
        parts.append(deform_z(apron,'Chest','Hips',1.12,.15))
        for sign in [-1,1]:add(tube('Apron neck strap',[(sign*.07,-.09,1.29),(sign*.052,-.06,1.39),(sign*.047,.03,1.4)],.009,apron_mat),'Chest')
        add(box('Apron pocket',(0,-.104,1.03),(.13,.006,.085),apron_mat,.008),'Hips')
        add(box('Name badge',(.045,-.105,1.23),(.045,.005,.022),BRASS,.003),'Chest')

    # One deform skeleton shared by all submaterials, including fingers/face.
    data=bpy.data.armatures.new('Cafe human deform rig');rig=bpy.data.objects.new('AtelierRig',data);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    def bone(name,head,tail,parent=None):
        b=data.edit_bones.new(name);b.head=head;b.tail=tail
        if parent:b.parent=data.edit_bones[parent]
    bone('Hips',(0,0,.93),(0,0,1.04));bone('Spine',(0,0,1.04),(0,0,1.23),'Hips');bone('Chest',(0,0,1.23),(0,0,1.4),'Spine');bone('Neck',(0,0,1.4),(0,0,1.47),'Chest');bone('Head',(0,0,1.47),(0,0,1.67),'Neck')
    for sign,side in [(-1,'Left'),(1,'Right')]:
        bone(side+'UpLeg',(sign*.084,0,.93),(sign*.084,.005,.50),'Hips');bone(side+'Leg',(sign*.084,.005,.50),(sign*.084,-.003,.11),side+'UpLeg');bone(side+'Foot',(sign*.084,-.003,.11),(sign*.084,-.15,.06),side+'Leg')
        bone(side+'Arm',(sign*.167,0,1.355),(sign*.226,.002,1.13),'Chest');bone(side+'ForeArm',(sign*.226,.002,1.13),(sign*.239,-.016,.94),side+'Arm');bone(side+'Hand',(sign*.239,-.016,.94),(sign*.24,-.025,.88),side+'ForeArm')
    bpy.ops.object.mode_set(mode='OBJECT')
    combined=merge(parts,'Atelier tailored character '+str(index));combined.parent=rig
    arm=combined.modifiers.new('Skin deformation','ARMATURE');arm.object=rig
    for pb in rig.pose.bones:pb.rotation_mode='XYZ'
    rig.animation_data_create();bpy.context.scene.render.fps=30
    for name,duration in [('Idle',2),('Walk',1),('Working',2),('Wave',2),('Sitting',2)]:
        action=bpy.data.actions.new(name);rig.animation_data.action=action
        frames=int(duration*30)
        for frame in range(frames+1):
            phase=math.tau*frame/frames
            for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0);p.scale=(1,1,1)
            p=rig.pose.bones
            p['Chest'].rotation_euler.x=math.sin(phase)*.012;p['Head'].rotation_euler.y=math.sin(phase)*.035
            if name=='Walk':
                p['Hips'].location.y=.006*(1-math.cos(phase*2));p['Hips'].rotation_euler.z=math.sin(phase)*.025
                p['Chest'].rotation_euler.y=math.sin(phase)*.055
                for side,offset in [('Left',0),('Right',math.pi)]:
                    s=math.sin(phase+offset);p[side+'UpLeg'].rotation_euler.x=s*.42
                    p[side+'Leg'].rotation_euler.x=max(0,-math.cos(phase+offset))*.57
                    p[side+'Foot'].rotation_euler.x=-max(0,s)*.13
                    p[side+'Arm'].rotation_euler.x=-s*.27;p[side+'ForeArm'].rotation_euler.x=-.12-max(0,s)*.12
            elif name=='Sitting':
                p['Hips'].location.y=-.42
                for side in ['Left','Right']:
                    p[side+'UpLeg'].rotation_euler.x=-math.pi/2;p[side+'Leg'].rotation_euler.x=math.pi/2
                    p[side+'Leg'].scale.y=1.12 # seated foot contact at the 49 cm cushion height
                    p[side+'Arm'].rotation_euler.x=-.25;p[side+'ForeArm'].rotation_euler.x=-.70
                p['Chest'].rotation_euler.x=.065+math.sin(phase)*.012
            elif name=='Working':
                for side,offset in [('Left',0),('Right',1.4)]:
                    p[side+'Arm'].rotation_euler.x=-.55+math.sin(phase+offset)*.08;p[side+'ForeArm'].rotation_euler.x=-.65+math.cos(phase+offset)*.12
                p['Head'].rotation_euler.x=.08
            elif name=='Wave':
                p['RightArm'].rotation_euler.z=-2.0;p['RightForeArm'].rotation_euler.z=-.3+math.sin(phase*3)*.2;p['RightHand'].rotation_euler.x=.15
            else:
                p['Hips'].location.y=math.sin(phase)*.002
                p['LeftForeArm'].rotation_euler.x=-.09;p['RightForeArm'].rotation_euler.x=-.12
            for pb in p:
                pb.keyframe_insert('rotation_euler',frame=frame+1,group=pb.name)
                pb.keyframe_insert('scale',frame=frame+1,group=pb.name)
                if pb.name=='Hips':pb.keyframe_insert('location',frame=frame+1,group=pb.name)
        for fc in action.fcurves:
            for k in fc.keyframe_points:k.interpolation='LINEAR'
        action.use_fake_user=True
    rig.animation_data.action=None
    for pb in rig.pose.bones:pb.rotation_euler=(0,0,0);pb.location=(0,0,0);pb.scale=(1,1,1)
    bpy.context.scene.frame_set(1)
    return rig

for i in range(6):
    rig=person(i);export('char_atelier_'+str(i+1),rig)
for role,index in [('barista',1),('server',2)]:
    rig=person(index,role);export('char_atelier_'+role,rig)
(SOURCE/'people-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
