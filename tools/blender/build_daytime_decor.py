"""Original Blender countertop collections for Golden Hour and Roastery.

Every object is authored here in metres, Z up, with the display facing -Y.
The source retains editable procedural materials; the web meshes use packed
albedo/normal bakes and a shared eight-material palette.
"""
import bpy, math, json, random, sys, os
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent))
from decor_collection_helpers import make_palette,lathe as turn_profile,beveled_box,tube,text_mesh,framed_card
SOURCE=ROOT/'assets/blender/collection';OUT=ROOT/'public/models'
SOURCE.mkdir(parents=True,exist_ok=True)
REPORT=json.loads((SOURCE/'daytime-decor-report.json').read_text()) if os.environ.get('VIBE_DECOR') and (SOURCE/'daytime-decor-report.json').exists() else {}
CANISTER_REPORT=[]


def ball(name,location,radius,mat,segments=20,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=location)
    ob=bpy.context.object;ob.name=name;ob.data.transform(Matrix.Diagonal((*radius,1)));ob.data.materials.append(mat)
    for p in ob.data.polygons:p.use_smooth=True
    return ob


def mesh(name,vertices,faces,mat):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);data.materials.append(mat)
    for p in data.polygons:p.use_smooth=True
    return ob


def lathe(name,profile,mat,location=(0,0,0),**kwargs):
    return turn_profile(name,[(z,r) for r,z in profile],mat,location,**kwargs)


def line(name,pts,mat,r=.0015):return tube(name,pts,r,mat,sides=8 if r>=.004 else 6,smooth=1)


def lettering(name,value,x,y,z,size,mat,align='CENTER'):
    return text_mesh(name,value,(x,y,z),size,mat,align=align,extrude=0)


def leaf(name,base,tip,width,mat,depth=.004):
    a,b=Vector(base),Vector(tip);d=b-a
    side=Vector((-d.z,0,d.x)).normalized()*width
    vertices=[];faces=[]
    for i in range(9):
        t=i/8;spread=math.sin(math.pi*t)**.82;center=a.lerp(b,t)
        center.y-=depth*math.sin(math.pi*t)
        vertices.extend([center-side*spread,center+Vector((0,-depth*.35*spread,0)),center+side*spread])
    for i in range(8):
        k=i*3;faces.extend([(k,k+3,k+4,k+1),(k+1,k+4,k+5,k+2)])
    return mesh(name,vertices,faces,mat)


def circle(name,x,y,z,r,mat,segments=48):
    verts=[(x,y,z)]+[(x+r*math.cos(i*math.tau/segments),y,z+r*math.sin(i*math.tau/segments)) for i in range(segments)]
    return mesh(name,verts,[(0,i+1,(i+1)%segments+1) for i in range(segments)],mat)


def linen_fold(palette,x,y,z,width=.33,depth=.23):
    verts=[];faces=[];nx,ny=23,17
    for j in range(ny):
        for i in range(nx):
            u=i/(nx-1);v=j/(ny-1)
            wave=.002*math.sin(u*math.tau*4+v*1.4)+.002*math.sin(v*math.pi)
            verts.append((x+(u-.5)*width,y+(v-.5)*depth,z+wave+.006*math.exp(-((u-.82)/.08)**2)))
    for j in range(ny-1):
        for i in range(nx-1):a=j*nx+i;faces.append((a,a+1,a+nx+1,a+nx))
    ob=mesh('Folded woven linen napkin',verts,faces,palette['linen'])
    solid=ob.modifiers.new('Folded textile thickness','SOLIDIFY');solid.thickness=.003
    bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=solid.name)
    for side in [-1,1]:
        line('Linen stitched hem',[(x+side*(width*.5-.012),y-depth*.5+.008,z+.002),(x+side*(width*.5-.012),y+depth*.5-.008,z+.002)],palette['paper'],.0007)


def vase(palette,name,x,y,height,radius):
    profile=[(0,0),(.72*radius,0),(.87*radius,.015)]
    for i in range(1,30):
        t=i/29;r=radius*(.84+.16*math.sin(t*math.pi))*(1-.55*max(0,(t-.55)/.45))
        r+=.0018*math.sin(t*math.pi*24)
        profile.append((r,.015+t*(height-.028)))
    mouth=profile[-1][0]
    profile.extend([(mouth+.003,height-.008),(mouth+.003,height),(mouth-.006,height),(mouth-.007,height-.010),(mouth-.012,height-.07),(.014,.018),(0,.018)])
    return lathe(name,profile,palette['ceramic'],(x,y,0),segments=56)


