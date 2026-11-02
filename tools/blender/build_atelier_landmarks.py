"""Blender-authored street architecture, cars, piano and roasting equipment."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import atelier_common
from atelier_common import *

def car():
    paint=mat('automotive enamel',(.09,.16,.17),.24,.35)
    glass=mat('automotive smoked glass',(.035,.075,.09),.19,.25)
    tyre=mat('tyre rubber',(.012,.014,.014),.94)
    box('Rounded unibody',(0,0,.59),(3.45,1.48,.48),paint,.16)
    box('Lower rocker',(0,0,.33),(3.27,1.42,.15),DARK,.04)
    verts=[(-1.04,-.66,.78),(.91,-.66,.78),(.91,.66,.78),(-1.04,.66,.78),(-.71,-.55,1.27),(.43,-.55,1.27),(.43,.55,1.27),(-.71,.55,1.27)]
    cabin=mesh('Curved passenger glazing',verts,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],glass)
    bevel=cabin.modifiers.new('Window edge radii','BEVEL');bevel.width=.04;bevel.segments=3;bpy.context.view_layer.objects.active=cabin;bpy.ops.object.modifier_apply(modifier=bevel.name)
    box('Floating roof',(-.14,0,1.29),(1.22,1.16,.065),paint,.025)
    for side in [-1,1]:
        for x in [-1.12,1.12]:
            o=lathe('Rounded tyre',[(0,-.10),(.23,-.10),(.29,-.07),(.30,0),(.29,.07),(.23,.10),(0,.10)],tyre,32);o.rotation_euler.x=math.pi/2;o.location=(x,side*.70,.30)
            o=lathe('Alloy hub',[(0,0),(.17,0),(.18,.015),(0,.015)],STEEL,20);o.rotation_euler.x=side*math.pi/2;o.location=(x,side*.81,.30)
        for x in [-.48,.42]:box('Flush door handle',(x,side*.748,.72),(.18,.012,.025),STEEL,.009)
        tube('Door seam',[(-.35,side*.748,.40),(-.35,side*.748,.77)],.003,DARK,5)
        box('Side mirror',(.54,side*.77,.98),(.19,.14,.10),paint,.04)
        box('LED headlight',(1.73,side*.48,.64),(.02,.38,.09),GLAZE,.025)
        box('Rear lamp',(-1.73,side*.48,.64),(.02,.36,.08),TERRACOTTA,.02)
    box('Front grille',(1.73,0,.48),(.025,.73,.12),DARK,.012)
    for y in [-.25,-.15,-.05,.05,.15,.25]:box('Grille blade',(1.75,y,.48),(.01,.02,.10),STEEL,.002)

def piano():
    lacquer=mat('piano satin lacquer',(.023,.018,.016),.29)
    box('Upright piano cabinet',(0,.05,.77),(1.52,.46,1.35),lacquer,.035)
    box('Upper panel',(0,-.195,1.07),(1.36,.035,.57),WOOD,.016)
    box('Keyboard case',(0,-.29,.79),(1.60,.45,.09),lacquer,.025)
    for i in range(36):box('Ivory piano key',((i-17.5)*.041,-.365,.845),(.039,.30,.025),GLAZE,.002)
    for i in range(35):
        if i%7 not in [2,6]:box('Ebony piano key',((i-17)*.041,-.28,.867),(.022,.19,.035),DARK,.002)
    box('Music stand',(0,-.24,1.16),(.70,.035,.34),lacquer,.015)
    box('Open score',(0,-.262,1.18),(.56,.003,.28),PAPER,.001)
    for i in range(10):tube('Music staff',[(-.25,-.266,1.09+i*.018),(.25,-.266,1.09+i*.018)],.0008,DARK,4)
    for x in [-.10,0,.10]:box('Brass pedal',(x,-.30,.12),(.05,.19,.022),BRASS,.008)
    box('Padded piano bench',(0,-.88,.46),(.74,.34,.09),LINEN,.035)
    for x in [-.27,.27]:
        for y in [-1,-.76]:tube('Bench leg',[(x,y,.015),(x,y,.43)],.023,WOOD)

def roaster():
    box('Roaster base',(0,0,.25),(.74,.78,.46),DARK,.05)
    shell=lathe('Copper roasting drum',[(0,0),(.43,0),(.46,.06),(.46,.70),(.43,.76),(0,.76)],DARK,48);shell.rotation_euler.y=math.pi/2;shell.location=(-.38,0,.97)
    plate=lathe('Brass drum face',[(0,0),(.42,0),(.42,.035),(0,.035)],BRASS,48);plate.rotation_euler.y=math.pi/2;plate.location=(.39,0,.97)
    for a in [i*math.tau/12 for i in range(12)]:ellipsoid('Drum fastener',(.43,math.cos(a)*.37,.97+math.sin(a)*.37),(.014,.014,.014),STEEL,10,6)
    glass=mat('Roaster gauge glass',(.07,.12,.13),.19)
    ellipsoid('Inspection window',(.435,-.16,1.06),(.015,.07,.07),glass,20,10)
    tube('Sample trier',[(.43,.14,.95),(.62,.14,.95)],.017,WOOD,10)
    move(lathe('Charging hopper',[(.09,0),(.09,.08),(.28,.35),(.29,.39),(.27,.39),(.08,.08)],STEEL,32),z=1.43)
    tube('Exhaust run',[(-.30,.20,1.28),(-.30,.20,1.8),(-.55,.20,1.95),(-.55,.20,3.15)],.09,DARK,16)
    for z in [2.05,2.8]:ring('Flue collar',(-.55,.20,z),.095,.013,STEEL)
    box('Control panel',(.1,-.48,1.03),(.33,.13,.34),DARK,.025)
    for x in [0,.1,.2]:ellipsoid('Roaster control',(x,-.55,1.05),(.02,.01,.02),BRASS,16,8)

def street():
    plaster=mat('warm limestone facade',(.47,.43,.35),.9);brick=mat('fired brick facade',(.29,.15,.10),.92);trim=mat('limestone mouldings',(.63,.59,.50),.85)
    glass=mat('deep blue storefront glass',(.045,.09,.11),.22,.25)
    for i in range(7):
        x=-18+i*5.8;h=[7.2,6.5,8.1][i%3];front=-15.35
        box('Masonry building',(x,front-1.2,h/2),(5.6,2.4,h),brick if i%2 else plaster,.045)
        for z in [.18,2.45,h-.2,h+.02]:box('Projecting stone course',(x,front+.035,z),(5.72,.18,.12),trim,.02)
        for side in [-1,1]:box('Facade pilaster',(x+side*2.66,front+.045,h/2),(.14,.15,h-.2),trim,.015)
        for row in range(3):
            for col in range(4):
                wx=x+(col-1.5)*1.22;z=3.05+row*1.5
                if z+.6>h:continue
                box('Recessed window',(wx,front+.045,z),(.72,.06,1.05),glass,.012)
                for dx in [-.40,.40]:box('Stone window jamb',(wx+dx,front+.09,z),(.08,.16,1.2),trim,.012)
                for dz in [-.59,.59]:box('Window lintel',(wx,front+.1,z+dz),(.90,.20,.08),trim,.012)
                box('Window mullion',(wx,front+.09,z),(.025,.035,1.08),WOOD,.002)
                box('Window transom',(wx,front+.09,z),(.77,.035,.035),WOOD,.002)
        for col in range(3):
            sx=x+(col-1)*1.55;box('Shopfront glazing',(sx,front+.06,1.2),(1.35,.07,1.96),glass,.015)
            for side in [-1,1]:box('Shopfront oak frame',(sx+side*.7,front+.13,1.2),(.07,.12,2.07),WOOD,.01)
        box('Shop signboard',(x,front+.14,2.16),(4.9,.15,.24),DARK,.02)
        awning=box('Canvas awning',(x,front+.50,2.43),(5.05,.95,.06),LINEN,.018);awning.rotation_euler.x=.14
        box('Awning valance',(x,front+.94,2.30),(5.05,.04,.17),LINEN,.012)

for name,builder in [('atelier_car',car),('atelier_piano',piano),('atelier_roaster',roaster),('atelier_streetscape',street)]:
    atelier_common.BOX_SEGMENTS=1 if name=='atelier_streetscape' else 3
    reset();builder();export(name)
(SOURCE/'landmarks-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
