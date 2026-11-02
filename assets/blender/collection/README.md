# Café collections

This pass gives the four cafés distinct countertop displays, quieter furniture
finishes, fuller botanical shapes, and revised floor and garden materials.
It updates 21 prop and décor exports: nine furniture assets, eight plants, and
four new venue displays. The approved human and pet assets remain in the
[preceding realism collection](../realism/README.md).

## Editable sources

| Group | Source files | Contents |
| --- | --- | --- |
| Golden Hour | `atelier_decor_goldenhour.blend` | Ribbed thrown stoneware, dried branches, original botanical and sun prints, folded linen, scored bread, and ceramic coffee service |
| Roastery | `atelier_decor_roastery.blend` | Gusseted origin packets with labels and valves, bean canisters, copper filter stand, pleated dripper, carafe, scale, and original contour print |
| Midnight | `atelier_decor_midnight.blend` | Walnut turntable, tonearm, original jazz artwork and typography, amber lamp, and glazed vessel |
| Terrace | `atelier_decor_terrace.blend` | Named culinary herbs, terracotta pots, rattan weave, and propagation glass with roots |
| Furniture | `studio_chair.blend`, `bar_stool.blend`, `armchair.blend`, `sofa.blend`, `side_table.blend`, and four `atelier_tables_<venue>.blend` files | Satin timber, restrained board variation, and venue linen palettes; existing geometry, seating heights, and Golden Hour curtains retained |
| Botanicals | `plant.blend`, `plant_monstera.blend`, `plant_fern.blend`, `plant_pothos.blend`, `plant_pothos_vine.blend`, `plant_snake.blend`, `plant_succulent.blend`, `plant_small.blend` | Curved species-specific leaves, stems and midribs, hollow planters, soil and perlite, original color/normal atlases |
| Ground | `ground-materials.blend` | Matte floor color/roughness and original garden ground-cover color/normal fields |

The source scenes contain packed images. The daytime displays retain their
original procedural shading graphs beside the baked runtime materials. Shared
maps are also stored under `textures/` and `botanical-textures/` for inspection.
Studio study scenes are separate from the model exports.

## Placement and rendering

Blender sources use metres, Z-up, with the display front toward −Y. GLB export
converts this to Y-up and +Z. The countertop displays keep their authored scale
and ground origin, with bounds metadata used by the runtime support audit.
Golden Hour and Roastery are centered on local X/Y with base Z=0; their source
dimensions are respectively 1.5297 ×0.3670 ×0.7730 m and
1.5575 ×0.2970 ×0.6400 m (width, depth, height).

| Display | Source triangles | Materials | Source width ×depth ×height | Packed GLB |
| --- | ---: | ---: | --- | ---: |
| Golden Hour | 18,949 | 6 | 1.5297 ×0.3670 ×0.7730 m | 256.6 KiB |
| Roastery | 20,844 | 7 | 1.5575 ×0.2970 ×0.6400 m | 345.0 KiB |
| Midnight | 18,271 | 8 | 1.6448 ×0.3410 ×0.7705 m | 168.9 KiB |
| Terrace | 23,492 | 7 | 1.7060 ×0.3420 ×0.6935 m | 267.1 KiB |

The runtime places each display on an existing cabinet or bench. Midnight uses
uniform 0.8 scale; its record rotation is driven by the existing application
behavior. Its sideboard moves beside the bookcase at world X=8.18, Z=5.65,
clear of the booth and guest envelopes; the adjacent plant moves to the left
wall, with navigation colliders updated. Seat positions remain unchanged.
Glass uses transparent PBR materials with transmission disabled to
avoid an extra refraction pass. Opaque contents have separate geometry, and
glass does not cast an opaque shadow in the application.

Plant exports retain their previous normalized placement envelopes. Broad and
fleshy leaves have modeled thickness; small fern pinnae use curved double-sided
surfaces. No custom browser shader is required to display their color and normal
maps.

## Provenance

