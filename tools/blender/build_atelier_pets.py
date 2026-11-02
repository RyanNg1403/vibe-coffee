"""Sculpted café cat and dog with a shared quadruped rig and authored behavior clips."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from atelier_common import *
for kind in ['cat','dog']:
    reset()
    for action in list(bpy.data.actions):bpy.data.actions.remove(action)
    dog=kind=='dog';h=.35 if dog else .22;length=.48 if dog else .33
    fur=mat(kind+' coat',(.31,.17,.085) if dog else (.27,.28,.26),.87)
    cream=mat(kind+' muzzle',(.66,.58,.43),.88);nose=mat('animal nose',(.018,.014,.012),.36)
    parts=[]
    def add(o,bone):
        vg=o.vertex_groups.new(name=bone);vg.add(list(range(len(o.data.vertices))),1,'REPLACE');parts.append(o);return o
    add(ellipsoid('Ribcage',(0,0,h),(.105,length*.6,.12 if dog else .075),fur,28,16),'Spine')
    add(ellipsoid('Chest',(0,-length*.3,h),(.10,.12,.12 if dog else .08),fur),'Spine')
    front=-length*.57
    add(ellipsoid('Head',(0,front,h+.12),(.09 if dog else .064,.10 if dog else .064,.10 if dog else .063),fur),'Head')
    add(ellipsoid('Muzzle',(0,front-.073,h+.09),(.057 if dog else .042,.065 if dog else .035,.047 if dog else .027),cream),'Head')
    add(ellipsoid('Nose',(0,front-(.125 if dog else .10),h+.10),(.025 if dog else .012,.014,.014),nose,16,10),'Head')
    for sign in [-1,1]:
        add(ellipsoid('Eye',(sign*.057,front-.067,h+.15),(.009,.008,.010),nose,16,10),'Head')
        add(ellipsoid('Catchlight',(sign*.058-.002,front-.075,h+.153),(.002,.001,.002),GLAZE,8,6),'Head')
        if dog:
            add(tube('Soft hanging ear',[(sign*.07,front+.025,h+.18),(sign*.105,front+.035,h+.11),(sign*.11,front+.025,h+.04)],[.031,.038,.015],fur,12),'Head')
        else:
            verts=[(sign*.033,front+.015,h+.16),(sign*.076,front+.017,h+.15),(sign*.066,front+.01,h+.235),(sign*.051,front+.045,h+.17)]
            add(mesh('Pointed cat ear',verts,[(0,1,2),(0,3,1),(0,2,3),(1,3,2)],fur),'Head')
            for i in range(3):add(tube('Whisker',[(sign*.026,front-.09,h+.08),(sign*.10,front-.10+i*.012,h+.08+i*.006)],.0005,cream,4),'Head')
    for sign in [-1,1]:
        for fore in [True,False]:
            name=('Front' if fore else 'Rear')+('L' if sign<0 else 'R');y=(-.32 if fore else .38)*length
            add(tube('Shaped leg',[(sign*.073,y,h),(sign*.08,y,.12),(sign*.08,y-.012,.045)],[.037,.025,.022],fur,12),name)
            add(ellipsoid('Paw',(sign*.08,y-.025,.028),(.033,.05,.025),cream if fore else fur,16,10),name)
    tailpts=[(0,length*.43,h+.02),(.02,length*.7,h+.09),(.05,length*.89,h+.22),(.03,length*.94,h+.30)]
    add(tube('Expressive tail',tailpts,[.027,.026,.018,.006],fur,12),'Tail')
    data=bpy.data.armatures.new('Quadruped');rig=bpy.data.objects.new('AtelierPetRig',data);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    def bone(n,a,b,parent=None):
        v=data.edit_bones.new(n);v.head=a;v.tail=b
        if parent:v.parent=data.edit_bones[parent]
    bone('Root',(0,0,0),(0,0,h));bone('Spine',(0,length*.3,h),(0,-length*.4,h),'Root');bone('Head',(0,front,h+.05),(0,front-.09,h+.13),'Spine');bone('Tail',tailpts[0],tailpts[-1],'Spine')
    for sign in [-1,1]:
        for fore in [True,False]:
            n=('Front' if fore else 'Rear')+('L' if sign<0 else 'R');y=(-.32 if fore else .38)*length;bone(n,(sign*.073,y,h),(sign*.08,y,.04),'Spine')
    bpy.ops.object.mode_set(mode='OBJECT');obj=merge(parts,'Atelier '+kind);obj.parent=rig;mod=obj.modifiers.new('Deform','ARMATURE');mod.object=rig
    rig.animation_data_create()
    for p in rig.pose.bones:p.rotation_mode='XYZ'
    for name in ['idle','walk','idle_eating','headbutt','death','idle_2_headlow','idle_2','eating']:
        action=bpy.data.actions.new(name);rig.animation_data.action=action
        for f in range(31):
            phase=math.tau*f/30
            for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
            p=rig.pose.bones;p['Tail'].rotation_euler.y=math.sin(phase)*.2
            if name=='walk':
                for i,n in enumerate(['FrontL','FrontR','RearL','RearR']):p[n].rotation_euler.x=math.sin(phase+([0,math.pi,math.pi,0][i]))*.35
            elif name=='death':
                p['Root'].location.y=-h*.5*(f/30)
                for n in ['FrontL','FrontR','RearL','RearR']:p[n].rotation_euler.x=(1 if n.startswith('Front') else -1)*1.1*f/30
            elif name in ['idle_eating','idle_2_headlow','eating']:p['Head'].rotation_euler.x=.32+math.sin(phase)*.06
            else:p['Head'].rotation_euler.y=math.sin(phase)*.07
            for pb in p:pb.keyframe_insert('rotation_euler',frame=f+1);pb.keyframe_insert('location',frame=f+1)
        for fc in action.fcurves:
            for k in fc.keyframe_points:k.interpolation='LINEAR'
        action.use_fake_user=True
    rig.animation_data.action=None
    for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
    export('pet_'+kind,rig)
    if kind=='cat':
        import shutil
        shutil.copyfile(OUT/'pet_cat.glb',OUT/'cat.glb')
(SOURCE/'pets-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
