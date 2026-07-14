// Midnight Jazz corner stage (CAFE_INTERIOR_REBUILD_PLAN §7): a low platform
// with visible nosing, three permanent performance anchors (the piano is
// placed by cafe.js on the anchor this module exposes), vocal mic with
// stool, upright bass on a stand, monitor wedges, speaker towers, floor
// cables and a curtain return. Instruments stay staged when nobody performs
// so the platform never reads as an unexplained empty slab.
import * as THREE from 'three';

export function buildJazzStage({ group, spec, helpers, mats, rand }) {
  const { box, roundedBox, cyl } = helpers;
  const { woodDarkMat, metalMat, cushionMat, clothTex } = mats;

  const stage = new THREE.Group();
  const w = spec.rect.x1 - spec.rect.x0;
  const d = spec.rect.z1 - spec.rect.z0;
  const cx = (spec.rect.x0 + spec.rect.x1) / 2;
  const cz = (spec.rect.z0 + spec.rect.z1) / 2;
  const h = spec.height;

  const platformMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.72 });
  const nosingMat = new THREE.MeshStandardMaterial({ color: 0x8a6b3a, roughness: 0.4, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d4f, roughness: 0.35, metalness: 0.85 });

  // platform with brass nosing along the two exposed edges
  const platform = box(w, h, d, platformMat);
  platform.position.set(cx, h / 2, cz);
  stage.add(platform);
  const nosingFront = box(w + 0.02, 0.03, 0.05, nosingMat);
  nosingFront.position.set(cx, h - 0.015, spec.rect.z1 + 0.01);
  stage.add(nosingFront);
  const nosingSide = box(0.05, 0.03, d + 0.02, nosingMat);
  nosingSide.position.set(spec.rect.x0 - 0.01, h - 0.015, cz);
  stage.add(nosingSide);
  // skirt shadowline under the nosing keeps the slab visually grounded
  const skirtFront = box(w, h - 0.03, 0.02, dark);
  skirtFront.position.set(cx, (h - 0.03) / 2, spec.rect.z1 + 0.02);
  stage.add(skirtFront);
  const skirtSide = box(0.02, h - 0.03, d, dark);
  skirtSide.position.set(spec.rect.x0 - 0.02, (h - 0.03) / 2, cz);
  stage.add(skirtSide);

  // vocal mic: stand, boom, mic, and the singer's stool just behind
  const micGroup = new THREE.Group();
  const micBase = cyl(0.17, 0.19, 0.03, dark, 14);
  micBase.position.y = 0.015;
  micGroup.add(micBase);
  const micPole = cyl(0.016, 0.016, 1.45, metalMat, 8);
  micPole.position.y = 0.74;
  micGroup.add(micPole);
  // boom drops to mouth height — the singer stands just behind the capsule
  // along the boom's +x direction (audit M1: it used to float over their head)
  const boom = cyl(0.012, 0.012, 0.4, metalMat, 8);
  boom.rotation.z = 1.15;
  boom.position.set(0.16, 1.42, 0);
  micGroup.add(boom);
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), dark);
  micHead.scale.set(1, 1.4, 1);
  micHead.rotation.z = 1.15;
  micHead.position.set(0.34, 1.47, 0);
  micGroup.add(micHead);
  micGroup.position.set(spec.anchors.mic.x, h, spec.anchors.mic.z);
  micGroup.rotation.y = spec.anchors.mic.rot ?? 0;
  stage.add(micGroup);
  const stool = new THREE.Group();
  const stoolSeat = cyl(0.17, 0.17, 0.05, cushionMat, 12);
  stoolSeat.position.y = 0.62;
  stool.add(stoolSeat);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const leg = cyl(0.02, 0.02, 0.62, woodDarkMat, 6);
    leg.position.set(Math.cos(angle) * 0.12, 0.31, Math.sin(angle) * 0.12);
    leg.rotation.z = Math.cos(angle) * 0.12;
    leg.rotation.x = -Math.sin(angle) * 0.12;
    stool.add(leg);
  }
  // singer's rest stool sits stage-left of the mic, clear of the singing spot
  // behind the boom and of the piano bench (audit M1/M6 repositioning)
  stool.position.set(spec.anchors.mic.x - 0.6, h, spec.anchors.mic.z - 0.6);
  stage.add(stool);

  // upright bass resting on a stand
  const bass = new THREE.Group();
  const bodyShape = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.16, 18),
    new THREE.MeshStandardMaterial({ color: 0x5b3416, roughness: 0.5 }),
  );
  bodyShape.rotation.x = Math.PI / 2;
  bodyShape.scale.set(1, 1, 1.55); // deepen into a body silhouette
  bodyShape.position.y = 0.62;
  bass.add(bodyShape);
  const neck = box(0.055, 0.95, 0.045, woodDarkMat);
  neck.position.y = 1.45;
  bass.add(neck);
  const scroll = box(0.07, 0.14, 0.06, woodDarkMat);
  scroll.position.y = 1.98;
  bass.add(scroll);
  const fingerboard = box(0.035, 1.15, 0.02, dark);
  fingerboard.position.set(0, 1.28, 0.035);
  bass.add(fingerboard);
  const tailpiece = box(0.05, 0.22, 0.02, dark);
  tailpiece.position.set(0, 0.42, 0.09);
  bass.add(tailpiece);
  const standLegA = cyl(0.015, 0.015, 0.5, metalMat, 6);
  standLegA.rotation.z = 0.5;
  standLegA.position.set(-0.18, 0.25, -0.05);
  bass.add(standLegA);
  const standLegB = cyl(0.015, 0.015, 0.5, metalMat, 6);
  standLegB.rotation.z = -0.5;
  standLegB.position.set(0.18, 0.25, -0.05);
  bass.add(standLegB);
  bass.rotation.y = spec.anchors.bass.rot ?? 0;
  bass.rotation.x = -0.1; // leans back on its stand
  bass.position.set(spec.anchors.bass.x, h, spec.anchors.bass.z);
  stage.add(bass);

  // monitor wedges at the front edge, angled back toward the performers
  for (const wx of [spec.anchors.mic.x - 0.85, spec.anchors.mic.x + 0.9]) {
    const wedge = box(0.42, 0.26, 0.3, dark);
    wedge.rotation.x = -0.5;
    wedge.position.set(wx, h + 0.14, spec.rect.z1 - 0.3);
    stage.add(wedge);
    const grill = box(0.34, 0.18, 0.02, new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.85 }));
    grill.rotation.x = -0.5;
    grill.position.set(wx, h + 0.2, spec.rect.z1 - 0.16);
    stage.add(grill);
  }

  // speaker towers flanking the platform's front corners
  for (const s of spec.speakers) {
    const cab = roundedBox(0.44, 1.15, 0.4, dark, 0.02);
    cab.position.set(s.x, h + 0.575, s.z);
    stage.add(cab);
    const cone = cyl(0.13, 0.13, 0.02, metalMat, 14);
    cone.rotation.x = Math.PI / 2;
    cone.position.set(s.x, h + 0.85, s.z + 0.2);
    stage.add(cone);
    const horn = box(0.2, 0.12, 0.02, metalMat);
    horn.position.set(s.x, h + 0.35, s.z + 0.2);
    stage.add(horn);
  }

  // floor cables snaking between anchors (flat dark runs, never floating)
  const cable = (x0, z0, x1, z1) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const run = box(0.035, 0.012, length, dark);
    run.position.set((x0 + x1) / 2, h + 0.006, (z0 + z1) / 2);
    run.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    stage.add(run);
  };
  cable(spec.anchors.mic.x, spec.anchors.mic.z, spec.speakers[0].x + 0.2, spec.speakers[0].z - 0.2);
  cable(spec.anchors.bass.x - 0.3, spec.anchors.bass.z, spec.anchors.mic.x - 0.2, spec.anchors.mic.z + 0.2);
  cable(spec.anchors.piano.x - 0.4, spec.anchors.piano.z + 0.3, spec.speakers[1].x - 0.25, spec.speakers[1].z - 0.1);

  // curtain return behind the stage: gathered velvet columns on a brass rod
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0x4a1f2a, roughness: 1, map: clothTex, bumpMap: clothTex, bumpScale: 0.01,
  });
  const rod = cyl(0.02, 0.02, spec.curtain.x1 - spec.curtain.x0 + 0.2, brass, 8);
  rod.rotation.z = Math.PI / 2;
  rod.position.set((spec.curtain.x0 + spec.curtain.x1) / 2, spec.curtain.y1 + 0.05, spec.curtain.z);
  stage.add(rod);
  const folds = Math.round((spec.curtain.x1 - spec.curtain.x0) / 0.33);
  for (let i = 0; i <= folds; i += 1) {
    const fx = spec.curtain.x0 + (i / folds) * (spec.curtain.x1 - spec.curtain.x0);
    const fold = cyl(0.09 + (i % 2) * 0.035, 0.11 + (i % 3) * 0.02,
      spec.curtain.y1 - spec.curtain.y0, curtainMat, 8);
    fold.position.set(fx, (spec.curtain.y0 + spec.curtain.y1) / 2, spec.curtain.z);
    stage.add(fold);
  }

  // the stage is the brightest local zone: one warm wash from above
  const wash = new THREE.PointLight(0xffb066, 7.5, 7.5);
  wash.position.set(cx - 0.4, 3.1, cz + 0.4);
  stage.add(wash);
  const washBulb = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.13, 0.18, 10),
    new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6 }),
  );
  washBulb.position.set(cx - 0.4, 3.24, cz + 0.4);
  stage.add(washBulb);

  group.add(stage);
  return {
    stage,
    contactShadows: [
      { x: cx - 0.5, z: spec.rect.z1 + 0.35, size: 2.6 },
      { x: spec.rect.x0 + 0.3, z: cz, size: 2.2 },
    ],
  };
}
