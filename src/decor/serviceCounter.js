// Service-counter upgrades and the semantic work-anchor contract. The legacy
// counter body still lives in cafe.js; everything NEW about the service area
// is authored here so the waiter/service-coordinator workstream can consume one
// stable anchor set, and sound positions derive from the same data.

import * as THREE from 'three';

// Per-café menu boards. Data-driven so each café reads like its own business
// (the old board hard-coded one menu for every location).
export const SERVICE_MENUS = {
  goldenhour: {
    title: 'GOLDEN HOUR',
    items: [
      ['espresso', '3.0'], ['latte', '4.5'], ['honey flat white', '5.0'],
      ['matcha', '5.5'], ['croissant', '3.5'],
    ],
    special: "today · banana bread + pour over 6.5",
  },
  roastery: {
    title: 'DOWNTOWN ROASTERY',
    items: [
      ['espresso', '3.2'], ['batch brew', '3.0'], ['pour over', '5.5'],
      ['cortado', '4.2'], ['beans 250g', '14'],
    ],
    special: 'today · ethiopia natural, tasting 4pm',
  },
  midnight: {
    title: 'MIDNIGHT JAZZ',
    items: [
      ['espresso', '3.0'], ['affogato', '6.0'], ['irish coffee', '8.5'],
      ['decaf latte', '4.5'], ['cheesecake', '5.5'],
    ],
    special: 'tonight · late set 10pm',
  },
  terrace: {
    title: 'GARDEN TERRACE',
    items: [
      ['iced latte', '5.0'], ['cold brew', '4.5'], ['lemonade', '4.0'],
      ['herbal tea', '4.0'], ['scone', '3.5'],
    ],
    special: 'today · fresh mint tea from the herb bench',
  },
};