def framed_print(palette,name,x,y,w,h,kind):
    framed_card(name,(x,y,h*.5),w,h,{**palette,'paper':palette['linen']})
    front=y-.010
    # Countertop easel feet make the freestanding prints physically supported.
    for side in [-1,1]:
        line(name+' rear support',[(x+side*w*.34,y+.008,h*.48),(x+side*w*.34,y+.065,.012),(x+side*w*.34,y-.012,.012)],palette['dark'],.007)
    if kind=='botanical':
        lettering('Herbarium heading','HERBARIUM',x,front-.001,h-.075,.021,palette['dark'])
        lettering('Herbarium edition','FIELD STUDIES  /  02',x,front-.001,.055,.010,palette['dark'])
        for n in range(3):
            bx=x+(n-1)*.075;top=.46+(.05 if n==1 else 0)
            line('Printed botanical stem',[(bx,front,.12),(bx+.025,front,.30),(bx-.007,front,top)],palette['olive'],.0015)
            for k in range(4):
                zz=.17+k*.065;sgn=-1 if k%2 else 1
                leaf('Botanical olive leaf',(bx+.012,front-.0005,zz),(bx+sgn*.055,front-.001,zz+.060),.014,palette['olive'],.0007)
    elif kind=='sun':
        circle('Original abstract sun',x,front,.215,.059,palette['brown'])
        for k in range(5):line('Quiet horizon',[(x-w*.30,front-.001,.10+k*.012),(x+w*.30,front-.001,.10+k*.012)],palette['olive'],.001)
        lettering('Sunday small print','SUNDAY',x,front-.001,.045,.014,palette['dark'])
    else:
        lettering('Origin editorial heading','ORIGIN / 04',x,front-.001,h-.065,.027,palette['dark'])
        lettering('Origin location','HUILA, COLOMBIA',x,front-.001,h-.100,.012,palette['dark'])
        # An original contour study, not a purported geographic survey.
        for k in range(9):
            pts=[]
            for i in range(24):
                t=i/23;xx=x+(t-.5)*w*.72
                zz=.17+k*.027+.030*math.sin(t*math.tau*1.1+k*.26)+.013*math.sin(t*math.tau*2.5+k*.40)
                pts.append((xx,front,zz))
            line('Origin contour engraving',pts,palette['brown'],.0012)
        lettering('Altitude annotation','1,850 M  /  WASHED',x,front-.001,.085,.013,palette['dark'])
        lettering('Roastery edition','FIELDWORKS COFFEE',x,front-.001,.049,.012,palette['dark'])


