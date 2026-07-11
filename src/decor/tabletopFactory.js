// Curated fixed-tabletop clusters. Each builder returns placed objects with a
// footprint radius; the café registers every one through registerTableProp so
// laptop clearance can move whole settings without overlaps, and the future
// waiter can transfer or remove them exactly once. All materials are flat and
// untextured so the static-décor merge folds them into existing batches.

import * as THREE from 'three';

const VASE_TINTS = [0xb9c7c2, 0xc9a54a, 0x8d9bb0, 0xc98e6e];
const PETAL_TINTS = [0xd88a9e, 0xe0b45a, 0xc06a5a, 0x9a86c9];

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = false;
  return m;
}

// A proper vessel: base, belly, neck and a flared rim (the old bud vase was a
// bare cylinder). Lathe profile in metres; ~120 triangles.
export function buildVase(tint = VASE_TINTS[0]) {
  const profile = [
    [0.028, 0], [0.034, 0.008], [0.04, 0.03], [0.042, 0.06],
    [0.03, 0.1], [0.018, 0.13], [0.016, 0.16], [0.022, 0.175], [0.026, 0.18],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const vase = new THREE.Group();
  const body = mesh(
    new THREE.LatheGeometry(profile, 14),
    new THREE.MeshStandardMaterial({ color: tint, roughness: 0.32, metalness: 0.05 })
  );
  vase.add(body);
  return vase;
}

// Small stem/leaf/petal kit: two stems with an offset leaf each and a simple
// five-petal head. Deliberately restrained — no spheres on sticks.
export function buildFlowers(petalTint = PETAL_TINTS[0]) {
  const flowers = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d6743, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5b7a4e, roughness: 0.85, side: THREE.DoubleSide });
  const petalMat = new THREE.MeshStandardMaterial({ color: petalTint, roughness: 0.7, side: THREE.DoubleSide });
  const centerMat = new THREE.MeshStandardMaterial({ color: 0xd8b23c, roughness: 0.8 });
  for (let i = 0; i < 2; i++) {
    const lean = (i === 0 ? 1 : -1) * 0.16;
    const stem = mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 0.17, 5), stemMat);
    stem.position.set(lean * 0.02, 0.085, i * 0.012);
    stem.rotation.z = lean;
    flowers.add(stem);
    const leaf = mesh(new THREE.CircleGeometry(0.02, 6), leafMat);
    leaf.scale.set(0.6, 1.4, 1);
    leaf.position.set(lean * 0.035, 0.09, i * 0.012);
    leaf.rotation.set(-0.5, 0.4 * lean, 1.2 * lean);
    flowers.add(leaf);
    // five petals fanned around a small centre
    const head = new THREE.Group();
    head.position.set(lean * 0.055, 0.175, i * 0.012);
    head.rotation.set(0.35, 0, lean * 0.8);
    for (let p = 0; p < 5; p++) {
      const petal = mesh(new THREE.CircleGeometry(0.016, 5), petalMat);
      petal.scale.set(0.65, 1, 1);
      const angle = (p / 5) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.014, Math.sin(angle) * 0.014, 0);
      petal.rotation.z = angle + Math.PI / 2;
      head.add(petal);
    }
    const centre = mesh(new THREE.CircleGeometry(0.007, 6), centerMat);
    centre.position.z = 0.001;
    head.add(centre);
    flowers.add(head);
  }
  return flowers;
}

// ---------- cluster builders ----------
// ctx: { table: {x, z}, topY, mats: {ceramicMat, paperMat, cushionMat, metalMat, glassMat, woodDarkMat}, seed }
// Each returns [{ object, footprint }]; positions are WORLD coordinates on
// the tabletop. Footprints feed the clearance grid.

function waterAndMenu({ table, topY, mats }) {
  const water = mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.11, 12), mats.glassMat);
  water.position.set(table.x - 0.24, topY + 0.055, table.z + 0.05);
  const menu = mesh(new THREE.BoxGeometry(0.13, 0.015, 0.2), mats.paperMat);
  menu.position.set(table.x + 0.05, topY + 0.008, table.z + 0.1);
  menu.rotation.y = 0.42;
  return [
    { object: water, footprint: 0.05 },
    { object: menu, footprint: 0.11 },
  ];
}

