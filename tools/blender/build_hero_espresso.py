"""Hero two-group espresso machine (studio_espresso).

Blender metres, Z up, customer-facing front toward -Y (glTF +Z). The flat
cup-warmer plate is the highest surface: the application stages cups on it.
The former `espresso_machine` key duplicated this model as an unreachable
fallback (src/cafe.js prefers studio_espresso) and is no longer exported.

    blender -b -t 8 --python-exit-code 1 --python tools/blender/build_hero_espresso.py
"""
import bpy, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import hero_common as H

H.reset()
STEEL = H.brushed_metal('brushed stainless', (0.66, 0.66, 0.67), rough=0.24, axis='X')
STEEL_V = H.brushed_metal('brushed stainless vertical', (0.64, 0.64, 0.65), rough=0.27, axis='Z')
CHROME = H.polished_metal('polished chrome', (0.86, 0.86, 0.87), rough=0.06)
BLACK = H.powder_coat('satin black powder coat', (0.022, 0.022, 0.024), rough=0.5)
GLOSS_BLACK = H.matte('gloss black button', (0.015, 0.015, 0.016), rough=0.12)
WALNUT = H.walnut('oiled walnut', axis='Y')
WALNUT_HANDLE = H.walnut('oiled walnut handle', axis='Y', scale=2.5)
RUBBER = H.matte('rubber', (0.018, 0.018, 0.018), rough=0.92, grain=0.05)
ENAMEL = H.glaze('gauge enamel', (0.86, 0.84, 0.79), rough=0.08)
INK = H.matte('gauge ink', (0.02, 0.02, 0.02), rough=0.4)
NEEDLE = H.matte('gauge needle', (0.62, 0.05, 0.03), rough=0.35)
BRASS = H.brushed_metal('brushed brass', (0.78, 0.56, 0.28), rough=0.3, axis='X')
AMBER = H.glaze('amber lens', (0.95, 0.48, 0.06), rough=0.05)
PERF = H.perforated('perforated cup warmer', (0.64, 0.64, 0.65), rough=0.28, pitch=110)

parts = []
add = parts.append

TOP = 0.50
FRONT = -0.14          # brew-area backsplash
HOOD = -0.165          # upper fascia front face
GROUPS = (-0.15, 0.15)

# chassis -------------------------------------------------------------------
for x in (-0.28, 0.28):
    for y in (-0.07, 0.20):
        add(H.cylinder('Adjustable chrome foot', (x, y, 0.017), 0.017, 0.026, CHROME, verts=16))
        add(H.cylinder('Foot rubber pad', (x, y, 0.002), 0.019, 0.004, RUBBER, verts=16, bevel_width=0))
add(H.box('Powder-coated plinth', (0, 0.06, 0.052), (0.62, 0.40, 0.046), BLACK, radius=0.006))
add(H.box('Stainless body shell', (0, 0.06, 0.29), (0.63, 0.40, 0.40), STEEL_V, radius=0.012, segments=3))
add(H.box('Brew-area backsplash', (0, FRONT + 0.004, 0.225), (0.56, 0.012, 0.26), BLACK, radius=0.003))
add(H.box('Upper fascia hood', (0, HOOD + 0.02, 0.425), (0.63, 0.04, 0.12), STEEL, radius=0.008, segments=4))
add(H.box('Hood underside trim', (0, HOOD + 0.02, 0.362), (0.60, 0.035, 0.008), CHROME, radius=0.003))
for side in (-1, 1):
    add(H.box('Oiled walnut side panel', (side * 0.3275, 0.05, 0.285), (0.026, 0.43, 0.43), WALNUT, radius=0.009, segments=4))
    for z in (0.12, 0.45):
        add(H.cylinder('Panel brass fixing', (side * 0.341, -0.13, z), 0.005, 0.003, BRASS, verts=12, axis='X', bevel_width=0))
        add(H.cylinder('Panel brass fixing', (side * 0.341, 0.23, z), 0.005, 0.003, BRASS, verts=12, axis='X', bevel_width=0))

# cup warmer: flat top plate at the model's highest point, framed by a rail
add(H.box('Perforated cup-warmer plate', (0, 0.06, TOP - 0.006), (0.585, 0.37, 0.012), PERF, radius=0.002, segments=2))
rail_z = TOP - 0.006
rail = [(-0.3, -0.125, rail_z), (0.3, -0.125, rail_z), (0.3, 0.245, rail_z), (-0.3, 0.245, rail_z), (-0.3, -0.125, rail_z)]
add(H.tube('Cup-warmer gallery rail', rail, 0.006, CHROME, sides=12, caps=False))