def goldenhour(p):
    vase(p,'Tall thrown porcelain vase',-.60,.035,.285,.088)
    vase(p,'Low ribbed stoneware bud vase',-.34,.015,.16,.061)
    rng=random.Random(33)
    for branch in range(7):
        bx=-.60+rng.uniform(-.018,.018);by=.035+rng.uniform(-.014,.014)
        tx=bx+rng.uniform(-.14,.17);tz=rng.uniform(.57,.78)
        pts=[(bx,by,.18),(bx+(tx-bx)*.35,by-.012,.39),(tx,by+.018,tz)]
        line('Dried botanical branch',pts,p['brown'],.0015)
        for n in range(4):
            u=.37+n*.15;pos=Vector(pts[0]).lerp(Vector(pts[1]),u*2) if u<.5 else Vector(pts[1]).lerp(Vector(pts[2]),(u-.5)*2);sgn=-1 if n%2 else 1
            leaf('Dried eucalyptus leaf',pos,pos+Vector((sgn*.047,-.006,.029)),.012,p['paper'])
    line('Fresh olive stem',[(-.34,.015,.13),(-.33,.02,.30),(-.28,.025,.37)],p['olive'],.0018)
    for k in range(4):
        z=.20+k*.04;sgn=-1 if k%2 else 1
        bx=-.34+(.01*(z-.13)/.17) if z<=.30 else -.33+.05*(z-.30)/.07
        leaf('Olive sprig leaf',(bx,.02,z),(bx+sgn*.037,.01,z+.035),.012,p['olive'])
    framed_print(p,'Walnut herbarium frame',.015,.105,.39,.62,'botanical')
    framed_print(p,'Layered small Sunday print',.31,.095,.23,.34,'sun')
    linen_fold(p,.55,-.035,.010,.40,.24)
    lathe('Glazed serving platter',[(0,0),(.12,0),(.145,.012),(.155,.025),(.154,.034),(.145,.036),(.130,.020),(0,.018)],p['ceramic'],(.55,-.035,.019),segments=56)
    loaf=ball('Crusty artisan demi boule',(.55,-.030,.091),(.105,.067,.055),p['brown'],28,18)
    for vertex in loaf.data.vertices:
        if vertex.co.z<=0:continue
        x,y,z=vertex.co;distance=min(abs(x-(-.06+k*.034)) for k in range(4))
        vertex.co.z-=.004*math.exp(-(distance/.004)**2)*max(0,1-(y/.05)**4)
    # Pale flour scoring sits flush on the domed crust.
    for k in range(4):
        xx=.49+k*.034;pts=[]
        for j in range(13):
            t=j/12;yy=-.070+t*.075
            dz=.055*math.sqrt(max(.05,1-((xx-.55)/.105)**2-((yy+.030)/.067)**2))
            pts.append((xx,yy,.089+dz))
        line('Hand scored flour seam',pts,p['linen'],.0012)
    lathe('Small espresso cup',[(0,0),(.029,0),(.035,.008),(.039,.061),(.040,.067),(.035,.068),(.032,.014),(0,.013)],p['ceramic'],(.775,-.060,.014),segments=40)
    lathe('Espresso saucer',[(0,0),(.054,0),(.065,.008),(.064,.014),(.045,.008),(0,.006)],p['ceramic'],(.775,-.06,0),segments=40)
    pts=[(.809+.024*math.sin(t*math.pi*2),-.060,.050+.024*math.cos(t*math.pi*2)) for t in [i/24 for i in range(25)]]
    line('Fine loop handle',pts,p['ceramic'],.004)
    lathe('Espresso surface',[(0,0),(.030,0),(.030,.001),(0,.001)],p['brown'],(.775,-.060,.070),segments=40)
    return ['Thrown ribbed stoneware and dried eucalyptus','Original framed herbarium and abstract sun prints','Folded linen, scored artisan bread, ceramic coffee service']


def coffee_bag(p,name,x,y,height=.29,width=.18):
    depth=.095;verts=[];rings=[(0,.91,.85),(.018,1,1),(height*.67,.94,1),(height*.88,.83,.66),(height,.80,.26)]
    # Eight corners retain a gusset, rather than a simple beveled cube.
    shape=[(-1,-.60),(-.78,-1),(.78,-1),(1,-.60),(1,.60),(.78,1),(-.78,1),(-1,.60)]
    for z,wx,dy in rings:
        for xx,yy in shape:verts.append((x+xx*width*.5*wx,y+yy*depth*.5*dy,z))
    faces=[tuple(range(7,-1,-1)),tuple(32+i for i in range(8))]
    faces += [(i*8+j,i*8+(j+1)%8,(i+1)*8+(j+1)%8,(i+1)*8+j) for i in range(4) for j in range(8)]
    ob=mesh(name+' folded kraft body',verts,faces,p['paper'])
    bevel=ob.modifiers.new('Soft packet folds','BEVEL');bevel.width=.006;bevel.segments=3
    bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=bevel.name)
    for side in [-1,1]:line(name+' heat sealed side',[(x+side*width*.45,y-depth*.40,.02),(x+side*width*.42,y-depth*.47,height*.68),(x+side*width*.39,y-depth*.15,height-.007)],p['brown'],.0015)
    beveled_box(name+' folded top',(width*.82,.018,.016),(x,y,height-.004),p['paper'],.003)
    line(name+' closure strip',[(x-width*.36,y-.010,height+.004),(x+width*.36,y-.010,height+.004)],p['dark'],.002)
    fy=y-depth*.51
    beveled_box(name+' ivory origin label',(width*.65,.0018,height*.43),(x,fy-.001,height*.42),p['linen'],.002)
    lettering(name+' brand','FIELDWORKS',x,fy-.003,height*.58,.013,p['dark'])
    lettering(name+' lot','LOT / 04',x,fy-.003,height*.47,.021,p['dark'])
    lettering(name+' origin','HUILA',x,fy-.003,height*.36,.013,p['dark'])
    lettering(name+' roast','FILTER  /  250 G',x,fy-.003,height*.27,.008,p['dark'])
    circle(name+' degassing valve',x,fy-.002,height*.77,.007,p['dark'],20)
    circle(name+' valve inset',x,fy-.003,height*.77,.003,p['brown'],16)