function flowerSetting({ table, topY, seed }) {
  const vase = buildVase(VASE_TINTS[seed % VASE_TINTS.length]);
  vase.add(buildFlowers(PETAL_TINTS[(seed + 1) % PETAL_TINTS.length]));
  vase.position.set(table.x - 0.08, topY, table.z - 0.16);
  const card = mesh(
    new THREE.BoxGeometry(0.07, 0.05, 0.008),
    new THREE.MeshStandardMaterial({ color: 0xefe7d6, roughness: 0.85 })
  );
  card.position.set(table.x + 0.12, topY + 0.025, table.z - 0.12);
  card.rotation.set(-0.28, 0.4, 0);
  return [
    { object: vase, footprint: 0.06 },
    { object: card, footprint: 0.05 },
  ];
}

function foldedLinen({ table, topY, mats }) {
  const linen = mesh(new THREE.BoxGeometry(0.16, 0.02, 0.12), mats.cushionMat);
  linen.position.set(table.x - 0.13, topY + 0.01, table.z + 0.12);
  linen.rotation.y = 0.34;
  return [{ object: linen, footprint: 0.1 }];
}

function readingSetting({ table, topY, mats, seed }) {
  const bookTints = [0x7a4a3a, 0x3f5d70, 0x5d6d4b, 0x6d4b6a];
  const book = new THREE.Group();
  const cover = mesh(
    new THREE.BoxGeometry(0.14, 0.025, 0.2),
    new THREE.MeshStandardMaterial({ color: bookTints[seed % bookTints.length], roughness: 0.75 })
  );
  book.add(cover);
  const pages = mesh(new THREE.BoxGeometry(0.13, 0.018, 0.19), mats.paperMat);
  pages.position.y = 0.004;
  book.add(pages);
  book.position.set(table.x - 0.16, topY + 0.013, table.z - 0.05);
  book.rotation.y = -0.3;
  // wire reading glasses folded on the cover
  const glasses = new THREE.Group();
  const wire = mats.metalMat;
  for (const side of [-1, 1]) {
    const lens = mesh(new THREE.TorusGeometry(0.021, 0.0024, 6, 14), wire);
    lens.position.x = side * 0.026;
    lens.rotation.x = Math.PI / 2;
    glasses.add(lens);
  }
  const bridge = mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 5), wire);
  bridge.rotation.z = Math.PI / 2;
  glasses.add(bridge);
  const arm = mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.09, 5), wire);
  arm.rotation.set(Math.PI / 2, 0, 0.5);
  arm.position.set(0.045, 0, -0.035);
  glasses.add(arm);
  // folded on the cover: glasses ride with the book as one clearable setting
  glasses.position.set(0.02, 0.017, 0.02);
  glasses.rotation.y = 1.0;
  book.add(glasses);
  return [{ object: book, footprint: 0.12 }];
}

function finishedSetting({ table, topY, mats }) {
  const setting = new THREE.Group();
  const saucer = mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.012, 14), mats.ceramicMat);
  setting.add(saucer);
  const cup = mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.05, 12), mats.ceramicMat);
  cup.position.y = 0.03;
  cup.rotation.z = 0.12; // tipped slightly: clearly finished, not fresh
  setting.add(cup);
  const spoon = mesh(new THREE.BoxGeometry(0.012, 0.004, 0.09), mats.metalMat);
  spoon.position.set(0.07, 0.008, 0.01);
  spoon.rotation.y = 0.5;
  setting.add(spoon);
  const napkin = mesh(new THREE.BoxGeometry(0.09, 0.014, 0.08), mats.paperMat);
  napkin.position.set(-0.09, 0.007, 0.05);
  napkin.rotation.y = 0.9;
  setting.add(napkin);
  setting.position.set(table.x + 0.18, topY, table.z - 0.14);
  return [{ object: setting, footprint: 0.12 }];
}

export const TABLE_CLUSTER_BUILDERS = {
  waterMenu: waterAndMenu,
  flowers: flowerSetting,
  linen: foldedLinen,
  reading: readingSetting,
  finished: finishedSetting,
};

export const CLUSTER_NAMES = Object.keys(TABLE_CLUSTER_BUILDERS);

// Per-café cluster rotations. Midnight skips the "finished" clutter (candles
// carry its tables); the terrace leans on flowers.
export const TABLETOP_CLUSTERS = {
  goldenhour: ['waterMenu', 'flowers', 'linen', 'reading', 'finished'],
  roastery: ['waterMenu', 'linen', 'reading', 'finished'],
  midnight: ['flowers', 'reading', 'waterMenu', 'linen'],
  terrace: ['flowers', 'waterMenu', 'linen', 'reading'],
};

export function buildTableCluster(themeId, tableIndex, ctx) {
  const rotation = TABLETOP_CLUSTERS[themeId] ?? TABLETOP_CLUSTERS.goldenhour;
  const name = rotation[tableIndex % rotation.length];
  return { name, items: TABLE_CLUSTER_BUILDERS[name](ctx) };
}
