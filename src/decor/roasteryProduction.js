// Roastery production corner (CAFE_INTERIOR_REBUILD_PLAN §6): a glazed
// partition seals the roasting zone off from patrons while keeping the
// process readable — drum roaster with hopper, sight glass, controls and a
// supported exhaust run, cooling tray with stirring arm, prep bench with
// scale and sample cups, and green-bean sacks. Everything uses flat shared
// materials so the static-decor merge folds it into few draw calls; only the
// two glass panes stay separate.
import * as THREE from 'three';

export function buildRoasteryProduction({
  group, spec, roomHeight, helpers, mats, track, rand,
}) {
  const { box, roundedBox, cyl } = helpers;
  const { metalMat, woodDarkMat, counterTopMat } = mats;

  const steelDark = new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.42, metalness: 0.72 });
  const steelFrame = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 0.6 });
  const burlap = new THREE.MeshStandardMaterial({ color: 0x9b8459, roughness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d4f, roughness: 0.35, metalness: 0.85 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdfe9ee, transmission: 0.92, transparent: true, opacity: 0.22,
    roughness: 0.05, depthWrite: false,
  });

  const production = new THREE.Group();

  // -- glazed partition with a minimal mullion rhythm --------------------------
  const frameH = 2.35;
  const addPartitionRun = (length, position, rotationY) => {
    const run = new THREE.Group();
    const bottomRail = box(0.09, 0.1, length, steelFrame);
    bottomRail.position.y = 0.05;
    run.add(bottomRail);
    const topRail = box(0.09, 0.09, length, steelFrame);
    topRail.position.y = frameH - 0.045;
    run.add(topRail);
    const mullions = Math.max(2, Math.round(length / 1.15));
    for (let i = 0; i <= mullions; i += 1) {
      const post = box(0.07, frameH, 0.07, steelFrame);
      post.position.set(0, frameH / 2, -length / 2 + (i / mullions) * length);
      run.add(post);
    }
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.02, frameH - 0.2, length - 0.1), glass);
    pane.position.y = frameH / 2;
    run.add(pane);
    run.position.copy(position);
    run.rotation.y = rotationY;
    production.add(run);
  };
  const partitionLength = Math.abs(spec.rect.z1 - spec.rect.z0);
  addPartitionRun(partitionLength - 0.75, new THREE.Vector3(spec.partitionX, 0, (spec.rect.z0 + spec.rect.z1) / 2 - 0.37), 0);
  const returnLength = Math.abs(spec.partitionX - spec.rect.x0);
  addPartitionRun(returnLength, new THREE.Vector3((spec.rect.x0 + spec.partitionX) / 2, 0, spec.returnZ), Math.PI / 2);
  // solid staff door at the counter end of the partition
  const door = box(0.06, 2.1, 0.72, steelDark);
  door.position.set(spec.partitionX, 1.05, spec.rect.z0 + 0.39);
  production.add(door);
  const pushBar = box(0.03, 0.03, 0.4, brass);
  pushBar.position.set(spec.partitionX - 0.06, 1.05, spec.rect.z0 + 0.39);
  production.add(pushBar);

  // -- the drum roaster ---------------------------------------------------------
  const roaster = new THREE.Group();
  const body = cyl(0.44, 0.48, 1.15, steelDark, 20);
  body.position.y = 0.85;
  roaster.add(body);
  for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const leg = box(0.07, 0.28, 0.07, steelFrame);
    leg.position.set(lx, 0.14, lz);
    roaster.add(leg);
  }
  // drum face, sight glass and trier on the room-facing side (+x)
  const face = cyl(0.34, 0.34, 0.07, steelFrame, 20);
  face.rotation.z = Math.PI / 2;
  face.position.set(0.46, 0.95, 0);
  roaster.add(face);
  const sightRim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 20), brass);
  sightRim.rotation.y = Math.PI / 2;
  sightRim.position.set(0.51, 0.95, 0);
  roaster.add(sightRim);
  const sight = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), glass);
  sight.rotation.z = Math.PI / 2;
  sight.position.set(0.51, 0.95, 0);
  roaster.add(sight);
  const trier = cyl(0.02, 0.02, 0.2, brass, 8);
  trier.rotation.z = Math.PI / 2;
  trier.position.set(0.53, 1.18, -0.14);
  roaster.add(trier);
  // hopper on top
  const hopper = cyl(0.09, 0.34, 0.5, steelFrame, 12);
  hopper.position.y = 1.7;
  roaster.add(hopper);
  const hopperMouth = cyl(0.34, 0.36, 0.06, steelDark, 12);
  hopperMouth.position.y = 1.95;
  roaster.add(hopperMouth);
  // control panel with knobs and a gauge
  const panel = box(0.3, 0.42, 0.34, steelFrame);
  panel.position.set(0.18, 0.5, 0.42);
  roaster.add(panel);
  for (let i = 0; i < 3; i += 1) {
    const knob = cyl(0.025, 0.025, 0.03, i === 1 ? brass : woodDarkMat, 8);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.18, 0.62 - i * 0.12, 0.6);
    roaster.add(knob);
  }
  // supported exhaust run to the ceiling
  const flue = cyl(0.1, 0.1, roomHeight - 2.0, steelDark, 10);
  flue.position.set(-0.15, 2.0 + (roomHeight - 2.0) / 2 - 0.1, 0);
  roaster.add(flue);
  const elbow = cyl(0.11, 0.11, 0.3, steelDark, 10);
  elbow.rotation.z = Math.PI / 2;
  elbow.position.set(-0.05, 1.92, 0);
  roaster.add(elbow);
  const flueBracket = box(0.05, 0.05, 0.5, steelFrame);
  flueBracket.position.set(-0.15, roomHeight - 0.5, -0.25);
  roaster.add(flueBracket);
  roaster.position.set(spec.roaster.x, 0, spec.roaster.z);
  roaster.rotation.y = 0.15;
  production.add(roaster);

  // -- cooling tray -------------------------------------------------------------
  const tray = new THREE.Group();
  const pedestal = box(0.34, 0.72, 0.34, steelFrame);
  pedestal.position.y = 0.36;
  tray.add(pedestal);
  const pan = cyl(0.52, 0.46, 0.14, steelDark, 20);
  pan.position.y = 0.8;
  tray.add(pan);
  const panRim = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.03, 8, 24), steelFrame);
  panRim.rotation.x = Math.PI / 2;
  panRim.position.y = 0.87;
  tray.add(panRim);
  const beans = cyl(0.45, 0.45, 0.03, new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 1 }), 20);
  beans.position.y = 0.875;
  tray.add(beans);
  const armPost = cyl(0.035, 0.035, 0.35, brass, 8);
  armPost.position.y = 1.0;
  tray.add(armPost);
  const arm = box(0.9, 0.03, 0.05, brass);
  arm.position.y = 0.92;
  arm.rotation.y = 0.6;
  tray.add(arm);
  tray.position.set(spec.coolingTray.x, 0, spec.coolingTray.z);
  production.add(tray);

  // -- prep bench with scale and sample cups -------------------------------------
  const bench = new THREE.Group();
  const benchBody = box(0.55, 0.86, spec.bench.length, steelFrame);
  benchBody.position.y = 0.43;
  bench.add(benchBody);
  const benchTop = roundedBox(0.62, 0.05, spec.bench.length + 0.06, counterTopMat, 0.02);
  benchTop.position.y = 0.885;
  bench.add(benchTop);
  const scale = box(0.24, 0.06, 0.3, steelDark);
  scale.position.set(0, 0.94, -spec.bench.length / 4);
  bench.add(scale);
  const scaleDish = cyl(0.11, 0.09, 0.05, metalMat, 14);
  scaleDish.position.set(0, 1.0, -spec.bench.length / 4);
  bench.add(scaleDish);
  const cups = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.045, 0.07, 10), counterTopMat, 5);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 5; i += 1) {
    matrix.makeTranslation(-0.12 + (i % 2) * 0.22, 0.945, spec.bench.length / 4 - 0.3 + Math.floor(i / 2) * 0.22);
    cups.setMatrixAt(i, matrix);
  }
  bench.add(cups);
  const kettle = cyl(0.09, 0.12, 0.18, steelDark, 12);
  kettle.position.set(0.12, 1.0, 0.05);
  bench.add(kettle);
  bench.position.set(spec.bench.x, 0, spec.bench.z);
  production.add(bench);

  // -- green-bean sacks -----------------------------------------------------------
  for (const [index, sack] of spec.sacks.entries()) {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), burlap);
    bag.scale.set(1, 1.15 - index * 0.08, 0.85);
    bag.position.set(sack.x, 0.3 * (1.15 - index * 0.08), sack.z);
    bag.rotation.y = rand(0, Math.PI);
    bag.castShadow = true;
    production.add(bag);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 10), burlap);
    tie.rotation.x = Math.PI / 2;
    tie.position.set(sack.x, 0.58 * (1.15 - index * 0.08), sack.z);
    production.add(tie);
  }

  // -- signage on the partition ---------------------------------------------------
  const signTex = track((() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = '#2c2f33'; g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#cfd3d7'; g.lineWidth = 4; g.strokeRect(6, 6, 244, 84);
    g.fillStyle = '#e8ebee'; g.textAlign = 'center';
    g.font = 'bold 30px Georgia'; g.fillText('ROASTING LAB', 128, 44);
    g.font = '20px Georgia'; g.fillText('staff only', 128, 74);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })());
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.3),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }),
  );
  sign.rotation.y = Math.PI / 2;
  sign.position.set(spec.partitionX + 0.06, 1.95, (spec.rect.z0 + spec.rect.z1) / 2);
  production.add(sign);

  group.add(production);

  return {
    production,
    contactShadows: [
      { x: spec.roaster.x, z: spec.roaster.z, size: 1.8 },
      { x: spec.coolingTray.x, z: spec.coolingTray.z, size: 1.4 },
      { x: spec.bench.x + 0.15, z: spec.bench.z, size: 1.6 },
    ],
  };
}