def bean(p,location,rng):
    ob=ball('Roasted coffee bean',location,(.008,.005,.0045),p['brown'],10,5)
    ob.rotation_euler.z=rng.random()*math.tau
    return ob


def canister(p,x,y,height,seed):
    r=.058
    lathe('Blown glass bean canister',[(0,0),(r-.004,0),(r,.008),(r,height-.016),(r-.002,height),(r-.006,height),(r-.006,.012),(0,.012)],p['glass'],(x,y,0),segments=48)
    lathe('Brushed canister lid',[(0,0),(r+.004,0),(r+.004,.011),(r-.002,.016),(0,.016)],p['copper'],(x,y,height-.002),segments=48)
    # A dark bean volume with individual visible beans at the top/outer wall.
    fill_height=height*.63;fill_top=.014+fill_height
    lathe('Coffee bean fill',[(0,0),(r-.015,0),(r-.015,fill_height),(0,fill_height)],p['brown'],(x,y,.014),segments=32)
    rng=random.Random(seed);top_beans=[];wall_beans=[]
    for i in range(20):
        a=rng.random()*math.tau;rr=math.sqrt(rng.random())*(r-.017)
        top_beans.append(bean(p,(x+rr*math.cos(a),y+rr*math.sin(a),fill_top+rng.uniform(.0015,.0040)),rng))
    for i in range(12):
        a=rng.random()*math.tau
        wall_beans.append(bean(p,(x+(r-.017)*math.cos(a),y+(r-.017)*math.sin(a),rng.uniform(.025,height*.64)),rng))
    # Check the actual modeled bean surfaces before combining the assembly.
    def bean_surface(ob):
        rotation=ob.rotation_euler.to_matrix()
        return [ob.location+rotation@vertex.co for vertex in ob.data.vertices]
    top_surfaces=[bean_surface(ob) for ob in top_beans];wall_surfaces=[bean_surface(ob) for ob in wall_beans]
    visible_tops=[max(v.z for v in vertices)-fill_top for vertices in top_surfaces]
    wall_radii=[max(math.hypot(v.x-x,v.y-y) for v in vertices) for vertices in wall_surfaces]
    maximum_radius=max(math.hypot(v.x-x,v.y-y) for vertices in top_surfaces+wall_surfaces for v in vertices)
    assert min(visible_tops)>.005,'Top beans must protrude above the opaque fill cap'
    assert all(min(v.z for v in vertices)<fill_top for vertices in top_surfaces),'Top beans must overlap the pile instead of floating'
    assert min(wall_radii)>r-.015+.001,'Wall beans must protrude outside the fill core'
    assert maximum_radius<r-.006-.001,'Individual beans must remain inside the glass with clearance'
    CANISTER_REPORT.append({'height':height,'inner_glass_radius':r-.006,'fill_radius':r-.015,'fill_top':fill_top,'top_bean_count':len(top_beans),'visible_top_minimum':min(visible_tops),'wall_bean_count':len(wall_beans),'minimum_wall_radius':min(wall_radii),'maximum_bean_radius':maximum_radius,'minimum_radial_glass_clearance':r-.006-maximum_radius})
    # Small index plaque sits on the front glass with restrained typography.
    beveled_box('Canister lot plaque',(.055,.002,.034),(x,y-r-.001,height*.37),p['linen'],.002)
    lettering('Canister lot number','04' if seed==4 else '07',x,y-r-.003,height*.34,.019,p['dark'])


