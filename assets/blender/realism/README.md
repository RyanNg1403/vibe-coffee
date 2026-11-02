# Architectural realism pass

The subsequent [café collection sources](../collection/README.md) add themed
displays, furniture finishes, and botanicals. This guide retains the source and
validation record for the earlier realism pass.

These editable Blender scenes supply the current character refits, rebuilt
pets, furniture materials, and floor contact shading. The reference is warm architectural
photography: natural daylight, restrained walnut grain, linen, stone, and small
finish variations.

## Source files

| Files | Contents |
| --- | --- |
| `char_atelier_1.blend` through `char_atelier_18.blend` | Eighteen patron variants from two source anatomical bases, with preserved face, hair, and clothing atlases |
| `char_atelier_barista.blend`, `char_atelier_server.blend` | Male barista and female server refits with modeled, skinned canvas aprons |
| `pet_cat.blend`, `pet_dog.blend` | Continuous pet meshes, modeled face and paw details, original procedural fur shaders, packed coat maps, and articulated rigs |
| `pet-textures/` | Original Blender coat bakes, also packed into each pet source |
| `architectural-materials.blend` | Editable walnut, linen, and stone materials, packed maps, study spheres, and HDR environment |
| `contact-<venue>.blend` | Four floor contact bake scenes using café layouts and furniture geometry |
| `atelier_tables_goldenhour.blend` | Golden Hour furniture assembly with six linen curtain panels, bronze rods and rings, and sewn hems |
| `furniture-study.blend` | Blender studio proof of furniture joinery, upholstery, and edge treatment |
| Other `.blend` files | Existing Blender props refined with the architectural materials |
| `courtyard-compact.hdr` | Blender-resampled environment for the portable HTML export |

The people retain anatomy, UV atlases, skin weights, and walk motion from the
project's CC0 `char_hero_female` and `char_hero_male` assets by suhakiylioglu / Meshy.
Blender removes helper geometry, reduces the meshes, introduces restrained
facial and garment variants, and authors café poses. The seated pose uses a
leg-length-preserving IK solve. All twenty exports have 24-joint rigs and five
looping actions: `Idle`, `Walk`, `Working`, `Wave`, and `Sitting`.
The eighteen patron profiles vary facial proportions, hair color, garment
palettes, skin appearance, glasses, knit hats, caps, and hair buns. Female hair
retains the source strand geometry; male crop and sweep treatments make modest
mesh changes.
`portrait_variations.py` repaints semantic atlas regions while preserving source
detail; `portrait_accessories.py` creates the rigged accessories. Each portrait
uses a shared atlas across its region-specific materials. Anatomical bounds
recorded before accessories keep hats and hair additions from shrinking the
body during runtime normalization. These are variants of
two source people, not independent scans.

The cat and dog are original Blender models with continuous body surfaces,
articulated upper and lower legs and paws, separate neck, head, ear, eye, and
tail joints, plus modeled muzzle, whisker, and paw details. Each uses a 22-joint
rig and eight editable actions: `idle`, `idle_2`, `idle_2_headlow`, `idle_eating`,
`eating`, `walk`, `headbutt`, and the legacy `death` action used for a low
resting crouch with planted paws.
`realism_pet_fur.py` authors the coat shaders and bakes 1024px color plus 512px
normal maps; `realism_pet_rig.py` supplies the gait and held poses. The procedural
shaders and packed bakes remain in each editable source. No external pet meshes
or textures are used. `cat.glb` is the legacy alias of `pet_cat.glb`.

Walnut color derives from the retained ambientCG Wood067 texture. Linen and
stone fields, fine normal variation, finish roughness, and floor contact bakes
are authored in Blender. The HDR environment is the CC0 *Venice Sunset* asset
from Poly Haven / HDRI Haven, obtained from the Three.js examples collection.
See [CREDITS.md](../../../CREDITS.md) for source links and licenses.

