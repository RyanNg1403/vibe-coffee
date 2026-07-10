# Immersion quality roadmap

The target is a polished, warm, semi-realistic café—not photorealism and not a
toy-like low-poly game. The scene should feel authored: every visible prop and
audible event should have a reason to be there.

## Completed in the immersion pass

- Indoor customers now use one coherent, smoother character language with richer
  faces, cloth detail, layered clothing and more natural proportions. The two
  textureless, faceted character models are no longer mixed into the room.
- Upholstery, rugs, tables and theme walls gained surface detail. Imported lounge
  seating is retinted into the café palette instead of keeping bright kit colors.
- Wood flooring, plaster and industrial painted concrete now use compact local CC0
  PBR diffuse, OpenGL normal and roughness maps rather than color noise alone.
- Table decoration uses four curated vignettes rather than unrelated random props.
- The four cafés now have distinct architectural treatments: timber display rail,
  tiled roastery service wall, and velvet acoustic panels.
- Crowd level follows actual occupancy. Typing and page sounds come from NPCs doing
  those activities; phantom chair scrapes were removed.
- Positional effects use HRTF. Synthetic room noise and record artifacts were
  reduced, and vinyl texture is now strongest only beside the visible turntable.
- The silent pour clip was replaced from its credited public-domain source and the
  barista timeline was synchronized with the grinder/steam/pour sequence.
- Seven CC0 instrumental recordings are bundled locally, loudness-normalized and
  streamed through per-café shuffle bags with crossfades. A twelve-arrangement
  generative engine remains as an automatic fallback.
- Foley, machinery and exterior sources have separate internal buses; grinder/steam
  activity ducks the music, café-specific room responses shape reverb, and footstep,
  clink and car-pass recordings use authored timing rather than arbitrary slices.

## Next: character production (highest visual impact)

Create a coherent set of 6–10 mid-poly café patrons sharing one skeleton. Each
character should have PBR skin, hair and fabric materials and these animation clips:

- idle breathing and weight shift
- walk, sit transition and seated idle
- talk/listen gestures
- type, read, phone and drink
- blink and subtle gaze saccades

Add explicit per-avatar material slots and per-seat pose offsets. Preserve the
existing `SkinnedAvatar` adapter so crowd behavior does not need to be rewritten.
Use procedural characters only as a distant fallback.

Acceptance target: no visible foot sliding, chair intersection or synchronized
idle loops; faces should remain readable at 1–4 metres without uncanny detail.

## Next: data-driven decorator

Extract decoration from `src/cafe.js` into per-location manifests with model,
position, rotation, scale, variant and collider fields. Build reusable authored
clusters rather than scattering independent props:

- laptop + half-finished latte
- book + reading glasses + tea
- conversation setting for two
- pastry service setup
- cleared table with reserved card
- counter prep, pickup and dirty-dish zones

Add a development-only placement mode using Three.js `TransformControls`, with an
export-to-JSON action. Seed vignette selection so a café remains visually stable
between reloads.

## Next: expand the recorded music library

The first ten credited recordings replace synthesis as the primary music source.
Expand that foundation toward 8–12 mastered tracks per café:

- Golden Hour: acoustic soul, gentle lo-fi, minimal piano, warm instrumental folk
- Roastery: bossa, Latin jazz, downtempo grooves, light swing
- Midnight: piano trio, brushed jazz, blues, ambient nocturnes

Keep the existing shuffle and crossfade behavior, then add ReplayGain-style loudness
metadata and diegetic speaker/turntable positioning with a quiet stereo safety feed.

## Next: authored foley and room acoustics

Replace multi-purpose or mismatched recordings with onset-trimmed variant pools:

- wood, tile/concrete and rug footsteps
- chair movement for each floor surface
- cup set-down, saucer, spoon, ceramic and glass variants
- card tap, POS beep, receipt printer and cash drawer
- grinder, tamp, portafilter lock, extraction, steam and milk pour phases

Use three measured or authored room impulse responses and separate crowd,
machinery, foley, weather and exterior buses. Normalize assets offline by category
using integrated loudness and true peak instead of forcing every sound toward the
same RMS.

## Next: architecture, exteriors and performance

- Give Golden Hour a bakery display and ceramic shelving, the Roastery a complete
  bean workflow, and Midnight a small stage plus acoustic treatment.
- Replace painted exterior planes with a lightweight layered street for parallax,
  glass reflections and believable passing traffic.
- Add Low/Medium/High presets for DPR, GTAO, shadow maps, light count and NPC detail.
- Add KTX2 textures and Meshopt/Draco before significantly increasing asset density.