# gauges, controls and badge on the hood -------------------------------------
def gauge(x, z, label_angle):
    y = HOOD - 0.002
    add(H.torus('Gauge chrome bezel', (x, y - 0.004, z), 0.031, 0.0045, CHROME, 40, 8, axis='Y'))
    add(H.cylinder('Gauge enamel face', (x, y - 0.002, z), 0.029, 0.004, ENAMEL, verts=40, axis='Y', bevel_width=0))
    for i in range(13):
        a = math.radians(225 - i * 22.5)
        r = 0.022
        long = i % 3 == 0
        tick = H.box('Gauge graduation', (x + r * math.cos(a), y - 0.0046, z + r * math.sin(a)),
                     (0.0012, 0.0006, 0.0065 if long else 0.0038), INK, radius=0)
        tick.rotation_euler = (0, -(a - math.pi / 2), 0)
        add(tick)
    needle = H.box('Gauge needle', (x, y - 0.0052, z), (0.0016, 0.0006, 0.021), NEEDLE, radius=0)
    needle.data.transform(__import__('mathutils').Matrix.Translation((0, 0, 0.008)))
    needle.rotation_euler = (0, label_angle, 0)
    add(needle)
    add(H.cylinder('Gauge hub', (x, y - 0.006, z), 0.0028, 0.002, INK, verts=16, axis='Y', bevel_width=0))

gauge(-0.15, 0.43, math.radians(-25))
gauge(0.15, 0.43, math.radians(35))

badge_y = HOOD - 0.002
add(H.box('Brushed brass badge', (0, badge_y - 0.002, 0.437), (0.13, 0.004, 0.034), BRASS, radius=0.0015, segments=2))
add(H.text_mesh('Badge lettering', 'VIBE  DUE', (0, badge_y - 0.0042, 0.437), 0.016, 0.0006, INK))
add(H.cylinder('Amber power lamp bezel', (0, badge_y - 0.002, 0.392), 0.007, 0.004, CHROME, verts=24, axis='Y', bevel_width=0.001))
add(H.lathe('Amber power lamp lens', [(0.0055, 0), (0.0052, 0.002), (0.0035, 0.0042), (0.0, 0.005)], AMBER, verts=24,
            center=(0, badge_y - 0.004, 0.392), axis='Y'))

for gx in GROUPS:
    for i, dx in enumerate((-0.036, -0.012, 0.012, 0.036)):
        add(H.cylinder('Dosing button collar', (gx + dx, HOOD - 0.002, 0.381), 0.0085, 0.003, CHROME, verts=16, axis='Y', bevel_width=0))
        add(H.cylinder('Dosing button', (gx + dx, HOOD - 0.005, 0.381), 0.0062, 0.004, GLOSS_BLACK, verts=16, axis='Y', bevel_width=0.0015, segments=1))

# steam valves and wands, hot-water tap ------------------------------------------
for side in (-1, 1):
    x = side * 0.262
    add(H.cylinder('Steam valve stem', (x, HOOD - 0.012, 0.415), 0.006, 0.024, CHROME, verts=20, axis='Y'))
    knob = H.lathe('Walnut steam knob', [(0.0, 0.0), (0.016, 0.0), (0.019, 0.006), (0.0195, 0.02), (0.017, 0.028), (0.009, 0.032), (0.0, 0.0325)],
                   WALNUT_HANDLE, verts=40, center=(x, HOOD - 0.024, 0.415), axis='Y')
    add(knob)
    path = [(x, FRONT - 0.002, 0.33), (x, -0.175, 0.33), (x, -0.19, 0.326)]
    path += H.arc_points((x + side * 0.0, -0.19, 0.30), 0.026, math.pi / 2, math.pi * 1.15, 6, plane='YZ')[1:]
    end = path[-1]
    path += [(end[0] + side * 0.012, end[1] - 0.012, 0.20), (end[0] + side * 0.02, end[1] - 0.02, 0.15)]
    add(H.tube('Steam wand', path, 0.0055, CHROME, sides=12))
    add(H.cylinder('Steam wand ball joint', (x, -0.19, 0.326), 0.011, 0.018, CHROME, verts=24, axis='X', bevel_width=0.004, segments=3))
    tip = path[-1]
    add(H.cylinder('Steam tip', (tip[0], tip[1], tip[2] - 0.008), 0.0065, 0.018, CHROME, verts=20, bevel_width=0.0015))
    add(H.tube('Wand cool-touch sleeve', [(path[-3][0], path[-3][1], path[-3][2] - 0.01), (path[-2][0], path[-2][1], path[-2][2])],
               0.0085, RUBBER, sides=16))