Display geometry, typography, botanical artwork, plant geometry, leaf maps,
ceramic/kraft/linen fields, and garden ground-cover fields are original project
artwork authored in Blender. These are designed real-time assets, not scans of
the depicted objects.

Two retained CC0 inputs contribute surface detail:

- [ambientCG Wood067](https://ambientcg.com/view?id=Wood067) supplies the scanned
  grain used by the quieter furniture timber maps and the walnut elements in
  the Midnight and Terrace displays.
- [ambientCG WoodFloor051](https://ambientcg.com/view?id=WoodFloor051) supplies
  the retained floor scan used by the matte floor color and roughness maps.

The original source files already exist in the project. Their derivatives keep
CC0 attribution in `tools/sound-credits.json` and the generated
[CREDITS.md](../../../CREDITS.md). The other new botanical and display textures
have no third-party image inputs.

## Reproduction

Run from the repository root with Blender 4.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/finish_cafe_materials.py -- --render
blender -b -t 2 --python-exit-code 1 --python tools/blender/build_collection_botanicals.py -- --render
blender -b -t 2 --python-exit-code 1 --python tools/blender/build_daytime_decor.py
blender -b -t 2 --python-exit-code 1 --python tools/blender/render_daytime_decor.py
blender -b -t 2 --python-exit-code 1 --python tools/blender/build_evening_garden_decor.py -- --render
blender -b -t 2 --python-exit-code 1 --python tools/blender/build_collection_ground.py
```

`VIBE_DECOR=goldenhour|roastery` limits daytime generation.
`VIBE_COLLECTION=midnight|terrace` limits evening/garden generation.
`VIBE_BOTANICAL=<asset-key>` limits botanical generation; `-- --render-only`
rebuilds its studio study from saved sources. The furniture script also supports
`-- --render-only` for its study.

These commands write source scenes and raw GLBs. Generate the manifest, then
pack only the 21 regenerated collection models so unrelated compressed assets
are preserved:

```sh
node tools/gen-manifest.mjs
collection_model_keys='studio_chair,bar_stool,armchair,sofa,side_table'
collection_model_keys="$collection_model_keys,atelier_tables_goldenhour,atelier_tables_roastery,atelier_tables_midnight,atelier_tables_terrace"
collection_model_keys="$collection_model_keys,plant,plant_monstera,plant_fern,plant_pothos,plant_pothos_vine,plant_snake,plant_succulent,plant_small"
collection_model_keys="$collection_model_keys,atelier_decor_goldenhour,atelier_decor_roastery,atelier_decor_midnight,atelier_decor_terrace"
node tools/pack-atelier-models.mjs --keys="$collection_model_keys" \
  --report=assets/blender/collection/runtime-report.json
npm run build
npm run artifact
```

When regenerating a smaller subset, pass only those regenerated keys to the
packer. Do not interpret raw GLB sizes in source reports as packed browser
transfer sizes. Application captures are a separate step documented in the
[collection proof guide](../../../docs/collection/README.md).

## Reports and proof

- [Daytime geometry and bounds](daytime-decor-report.json)
- [Current packed runtime library](runtime-report.json): 83 models, 25.76 MiB total
- [Read-only daytime source validation](daytime-source-validation.json)
- [Furniture material settings and retained geometry](furniture-material-report.json)
- [Botanical geometry and normalized footprint comparisons](botanical-report.json)
- [Independent botanical GLB validation](botanical-validation.json)
- [Evening and garden display report](evening-garden-report.json)
- [Floor and garden material provenance](ground-materials-report.json)
- [Application captures and Blender studio studies](../../../docs/collection/README.md)

Daytime source validation checks source triangle/material counts, centered
bounds, base height, packed 1024 color and 512 normal maps, retained procedural
materials, and unchanged source hashes after inspection. The source report also
identifies the GLB snapshots used to check transparent material settings.
The daytime generation report additionally checks actual bean vertices: the
top beans protrude above and overlap their fill cap, wall beans extend beyond
the fill core, and every bean retains radial clearance inside its glass jar.