def brew_station(p,x,y):
    beveled_box('Precision brew scale',(.245,.205,.022),(x,y,.011),p['dark'],.009)
    beveled_box('Scale brushed top',(.229,.168,.003),(x,y+.010,.024),p['copper'],.008)
    beveled_box('Scale display',(.069,.002,.015),(x,y-.103,.014),p['ceramic'],.001)
    lettering('Scale readout','00.0',x,y-.105,.009,.011,p['dark'])
    # Clear carafe with believable wall thickness and a flared pouring lip.
    lathe('Glass filter coffee carafe',[(0,0),(.059,0),(.068,.017),(.071,.085),(.054,.145),(.039,.175),(.042,.188),(.038,.190),(.034,.175),(.049,.144),(.065,.083),(.061,.022),(0,.014)],p['glass'],(x,y,.027),segments=56)
    lathe('Fresh brewed coffee',[(0,0),(.026,0),(.058,.010),(.061,.072),(0,.072)],p['brown'],(x,y,.044),segments=40)
    # Offset upright and circular holder support the dripper, with no floating parts.
    line('Copper brew stand',[(x-.135,y+.075,0),(x-.135,y+.075,.390),(x-.105,y+.075,.412),(x,y+.075,.412)],p['copper'],.008)
    beveled_box('Stand mounting foot',(.080,.090,.014),(x-.135,y+.070,.007),p['dark'],.006)
    holder=[(x+.079*math.cos(i*math.tau/48),y+.079*math.sin(i*math.tau/48),.306) for i in range(49)]
    line('Dripper support ring',holder,p['copper'],.005)
    line('Ring support arm',[(x-.135,y+.075,.306),(x-.072,y+.040,.306)],p['copper'],.006)
    lathe('Fluted copper cone dripper',[(.018,.230),(.023,.237),(.079,.350),(.085,.355),(.084,.361),(.077,.358),(.018,.242)],p['copper'],(x,y,0),segments=56,ribs=28)
    lathe('Pleated paper filter',[(.012,.243),(.078,.363),(.082,.380),(.079,.380),(.074,.362),(.010,.250)],p['linen'],(x,y,0),segments=56,ribs=28)
    lathe('Dripper coffee bed',[(0,0),(.038,0),(.038,.002),(0,.002)],p['brown'],(x,y,.307),segments=32)


def roastery(p):
    coffee_bag(p,'Signature coffee bag',-.72,.005,.29,.18)
    coffee_bag(p,'Companion coffee bag',-.49,.035,.25,.16)
    canister(p,-.255,-.025,.245,4);canister(p,-.105,.035,.205,7)
    framed_print(p,'Origin contour print',.175,.110,.39,.64,'origin')
    brew_station(p,.625,-.010)
    lettering('Brew stand maker mark','FIELDWORKS',.625,-.114,.034,.009,p['linen'])
    return ['Gusseted kraft coffee packets with branded origin labels and valves','Glass bean canisters with individual roasted beans','Copper filter stand, pleated dripper, glass carafe and precision scale','Original origin contour print and editorial typography']


def join_meshes(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();ob=bpy.context.object;ob.name=name
    return ob


def bake_collection(obj,key):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8
    scene.render.bake.use_selected_to_active=False;scene.render.bake.margin=8;scene.render.bake.normal_space='TANGENT'
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.008);bpy.ops.object.mode_set(mode='OBJECT')
    materials=list(obj.data.materials);state=[]
    for mat in materials:
        nodes,links=mat.node_tree.nodes,mat.node_tree.links;p=nodes.get('Principled BSDF');out=nodes.get('Material Output')
        emission=nodes.new('ShaderNodeEmission');base=p.inputs['Base Color']
        if base.is_linked:links.new(base.links[0].from_socket,emission.inputs['Color'])
        else:emission.inputs['Color'].default_value=base.default_value
        target=nodes.new('ShaderNodeTexImage');state.append((mat,p,out,emission,target))
    images={};texture_dir=SOURCE/'textures';texture_dir.mkdir(exist_ok=True)
    for channel,size,kind in [('color',1024,'EMIT'),('normal',512,'NORMAL')]:
        im=bpy.data.images.new(key+'_'+channel,width=size,height=size);im.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
        for mat,p,out,emission,target in state:
            target.image=im;mat.node_tree.nodes.active=target
            mat.node_tree.links.new((emission if channel=='color' else p).outputs[0],out.inputs['Surface'])
        bpy.ops.object.bake(type=kind);im.file_format='JPEG';im.filepath_raw=str(texture_dir/(im.name+'.jpg'));im.save();im.pack();images[channel]=im
    for idx,(mat,p,out,emission,target) in enumerate(state):
        mat.node_tree.links.new(p.outputs[0],out.inputs['Surface']);mat.node_tree.nodes.remove(emission);mat.node_tree.nodes.remove(target);mat.use_fake_user=True
        runtime=bpy.data.materials.new(mat.name+' / atlas');runtime.use_nodes=True;n,l=runtime.node_tree.nodes,runtime.node_tree.links;q=n.get('Principled BSDF')
        for socket in ['Metallic','Roughness','IOR','Transmission Weight','Coat Weight','Coat Roughness','Sheen Weight']:
            q.inputs[socket].default_value=p.inputs[socket].default_value
        color=n.new('ShaderNodeTexImage');color.image=images['color'];l.new(color.outputs['Color'],q.inputs['Base Color'])
        normal=n.new('ShaderNodeTexImage');normal.image=images['normal'];mapping=n.new('ShaderNodeNormalMap');mapping.inputs['Strength'].default_value=.45;l.new(normal.outputs['Color'],mapping.inputs['Color']);l.new(mapping.outputs['Normal'],q.inputs['Normal'])
        obj.data.materials[idx]=runtime
    return images


