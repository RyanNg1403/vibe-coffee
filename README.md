# vibe coffee ☕

A small corner of the internet that feels like your favourite café.

A local 3D coffee-shop simulator for studying and working — inspired by those
YouTube "café ambience" videos, except here you're *inside* the café: pick a
seat, look around, listen to the room, and get things done.

![vibe coffee](https://img.shields.io/badge/vibe-immaculate-c98e4e)

## Features

- **Three spacious locations**, each with its own light, layout, signature decor and mood:
  - 🌅 **Golden Hour Café** — warm wood, exposed ceiling beams, hanging plants,
    string lights, sunbeams full of dust
  - 🏙️ **Downtown Roastery** — concrete and steel, ductwork, a big corner coffee
    roaster with burlap bean sacks, Edison bulbs, a ceiling fan
  - 🌧️ **Midnight Jazz Corner** — rain on the glass, candlelit tables, a wall of
    books, a spinning vinyl record, a neon glow
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
- **Generative music, a different record in every café** — lo-fi hip-hop in the golden
  hour, bossa-flavored plucked guitar downtown, slow brushed-drum jazz with a walking
  bass at midnight. Songs have real structure (intro / sections / outro), then the
  needle lifts, and a new one starts in a new key and tempo. All synthesized live —
  including a Karplus-Strong plucked string
- **Real recorded café sound, positioned in 3D** — 18 Creative-Commons / public-domain
  field recordings (see `CREDITS.md`): real crowd chatter, espresso grinding, milk
  steaming, cup clinks, footsteps, a shop door bell, a cash register, rain on the
  window, day & night street traffic, and single cars that audibly drive past outside.
  A procedural convolution reverb puts every sound in the room, and 3D panning puts it
  in its *place* — the machine sounds come from the counter, typing from the actual
  laptop users, footsteps from whoever is walking past you. Every recording has a
  synthesized fallback, so the app still works fully offline/asset-free
- **Focus timer** — a built-in 25/5 pomodoro with a gentle chime

Everything — geometry, textures, music, sound — is generated in code.
There are no assets to download; the whole café is built from Three.js
primitives and canvas textures when the page loads.

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

## Stack

- [Three.js](https://threejs.org/) — 3D scene, procedural geometry, canvas textures
- [Vite](https://vitejs.dev/) — dev server and build
- WebAudio API — generative lo-fi + café soundscape, no samples
