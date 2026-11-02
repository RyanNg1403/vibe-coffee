"""Blender refit of the project's credited CC0 source people, with authored café poses.
Run node tools/prepare-realism-sources.mjs first. Source atlas UVs are preserved.
"""
import bpy,math,json,sys,os
from pathlib import Path
from mathutils import Vector,Quaternion,Matrix
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('VIBE_PORTRAIT_GLB_DIR',str(ROOT/'public/models')))
SOURCE=Path(os.environ.get('VIBE_PORTRAIT_SOURCE_DIR',str(ROOT/'assets/blender/realism')))
OUT.mkdir(parents=True,exist_ok=True)
SOURCE.mkdir(parents=True,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
REPORT={}
sys.path.insert(0,str(Path(__file__).parent))
from portrait_variations import apply_portrait_variation
from portrait_accessories import add_portrait_accessories

def aim(rig,name,child,direction):
    bpy.context.view_layer.update()
    p=rig.pose.bones[name];c=rig.pose.bones[child]
    q=(c.head-p.head).normalized().rotation_difference(Vector(direction).normalized())
    loc,rot,scale=p.matrix.decompose()
    p.matrix=Matrix.LocRotScale(loc,q@rot,scale)
    bpy.context.view_layer.update()

def move_hips(rig,dz):
    p=rig.pose.bones['Hips'];m=p.matrix.copy();m.translation.z+=dz/rig.scale.x;p.matrix=m
    bpy.context.view_layer.update()

def ground_legs(rig):
    # Analytic two-bone IK, solved in armature space: fixed leg lengths and
    # planted ankles, rather than stretching calves or sliding the root.
    for side in ['Left','Right']:
        a,b,c=[rig.pose.bones[side+n] for n in ['UpLeg','Leg','Foot']]
        H=a.head.copy();l1=(b.head-H).length;l2=(c.head-b.head).length
        unit=1/rig.scale.x
        F=Vector((H.x, -.39*unit, .095*unit));D=F-H;d=D.length;direction=D.normalized()
        distance=(l1*l1-l2*l2+d*d)/(2*d)
        height=math.sqrt(max(.001,l1*l1-distance*distance))
        forward=Vector((0,-1,0));bend=(forward-direction*forward.dot(direction)).normalized()
        K=H+direction*distance+bend*height
        aim(rig,side+'UpLeg',side+'Leg',K-H)
        aim(rig,side+'Leg',side+'Foot',F-rig.pose.bones[side+'Leg'].head)
        # The foot retains its source toe pitch, now aligned with the floor.
        aim(rig,side+'Foot',side+'ToeBase',(0,-1,-.45))

def pose(rig,name,phase):
    for p in rig.pose.bones:p.matrix_basis.identity()
    bpy.context.view_layer.update()
    if name=='Sitting':
        move_hips(rig,-.345)
        ground_legs(rig)
    else:move_hips(rig,math.sin(phase)*.0015)
    for side,sign in [('Left',1),('Right',-1)]:
        upper=(sign*.11,-.07,-1);fore=(sign*.04,-.12,-1)
        if name=='Sitting':upper=(sign*.08,-.28,-1);fore=(sign*.03,-.65,-.80)
        if name=='Working':upper=(sign*.14,-.52,-1);fore=(sign*.10,-1,-.15+math.sin(phase+(0 if side=='Left' else 1.3))*.07)
        if name=='Wave' and side=='Right':upper=(sign*.70,.05,.70);fore=(math.sin(phase*2)*.22,-.1,1)
        aim(rig,side+'Arm',side+'ForeArm',upper)
        aim(rig,side+'ForeArm',side+'Hand',fore)
    p=rig.pose.bones['Head'];p.rotation_mode='QUATERNION'
    axis=p.bone.matrix_local.to_3x3().inverted()@Vector((0,0,1))
    p.rotation_quaternion=Quaternion(axis.normalized(),math.sin(phase)*.018)
    bpy.context.view_layer.update()

def build_apron(body,rig,role):
    """Fit a sewn canvas apron to the actual shirt surface, retaining its weights."""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    import numpy as np
    sys.path.insert(0,str(Path(__file__).parent))
    from atelier_common import mesh,mat,tube
    world=body.matrix_world.copy()
    coords=[world@v.co for v in body.data.vertices]
    polygons=[list(p.vertices) for p in body.data.polygons]
    surface=BVHTree.FromPolygons(coords,polygons,all_triangles=True)
    group_names={group.index:group.name for group in body.vertex_groups}
    fabric=mat('Portrait '+role+' washed canvas',(.105,.13,.105) if role=='barista' else (.20,.145,.09),.91)
    seam=mat('Portrait '+role+' canvas stitching',(.19,.205,.16) if role=='barista' else (.32,.245,.16),.94)
    parts=[]
    # The original plane cut through shirt folds. Sample the complete front
    # surface, then add real garment clearance and a small hem ripple.
    profile=[(.72,.165),(.83,.17),(.95,.18),(1.06,.18),(1.16,.145),(1.25,.105),(1.34,.09)]
    rows=[]
    for z in np.linspace(.72,1.34,25):
        width=float(np.interp(z,[p[0] for p in profile],[p[1] for p in profile]))
        xs=np.linspace(-width,width,19)
        hits=[surface.ray_cast(Vector((float(x),-1,float(z))),Vector((0,1,0)))[0] for x in xs]
        known=[i for i,hit in enumerate(hits) if hit is not None and abs(xs[i])<.085]
        # Torso centre samples avoid sleeve intersections at the panel sides.
        front_depth=min((hits[i].y for i in known),default=-.14)-.026
        if z<1.04:front_depth=min(front_depth,-.175)
        rows.append([(float(x),front_depth+.018*(x/width)**2-.0015*math.cos(j*1.3)*(1.34-z)/.62,float(z)) for j,x in enumerate(xs)])
    verts=[p for row in rows for p in row]
    faces=[(r*19+j,r*19+j+1,(r+1)*19+j+1,(r+1)*19+j) for r in range(24) for j in range(18)]
    parts.append(mesh('Fitted canvas apron',verts,faces,fabric))
    def front(x,z):
        lo=max(0,min(23,int((z-.72)/(.62/24))))
        t=max(0,min(1,(z-rows[lo][0][2])/(.62/24)))
        def at(row):return float(np.interp(x,[p[0] for p in row],[p[1] for p in row]))
        return at(rows[lo])*(1-t)+at(rows[lo+1])*t
    # Narrow sewn hems make the fabric edge legible without a thick border.
    for name,points in [('left',[r[0] for r in rows]),('right',[r[-1] for r in rows]),('top',rows[-1]),('bottom',rows[0])]:
        points=[(x,y-.0015,z) for x,y,z in points]
        parts.append(tube('Apron '+name+' hem',points,.0015,seam,sides=5))
    # A curved patch pocket follows the same shirt profile and stays proud of
    # the main panel. It is open at the top and sewn on the remaining edges.
    pocket=[]
    for z in [.985,1.025,1.065,1.105]:
        pocket.append([(x,front(x,z)-.009-.003*math.sin(math.pi*(x+.095)/.19),z) for x in np.linspace(-.095,.095,13)])
    pv=[p for row in pocket for p in row]
    pf=[(r*13+j,r*13+j+1,(r+1)*13+j+1,(r+1)*13+j) for r in range(3) for j in range(12)]
    parts.append(mesh('Apron patch pocket',pv,pf,fabric))
    for points in [[r[0] for r in pocket],[r[-1] for r in pocket],pocket[0],pocket[-1]]:
        parts.append(tube('Pocket stitched edge',[(x,y-.001,z) for x,y,z in points],.0012,seam,sides=5))
    def ribbon(name,points,width):
        v=[]
        for i,p in enumerate(points):
            p=Vector(p);tangent=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])).normalized()
            side=tangent.cross(Vector((0,-1,0))).normalized()
            if side.length<.1:side=Vector((1,0,0))
            v.extend([tuple(p-side*width/2),tuple(p+side*width/2)])
        return mesh(name,v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(points)-1)],fabric)
    # Webbing follows the collar and passes behind the neck, joining both bib corners.
    neck=[(-.08,front(-.08,1.34),1.335),(-.072,-.12,1.365),(-.064,-.085,1.39),(-.060,-.025,1.405),(-.056,.045,1.40),(0,.064,1.395),(.056,.045,1.40),(.060,-.025,1.405),(.064,-.085,1.39),(.072,-.12,1.365),(.08,front(.08,1.34),1.335)]
    parts.append(ribbon('Apron neck webbing',neck,.018))
    # Waist tape conforms around the torso instead of ending in mid-air.
    belt=[]
    for i in range(65):
        a=math.tau*i/64;direction=Vector((math.sin(a),math.cos(a),0))
        hit=surface.ray_cast(Vector((direction.x*.5,direction.y*.5,1.055)),-direction)[0]
        p=(hit+direction*.025) if hit is not None else Vector((direction.x*.19,direction.y*.15,1.055))
        # Lateral rays can encounter a relaxed forearm; keep the tie on the torso.
        p.x=max(-.20,min(.20,p.x));p.y=max(-.18,min(.15,p.y))
        belt.extend([(p.x,p.y,1.044),(p.x,p.y,1.066)])
    parts.append(mesh('Apron waist tape',belt,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(64)],fabric))
    for part in parts:
        for vertex in part.data.vertices:
            position=vertex.co.copy()
            hit,normal,face,distance=surface.find_nearest(position)
            weights={}
            if face is not None:
                ids=polygons[face][:3];a,b,c=[coords[i] for i in ids]
                bary=barycentric_transform(hit,a,b,c,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
                for index,coefficient in zip(ids,bary):
                    for assignment in body.data.vertices[index].groups:
                        name=group_names[assignment.group]
                        weights[name]=weights.get(name,0)+max(0,coefficient)*assignment.weight
            # Cloth wraps the torso. Nearest geometry at a bib edge may be a
            # relaxed sleeve; inheriting arm weights creates fins when it moves.
            weights={name:weight for name,weight in weights.items() if not any(term in name for term in ['Arm','Hand','Shoulder'])}
            if not weights:weights={'Hips' if position.z<1.04 else 'Spine01':1}
            # Match glTF's four-influence contract in the editable preview too.
            weights=dict(sorted(weights.items(),key=lambda item:item[1],reverse=True)[:4])
            total=sum(weights.values())
            for name,weight in weights.items():
                if weight>.0001:(part.vertex_groups.get(name) or part.vertex_groups.new(name=name)).add([vertex.index],weight/total,'REPLACE')
            vertex.co=world.inverted()@position
        part.parent=body.parent;part.matrix_parent_inverse=body.matrix_parent_inverse.copy();part.matrix_basis=body.matrix_basis.copy()
        modifier=part.modifiers.new('Canvas skin deformation','ARMATURE');modifier.object=rig
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True)
    for part in parts:part.select_set(True)
    bpy.context.view_layer.objects.active=body;bpy.ops.object.join()

