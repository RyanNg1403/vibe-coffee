// Garden Terrace upper deck + switchback stair (CAFE_INTERIOR_REBUILD_PLAN
// §8). All geometry derives from the SAME blueprint spec that feeds the walk
// surfaces, navigation links, colliders and tests — treads, landing, guards
// and the deck slab are rendered exactly where the resolver says they are.
import * as THREE from 'three';
import { cloneModel } from '../modelLoader.js';

export function buildTerraceDeck({ group, spec, helpers, mats, models, rand }) {
  const { box, roundedBox, cyl } = helpers;
  const { woodMat, woodDarkMat, metalMat, plantPotMat, foliageMat } = mats;

  // A cluster of curved leaf blades — a real plant reads far better than a
  // fan of cones. Each blade is a tapered double-sided card, splayed and
  // bowed outward from the crown. Used as the fallback when a GLB plant model
  // is unavailable, and for the box-planter greenery.
  const leafBlade = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.05, 0.18, 0.04, 0.42, 0, 0.6);
    shape.bezierCurveTo(-0.04, 0.42, -0.05, 0.18, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 6);
    geo.computeVertexNormals();
    return geo;
  })();
  function makeLeafClump(mat, { blades = 9, spread = 0.16, rise = 0.55, curl = 0.5 } = {}) {
    const clump = new THREE.Group();
    for (let i = 0; i < blades; i += 1) {
      const blade = new THREE.Mesh(leafBlade, mat);
      const a = (i / blades) * Math.PI * 2 + rand(-0.3, 0.3);
      const lean = rand(0.25, 0.7);
      const h = rise * rand(0.7, 1.15);
      blade.scale.set(rand(0.8, 1.2), h / 0.6, 1);
      blade.position.set(Math.cos(a) * spread * rand(0.2, 1), 0, Math.sin(a) * spread * rand(0.2, 1));
      blade.rotation.order = 'YXZ';
      blade.rotation.y = a;
      blade.rotation.x = lean * curl;
      blade.castShadow = true;
      clump.add(blade);
    }
    return clump;
  }

  const deck = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x4d4238, roughness: 0.45, metalness: 0.7 });
  const teak = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.62 });
  const limewash = new THREE.MeshStandardMaterial({ color: 0xd9d0bc, roughness: 0.92 });
  const terracotta = new THREE.MeshStandardMaterial({ color: 0xa9634a, roughness: 0.85 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x3d2f22, roughness: 1 });
  const canvasMat = new THREE.MeshStandardMaterial({
    color: 0xe8dcc4, roughness: 0.95, side: THREE.DoubleSide,
  });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });

  const stair = spec.stair;
  const deckY = spec.y;

  // -- deck slab: bounding pieces of the L (main wing + notch) ---------------
  const slabThickness = 0.16;
  const mainW = Math.abs(-4.55 - -8.5);
  const mainD = Math.abs(3.0 - -6.75);
  const slab = box(mainW, slabThickness, mainD, teak);
  slab.position.set((-8.5 + -4.55) / 2, deckY - slabThickness / 2, (3.0 + -6.75) / 2);
  deck.add(slab);
  const notch = box(4.55 - 3.42, slabThickness, 3.3 - 1.95, teak);
  notch.position.set((-4.55 + -3.42) / 2, deckY - slabThickness / 2, (-3.3 + -1.95) / 2);
  deck.add(notch);
  // plank lines: thin dark strips across the wing (cheap, merged)
  for (let px = -8.3; px < -4.6; px += 0.55) {
    const seam = box(0.02, 0.006, mainD - 0.2, woodDarkMat);
    seam.position.set(px, deckY + 0.004, (3.0 + -6.75) / 2);
    deck.add(seam);
  }
  // bevelled fascia along the exposed edges
  const fasciaE = roundedBox(0.1, 0.3, mainD + 0.1, woodDarkMat, 0.03);
  fasciaE.position.set(-4.53, deckY - 0.15, (3.0 + -6.75) / 2);
  deck.add(fasciaE);
  const fasciaN = roundedBox(mainW + 0.1, 0.3, 0.1, woodDarkMat, 0.03);
  fasciaN.position.set((-8.5 + -4.55) / 2, deckY - 0.15, 2.98);
  deck.add(fasciaN);
  // joist hints under the east edge
  for (const jz of [-5.8, -4.2, -2.6, -1.0, 0.6, 2.2]) {
    const joist = box(0.08, 0.22, 0.9, woodDarkMat);
    joist.position.set(-4.75, deckY - 0.28, jz);
    deck.add(joist);
  }

  // -- support columns ---------------------------------------------------------
  for (const column of spec.columns) {
    const post = cyl(0.13, 0.15, deckY - slabThickness, limewash, 10);
    post.position.set(column.x, (deckY - slabThickness) / 2, column.z);
    deck.add(post);
    const capital = box(0.36, 0.1, 0.36, woodDarkMat);
    capital.position.set(column.x, deckY - slabThickness - 0.05, column.z);
    deck.add(capital);
    const base = cyl(0.19, 0.21, 0.09, terracotta, 10);
    base.position.set(column.x, 0.045, column.z);
    deck.add(base);
  }

  // -- guard rails: posts + double rail + planter boxes, from guard rects -----
  const railTopY = deckY + 1.02;
  const addGuardRun = (rect) => {
    const alongX = (rect.x1 - rect.x0) > (rect.z1 - rect.z0);
    const length = alongX ? rect.x1 - rect.x0 : rect.z1 - rect.z0;
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    for (const railY of [railTopY, deckY + 0.55]) {
      const rail = box(alongX ? length : 0.05, railY === railTopY ? 0.07 : 0.04, alongX ? 0.05 : length, bronze);
      rail.position.set(cx, railY, cz);
      deck.add(rail);
    }
    const posts = Math.max(1, Math.round(length / 1.15));
    for (let i = 0; i <= posts; i += 1) {
      const t = i / posts;
      const post = box(0.06, 1.02, 0.06, bronze);
      post.position.set(
        alongX ? rect.x0 + t * length : cx,
        deckY + 0.51,
        alongX ? cz : rect.z0 + t * length,
      );
      deck.add(post);
    }
    // continuous LED guidance strip under the top rail (one emissive run)
    const led = box(alongX ? length - 0.1 : 0.02, 0.015, alongX ? 0.02 : length - 0.1, ledMat);
    led.position.set(cx, railTopY - 0.06, cz);
    deck.add(led);
  };
  for (const rect of spec.guards) addGuardRun(rect);
  // railing planters on the east guard overlooking the courtyard
  for (const pz of [-5.6, -0.6, 1.8]) {
    const boxPlanter = box(0.22, 0.18, 0.7, terracotta);
    boxPlanter.position.set(-4.54, railTopY + 0.02, pz);
    deck.add(boxPlanter);
    const dirt = box(0.18, 0.03, 0.64, soil);
    dirt.position.set(-4.54, railTopY + 0.1, pz);
    deck.add(dirt);
    // trailing greenery: three leaf clumps spilling along the box planter
    for (const off of [-0.22, 0, 0.22]) {
      const clump = makeLeafClump(foliageMat, { blades: 7, spread: 0.09, rise: 0.34, curl: 0.85 });
      clump.position.set(-4.54, railTopY + 0.12, pz + off + rand(-0.03, 0.03));
      clump.rotation.y = rand(0, Math.PI);
      deck.add(clump);
    }
  }

  // -- the switchback stair -----------------------------------------------------
  // Each flight is drawn straight from its blueprint endpoints (z0,y0)->(z1,y1)
  // — the SAME numbers the navigation ramp uses — so the visible treads always
  // slope exactly the way you actually walk. flightA (east lane) rises north
  // 0 -> 1.625; flightB (west lane) rises south 1.625 -> 3.25 (its spec reads
  // z0=-2 at y3.25 down to z1=0.85 at y1.625). No y-swap, no direction flag.
  const treadMat = teak;
  const buildFlight = (flight) => {
    const width = flight.x1 - flight.x0;
    const cx = (flight.x0 + flight.x1) / 2;
    const run = flight.z1 - flight.z0;          // signed span along z
    const rise = flight.y1 - flight.y0;         // signed rise
    const steps = 10;
    const stepRun = run / steps;
    const stepRise = rise / steps;
    const slope = Math.atan2(rise, run);
    const midZ = (flight.z0 + flight.z1) / 2;
    const midY = (flight.y0 + flight.y1) / 2;
    for (let i = 0; i < steps; i += 1) {
      const zFront = flight.z0 + stepRun * (i + 1); // higher (downhill-facing) edge
      const yTop = flight.y0 + stepRise * (i + 1);
      const zc = zFront - stepRun / 2;
      const tread = roundedBox(width - 0.06, 0.06, Math.abs(stepRun) - 0.008, treadMat, 0.016);
      tread.position.set(cx, yTop - 0.03, zc);
      tread.castShadow = true; tread.receiveShadow = true;
      deck.add(tread);
      // solid riser closing the vertical face beneath each tread nose
      const riser = box(width - 0.08, Math.abs(stepRise) + 0.03, 0.03, woodDarkMat);
      riser.position.set(cx, yTop - Math.abs(stepRise) / 2 - 0.03, zFront - Math.sign(stepRun) * 0.014);
      deck.add(riser);
    }
    // closed teak stringers hugging the tread line on both sides (reads solid,
    // not floating), each tilted to the flight's true slope
    const stringerLen = Math.hypot(run, rise);
    for (const sx of [flight.x0 + 0.04, flight.x1 - 0.04]) {
      const stringer = box(0.09, 0.34, stringerLen + 0.12, teak);
      stringer.position.set(sx, midY - 0.17, midZ);
      stringer.rotation.x = -slope;
      stringer.castShadow = true;
      deck.add(stringer);
      // a real railing: newel posts stepping up the flight + a top rail and
      // LED strip that follow the exact slope
      for (let p = 0; p <= 4; p += 1) {
        const f = p / 4;
        const post = cyl(0.022, 0.022, 0.92, bronze, 6);
        post.position.set(sx, flight.y0 + rise * f + 0.46, flight.z0 + run * f);
        deck.add(post);
      }
      const rail = box(0.05, 0.05, stringerLen, bronze);
      rail.position.set(sx, midY + 0.9, midZ);
      rail.rotation.x = -slope;
      deck.add(rail);
      const ledRun = box(0.02, 0.012, Math.abs(run) - 0.2, ledMat);
      ledRun.position.set(sx, midY + 0.82, midZ);
      ledRun.rotation.x = -slope;
      deck.add(ledRun);
    }
  };
  buildFlight({ ...stair.flightA });
  buildFlight({ ...stair.flightB });

  // -- landing platform: teak deck, a proper guard rail on the open north edge,
  // slim timber piers and a closed soffit so the mass reads solid without the
  // old featureless white wall/box.
  const landing = stair.landing;
  const lcx = (landing.x0 + landing.x1) / 2;
  const lw = landing.x1 - landing.x0;
  const lz = (landing.z0 + landing.z1) / 2;
  const landingSlab = box(lw, 0.16, landing.z1 - landing.z0, teak);
  landingSlab.position.set(lcx, landing.y - 0.08, lz);
  landingSlab.receiveShadow = true;
  deck.add(landingSlab);
  const fascia = box(lw + 0.03, 0.2, 0.06, woodDarkMat);
  fascia.position.set(lcx, landing.y - 0.16, landing.z1);
  deck.add(fascia);
  // guard rail along the open (north) edge of the landing
  const railTop = box(lw, 0.05, 0.05, bronze);
  railTop.position.set(lcx, landing.y + 0.95, landing.z1 - 0.05);
  deck.add(railTop);
  for (const px of [landing.x0 + 0.14, lcx, landing.x1 - 0.14]) {
    const post = cyl(0.024, 0.024, 0.95, bronze, 6);
    post.position.set(px, landing.y + 0.475, landing.z1 - 0.05);
    deck.add(post);
    const led = box(lw / 3, 0.012, 0.02, ledMat);
    led.position.set(px, landing.y + 0.86, landing.z1 - 0.05);
    deck.add(led);
  }
  // slim piers carrying the landing down to the courtyard floor
  for (const px of [landing.x0 + 0.22, landing.x1 - 0.22]) {
    const pierH = landing.y - 0.16;
    const pier = box(0.13, pierH, 0.13, woodDarkMat);
    pier.position.set(px, pierH / 2, landing.z1 - 0.22);
    pier.castShadow = true;
    deck.add(pier);
  }
  // closed soffit under flightB's west lane so there is no hollow gap seen
  // from the courtyard, tucked below the treads
  const soffitLen = Math.hypot(stair.flightB.z1 - stair.flightB.z0, stair.flightB.y1 - stair.flightB.y0);
  const soffit = box(stair.flightB.x1 - stair.flightB.x0 - 0.1, 0.05, soffitLen,
    new THREE.MeshStandardMaterial({ color: 0x6f5638, roughness: 0.7 }));
  soffit.position.set(
    (stair.flightB.x0 + stair.flightB.x1) / 2,
    (stair.flightB.y0 + stair.flightB.y1) / 2 - 0.42,
    (stair.flightB.z0 + stair.flightB.z1) / 2,
  );
  soffit.rotation.x = -Math.atan2(stair.flightB.y1 - stair.flightB.y0, stair.flightB.z1 - stair.flightB.z0);
  deck.add(soffit);

  // -- integrated deck bench along the west edge -------------------------------
  const bench = roundedBox(0.5, 0.42, 3.0, teak, 0.04);
  bench.position.set(-8.15, deckY + 0.21, -3.4);
  deck.add(bench);
  const benchBack = roundedBox(0.12, 0.5, 3.0, woodDarkMat, 0.03);
  benchBack.position.set(-8.38, deckY + 0.62, -3.4);
  deck.add(benchBack);

  // -- terracotta planters with rims, cavities, soil and plants ---------------
  for (const planter of spec.planters) {
    const pot = cyl(0.3, 0.24, 0.5, terracotta, 12);
    pot.position.set(planter.x, deckY + 0.25, planter.z);
    deck.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 14), terracotta);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(planter.x, deckY + 0.5, planter.z);
    deck.add(rim);
    const dirt = cyl(0.26, 0.26, 0.04, soil, 12);
    dirt.position.set(planter.x, deckY + 0.46, planter.z);
    deck.add(dirt);
    // a real potted plant (leafy monstera/pothos) rather than a fan of cones;
    // fall back to a full leaf-blade clump if the model library is absent
    const kinds = ['plant_monstera', 'plant_pothos', 'plant_succulent'];
    const potted = cloneModel(models, kinds[Math.floor(rand(0, kinds.length)) % kinds.length]);
    if (potted) {
      potted.position.set(planter.x, deckY + 0.48, planter.z);
      potted.scale.setScalar(rand(0.85, 1.1));
      potted.rotation.y = rand(0, Math.PI * 2);
      deck.add(potted);
    } else {
      const clump = makeLeafClump(foliageMat, { blades: 11, spread: 0.18, rise: 0.62, curl: 0.45 });
      clump.position.set(planter.x, deckY + 0.5, planter.z);
      deck.add(clump);
    }
    const potBase = cyl(0.26, 0.28, 0.03, plantPotMat ?? woodDarkMat, 12);
    potBase.position.set(planter.x, deckY + 0.015, planter.z);
    deck.add(potBase);
  }

  // -- shade canopy over the study corner --------------------------------------
  const canopy = spec.canopy;
  for (const [px, pz] of [[canopy.x0 + 0.2, canopy.z0 + 0.2], [canopy.x1 - 0.2, canopy.z0 + 0.2],
    [canopy.x0 + 0.2, canopy.z1 - 0.2], [canopy.x1 - 0.2, canopy.z1 - 0.2]]) {
    // a visible base plate and timber-gauge section keep the posts reading
    // structural instead of as bare floating rods (audit T2)
    const post = cyl(0.055, 0.065, canopy.y - deckY, bronze, 8);
    post.position.set(px, deckY + (canopy.y - deckY) / 2, pz);
    deck.add(post);
    const plate = cyl(0.11, 0.13, 0.04, woodDarkMat, 10);
    plate.position.set(px, deckY + 0.02, pz);
    deck.add(plate);
  }
  const sail = box(canopy.x1 - canopy.x0, 0.03, canopy.z1 - canopy.z0, canvasMat);
  sail.position.set((canopy.x0 + canopy.x1) / 2, canopy.y, (canopy.z0 + canopy.z1) / 2);
  sail.rotation.z = 0.045;
  deck.add(sail);

  group.add(deck);
  return {
    deck,
    contactShadows: [
      ...spec.columns.map((c) => ({ x: c.x, z: c.z, size: 0.8 })),
      { x: stair.bottomHold.x, z: stair.bottomHold.z + 0.4, size: 1.9 },
    ],
  };
}
