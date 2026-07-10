# vibe coffee ☕

A small corner of the internet that feels like your favourite café.

A local 3D coffee-shop simulator for studying and working — inspired by those
YouTube "café ambience" videos, except here you're *inside* the café: pick a
seat, look around, listen to the room, and get things done.

![vibe coffee](https://img.shields.io/badge/vibe-immaculate-c98e4e)

## Features

- **Four spacious locations**, each with its own light, layout, signature decor and mood:
  - 🌅 **Golden Hour Café** — warm wood, exposed ceiling beams, hanging plants,
    string lights, sunbeams full of dust
  - 🏙️ **Downtown Roastery** — concrete and steel, ductwork, a big corner coffee
    roaster with burlap bean sacks, Edison bulbs, a ceiling fan
  - 🌧️ **Midnight Jazz Corner** — rain on the glass, candlelit tables, a wall of
    books, a spinning vinyl record, a neon glow
  - 🌿 **Garden Terrace** — an open-air pergola, climbing plants, sun-warmed
    paving and outdoor café life
  - Switch each location's time-of-day or weather variant from the location HUD
  - ...and in every café: a working wall clock, wall art, sconces, a chalkboard
    sign, and a cat asleep on the rug
- **Sit anywhere, or walk around** — click any free chair or window stool to move there,
  drag to look around, or press **WASD** to stand up and stroll through the café
  (with real collision against tables and the counter)
- **A living café** — up to ~18 customers with faces, glasses, beanies and varied
  builds walk in (door chime included), join the queue (half of them on their phones),
  order at the register, wait at pickup while the barista actually brews their drink,
  then settle in with a laptop, a book, or their phone — sipping, stretching, people-
  watching. Pairs arrive together and chat, taking turns talking and nodding. Walkers
  steer around each other, and pedestrians pass by outside the windows (with umbrellas
  when it rains)
- **Recorded, locally bundled café playlists** — ten credited instrumental
  recordings cover warm lo-fi, bossa nova, lounge jazz, guitar jazz and ambient
  piano. Per-café shuffle bags prevent immediate repeats, 4–7 second crossfades keep
  location changes natural, and the HUD identifies the current track and artist.
  A twelve-arrangement generative engine remains as an automatic fallback when media
  playback is unavailable, including a live Karplus-Strong plucked string
- **Real recorded café sound, positioned in 3D — and different in every café** — 20
  Creative-Commons / public-domain field recordings (see `CREDITS.md`): each location
  mixes its own crowd (relaxed walla at golden hour, a genuinely busy room downtown, a
  hushed late-night lounge at midnight) with its own street level, footstep character,
  crowd tone and pacing. Plus espresso grinding, milk steaming, cup clinks, footsteps,
  a shop door bell, a cash register, rain on the window, day & night street traffic,
  and single cars that audibly drive past outside.
  A procedural convolution reverb puts every sound in the room, and 3D panning puts it
  in its *place* — the machine sounds come from the counter, typing from the actual
  laptop users, page turns only come from readers, and footsteps come from whoever is
  walking past you. Indoor effects use HRTF spatialization, and recorded crowd level
  follows the actual room occupancy instead of an unrelated event timer. Every recording has a
  synthesized fallback, so the app still works fully offline/asset-free
- **Focus timer** — a built-in 25/5 pomodoro with a gentle chime
- **Order from your table** — request a drink and watch the barista prepare and
  deliver it into the scene

The rooms combine procedural geometry and canvas textures with locally bundled,
credited CC/public-domain models and field recordings. No runtime asset downloads
or third-party requests are required.

## Running it

```bash
npm install
npm run dev
```

Then open the printed URL (usually http://localhost:5173), click
**step inside**, and find your seat.

## Controls

| Action | How |
| --- | --- |
| Look around | drag with the mouse |
| Walk around | WASD / arrow keys (or the "stand up & walk" button) |
| Take a seat | click any free chair (red ring = taken) |
| Change location | buttons in the top-left panel |
| Music on/off, volumes | bottom bar |
| Focus timer | bottom-right of the bar (▶ / ↺) |

- **Downloaded 3D props** — CC0 low-poly models (Kenney furniture & food kits): real
  mugs with handles, croissants on plates, lounge armchairs, potted plants, and the
  coffee machine — with procedural fallbacks if any model fails to load

## Stack

- [Three.js](https://threejs.org/) — 3D scene, procedural geometry, and local PBR materials
- [Vite](https://vitejs.dev/) — dev server and build
- Web Audio API + streamed local media — spatial soundscape, recorded playlists,
  and a generative fallback
