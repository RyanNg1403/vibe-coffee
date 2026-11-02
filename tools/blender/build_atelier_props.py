"""Rebuild every static runtime prop, including the legacy library keys, in Blender."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from atelier_common import *

def cup(saucer=True,tall=False):
    h=.105 if tall else .09
    lathe('Thrown ceramic body',[(0,.008),(.026,.008),(.030,.013),(.035,h*.35),(.043,h*.85),(.044,h),(.041,h+.001),(.039,h-.006),(.033,.028),(0,.024)],GLAZE,32)
    tube('Pulled handle',[(.04+.026*math.sin(t),0,h*.52+.031*math.cos(t)) for t in [i*math.pi/16 for i in range(17)]],.005,GLAZE)
    if saucer:
        lathe('Recessed saucer',[(0,.003),(.03,.003),(.055,.006),(.073,.015),(.075,.018),(.072,.02),(.052,.01),(0,.009)],GLAZE,32)
        tube('Spoon stem',[(.045,-.04,.025),(.065,-.036,.026),(.085,-.03,.025)],.002,STEEL)
        ellipsoid('Spoon bowl',(.087,-.029,.025),(.012,.006,.002),STEEL,16,8)
    if tall:
        move(lathe('Coffee',[(0,h-.01),(.038,h-.01)],COFFEE,32))

def chair(stool=False,arm=False):
    seat=.67 if stool else .46
    w=.54 if arm else .44;d=.47 if arm else .43
    for x in [-1,1]:
        for y in [-1,1]:
            tube('Tapered oak leg',[(x*w*.47,y*d*.48,.015),(x*w*.38,y*d*.36,seat-.055)],[.018,.024],WOOD,10)
    box('Steam bent seat rim',(0,0,seat-.028),(w,d,.055),WOOD,.024)
    box('Fitted linen seat',(0,-.009,seat+.017),(w-.035,d-.035,.052),LINEN,.025)
    # A continuous moulded plywood back, curved around the spine.
    profile=[]
    for z in [seat+.20,seat+.25,seat+.37,seat+.43]:
        row=[]
        for j in range(17):
            x=(j/16-.5)*(w+.025);y=d*.43-.16*(x/(w*.5))**2
            row.append((x,y,z))
        profile+=row
    f=[(i*17+j,i*17+j+1,(i+1)*17+j+1,(i+1)*17+j) for i in range(3) for j in range(16)]
    shell=mesh('Sculpted plywood back',profile,f,WOOD)
    so=shell.modifiers.new('Plywood thickness','SOLIDIFY');so.thickness=.018;bpy.context.view_layer.objects.active=shell;bpy.ops.object.modifier_apply(modifier=so.name)
    for x in [-w*.37,w*.37]:tube('Back support',[(x,d*.32,seat-.04),(x,d*.42,seat+.3)],.016,WOOD)
    if stool:ring('Foot rail',(0,0,.26),.20,.012,BRASS)
    if arm:
        for sign in [-1,1]:
            tube('Arm frame',[(sign*.25,-.16,seat-.02),(sign*.25,-.16,seat+.18),(sign*.25,.17,seat+.2)],.02,WOOD)
            box('Upholstered arm',(sign*.25,0,seat+.19),(.07,.4,.065),LINEN,.025)

def sofa():
    box('Oak plinth',(0,0,.18),(1.72,.70,.16),WOOD,.035)
    for x in [-.68,.68]:
        for y in [-.26,.26]:tube('Turned foot',[(x,y,.02),(x,y,.16)],.036,WOOD)
    for i in range(3):
        x=(i-1)*.52
        box('Separate seat cushion',(x,-.035,.38),(.51,.64,.19),LINEN,.065)
        back=box('Back cushion',(x,.25,.65),(.53,.18,.46),LINEN,.075);back.rotation_euler.x=-.12
        tube('Cushion welt',[(x-.23,-.32,.44),(x+.23,-.32,.44),(x+.25,.25,.44)],.003,GLAZE)
    for x in [-.84,.84]:box('Round upholstered arm',(x,0,.52),(.17,.72,.39),LINEN,.08)

def espresso():
    box('Espresso enamel chassis',(0,0,.27),(.65,.36,.42),DARK,.05)
    for x in [-.32,.32]:box('Oak side cheek',(x,0,.27),(.05,.39,.40),WOOD,.025)
    box('Steel fascia',(0,-.192,.33),(.59,.025,.20),STEEL,.008)
    box('Cup warming rail',(0,0,.49),(.66,.38,.025),STEEL,.01)
    box('Drain basin',(0,-.23,.066),(.63,.22,.06),DARK,.018)
    for i in range(16):box('Drip grate',(i*.036-.27,-.23,.1),(.011,.19,.008),STEEL,.003)
    for x in [-.15,.15]:
        group=lathe('Brew group',[(0,0),(.047,0),(.047,.055),(0,.055)],STEEL,24);group.location=(x,-.19,.23)
        tube('Walnut portafilter grip',[(x,-.21,.23),(x,-.34,.23)],[.017,.014],WOOD,12)
        tube('Twin spout',[(x-.023,-.21,.23),(x-.023,-.23,.18),(x+.023,-.23,.18),(x+.023,-.21,.23)],.006,STEEL)
        for j in range(3):ellipsoid('Backlit brew button',(x+(j-1)*.035,-.21,.37),(.011,.004,.011),GLAZE,12,8)
    for sign in [-1,1]:tube('Articulated steam wand',[(sign*.26,-.2,.31),(sign*.29,-.27,.24),(sign*.30,-.29,.13)],.007,STEEL)
    dial=lathe('Pressure dial',[(0,0),(.03,0),(.03,.008),(0,.008)],GLAZE,24);dial.rotation_euler.x=math.pi/2;dial.location=(0,-.214,.37)
    tube('Pressure needle',[(0,-.225,.37),(.014,-.225,.383)],.0015,DARK,6)

def pendant(kind='metal'):
    if kind=='metal':
        lathe('Spun shade',[(.012,.18),(.025,.17),(.06,.13),(.11,.075),(.17,.015),(.17,0),(.16,0),(.10,.07),(.05,.12),(.014,.16)],DARK,40)
        ring('Brass rolled rim',(0,0,.008),.168,.004,BRASS,40)
    else:
        v=[]
        for z,r in [(0,.16),(.23,.10)]:
            for j in range(64):
                a=j*math.tau/64;rr=r+(.003 if j%2 else -.003);v.append((rr*math.cos(a),rr*math.sin(a),z))
        mesh('Pleated linen shade',v,[(j,(j+1)%64,(j+1)%64+64,j+64) for j in range(64)],LINEN)
        for z,r in [(0,.16),(.23,.10)]:ring('Shade binding',(0,0,z),r,.003,GLAZE)
    ellipsoid('Opal diffuser',(0,0,.09),(.036,.036,.05),GLAZE,20,10)

def lamp(table=False):
    h=.47 if table else 1.55
    lathe('Weighted lamp foot',[(0,0),(.14,0),(.14,.02),(.11,.035),(0,.035)],DARK)
    tube('Brass lamp stem',[(0,0,.025),(0,0,h-.24)],.012,BRASS,12)
    before=set(bpy.context.scene.objects);pendant('linen')
    for o in set(bpy.context.scene.objects)-before:o.location.z+=h-.23

def pot(radius=.13,h=.19):
    lathe('Hand-thrown planter',[(0,0),(radius*.72,0),(radius*.82,.02),(radius,h*.92),(radius,h),(radius*.90,h),(radius*.88,h*.85),(0,h*.85)],TERRACOTTA,24)
    move(lathe('Dark soil',[(0,0),(radius*.87,0)],SOIL,24),z=h*.88)

def leaf(name,start,end,width,m=GREEN):
    a=Vector(start);b=Vector(end);axis=b-a;side=axis.cross(Vector((0,0,1))).normalized()
    if side.length<.1:side=Vector((1,0,0))
    v=[]
    for i in range(7):
        t=i/6;mid=a+axis*t+Vector((0,0,math.sin(math.pi*t)*width*.25));w=math.sin(math.pi*t)**.8*width
        for j in [-1,0,1]:v.append(tuple(mid+side*j*w+Vector((0,0,-abs(j)*width*.13))))
    f=[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(6) for j in range(2)]
    o=mesh(name,v,f,m);so=o.modifiers.new('Leaf body','SOLIDIFY');so.thickness=.0015;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=so.name)
    tube('Leaf midrib',[tuple(a+axis*t+Vector((0,0,math.sin(math.pi*t)*width*.25+.001))) for t in [0,.25,.5,.75,1]],.0013,LEAFLIGHT,5)

def plant(kind='monstera'):
    if kind in ['tree_a','tree_b']:
        tube('Branching trunk',[(0,0,0),(.02,0,1.1),(-.03,0,2.25)],[.10,.065,.02],WOOD,12)
        for i in range(14):
            angle=i*2.399;z=.8+i*.11;end=(math.cos(angle)*(.55+(i%3)*.17),math.sin(angle)*(.55+(i%3)*.17),z+.65)
            tube('Tree bough',[(0,0,z),end],[.026,.008],WOOD)
            for j in range(18):
                a=j*2.399;centre=Vector(end)+Vector((math.cos(a)*random.uniform(.05,.34),math.sin(a)*random.uniform(.05,.34),random.uniform(-.18,.30)))
                leaf('Canopy leaf',centre,centre+Vector((math.cos(a)*.16,math.sin(a)*.16,.03)),.055,GREEN if j%3 else LEAFLIGHT)
        return
    if kind=='vine':
        for i in range(6):
            x=(i-2.5)*.055;points=[(x+math.sin(t*4+i)*.05,t*.12,.55-t*.52) for t in [j/8 for j in range(9)]]
            tube('Trailing stem',points,.004,WOOD)
            for j in range(1,8):
                a=Vector(points[j]);sign=(-1)**j;leaf('Pothos leaf',a,a+Vector((sign*.09,.035,-.055)),.055)
        return
    small=kind in ['succulent','cacti'];pot(.10 if small else .14,.14 if small else .2)
    if kind=='cacti':
        for i in range(4):
            x=(i-1.5)*.038
            ellipsoid('Ribbed cactus',(x,0,.23+(i%2)*.035),(.035,.04,.11+(i%2)*.03),GREEN,16,12)
            for j in range(6):
                a=j*math.tau/6;tube('Cactus rib',[(x+.035*math.cos(a),.04*math.sin(a),.15),(x+.032*math.cos(a),.036*math.sin(a),.30)],.002,LEAFLIGHT,5)
    elif kind=='snake':
        for i in range(10):
            a=i*2.399;h=.36+(i%4)*.07
            leaf('Upright sword leaf',(.05*math.cos(a),.05*math.sin(a),.18),(.14*math.cos(a),.14*math.sin(a),h+.2),.035,LEAFLIGHT if i%3==0 else GREEN)
    elif kind=='succulent':
        for i in range(20):
            a=i*2.399;r=.07+(i%3)*.018
            leaf('Fleshy rosette',(0,0,.15),(math.cos(a)*r,math.sin(a)*r,.17+(i%4)*.02),.035,LEAFLIGHT)
    elif kind=='fern':
        for i in range(13):
            a=i*2.399;end=Vector((math.cos(a)*.28,math.sin(a)*.28,.38));start=Vector((0,0,.18));tube('Fern rachis',[start,((start+end)/2)+Vector((0,0,.12)),end],.003,GREEN)
            for j in range(1,9):
                t=j/10;p=start.lerp(end,t)+Vector((0,0,math.sin(t*math.pi)*.10))
                for sign in [-1,1]:leaf('Fern pinna',p,p+Vector((-math.sin(a)*sign*.07*(1-t*.5),math.cos(a)*sign*.07*(1-t*.5),.005)),.016)
    else:
        for i in range(11):
            a=i*2.399;h=.33+(i%5)*.13;reach=.22+(i%3)*.07
            start=Vector((math.cos(a)*.02,math.sin(a)*.02,.19));joint=Vector((math.cos(a)*reach*.55,math.sin(a)*reach*.55,h));end=joint+Vector((math.cos(a)*reach,math.sin(a)*reach,-.07))
            tube('Living plant stalk',[start,joint],.0045,GREEN)
            leaf('Broad sculpted leaf',joint,end,.10 if kind=='monstera' else .065,GREEN if i%3 else LEAFLIGHT)

def pastry(kind):
    if kind=='croissant':
        points=[];r=[]
        for i in range(25):
            t=i/24;a=-.85*math.pi+t*1.7*math.pi;points.append((math.cos(a)*.065,math.sin(a)*.048,.024));r.append(.006+math.sin(math.pi*t)**.7*.022)
        tube('Laminated crescent',points,r,BREAD,12)
        for i in range(3,23,3):
            p=Vector(points[i]);a=i/24*1.7*math.pi-.85*math.pi
            tube('Pastry lamination',[tuple(p+Vector((math.cos(a)*r[i]*math.cos(t),math.sin(a)*r[i]*math.cos(t),r[i]*math.sin(t)))) for t in [j*math.pi/12 for j in range(13)]],.0015,GLAZE,5)
    elif kind in ['muffin','cupcake']:
        lathe('Fluted baking case',[(0,0),(.033,0),(.043,.055),(0,.055)],PAPER,24)
        for i in range(24):
            a=i*math.tau/24;tube('Paper pleat',[(.033*math.cos(a),.033*math.sin(a),.005),(.043*math.cos(a),.043*math.sin(a),.05)],.001,PAPER,4)
        ellipsoid('Baked crown',(0,0,.056),(.047,.047,.03),BREAD,24,12)
        for i in range(8):
            a=i*2.399;ellipsoid('Blueberry',(math.cos(a)*.025,math.sin(a)*.025,.076),(.006,.006,.005),DARK,10,6)
        if kind=='cupcake':tube('Piped vanilla cream',[(math.cos(t)*(.033*(1-t/(math.tau*3))),math.sin(t)*(.033*(1-t/(math.tau*3))),.08+t*.002) for t in [j*.15 for j in range(126)]],.009,GLAZE,7)
    elif kind=='donut':
        ring('Brioche dough',(0,0,.024),.037,.021,BREAD)
        icing=mat('cocoa glaze',(.105,.037,.017),.31)
        ring('Chocolate icing',(0,0,.035),.037,.014,icing)
        for i in range(28):
            a=i*2.399;r=.03+random.random()*.016;tube('Almond shaving',[(math.cos(a)*r,math.sin(a)*r,.049),(math.cos(a)*r+.005,math.sin(a)*r+.002,.05)],.0015,GLAZE,4)
    elif kind=='cookie':
        ellipsoid('Butter cookie',(0,0,.012),(.048,.044,.012),BREAD,24,10)
        for i in range(12):
            a=i*2.399;r=.03*random.random();ellipsoid('Chocolate chunk',(math.cos(a)*r,math.sin(a)*r,.021),(.005,.005,.003),COFFEE,8,5)
    elif kind=='apple':
        red=mat('apple skin',(.32,.035,.02),.29)
        ellipsoid('Apple',(0,0,.039),(.036,.036,.038),red,24,16);tube('Apple stalk',[(0,0,.07),(.004,0,.083)],.002,WOOD)
        leaf('Apple leaf',(.003,0,.078),(.028,.005,.08),.008)
    elif kind=='sandwich':
        for z,m in [(.008,BREAD),(.015,GLAZE),(.024,GREEN),(.032,TERRACOTTA),(.04,BREAD)]:
            o=mesh('Sourdough triangle',[(-.065,-.045,z),(.065,-.045,z),(-.065,.045,z),(-.065,-.045,z+.009),(.065,-.045,z+.009),(-.065,.045,z+.009)],[(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)],m,False)
    elif kind=='pancakes':
        for i in range(4):move(lathe('Griddled pancake',[(0,0),(.065,0),(.065,.012),(0,.012)],BREAD),z=i*.014)
        box('Butter pat',(0,0,.064),(.025,.028,.01),GLAZE,.005)
    elif kind=='iceCream':
        lathe('Waffle cone',[(0,0),(.032,.09),(0,.09)],BREAD,24)
        ellipsoid('Vanilla gelato',(0,0,.106),(.04,.04,.035),GLAZE,24,12)
    else:
        radius=.13 if kind=='cake' else .055
        for i in range(4):move(lathe('Cake layer',[(0,0),(radius,0),(radius,.023),(0,.023)],GLAZE if i%2 else BREAD),z=i*.025)
        ring('Piped frosting',(0,0,.106),radius*.9,.009,GLAZE)
        for i in range(6):
            a=i*math.tau/6;ellipsoid('Berries',(math.cos(a)*radius*.65,math.sin(a)*radius*.65,.12),(.011,.011,.013),TERRACOTTA,12,8)

def furniture(kind):
    if kind=='bookcase' or kind=='wall_shelf':
        width=.82;height=1.9
        for x in [-width/2,width/2]:box('Solid oak stile',(x,0,height/2),(.035,.29,height),WOOD)
        box('Inset back',(0,.135,height/2),(width,.02,height),LIGHTWOOD)
        for row in range(5):
            z=.12+row*.39;box('Shelf',(0,0,z),(width,.31,.035),WOOD)
            for j in range(9):
                h=.17+((j*3+row)%5)*.025;col=mat('book cloth '+str(j%4),[(.18,.27,.24),(.34,.18,.11),(.53,.44,.27),(.19,.22,.28)][j%4],.9)
                book=box('Cloth-bound volume',(-.34+j*.074,.015,z+h/2+.022),(.058,.19,h),col,.003)
                box('Spine title',(-.34+j*.074,-.083,z+h*.7),(.035,.002,.006),BRASS,.001)
    elif kind=='side_table':
        move(lathe('Bullnose table top',[(0,.46),(.23,.46),(.25,.48),(.25,.50),(0,.50)],LIGHTWOOD))
        for i in range(3):
            a=i*math.tau/3;tube('Splayed leg',[(math.cos(a)*.2,math.sin(a)*.2,0),(math.cos(a)*.15,math.sin(a)*.15,.47)],[.018,.025],WOOD)
    elif kind=='coat_rack':
        box('Oak peg rail',(0,0,.2),(.66,.055,.09),WOOD)
        for x in [-.25,-.125,0,.125,.25]:tube('Brass hook',[(x,-.03,.21),(x,-.09,.18),(x,-.1,.23)],.009,BRASS)
    elif kind=='trashcan':
        lathe('Ribbed bin',[(0,0),(.12,0),(.13,.38),(.12,.39),(.11,.37),(.10,.03),(0,.03)],DARK)
        for i in range(22):
            a=i*math.tau/22;tube('Bin flute',[(.12*math.cos(a),.12*math.sin(a),.03),(.128*math.cos(a),.128*math.sin(a),.36)],.003,DARK)
    elif kind=='crate':
        for z in [.035,.13,.23,.33]:
            for y in [-.19,.19]:box('Crate board',(0,y,z),(.48,.022,.065),LIGHTWOOD,.003)
            for x in [-.23,.23]:box('End slat',(x,0,z),(.022,.38,.065),LIGHTWOOD,.003)
        for x in [-.21,.21]:
            for y in [-.17,.17]:box('Crate corner',(x,y,.19),(.035,.035,.38),WOOD)
    elif kind=='painting':
        box('Oak frame',(0,0,.3),(.46,.035,.60),WOOD)
        box('Linen canvas',(0,-.022,.3),(.42,.009,.56),PAPER,.003)
        for i,(x,z,r) in enumerate([(-.10,.35,.09),(.06,.23,.12),(.12,.44,.055)]):
            o=ellipsoid('Abstract pigment',(x,-.030,z),(r,.003,r*1.25),[TERRACOTTA,GREEN,LIGHTWOOD][i],32,12)
    elif kind=='radio':
        box('Walnut radio cabinet',(0,0,.14),(.43,.20,.28),WOOD,.035)
        box('Speaker cloth',(-.08,-.105,.15),(.22,.01,.20),LINEN,.015)
        for z in [.08,.20]:ellipsoid('Tuning knob',(.13,-.12,z),(.026,.014,.026),BRASS,20,10)
        tube('Aerial',[(.17,.04,.27),(.19,.04,.38)],.003,STEEL)
    elif kind=='typewriter':
        box('Cast metal typewriter',(0,0,.05),(.30,.23,.09),DARK,.02)
        box('Platen',(0,.085,.10),(.28,.055,.05),WOOD,.018)
        for row in range(4):
            for col in range(10):ellipsoid('Ivory key',((col-4.5)*.023,-.085+row*.033,.096),(.009,.009,.004),GLAZE,10,6)
        box('Paper sheet',(0,.105,.18),(.2,.003,.15),PAPER,.001)
    elif kind=='lantern':
        lathe('Lantern base',[(0,0),(.09,0),(.09,.025),(0,.025)],DARK)
        for x,y in [(-.07,-.07),(.07,-.07),(-.07,.07),(.07,.07)]:tube('Lantern frame',[(x,y,.02),(x,y,.25)],.006,BRASS)
        box('Lantern canopy',(0,0,.25),(.18,.18,.03),DARK)
        tube('Carrying loop',[(-.045,0,.27),(-.045,0,.32),(.045,0,.32),(.045,0,.27)],.006,BRASS)
        move(lathe('Pillar candle',[(0,0),(.035,0),(.035,.13),(0,.13)],GLAZE),z=.025)
    elif kind=='teapot':
        lathe('Porcelain tea pot',[(0,0),(.04,0),(.075,.03),(.085,.08),(.07,.13),(.04,.15),(0,.15)],GLAZE)
        ellipsoid('Teapot lid',(0,0,.15),(.048,.048,.008),GLAZE);ellipsoid('Lid finial',(0,0,.17),(.012,.012,.015),WOOD)
        tube('Tea spout',[(.065,0,.065),(.10,0,.08),(.14,0,.14)],[.025,.018,.012],GLAZE,12)
        tube('Teapot handle',[(-.065,0,.12),(-.12,0,.14),(-.13,0,.05),(-.07,0,.035)],.009,WOOD,10)

BUILDERS={
 'studio_cup':lambda:cup(), 'cup':lambda:cup(), 'mug':lambda:cup(False,True),'latte':lambda:cup(True,True),
 'studio_chair':lambda:chair(),'bar_stool':lambda:chair(True),'armchair':lambda:chair(False,True),'sofa':sofa,
 'espresso_machine':espresso,'studio_espresso':espresso,'studio_pendant':pendant,'pendant_lamp':lambda:pendant('linen'),
 'floor_lamp':lambda:lamp(),'table_lamp':lambda:lamp(True),
}
for key in ['croissant','cake','cakeSlice','donut','muffin','cookie','cupcake','pancakes','apple','iceCream','sandwich']:BUILDERS[key]=lambda k=key:pastry(k)
for key in ['bookcase','wall_shelf','side_table','coat_rack','trashcan','crate','painting','radio','typewriter','lantern','teapot']:BUILDERS[key]=lambda k=key:furniture(k)
for key,kind in {'plant':'monstera','plant_small':'succulent','cactus_pot':'cacti','plant_monstera':'monstera','plant_snake':'snake','plant_pothos':'pothos','plant_pothos_vine':'vine','plant_fern':'fern','plant_succulent':'succulent','plant_cacti':'cacti','tree_park_a':'tree_a','tree_park_b':'tree_b'}.items():BUILDERS[key]=lambda k=kind:plant(k)

for name,builder in BUILDERS.items():
    reset();builder();export(name)
(SOURCE/'props-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
