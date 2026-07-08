# vibe coffee ☕

A small corner of the internet that feels like your favourite café.

A local 3D coffee-shop simulator for studying and working — inspired by those
YouTube "café ambience" videos, except here you're *inside* the café: pick a
seat, look around, listen to the room, and get things done.

![vibe coffee](https://img.shields.io/badge/vibe-immaculate-c98e4e)

## Features

- **Three locations**, each with its own light, layout and mood:
  - 🌅 **Golden Hour Café** — warm wood, late-afternoon sun, plants everywhere
  - 🏙️ **Downtown Roastery** — concrete and steel, big windows onto a bright city street
  - 🌧️ **Midnight Jazz Corner** — rain on the glass, warm lamps, a neon glow
- **Sit anywhere** — click any free chair or window stool to move there, drag to look around
- **A living café** — customers walk in (door chime included), order at the counter,
  sit with their coffee, and eventually head back out; a barista putters behind the bar
- **Procedurally generated lo-fi music** — an endless, never-repeating chord loop with
  vinyl crackle, synthesized live in your browser. Turn it off to keep just the room sound,
  exactly like the "no music, ambience only" videos
- **Synthesized café ambience** — crowd murmur, espresso machine, cup clinks,
  rain against the windows at night. No audio files, everything is WebAudio
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
| Change table | click any free chair (red ring = taken) |
| Change location | buttons in the top-left panel |
| Music on/off, volumes | bottom bar |
| Focus timer | bottom-right of the bar (▶ / ↺) |

## Stack

- [Three.js](https://threejs.org/) — 3D scene, procedural geometry, canvas textures
- [Vite](https://vitejs.dev/) — dev server and build
- WebAudio API — generative lo-fi + café soundscape, no samples