add(H.tube('Hot-water spout', [(0, FRONT - 0.002, 0.30), (0, -0.172, 0.30), (0, -0.185, 0.292), (0, -0.19, 0.25)], 0.006, CHROME))
add(H.cylinder('Hot-water nozzle', (0, -0.19, 0.245), 0.008, 0.014, CHROME, verts=20))

# group heads and portafilters --------------------------------------------------
for gx in GROUPS:
    add(H.cylinder('Group neck', (gx, -0.165, 0.315), 0.03, 0.05, CHROME, verts=40, axis='Y', bevel_width=0.003))
    head = H.lathe('E61-style group head', [
        (0.0, 0.262), (0.044, 0.262), (0.047, 0.268), (0.047, 0.29), (0.042, 0.296), (0.042, 0.315),
        (0.036, 0.322), (0.036, 0.334), (0.026, 0.342), (0.012, 0.346), (0.0, 0.347)],
        CHROME, verts=48, center=(gx, -0.205, 0))
    add(head)
    add(H.tube('Brew lever', [(gx, -0.205, 0.346), (gx, -0.215, 0.36), (gx, -0.245, 0.372)], 0.0042, CHROME, sides=12))
    add(H.lathe('Brew lever knob', [(0, 0), (0.008, 0.002), (0.0095, 0.012), (0.007, 0.022), (0, 0.024)], BLACK, verts=24,
                center=(gx, -0.245, 0.366)))
    add(H.torus('Group gasket', (gx, -0.205, 0.2615), 0.04, 0.003, RUBBER, 32, 6))
    basket = H.lathe('Portafilter basket', [
        (0.0, 0.222), (0.03, 0.222), (0.036, 0.226), (0.039, 0.236), (0.041, 0.255), (0.045, 0.256), (0.045, 0.261), (0.0, 0.261)],
        CHROME, verts=48, center=(gx, -0.205, 0))
    add(basket)
    for ear in (-1, 1):
        add(H.box('Bayonet ear', (gx + ear * 0.048, -0.205, 0.258), (0.012, 0.016, 0.005), CHROME, radius=0.0015, segments=2))
    for sx in (-0.012, 0.012):
        add(H.tube('Twin spout', [(gx, -0.205, 0.222), (gx + sx * 0.6, -0.205, 0.214), (gx + sx, -0.205, 0.204)], 0.0045, CHROME, sides=12))
    hx = gx * 1.12
    handle_path = [(gx, -0.243, 0.244), (hx, -0.27, 0.240), (hx * 1.02, -0.30, 0.234), (hx * 1.04, -0.34, 0.226), (hx * 1.05, -0.37, 0.221)]
    add(H.tube('Portafilter neck', handle_path[:2], 0.0075, CHROME, sides=16))
    add(H.tube('Walnut portafilter handle', handle_path[1:], [0.011, 0.013, 0.012, 0.0095], WALNUT_HANDLE, sides=20))
    add(H.torus('Handle ferrule', handle_path[1], 0.0115, 0.0018, CHROME, 20, 6, axis='Y'))

# drip tray --------------------------------------------------------------------
add(H.box('Drip tray body', (0, -0.2, 0.085), (0.6, 0.17, 0.03), STEEL, radius=0.005))
add(H.box('Drip tray recess', (0, -0.2, 0.0995), (0.57, 0.15, 0.002), BLACK, radius=0))
for i in range(27):
    x = -0.273 + i * 0.021
    add(H.box('Drip grate bar', (x, -0.2, 0.103), (0.009, 0.15, 0.006), STEEL, radius=0.0012, segments=1))
add(H.box('Drip tray pull lip', (0, -0.287, 0.085), (0.16, 0.006, 0.012), CHROME, radius=0.002, segments=2))

H.apply_all(parts)
machine = H.join(parts, 'studio_espresso')
print('ESPRESSO_SOURCE_TRIANGLES', H.triangles(machine), flush=True)
H.bake_atlas(machine, 'espresso', size=2048, out_size=1024)
H.export([machine], 'studio_espresso')
