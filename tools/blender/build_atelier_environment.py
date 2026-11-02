"""Blender furniture assemblies follow the application's exact navigation blueprints."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from atelier_common import *
layouts=json.loads((SOURCE/'layouts.json').read_text())
for venue,layout in layouts.items():
    reset()
    for t in layout['tables']:
        if t.get('isBar'):continue
        before=set(bpy.context.scene.objects)
        h=t['surfaceY']-t.get('baseY',0)
        shape=t['shape'];w=t.get('width',t.get('rx',t.get('radius',.6))*2);d=t.get('depth',t.get('rz',t.get('radius',.6))*2)
        # Countertop height matches the physical support plane exactly.
        if shape in ['disc','circle','round','ellipse','oval']:
            r=t.get('radius',1);rx=t.get('rx',r);ry=t.get('rz',r)
            o=lathe('Bullnose solid oak top',[(0,h-.055),(.98,h-.055),(1,h-.045),(1,h-.014),(.985,h),(0,h)],LIGHTWOOD,64);o.scale=(rx,ry,1)
            for x in ([-rx*.4,rx*.4] if rx>1 else [0]):
                tube('Fluted pedestal',[(x,0,.06),(x,0,h-.04)],[.075,.06],WOOD,16)
                move(lathe('Weighted pedestal foot',[(0,0),(.25,0),(.26,.018),(.21,.04),(0,.04)],DARK,32),x=x)
                for j in range(16):
                    a=j*math.tau/16;tube('Pedestal flute',[(x+.072*math.cos(a),.072*math.sin(a),.07),(x+.058*math.cos(a),.058*math.sin(a),h-.08)],.004,WOOD,5)
        else:
            box('Solid oak table slab',(0,0,h-.03),(w,d,.06),LIGHTWOOD,.028)
            for x in [-w/2+.08,w/2-.08]:
                for y in [-d/2+.09,d/2-.09]:tube('Tapered furniture leg',[(x*1.02,y*1.02,.012),(x,y,h-.04)],[.025,.037],WOOD,12)
            for y in [-d/2+.10,d/2-.10]:box('Joinery apron',(0,y,h-.09),(w-.10,.035,.10),WOOD)
            if t.get('archetype')=='writing':
                box('Desk drawer',(0,-d/2+.06,h-.105),(w*.60,.065,.10),WOOD)
                tube('Brass drawer pull',[(-.07,-d/2+.015,h-.10),(.07,-d/2+.015,h-.10)],.006,BRASS)
        angle=t.get('rotation',0)
        for o in set(bpy.context.scene.objects)-before:
            x,y=o.location.x,o.location.y;o.location.x=math.cos(angle)*x-math.sin(angle)*y+t['center']['x'];o.location.y=math.sin(angle)*x+math.cos(angle)*y-t['center']['z'];o.location.z+=t.get('baseY',0);o.rotation_euler.z+=angle
    export('atelier_tables_'+venue)
(SOURCE/'environment-report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