def build(venue):
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
    CANISTER_REPORT.clear()
    p=make_palette()
    if venue=='roastery':
        # Coffee needs its own roast value; Golden Hour keeps the bread palette.
        brown=(.055,.023,.009);nodes=p['brown'].node_tree.nodes
        nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*brown,1)
        for node in nodes:
            if node.type=='MIX_RGB':
                node.inputs[1].default_value=(*[v*.92 for v in brown],1)
                node.inputs[2].default_value=(*[v*1.06 for v in brown],1)
    features=goldenhour(p) if venue=='goldenhour' else roastery(p)
    objects=[ob for ob in bpy.context.scene.objects if ob.type=='MESH']
    # Preserve glass as a separate portable PBR primitive; opaque surfaces share an atlas.
    opaque=[ob for ob in objects if ob.data.materials[0]!=p['glass']];glass=[ob for ob in objects if ob.data.materials[0]==p['glass']]
    body=join_meshes(opaque,'Collection '+venue+' authored display');key='atelier_decor_'+venue
    bake_collection(body,key)
    if glass:body=join_meshes([body,*glass],'Collection '+venue+' authored display')
    bpy.context.view_layer.objects.active=body;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    coords=[v.co for v in body.data.vertices]
    center_x=(min(v.x for v in coords)+max(v.x for v in coords))*.5
    center_y=(min(v.y for v in coords)+max(v.y for v in coords))*.5
    floor=min(v.z for v in coords)
    body.data.transform(Matrix.Translation(Vector((-center_x,-center_y,-floor))))
    coords=[v.co for v in body.data.vertices]
    lower=[min(v[i] for v in coords) for i in range(3)];upper=[max(v[i] for v in coords) for i in range(3)]
    body['atelier']=True;body['collection']='daytime countertop';body['source_license']='Original Vibe Coffee Blender artwork'
    body['support_bounds']=[lower[0],lower[2],-upper[1],upper[0],upper[2],-lower[1]]
    body['placement_base']=0.0;body['display_front']='+Z after glTF export';body['venue']=venue
    body.data.calc_loop_triangles();triangles=len(body.data.loop_triangles)
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(key+'.blend')),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(key+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=True)
    REPORT[key]={'triangles':triangles,'materials':len(body.data.materials),'source_bounds_xyz':[lower,upper],'runtime_support_bounds':list(body['support_bounds']),'width_metres':upper[0]-lower[0],'depth_metres':upper[1]-lower[1],'height_metres':upper[2]-lower[2],'features':features,'original_artwork':True,'packed_maps':['1024 color','512 normal'],'raw_glb_bytes':(OUT/(key+'.glb')).stat().st_size}
    if CANISTER_REPORT:REPORT[key]['canister_surface_checks']=list(CANISTER_REPORT)
    print('DAYTIME_COLLECTION',key,REPORT[key],flush=True)


for venue in ['goldenhour','roastery']:
    if not os.environ.get('VIBE_DECOR') or os.environ['VIBE_DECOR']==venue:build(venue)
(SOURCE/'daytime-decor-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