function textCanvas(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Readable menu-board texture generated from SERVICE_MENUS data.
export function menuBoardTexture(themeId) {
  const menu = SERVICE_MENUS[themeId] ?? SERVICE_MENUS.goldenhour;
  return textCanvas(384, 256, (g, w, h) => {
    g.fillStyle = '#232019';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(232,220,192,0.45)';
    g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#e8dcc0';
    g.textAlign = 'center';
    g.font = 'bold 24px Georgia';
    g.fillText(`— ${menu.title} —`, w / 2, 40);
    g.font = '19px Georgia';
    menu.items.forEach(([name, price], index) => {
      const y = 76 + index * 28;
      g.textAlign = 'left';
      g.fillText(name, 34, y);
      g.textAlign = 'right';
      g.fillText(price, w - 34, y);
    });
    g.fillStyle = '#d8b26a';
    g.font = 'italic 15px Georgia';
    g.textAlign = 'center';
    g.fillText(menu.special, w / 2, h - 22);
  });
}

// The semantic work anchors every service consumer shares: the barista and
// the future waiter reserve these, and audio positions derive from them so
// sound and visible action cannot drift apart. Coordinates follow the
// counter layout in cafe.js (row at z = -D/2 + 1.15).
export function serviceAnchorsFor(D) {
  const counterZ = -D / 2 + 1.15;
  const staffZ = -D / 2 + 0.6;
  const customerZ = -D / 2 + 2.2;
  return {
    register: new THREE.Vector3(2.2, 0, staffZ),
    espresso: new THREE.Vector3(-2.2, 0, staffZ),
    pickup: new THREE.Vector3(-0.7, 0, customerZ),
    pastryCase: new THREE.Vector3(-3.9, 0, staffZ),
    restock: new THREE.Vector3(0.4, 0, staffZ),
    dirtyDish: new THREE.Vector3(4.0, 0, -D / 2 + 2.6),
    waiterStandby: new THREE.Vector3(-4.6, 0, -D / 2 + 2.5),
    // audio emitter positions (world, with height) derived from the same rows
    audio: {
      register: new THREE.Vector3(2.2, 1.1, counterZ),
      espresso: new THREE.Vector3(-2.2, 1.1, counterZ),
      pickup: new THREE.Vector3(-0.7, 1.1, counterZ),
      dishes: new THREE.Vector3(4.0, 0.9, -D / 2 + 1.9),
    },
  };
}

// Builds the new counter dressing: POS details, pickup tray + bell, espresso
// work tools, cup station, and the dirty-dish return. Everything uses flat
// shared-style materials so the static-decor merge folds it into existing
// batches; the only textures are the menu board and two small signs.
export function buildServiceUpgrades({ group, theme, D, helpers, mats }) {
  const { box, cyl, roundedBox, track } = helpers;
  const { woodDarkMat, metalMat } = mats;
  const counterZ = -D / 2 + 1.15;
  const topY = 1.06;

  const cream = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.6 });
  const kraft = new THREE.MeshStandardMaterial({ color: 0xb98d5f, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bfc6, roughness: 0.35, metalness: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.35, metalness: 0.75 });
  const darkPlastic = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 });

  // --- register zone: card reader, receipt slot, customer-facing display ---
  const reader = box(0.11, 0.05, 0.14, darkPlastic);
  reader.position.set(2.62, topY + 0.025, counterZ + 0.22);
  reader.rotation.y = -0.35;
  group.add(reader);
  const readerScreen = box(0.08, 0.012, 0.09, new THREE.MeshStandardMaterial({
    color: 0x1c2b33, emissive: 0x2c6f7a, emissiveIntensity: 0.55, roughness: 0.4,
  }));
  readerScreen.position.set(2.62, topY + 0.056, counterZ + 0.21);
  readerScreen.rotation.y = -0.35;
  group.add(readerScreen);
  const receiptSlot = box(0.16, 0.02, 0.05, darkPlastic);
  receiptSlot.position.set(2.2, 1.375, counterZ + 0.06);
  group.add(receiptSlot);
  // small customer-facing total display on the register back
  const customerDisplay = box(0.2, 0.12, 0.015, darkPlastic);
  customerDisplay.position.set(2.2, 1.3, counterZ + 0.19);
  group.add(customerDisplay);
  const customerGlow = box(0.16, 0.08, 0.004, new THREE.MeshStandardMaterial({
    color: 0x101a12, emissive: 0x3f8a4a, emissiveIntensity: 0.7, roughness: 0.4,
  }));
  customerGlow.position.set(2.2, 1.3, counterZ + 0.2);
  group.add(customerGlow);

  // --- pickup zone: serving tray, brass counter bell, small sign ---
  const tray = roundedBox(0.52, 0.025, 0.36, woodDarkMat, 0.01);
  tray.position.set(-0.7, topY + 0.012, counterZ + 0.12);
  group.add(tray);
  const bellBase = cyl(0.05, 0.055, 0.025, brass, 12);
  bellBase.position.set(-0.28, topY + 0.012, counterZ + 0.2);
  group.add(bellBase);
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  bellDome.position.set(-0.28, topY + 0.025, counterZ + 0.2);
  group.add(bellDome);
  const pickupSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.11),
    new THREE.MeshBasicMaterial({
      map: track(textCanvas(96, 44, (g, w, h) => {
        g.fillStyle = '#efe7d6';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#4a4136';
        g.font = 'bold 19px Georgia';
        g.textAlign = 'center';
        g.fillText('PICK UP', w / 2, 29);
      })),
    })
  );
  pickupSign.position.set(-0.7, topY + 0.12, counterZ + 0.31);
  pickupSign.rotation.x = -0.35;
  group.add(pickupSign);

  // --- espresso work zone: knock box, tamp mat, milk pitcher ---
  const knockBox = box(0.16, 0.12, 0.16, darkPlastic);
  knockBox.position.set(-2.85, topY + 0.06, counterZ - 0.05);
  group.add(knockBox);
  const knockBar = cyl(0.014, 0.014, 0.17, steel, 8);
  knockBar.rotation.z = Math.PI / 2;
  knockBar.position.set(-2.85, topY + 0.125, counterZ - 0.05);
  group.add(knockBar);
  const tampMat = box(0.28, 0.01, 0.2, new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.95 }));
  tampMat.position.set(-1.72, topY + 0.005, counterZ - 0.02);
  group.add(tampMat);
  const pitcher = cyl(0.05, 0.038, 0.11, steel, 10);
  pitcher.position.set(-1.62, topY + 0.055, counterZ - 0.22);
  group.add(pitcher);
  const pitcherHandle = box(0.012, 0.07, 0.03, steel);
  pitcherHandle.position.set(-1.56, topY + 0.06, counterZ - 0.22);
  group.add(pitcherHandle);

  // --- cup station beside the cup stack: lids, sleeves, napkins, stirrers ---
  const backZ = -D / 2 + 0.35;
  const lidStack = cyl(0.052, 0.052, 0.07, darkPlastic, 12);
  lidStack.position.set(0.86, topY + 0.085, backZ + 0.05);
  group.add(lidStack);
  const sleeves = box(0.13, 0.09, 0.13, kraft);
  sleeves.position.set(1.06, topY + 0.095, backZ + 0.02);
  group.add(sleeves);
  const napkinHolder = box(0.17, 0.02, 0.07, metalMat);
  napkinHolder.position.set(0.66, topY + 0.06, backZ + 0.18);
  group.add(napkinHolder);
  const napkins = box(0.15, 0.07, 0.055, cream);
  napkins.position.set(0.66, topY + 0.095, backZ + 0.18);
  group.add(napkins);
  const stirrers = cyl(0.03, 0.026, 0.09, cream, 10);
  stirrers.position.set(0.52, topY + 0.095, backZ + 0.05);
  group.add(stirrers);

  // --- dirty-dish return: open tub on a low stand by the bin, off the aisle ---
  const standX = 4.0;
  const standZ = -D / 2 + 1.9;
  const stand = box(0.55, 0.72, 0.42, woodDarkMat);
  stand.position.set(standX, 0.36, standZ);
  group.add(stand);
  const tub = box(0.48, 0.16, 0.36, new THREE.MeshStandardMaterial({ color: 0x8f9499, roughness: 0.8 }));
  tub.position.set(standX, 0.8, standZ);
  group.add(tub);
  const tubInner = box(0.42, 0.14, 0.3, new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.9 }));
  tubInner.position.set(standX, 0.82, standZ);
  group.add(tubInner);
  const dishSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.09),
    new THREE.MeshBasicMaterial({
      map: track(textCanvas(128, 40, (g, w, h) => {
        g.fillStyle = '#efe7d6';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#4a4136';
        g.font = 'bold 15px Georgia';
        g.textAlign = 'center';
        g.fillText('DISHES · THANKS', w / 2, 26);
      })),
    })
  );
  dishSign.position.set(standX, 0.62, standZ + 0.215);
  group.add(dishSign);

  return { anchors: serviceAnchorsFor(D), dishReturnCollider: { x: standX, z: standZ, r: 0.42 } };
}