def build(index,role=None):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for a in list(bpy.data.actions):bpy.data.actions.remove(a)
    sex='female' if index%2==0 else 'male'
    bpy.ops.import_scene.gltf(filepath='/tmp/vibe-realism-input/'+sex+'.glb',bone_heuristic='BLENDER')
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    body=max((o for o in bpy.context.scene.objects if o.type=='MESH'),key=lambda o:len(o.data.vertices))
    for o in list(bpy.context.scene.objects):
        if o not in [rig,body]:bpy.data.objects.remove(o,do_unlink=True)
    rig.name='CafePortraitRig';body.name='Photo-textured café character'
    source_walk=next(a for a in bpy.data.actions if 'Walk' in a.name)
    first,last=source_walk.frame_range
    samples=[]
    # Preserve the source locomotion, resampled to a seamless loop at 30 Hz.
    for i in range(31):
        rig.animation_data.action=source_walk;bpy.context.scene.frame_set(int(first),subframe=0)
        t=first+(last-first)*(i%30)/30;bpy.context.scene.frame_set(int(t),subframe=t-int(t));bpy.context.view_layer.update()
        p=rig.pose.bones['Hips'];m=p.matrix.copy();m.translation.x=p.bone.head_local.x;m.translation.y=p.bone.head_local.y;p.matrix=m
        samples.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy()) for p in rig.pose.bones})
    rig.animation_data.action=None
    for p in rig.pose.bones:p.matrix_basis.identity();p.rotation_mode='QUATERNION'
    # Remove duplicate source vertices, then reduce the mesh with UVs, skin
    # weights and material boundaries retained by Blender's decimator.
    bpy.context.view_layer.objects.active=body;body.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.001);bpy.ops.object.mode_set(mode='OBJECT')
    dec=body.modifiers.new('Portrait silhouette optimization','DECIMATE');dec.ratio=.23;dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_move_up(modifier=dec.name)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    for poly in body.data.polygons:poly.use_smooth=True
    spec=apply_portrait_variation(body,rig,index,role)
    anatomical=[body.matrix_world@v.co for v in body.data.vertices]
    body['portrait_bounds']=[min(v.x for v in anatomical),min(v.z for v in anatomical),-max(v.y for v in anatomical),max(v.x for v in anatomical),max(v.z for v in anatomical),-min(v.y for v in anatomical)]
    add_portrait_accessories(body,rig,spec)
    if role:
        build_apron(body,rig,role)
    # Replace all temporary imported actions with explicit café actions.
    rig.animation_data.action=None
    for a in list(bpy.data.actions):bpy.data.actions.remove(a)
    bpy.context.scene.render.fps=30
    for name,frames in [('Idle',60),('Walk',30),('Working',60),('Wave',60),('Sitting',60)]:
        action=bpy.data.actions.new(name);rig.animation_data.action=action
        for f in range(frames+1):
            if name=='Walk':
                for p in rig.pose.bones:
                    loc,rot,scale=samples[f][p.name];p.location=loc;p.rotation_quaternion=rot;p.scale=scale
            else:pose(rig,name,math.tau*f/frames)
            for p in rig.pose.bones:
                p.keyframe_insert('location',frame=f+1);p.keyframe_insert('rotation_quaternion',frame=f+1);p.keyframe_insert('scale',frame=f+1)
        for curve in action.fcurves:
            for key in curve.keyframe_points:key.interpolation='LINEAR'
        action.use_fake_user=True
    rig.animation_data.action=bpy.data.actions['Idle'];bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
    # Preserve one atlas per portrait across region-specific roughness materials.
    # glTF embeds images by identity, so every slot must reuse the same image.
    image_dir=Path('/tmp/vibe-realism-images');image_dir.mkdir(exist_ok=True)
    image_cache={}
    for material in body.data.materials:
        for node in material.node_tree.nodes:
            if node.type!='TEX_IMAGE' or not node.image:continue
            image=node.image;image_id=image.as_pointer()
            if image_id not in image_cache:
                image.filepath_raw=str(image_dir/(sex+'_'+str(index)+'_'+image.name.replace('/','_')+'.png'));image.file_format='PNG';image.save()
                replacement=bpy.data.images.load(image.filepath_raw,check_existing=False);replacement.pack();image_cache[image_id]=replacement
            node.image=image_cache[image_id]
    body['atelier']=True;body['realism']=True;body['source_license']='CC0; suhakiylioglu / Meshy; see CREDITS.md'
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True);rig.select_set(True)
    key='char_atelier_'+(role or str(index+1))
    # Repeated imports otherwise retain previous characters' unused packed
    # atlases. Scene-owned data and the five fake-user actions remain intact.
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(key+'.blend')),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(key+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=True,export_anim_single_armature=True,export_extras=True,export_cameras=False,export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(key+'.blend')),compress=True)
    body.data.calc_loop_triangles();REPORT[key]={'triangles':len(body.data.loop_triangles),'materials':len(body.data.materials),'bytes':(OUT/(key+'.glb')).stat().st_size,'rigged':True,'source':sex,'portrait':spec['name'],'hair':spec['hair'],'eyewear':spec.get('eyewear'),'headwear':spec.get('headwear'),'hair_bun':spec.get('hair_bun',False)}
    print('PORTRAIT_ASSET',key,REPORT[key],flush=True)

selection=os.environ.get('VIBE_CHARACTER')
for i in range(18):
    if selection and selection!=str(i+1):continue
    build(i)
for role,index in [('barista',1),('server',2)]:
    if not selection or selection==role:build(index,role)
report_path=SOURCE/'people-report.json'
if selection and report_path.exists():
    previous=json.loads(report_path.read_text());previous.update(REPORT);REPORT=previous
report_path.write_text(json.dumps(REPORT,indent=2)+'\n')
