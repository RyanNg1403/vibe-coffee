// Garden Terrace upper deck + switchback stair (CAFE_INTERIOR_REBUILD_PLAN
// §8). All geometry derives from the SAME blueprint spec that feeds the walk
// surfaces, navigation links, colliders and tests — treads, landing, guards
// and the deck slab are rendered exactly where the resolver says they are.
import * as THREE from 'three';

export function buildTerraceDeck({ group, spec, helpers, mats, rand }) {
  const { box, roundedBox, cyl } = helpers;
  const { woodMat, woodDarkMat, metalMat, plantPotMat, foliageMat } = mats;

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
    for (let i = 0; i < 4; i += 1) {
      const sprig = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), foliageMat);
      sprig.position.set(-4.54 + rand(-0.05, 0.05), railTopY + 0.22, pz + rand(-0.26, 0.26));
      sprig.rotation.z = rand(-0.25, 0.25);
      deck.add(sprig);
    }
  }

  // -- the switchback stair -----------------------------------------------------
  const treadMat = teak;
  const buildFlight = (flight, ascendingNorth) => {
    const width = flight.x1 - flight.x0;
    const cx = (flight.x0 + flight.x1) / 2;
    const run = flight.z1 - flight.z0;
    const steps = 10;
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 0.5) / steps;
      const z = flight.z0 + run * t;
      const yTop = ascendingNorth
        ? flight.y0 + (flight.y1 - flight.y0) * ((i + 1) / steps)
        : flight.y1 + (flight.y0 - flight.y1) * ((steps - i) / steps);
      const tread = roundedBox(width - 0.06, 0.055, run / steps - 0.015, treadMat, 0.015);
      tread.position.set(cx, yTop - 0.0275, z);
      deck.add(tread);
      const riser = box(width - 0.08, stair.riserHeight - 0.05, 0.03, woodDarkMat);
      riser.position.set(cx, yTop - stair.riserHeight / 2 - 0.03, z - (run / steps) / 2 + 0.03);
      deck.add(riser);
    }
    // slim bronze stringers on both sides of the flight
    for (const sx of [flight.x0 + 0.03, flight.x1 - 0.03]) {
      const yLow = ascendingNorth ? flight.y0 : flight.y1;
      const yHigh = ascendingNorth ? flight.y1 : flight.y0;
      const stringerLength = Math.hypot(run, yHigh - yLow);
      const stringer = box(0.05, 0.24, stringerLength, bronze);
      stringer.position.set(sx, (yLow + yHigh) / 2 - 0.05, (flight.z0 + flight.z1) / 2);
      stringer.rotation.x = -Math.atan2(yHigh - yLow, run);
      deck.add(stringer);
      // handrail above the stringer with the same slope
      const handrail = cyl(0.025, 0.025, stringerLength, bronze, 8);
      handrail.rotation.x = Math.PI / 2 + Math.atan2(yHigh - yLow, run);
      handrail.position.set(sx, (yLow + yHigh) / 2 + 0.92, (flight.z0 + flight.z1) / 2);
      deck.add(handrail);
      const ledRun = box(0.02, 0.012, run - 0.2, ledMat);
      ledRun.position.set(sx, (yLow + yHigh) / 2 + 0.84, (flight.z0 + flight.z1) / 2);
      ledRun.rotation.x = -Math.atan2(yHigh - yLow, run);
      deck.add(ledRun);
    }
  };
  buildFlight({ ...stair.flightA }, true);
  buildFlight({ ...stair.flightB, y0: stair.flightB.y1, y1: stair.flightB.y0 }, false);

  // landing platform with textured face and rail posts
  const landing = stair.landing;
  const landingSlab = box(landing.x1 - landing.x0, 0.14, landing.z1 - landing.z0, teak);
  landingSlab.position.set((landing.x0 + landing.x1) / 2, landing.y - 0.07, (landing.z0 + landing.z1) / 2);
  deck.add(landingSlab);
  const landingWall = box(landing.x1 - landing.x0, landing.y, 0.12, limewash);
  landingWall.position.set((landing.x0 + landing.x1) / 2, landing.y / 2, landing.z1 + 0.06);
  deck.add(landingWall);
  const landingRail = box(landing.x1 - landing.x0, 0.06, 0.05, bronze);
  landingRail.position.set((landing.x0 + landing.x1) / 2, landing.y + 1.0, landing.z1 - 0.05);
  deck.add(landingRail);
  // under-stair skirts so the mass reads solid from the courtyard
  const skirtB = box(-3.5 - -4.55, 0.02 + landing.y, 2.0 - -2.0, limewash);
  skirtB.position.set((-4.55 + -3.5) / 2, landing.y / 2, 0);
  skirtB.scale.y = 1;
  deck.add(skirtB);

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
    const stemCount = 3 + Math.floor(rand(0, 3));
    for (let i = 0; i < stemCount; i += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, rand(0.35, 0.6), 6), foliageMat);
      leaf.position.set(planter.x + rand(-0.1, 0.1), deckY + 0.55 + rand(0.1, 0.25), planter.z + rand(-0.1, 0.1));
      leaf.rotation.z = rand(-0.35, 0.35);
      deck.add(leaf);
    }
    const potBase = cyl(0.26, 0.28, 0.03, plantPotMat ?? woodDarkMat, 12);
    potBase.position.set(planter.x, deckY + 0.015, planter.z);
    deck.add(potBase);
  }

  // -- shade canopy over the study corner --------------------------------------
  const canopy = spec.canopy;
  for (const [px, pz] of [[canopy.x0 + 0.2, canopy.z0 + 0.2], [canopy.x1 - 0.2, canopy.z0 + 0.2],
    [canopy.x0 + 0.2, canopy.z1 - 0.2], [canopy.x1 - 0.2, canopy.z1 - 0.2]]) {
    const post = cyl(0.05, 0.05, canopy.y - deckY, bronze, 8);
    post.position.set(px, deckY + (canopy.y - deckY) / 2, pz);
    deck.add(post);
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
