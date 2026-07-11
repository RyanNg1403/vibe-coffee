// Authored per-café greenery placement. Each café gets a curated species
// palette instead of sampling every plant everywhere; `spot` indexes the
// shared floor-spot list in cafe.js (positions depend on room dimensions).
// Species keys are model-library keys; a missing model falls back to the
// procedural potted plant, so no entry can prevent the café from loading.
//
// Sources (see CREDITS.md): Isa Lousberg houseplant set (CC0), fern by
// Danni Bittman (CC BY), park trees by Quaternius (CC0).

export const GREENERY = {
  goldenhour: {
    // warm and lived-in: broad monstera leaves, trailing pothos, soft ferns
    floor: [
      { spot: 0, kind: 'plant_monstera', scale: [1.05, 1.2], collider: 0.24 },
      { spot: 1, kind: 'plant_pothos', scale: [0.95, 1.1] },
      { spot: 2, kind: 'plant_fern', scale: [1.0, 1.25] },
      { spot: 3, kind: 'plant_snake', scale: [1.0, 1.15] },
      { spot: 4, kind: 'plant_monstera', scale: [0.88, 1.0], collider: 0.2 },
      { spot: 5, kind: 'plant', scale: [1.0, 1.4] },
      { spot: 6, kind: 'plant_fern', scale: [0.9, 1.1] },
      { spot: 7, kind: 'plant', scale: [1.0, 1.3] },
      { spot: 8, kind: 'plant_snake', scale: [0.85, 1.0] },
    ],
    sill: ['plant_succulent', 'plant_cacti', 'cactus_pot', 'plant_small'],
    hangingKind: 'plant_pothos_vine',
  },
  roastery: {
    // architectural and restrained: upright sansevieria, one statement plant
    floor: [
      { spot: 0, kind: 'plant_snake', scale: [1.1, 1.25] },
      { spot: 1, kind: 'plant_monstera', scale: [0.95, 1.1], collider: 0.22 },
      { spot: 2, kind: 'plant_snake', scale: [1.0, 1.15] },
      { spot: 3, kind: 'plant_fern', scale: [0.95, 1.1] },
      { spot: 4, kind: 'plant_snake', scale: [0.9, 1.05] },
    ],
    sill: ['plant_cacti', 'plant_succulent', 'cactus_pot', 'plant_small'],
  },
  midnight: {
    // darker foliage, a couple of sculptural silhouettes, no tropical overload
    floor: [
      { spot: 0, kind: 'plant_monstera', scale: [1.0, 1.12], collider: 0.22 },
      { spot: 1, kind: 'plant_snake', scale: [1.05, 1.2] },
      { spot: 2, kind: 'plant_fern', scale: [0.9, 1.05] },
      { spot: 3, kind: 'plant_snake', scale: [0.9, 1.05] },
      { spot: 4, kind: 'plant', scale: [1.0, 1.3] },
      { spot: 5, kind: 'plant_fern', scale: [0.85, 1.0] },
    ],
    sill: ['plant_succulent', 'cactus_pot', 'plant_small', 'plant_cacti'],
  },
  terrace: {
    // the richest set: layered species groupings around the pergola
    floor: [
      { spot: 0, kind: 'plant_monstera', scale: [1.1, 1.25], collider: 0.24 },
      { spot: 1, kind: 'plant_fern', scale: [1.0, 1.2] },
      { spot: 2, kind: 'plant_pothos', scale: [0.95, 1.1] },
      { spot: 3, kind: 'plant_fern', scale: [1.0, 1.2] },
      { spot: 4, kind: 'plant_snake', scale: [1.0, 1.15] },
      { spot: 5, kind: 'plant_monstera', scale: [0.9, 1.05], collider: 0.2 },
      { spot: 6, kind: 'plant_fern', scale: [0.95, 1.15] },
      { spot: 7, kind: 'plant_pothos', scale: [0.9, 1.05] },
      { spot: 8, kind: 'plant', scale: [1.1, 1.4] },
    ],
    sill: ['plant_succulent', 'plant_cacti', 'cactus_pot', 'plant_small'],
    hangingKind: 'plant_pothos_vine',
  },
};
