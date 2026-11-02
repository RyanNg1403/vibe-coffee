import { mkdir, writeFile } from 'node:fs/promises';
import { venueBlueprints } from '../src/cafe/interiorLayouts.js';
await mkdir('assets/blender/rebuild', { recursive: true });
await writeFile('assets/blender/rebuild/layouts.json', JSON.stringify(Object.fromEntries(venueBlueprints().map(b => [b.id, b])), null, 2) + '\n');