## Reproduce

Run from the repository root with Blender 4.3, Node 24, and FFmpeg installed.
The checked-in `rebuild/*.blend` files are inputs to the furniture refinement
and contact bake steps. The source character GLBs and environment are also
checked in, so these commands do not download assets.

```sh
npm install
node tools/export-atelier-layouts.mjs
node tools/prepare-realism-sources.mjs
blender -b -t 4 --python-exit-code 1 --python tools/blender/build_realism_people.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/build_realism_pets.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/build_realism_surfaces.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/refine_realism_props.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/add_realism_drapery.py -- --export
blender -b -t 4 --python-exit-code 1 --python tools/blender/polish_realism_furniture.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/polish_realism_decor.py
blender -b -t 4 --python-exit-code 1 --python tools/blender/bake_realism_contact.py
node tools/gen-manifest.mjs
node tools/pack-atelier-models.mjs
npm test
npm run build
npm run artifact
```

The furniture polish step preserves the layout footprints and existing curtains
while adding rounded bentwood edges, grain aligned along legs, flush joinery
dowels, cushion seams and piping, turned leg collars, floor glides, and recessed
table undersides. It updates the standard chair, bar stool, armchair, sofa, side
table, and all four table assemblies. Add `-- --render` to that command to
recreate the Blender furniture study. The decor polish step updates 43 assets
with details including rolled cup lips and feet, ceramic clearcoat, a recessed
teapot mouth, espresso-machine gauge graduations and fascia fasteners, and
restrained leaf, crust, and terracotta color variation. Tagged additions make
these polishing steps repeatable without duplicating their geometry.

The pet generator accepts `VIBE_PET=cat` or `dog` to rebuild one species.
`tools/blender/render_realism_pets.py` renders the editable sources in a neutral
Blender studio, with standing and resting views.

The source decoder writes temporary, uncompressed GLBs to
`/tmp/vibe-realism-input/` for Blender's importer. Packed images remain in the
saved `.blend` files. `VIBE_CHARACTER=1` through `18` can limit character generation
to one patron while iterating. `VIBE_CHARACTER=barista` or `server` regenerates
only that staff variant. Omit the variable to regenerate the complete cast.
The generator purges unused datablocks before saving; existing sources can be
cleaned with `tools/blender/clean_realism_sources.py`, which verifies retained
scene objects, textures, actions, rig bones, and authored shader graphs before
saving. Materials explicitly retained with a Blender fake user are preserved,
including the original procedural pet coat shaders.

The asset packer retains 1024px human atlases and pet coat color maps, 512px
pet normal maps, and up to 512px prop maps, then applies Meshopt compression
without upscaling images. For a pet-only iteration, use
`node tools/pack-atelier-models.mjs --keys=pet_cat,pet_dog,cat` to preserve the
other packed assets. Supporting surface and contact maps are 1024px in
the full app. The standalone export separately reduces character maps to 384px,
prop and tiled material maps to 256px, contact maps to 512px, and the HDR to
512×256. It also simplifies character meshes within a 0.8% relative error budget
and props within a 0.2% budget, then removes redundant animation keys. Editable
sources and full app assets are unchanged by that export. The portable HTML also losslessly compresses its
embedded asset table and requires a modern browser with native
`DecompressionStream` support; decompression happens locally without a network
request. Portable audio is encoded as 48 kbps Opus; sound effects retain their
full duration and music excerpts remain 45 seconds. The full application audio
and model assets are not changed by this export.

`people-report.json`, `pets-report.json`, and `props-report.json` describe Blender exports before
runtime packing. [The runtime report](runtime-report.json) records
compressed model sizes and triangle counts. [Pet source validation](pets-source-validation.json)
checks retained shader graphs, packed images, rig and clip contracts, and
unchanged source hashes during inspection. [Application captures](../../../docs/realism/README.md)
show the models with the browser's lighting and rendering pipeline.
