// Procedural coffee shop builder: three themed locations, built entirely
// from Three.js primitives + canvas textures (no external assets).

import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

// Room shell is shared across themes; palette, light, view and layout differ.
export const ROOM = { W: 13, D: 10.5, H: 3.6 };

export const THEMES = [
  {
    id: 'goldenhour',
    name: 'Golden Hour Café',
    blurb: 'Warm wood, late-afternoon sun, plants everywhere.',
    musicKey: 0, rain: false, exposure: 1.15,
    fog: { color: 0x2b1d12, density: 0.012 },
    floor: '#8a6242', floorLine: '#6d4b31', wall: '#c9b394', wallTrim: '#8a6242',
    wood: 0x6f4a2d, woodDark: 0x4e3018, accent: 0x2e6e4e, cushion: 0xa33b2e,
    counter: 0x5b3a20, counterTop: 0xd9c9a8,
    hemi: [0xffe0b0, 0x54371c, 0.55],
    sun: { color: 0xffb469, intensity: 2.6, pos: [6, 4.5, 12] },
    lampColor: 0xffb066, lampIntensity: 8, lampY: 2.3,
    outside: 'sunset',
    dust: true, neon: null,
    tables: [
      { x: -3.6, z: 1.4, type: 'round' }, { x: -3.8, z: -1.6, type: 'round' },
      { x: 3.4, z: 1.5, type: 'square' }, { x: 3.7, z: -1.5, type: 'round' },
      { x: 1.9, z: 3.1, type: 'round' }, { x: -1.9, z: 3.2, type: 'square' },
    ],
    windowBar: true, plants: 6,
  },
  {
    id: 'roastery',
    name: 'Downtown Roastery',
    blurb: 'Concrete and steel, big windows onto a bright city street.',
    musicKey: 5, rain: false, exposure: 1.05,
    fog: { color: 0x272a2e, density: 0.010 },
    floor: '#7d7f83', floorLine: '#6a6c70', wall: '#b9bcc0', wallTrim: '#3c3e42',
    wood: 0x8a6a48, woodDark: 0x2e2f33, accent: 0x1f2124, cushion: 0x3f4a54,
    counter: 0x2c2e32, counterTop: 0xcfd2d6,
    hemi: [0xdfeaf5, 0x53565c, 1.0],
    sun: { color: 0xf2f7ff, intensity: 2.0, pos: [-10, 6, 6] },
    lampColor: 0xffd9a0, lampIntensity: 4, lampY: 2.4,
    outside: 'city',
    dust: false, neon: null,
    tables: [
      { x: -3.9, z: 0.2, type: 'long' },
      { x: 3.4, z: 1.6, type: 'square' }, { x: 3.6, z: -1.4, type: 'square' },
      { x: 1.8, z: 3.2, type: 'round' }, { x: -1.9, z: 3.2, type: 'round' },
    ],
    windowBar: true, plants: 3,
  },
  {
    id: 'midnight',
    name: 'Midnight Jazz Corner',
    blurb: 'Rain on the glass, warm lamps, a neon glow. Open late.',
    musicKey: -3, rain: true, exposure: 1.25,
    fog: { color: 0x0b0d14, density: 0.016 },
    floor: '#4a3628', floorLine: '#38281d', wall: '#4e4038', wallTrim: '#2c2119',
    wood: 0x4e3323, woodDark: 0x2a1a10, accent: 0x7a2c26, cushion: 0x274235,
    counter: 0x332012, counterTop: 0x1d2b26,
    hemi: [0x30405e, 0x120c08, 0.4],
    sun: { color: 0x7e97c8, intensity: 0.5, pos: [4, 6, 12] },
    lampColor: 0xff9a4d, lampIntensity: 14, lampY: 2.25,
    outside: 'rainNight',
    dust: false, neon: { text: 'open late', color: '#ff5d8f' },
    tables: [
      { x: -3.6, z: 1.3, type: 'round' }, { x: -3.8, z: -1.7, type: 'round' },
      { x: 3.5, z: 1.4, type: 'round' }, { x: 3.7, z: -1.6, type: 'square' },
      { x: -1.9, z: 3.2, type: 'round' }, { x: 1.9, z: 3.1, type: 'round' },
    ],
    windowBar: true, plants: 4,
  },
];

// ---------- canvas texture helpers ----------

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function woodFloorTexture(base, line) {
  const tex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const plank = 64;
    for (let y = 0; y < h; y += plank) {
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(0,0,0,${rand(0.02, 0.07)})`;
        g.fillRect(rand(0, w), y + rand(0, plank), rand(20, 130), rand(1, 3));
      }
      g.fillStyle = line;
      g.fillRect(0, y, w, 2);
      const off = (y / plank) % 2 ? w / 2 : w / 4;
      g.fillRect(off, y, 2, plank);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function plasterTexture(base) {
  const tex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rand(0.01, 0.05)})`;
      g.fillRect(rand(0, w), rand(0, h), rand(1, 4), rand(1, 4));
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
}

// The world seen through the windows, painted per theme.
function outsideTexture(kind) {
  return canvasTexture(1024, 512, (g, w, h) => {
    if (kind === 'sunset') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#ffb45e'); sky.addColorStop(0.55, '#ff8f4d');
      sky.addColorStop(0.75, '#d95f38'); sky.addColorStop(1, '#7c3a24');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff2ce';
      g.beginPath(); g.arc(w * 0.68, h * 0.42, 46, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,220,160,0.55)';
      g.beginPath(); g.arc(w * 0.68, h * 0.42, 80, 0, 7); g.fill();
      // distant rooftops and trees
      g.fillStyle = '#5e3822';
      for (let x = 0; x < w; x += rand(60, 140)) {
        const bh = rand(40, 110);
        g.fillRect(x, h * 0.72 - bh, rand(50, 120), bh + 40);
      }
      g.fillStyle = '#432616';
      for (let x = 0; x < w; x += rand(40, 90)) {
        g.beginPath(); g.arc(x, h * 0.78, rand(18, 42), 0, 7); g.fill();
      }
      g.fillStyle = '#33190d'; g.fillRect(0, h * 0.8, w, h * 0.2);
    } else if (kind === 'city') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#bcd7ee'); sky.addColorStop(1, '#e8f1f7');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += rand(50, 110)) {
        const bh = rand(120, 330), bw = rand(60, 110);
        g.fillStyle = `hsl(${rand(200, 220)},12%,${rand(52, 70)}%)`;
        g.fillRect(x, h * 0.86 - bh, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        for (let wy = h * 0.86 - bh + 10; wy < h * 0.82; wy += 18)
          for (let wx = x + 8; wx < x + bw - 10; wx += 16)
            if (Math.random() < 0.8) g.fillRect(wx, wy, 8, 10);
      }
      g.fillStyle = '#9aa1a6'; g.fillRect(0, h * 0.86, w, h * 0.14); // street
      g.fillStyle = '#c6ccd1'; g.fillRect(0, h * 0.86, w, 6);
    } else { // rainNight
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#060810'); sky.addColorStop(1, '#101627');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += rand(50, 120)) {
        const bh = rand(130, 340), bw = rand(60, 110);
        g.fillStyle = '#0c1120';
        g.fillRect(x, h * 0.88 - bh, bw, bh);
        for (let wy = h * 0.88 - bh + 10; wy < h * 0.84; wy += 18)
          for (let wx = x + 8; wx < x + bw - 10; wx += 16)
            if (Math.random() < 0.4) {
              g.fillStyle = `rgba(255,${rand(170, 220) | 0},120,${rand(0.5, 1)})`;
              g.fillRect(wx, wy, 8, 10);
            }
      }
      // street-light bokeh + wet street reflections
      for (let i = 0; i < 26; i++) {
        const x = rand(0, w), y = rand(h * 0.55, h * 0.85), r = rand(4, 16);
        const hue = Math.random() < 0.3 ? '340' : '35';
        const glow = g.createRadialGradient(x, y, 0, x, y, r * 3);
        glow.addColorStop(0, `hsla(${hue},90%,65%,0.8)`);
        glow.addColorStop(1, 'transparent');
        g.fillStyle = glow;
        g.beginPath(); g.arc(x, y, r * 3, 0, 7); g.fill();
        g.fillStyle = `hsla(${hue},80%,60%,0.25)`;
        g.fillRect(x - 2, y, 4, h - y);
      }
      g.fillStyle = 'rgba(10,14,26,0.6)'; g.fillRect(0, h * 0.88, w, h * 0.12);
    }
  });
}

function artTexture(accentHex) {
  return canvasTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#efe8da'; g.fillRect(0, 0, w, h);
    const cols = ['#c96f4a', accentHex, '#54683f', '#b89a5b', '#71563c'];
    for (let i = 0; i < 5; i++) {
      g.fillStyle = cols[i % cols.length];
      g.globalAlpha = rand(0.5, 0.9);
      g.beginPath();
      g.arc(rand(20, w - 20), rand(20, h - 20), rand(10, 34), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

function menuTexture() {
  return canvasTexture(256, 170, (g, w, h) => {
    g.fillStyle = '#232019'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8dcc0';
    g.font = 'bold 22px Georgia';
    g.fillText('— MENU —', 66, 30);
    g.font = '15px Georgia';
    const items = [['espresso', '3.0'], ['latte', '4.5'], ['pour over', '5.0'], ['matcha', '5.5'], ['croissant', '3.5']];
    items.forEach(([n, p], i) => {
      g.fillText(n, 28, 62 + i * 21);
      g.fillText(p, w - 58, 62 + i * 21);
    });
  });
}

function neonTexture(text, color) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'italic bold 72px Georgia';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 26;
    g.strokeStyle = color; g.lineWidth = 3;
    g.strokeText(text, w / 2, h / 2);
    g.shadowBlur = 8;
    g.fillStyle = '#fff';
    g.fillText(text, w / 2, h / 2);
  });
}

function steamTexture() {
  const tex = canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.65)');
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  return tex;
}

// ---------- small builders ----------

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function makeChair(woodMat, cushionMat) {
  const g = new THREE.Group();
  const seat = box(0.42, 0.05, 0.42, woodMat); seat.position.y = 0.45; g.add(seat);
  const cushion = box(0.38, 0.045, 0.38, cushionMat); cushion.position.y = 0.49; g.add(cushion);
  const back = box(0.42, 0.45, 0.05, woodMat); back.position.set(0, 0.72, -0.19); g.add(back);
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
    const leg = box(0.04, 0.45, 0.04, woodMat);
    leg.position.set(x, 0.225, z); g.add(leg);
  }
  return g;
}

function makeStool(woodMat, cushionMat) {
  const g = new THREE.Group();
  const seat = cyl(0.19, 0.19, 0.06, cushionMat); seat.position.y = 0.62; g.add(seat);
  const pole = cyl(0.035, 0.035, 0.6, woodMat); pole.position.y = 0.31; g.add(pole);
  const base = cyl(0.16, 0.16, 0.03, woodMat); base.position.y = 0.02; g.add(base);
  return g;
}

function makeCup(accent) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.4 });
  const cup = cyl(0.045, 0.035, 0.075, mat, 14); cup.position.y = 0.038; g.add(cup);
  const coffee = cyl(0.038, 0.038, 0.006, new THREE.MeshStandardMaterial({ color: 0x3a2113, roughness: 0.25 }), 14);
  coffee.position.y = 0.073; g.add(coffee);
  const saucer = cyl(0.075, 0.06, 0.012, mat, 16); saucer.position.y = 0.006; g.add(saucer);
  return g;
}

function makePlant(potColor) {
  const g = new THREE.Group();
  const pot = cyl(0.16, 0.12, 0.24, new THREE.MeshStandardMaterial({ color: potColor, roughness: 0.9 }));
  pot.position.y = 0.12; g.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3f, roughness: 0.8 });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, rand(0.35, 0.6), 5), leafMat);
    leaf.position.set(rand(-0.07, 0.07), 0.24 + leaf.geometry.parameters.height / 2, rand(-0.07, 0.07));
    leaf.rotation.set(rand(-0.35, 0.35), 0, rand(-0.35, 0.35));
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

function makeBooks(n) {
  const g = new THREE.Group();
  const cols = [0x8a3b2e, 0x2e5e6e, 0x777a3c, 0xa08040, 0x5d3f6e];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const w = rand(0.035, 0.06), h = rand(0.18, 0.26);
    const b = box(w, h, 0.15, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.85 }));
    b.position.set(x + w / 2, h / 2, 0);
    b.rotation.z = Math.random() < 0.15 ? -0.25 : 0;
    g.add(b);
    x += w + 0.008;
  }
  return g;
}

// ---------- the café ----------

export function buildCafe(theme) {
  const group = new THREE.Group();
  const { W, D, H } = ROOM;
  const disposables = [];
  const track = (t) => { disposables.push(t); return t; };

  const woodMat = new THREE.MeshStandardMaterial({ color: theme.wood, roughness: 0.75 });
  const woodDarkMat = new THREE.MeshStandardMaterial({ color: theme.woodDark, roughness: 0.8 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: theme.cushion, roughness: 0.95 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6a6d70, roughness: 0.35, metalness: 0.7 });

  // floor
  const floorTex = track(woodFloorTexture(theme.floor, theme.floorLine));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ceiling
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ color: theme.wallTrim, roughness: 0.95 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  group.add(ceil);

  // walls — front (+z) and left (-x) get window openings
  const wallTex = track(plasterTexture(theme.wall));
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const sillY = 0.9, winH = 1.9, headY = sillY + winH;

  function windowedWall(len) {
    // returns group lying along local x, centered, opening from |x|<len/2-margin
    const g2 = new THREE.Group();
    const doorHalf = 0; // no door here
    const seg = (w, h, x, y) => {
      const m = box(w, h, 0.15, wallMat);
      m.position.set(x, y, 0);
      g2.add(m);
    };
    const m = 0.55; // margin columns at wall ends
    seg(len, sillY, 0, sillY / 2);                    // sill band
    seg(len, H - headY, 0, headY + (H - headY) / 2);  // header band
    seg(m, winH, -(len - m) / 2, sillY + winH / 2);   // end columns
    seg(m, winH, (len - m) / 2, sillY + winH / 2);
    // mullions
    for (const fx of [-len / 6, len / 6]) {
      const mm = box(0.08, winH, 0.08, woodDarkMat);
      mm.position.set(fx, sillY + winH / 2, 0);
      g2.add(mm);
    }
    // glass
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(len - m * 2, winH),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transmission: 0.95, transparent: true, opacity: 0.35,
        roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    glass.position.set(0, sillY + winH / 2, 0);
    g2.add(glass);
    void doorHalf;
    return g2;
  }

  // front wall: door in the middle, windows either side
  const doorW = 1.1, doorH = 2.3;
  {
    const half = (W - doorW) / 2;
    for (const s of [-1, 1]) {
      const w = windowedWall(half);
      w.position.set(s * (doorW / 2 + half / 2), 0, D / 2);
      group.add(w);
    }
    const header = box(doorW, H - doorH, 0.15, wallMat);
    header.position.set(0, doorH + (H - doorH) / 2, D / 2);
    group.add(header);
    // door frame + glass door
    const frame = box(doorW + 0.12, 0.08, 0.2, woodDarkMat);
    frame.position.set(0, doorH, D / 2);
    group.add(frame);
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW - 0.1, doorH - 0.1),
      new THREE.MeshPhysicalMaterial({ color: 0xcfe0e8, transmission: 0.9, transparent: true, opacity: 0.4, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    door.position.set(0, doorH / 2, D / 2 + 0.02);
    group.add(door);
    const handle = box(0.03, 0.5, 0.03, metalMat);
    handle.position.set(-0.35, 1.1, D / 2 - 0.06);
    group.add(handle);
  }

  // left wall with windows
  {
    const w = windowedWall(D);
    w.rotation.y = Math.PI / 2;
    w.position.set(-W / 2, 0, 0);
    group.add(w);
  }

  // right + back walls solid
  for (const [len, pos, rotY] of [
    [D, [W / 2, 0, 0], -Math.PI / 2],
    [W, [0, 0, -D / 2], 0],
  ]) {
    const m = box(len, H, 0.15, wallMat);
    m.position.set(pos[0], H / 2, pos[2]);
    m.rotation.y = rotY;
    m.position.y = H / 2;
    group.add(m);
  }

  // baseboard trim
  const trimMat = new THREE.MeshStandardMaterial({ color: theme.wallTrim, roughness: 0.9 });
  for (const [len, pos, rotY] of [
    [W, [0, 0.06, -D / 2 + 0.09], 0],
    [D, [W / 2 - 0.09, 0.06, 0], Math.PI / 2],
  ]) {
    const t = box(len, 0.12, 0.04, trimMat);
    t.position.set(...pos); t.rotation.y = rotY;
    group.add(t);
  }

  // outside backdrops (emissive planes past the windows)
  const outTex = track(outsideTexture(theme.outside));
  const outMat = new THREE.MeshBasicMaterial({ map: outTex, fog: false });
  const back1 = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.4, 9), outMat);
  back1.position.set(0, 2.6, D / 2 + 3.2);
  back1.rotation.y = Math.PI;
  group.add(back1);
  const back2 = new THREE.Mesh(new THREE.PlaneGeometry(D * 2.4, 9), outMat);
  back2.position.set(-W / 2 - 3.2, 2.6, 0);
  back2.rotation.y = Math.PI / 2;
  group.add(back2);

  // ---------- counter along back wall ----------
  const counterMat = new THREE.MeshStandardMaterial({ color: theme.counter, roughness: 0.7 });
  const counterTopMat = new THREE.MeshStandardMaterial({ color: theme.counterTop, roughness: 0.35 });
  const counter = box(6.2, 1.0, 0.75, counterMat);
  counter.position.set(-0.6, 0.5, -D / 2 + 1.15);
  group.add(counter);
  const ctop = box(6.4, 0.06, 0.85, counterTopMat);
  ctop.position.set(-0.6, 1.03, -D / 2 + 1.15);
  group.add(ctop);

  // espresso machine
  {
    const m = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb33939, roughness: 0.3, metalness: 0.4 });
    const body = box(0.85, 0.42, 0.5, bodyMat); body.position.y = 0.29; m.add(body);
    const top = box(0.9, 0.07, 0.55, metalMat); top.position.y = 0.53; m.add(top);
    for (const x of [-0.22, 0.22]) {
      const grp = cyl(0.035, 0.035, 0.12, metalMat); grp.position.set(x, 0.12, 0.2); m.add(grp);
      const hd = box(0.14, 0.05, 0.14, metalMat); hd.position.set(x, 0.06, 0.2); m.add(hd);
    }
    m.position.set(-2.2, 1.06, -D / 2 + 1.15);
    group.add(m);
  }
  // grinder + cup stack + register
  {
    const grinder = new THREE.Group();
    const b = cyl(0.09, 0.11, 0.3, woodDarkMat); b.position.y = 0.15; grinder.add(b);
    const hopper = cyl(0.11, 0.07, 0.14, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2, transparent: true, opacity: 0.85 }));
    hopper.position.y = 0.37; grinder.add(hopper);
    grinder.position.set(-1.2, 1.06, -D / 2 + 1.1);
    group.add(grinder);

    for (let i = 0; i < 8; i++) {
      const c = cyl(0.05, 0.04, 0.09, new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.5 }), 12);
      c.position.set(0.4 + (i % 4) * 0.12, 1.11 + Math.floor(i / 4) * 0.1, -D / 2 + 1.0);
      group.add(c);
    }
    const reg = box(0.4, 0.3, 0.35, woodDarkMat);
    reg.position.set(1.6, 1.21, -D / 2 + 1.15);
    group.add(reg);
    // pastry case
    const caseGlass = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.6),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.92, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false }));
    caseGlass.position.set(-4.2, 1.31, -D / 2 + 1.15);
    group.add(caseGlass);
    const caseBase = box(1.35, 0.5, 0.65, counterMat);
    caseBase.position.set(-4.2, 0.81, -D / 2 + 1.15);
    group.add(caseBase);
    const pastryMat = new THREE.MeshStandardMaterial({ color: 0xc98e4e, roughness: 0.8 });
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), pastryMat);
      p.scale.set(1.4, 0.7, 1);
      p.position.set(-4.55 + (i % 3) * 0.35, 1.12 + Math.floor(i / 3) * 0.16, -D / 2 + 1.1);
      group.add(p);
    }
  }

  // back bar shelves with books/jars + menu board
  {
    const shelfMat = woodMat;
    for (const y of [1.7, 2.2]) {
      const s = box(4.4, 0.05, 0.3, shelfMat);
      s.position.set(-2.4, y, -D / 2 + 0.25);
      group.add(s);
    }
    const books = makeBooks(10);
    books.position.set(-4.4, 1.73, -D / 2 + 0.25);
    group.add(books);
    for (let i = 0; i < 6; i++) {
      const jar = cyl(0.08, 0.08, rand(0.18, 0.3), new THREE.MeshStandardMaterial({ color: [0x9c7844, 0x6a4a2a, 0x8d8d6a][i % 3], roughness: 0.6 }), 12);
      jar.position.set(-3.6 + i * 0.5, 2.2 + jar.geometry.parameters.height / 2 + 0.03, -D / 2 + 0.25);
      group.add(jar);
    }
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.4),
      new THREE.MeshBasicMaterial({ map: track(menuTexture()) }));
    menu.position.set(1.4, 2.35, -D / 2 + 0.09);
    group.add(menu);
  }

  // neon sign (night café)
  let neonMesh = null;
  if (theme.neon) {
    neonMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65),
      new THREE.MeshBasicMaterial({ map: track(neonTexture(theme.neon.text, theme.neon.color)), transparent: true }));
    neonMesh.position.set(4.2, 2.5, -D / 2 + 0.09);
    group.add(neonMesh);
    const neonLight = new THREE.PointLight(theme.neon.color, 6, 6);
    neonLight.position.set(4.2, 2.5, -D / 2 + 0.6);
    group.add(neonLight);
  }

  // wall art on right wall
  for (let i = 0; i < 3; i++) {
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.95),
      new THREE.MeshStandardMaterial({ map: track(artTexture('#' + theme.accent.toString(16).padStart(6, '0'))), roughness: 0.9 }));
    art.rotation.y = -Math.PI / 2;
    art.position.set(W / 2 - 0.09, 1.8, -2.2 + i * 2.1);
    group.add(art);
    const frame = box(0.04, 1.05, 0.85, woodDarkMat);
    frame.position.set(W / 2 - 0.07, 1.8, -2.2 + i * 2.1);
    group.add(frame);
  }

  // ---------- tables + seats ----------
  const seats = [];      // {pos, look, tableCenter}
  const seatMeshes = []; // raycast targets
  const cups = [];       // for steam

  function addSeat(chair, seatPos, lookAt, tableCenter) {
    chair.traverse((o) => { o.userData.seatIndex = seats.length; });
    chair.userData.seatIndex = seats.length;
    seats.push({ pos: seatPos, look: lookAt, tableCenter, chair });
    seatMeshes.push(chair);
  }

  function addTable(tx, tz, type) {
    const tGroup = new THREE.Group();
    const center = new THREE.Vector3(tx, 0, tz);
    let topY = 0.78;
    if (type === 'long') {
      const top = box(1.1, 0.06, 2.6, woodMat); top.position.y = topY; tGroup.add(top);
      for (const [lx, lz] of [[-0.45, -1.15], [0.45, -1.15], [-0.45, 1.15], [0.45, 1.15]]) {
        const leg = box(0.07, topY, 0.07, woodDarkMat);
        leg.position.set(lx, topY / 2, lz); tGroup.add(leg);
      }
    } else if (type === 'square') {
      const top = box(0.95, 0.055, 0.95, woodMat); top.position.y = topY; tGroup.add(top);
      for (const [lx, lz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
        const leg = box(0.06, topY, 0.06, woodDarkMat);
        leg.position.set(lx, topY / 2, lz); tGroup.add(leg);
      }
    } else {
      const top = cyl(0.52, 0.52, 0.05, woodMat, 24); top.position.y = topY; tGroup.add(top);
      const pole = cyl(0.05, 0.05, topY, woodDarkMat); pole.position.y = topY / 2; tGroup.add(pole);
      const base = cyl(0.3, 0.34, 0.04, woodDarkMat, 20); base.position.y = 0.02; tGroup.add(base);
    }
    tGroup.position.set(tx, 0, tz);
    group.add(tGroup);

    // chairs around the table, rotated to face center
    const chairDefs = type === 'long'
      ? [[-0.95, -0.7], [-0.95, 0.7], [0.95, -0.7], [0.95, 0.7]]
      : [[0, -0.85], [0, 0.85], [-0.85, 0], [0.85, 0]].slice(0, type === 'square' ? 4 : 3);
    for (const [cx, cz] of chairDefs) {
      const chair = makeChair(woodMat, cushionMat);
      const px = tx + cx, pz = tz + cz;
      chair.position.set(px, 0, pz);
      chair.lookAt(tx, 0, tz);
      group.add(chair);
      addSeat(chair,
        new THREE.Vector3(px, 0, pz),
        new THREE.Vector3(tx, 1.08, tz), // near eye level, so the room stays in view
        center);
    }
    // a cup + maybe a little vase on the table
    const cup = makeCup(theme.accent);
    cup.position.set(tx + rand(-0.15, 0.15), topY + 0.03, tz + rand(-0.15, 0.15));
    group.add(cup);
    cups.push(cup);
    if (Math.random() < 0.6) {
      const vase = cyl(0.03, 0.045, 0.12, new THREE.MeshStandardMaterial({ color: 0x87a06a, roughness: 0.6 }), 10);
      vase.position.set(tx - 0.2, topY + 0.09, tz + 0.15);
      group.add(vase);
      const stem = cyl(0.006, 0.006, 0.16, new THREE.MeshStandardMaterial({ color: 0x4a7040 }), 6);
      stem.position.set(tx - 0.2, topY + 0.22, tz + 0.15);
      stem.rotation.z = 0.15;
      group.add(stem);
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xd9793e, roughness: 0.7 }));
      flower.position.set(tx - 0.22, tz ? topY + 0.3 : topY + 0.3, tz + 0.15);
      flower.position.set(tx - 0.223, topY + 0.3, tz + 0.15);
      group.add(flower);
    }
  }

  for (const t of theme.tables) addTable(t.x, t.z, t.type);

  // window bar with stools, looking out the front window
  if (theme.windowBar) {
    for (const s of [-1, 1]) {
      const barLen = (W - doorW) / 2 - 1.3;
      const bx = s * (doorW / 2 + 0.65 + barLen / 2);
      const bar = box(barLen, 0.05, 0.42, woodMat);
      bar.position.set(bx, 1.0, D / 2 - 0.45);
      group.add(bar);
      for (const [lx] of [[-barLen / 2 + 0.2], [barLen / 2 - 0.2]]) {
        const leg = box(0.05, 1.0, 0.36, woodDarkMat);
        leg.position.set(bx + lx, 0.5, D / 2 - 0.45);
        group.add(leg);
      }
      const nStools = Math.floor(barLen / 1.1);
      for (let i = 0; i < nStools; i++) {
        const sx = bx - barLen / 2 + (i + 0.5) * (barLen / nStools);
        const stool = makeStool(woodDarkMat, cushionMat);
        stool.position.set(sx, 0, D / 2 - 1.05);
        group.add(stool);
        addSeat(stool,
          new THREE.Vector3(sx, 0.15, D / 2 - 1.05),
          new THREE.Vector3(sx, 1.5, D / 2 + 3),
          new THREE.Vector3(sx, 0, D / 2 - 0.45));
        if (Math.random() < 0.5) {
          const cup = makeCup(theme.accent);
          cup.position.set(sx + rand(-0.1, 0.1), 1.03, D / 2 - 0.45);
          group.add(cup);
          cups.push(cup);
        }
      }
    }
  }

  // plants
  const plantSpots = [
    [-W / 2 + 0.7, -D / 2 + 0.7], [W / 2 - 0.7, D / 2 - 0.9], [W / 2 - 0.6, -D / 2 + 2.6],
    [-W / 2 + 0.6, 2.8], [2.6, -3.0], [-1.6, -3.2],
  ];
  for (let i = 0; i < Math.min(theme.plants, plantSpots.length); i++) {
    const p = makePlant(theme.woodDark);
    p.position.set(plantSpots[i][0], 0, plantSpots[i][1]);
    p.scale.setScalar(rand(1.2, 2.0));
    group.add(p);
  }

  // rug under the seating area
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32),
    new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-3.6, 0.01, 0);
  rug.receiveShadow = true;
  group.add(rug);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.set(...theme.sun.pos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
  sun.shadow.bias = -0.0005;
  group.add(sun);
  group.add(sun.target);

  // pendant lamps over the tables
  const lampMats = [];
  const lampLights = [];
  theme.tables.forEach((t, i) => {
    const cord = cyl(0.008, 0.008, H - theme.lampY, woodDarkMat, 6);
    cord.position.set(t.x, theme.lampY + (H - theme.lampY) / 2, t.z);
    group.add(cord);
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x282018, roughness: 0.6,
      emissive: theme.lampColor, emissiveIntensity: 0.25,
    });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.16, 16, 1, true), shadeMat);
    shade.position.set(t.x, theme.lampY, t.z);
    group.add(shade);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), bulbMat);
    bulb.position.set(t.x, theme.lampY - 0.05, t.z);
    group.add(bulb);
    lampMats.push(shadeMat, bulbMat);
    if (i < (theme.rain ? 6 : 4)) { // the night café leans on its lamps
      const pl = new THREE.PointLight(theme.lampColor, theme.lampIntensity, 6, 2);
      pl.position.set(t.x, theme.lampY - 0.12, t.z);
      group.add(pl);
      lampLights.push(pl);
    }
  });

  // ---------- atmosphere particles ----------
  const steamTex = track(steamTexture());
  const steamSprites = [];
  for (const cup of cups) {
    if (Math.random() < 0.7) continue; // only some cups steam
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: steamTex, transparent: true, opacity: 0, depthWrite: false,
      }));
      s.scale.setScalar(0.1);
      cup.add(s);
      steamSprites.push({ sprite: s, phase: rand(0, 10), speed: rand(0.5, 0.9) });
    }
  }

  // sun dust motes
  let dust = null;
  if (theme.dust) {
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-2, 5);
      pos[i * 3 + 1] = rand(0.4, 3);
      pos[i * 3 + 2] = rand(-1, 4.8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffdda8, size: 0.02, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    group.add(dust);
  }

  // rain streaks outside the windows
  let rain = null;
  if (theme.rain) {
    const n = 500;
    const pos = new Float32Array(n * 3);
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // spread outside the front and left windows
      if (Math.random() < 0.6) {
        pos[i * 3] = rand(-W, W);
        pos[i * 3 + 1] = rand(0, 7);
        pos[i * 3 + 2] = D / 2 + rand(0.4, 2.8);
      } else {
        pos[i * 3] = -W / 2 - rand(0.4, 2.8);
        pos[i * 3 + 1] = rand(0, 7);
        pos[i * 3 + 2] = rand(-D, D);
      }
      speed[i] = rand(5, 9);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x8fa8cc, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
    }));
    rain.userData.speed = speed;
    group.add(rain);
  }

  // ---------- NPC navigation info ----------
  const nav = {
    door: new THREE.Vector3(0, 0, D / 2 - 0.4),
    doorInside: new THREE.Vector3(0, 0, D / 2 - 1.4),
    counter: new THREE.Vector3(-0.6, 0, -D / 2 + 2.1),
    baristaHome: new THREE.Vector3(-1.8, 0, -D / 2 + 0.6),
    corridorX: 0, // the clear vertical aisle
  };

  // ---------- per-frame animation ----------
  let t = 0;
  function animate(dt) {
    t += dt;
    for (const s of steamSprites) {
      const cycle = (t * s.speed + s.phase) % 3;
      const f = cycle / 3;
      s.sprite.position.y = 0.1 + f * 0.4;
      s.sprite.position.x = Math.sin((t + s.phase) * 1.7) * 0.03;
      s.sprite.material.opacity = f < 0.15 ? f * 2.3 : 0.35 * (1 - f);
      s.sprite.scale.setScalar(0.08 + f * 0.16);
    }
    if (dust) {
      const p = dust.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setY(i, p.getY(i) + Math.sin(t * 0.4 + i) * 0.0008);
        p.setX(i, p.getX(i) + Math.cos(t * 0.3 + i * 1.7) * 0.0006);
      }
      p.needsUpdate = true;
    }
    if (rain) {
      const p = rain.geometry.attributes.position;
      const speed = rain.userData.speed;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - speed[i] * dt;
        if (y < 0) y = 7;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    if (neonMesh) {
      neonMesh.material.opacity = 0.86 + Math.sin(t * 30) * 0.04 + (Math.random() < 0.005 ? -0.4 : 0);
      neonMesh.material.transparent = true;
    }
    // subtle lamp warmth flicker
    lampLights.forEach((pl, i) => {
      pl.intensity = theme.lampIntensity * (1 + Math.sin(t * 7 + i * 2) * 0.03);
    });
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    disposables.forEach((d) => d.dispose());
  }

  return { group, seats, seatMeshes, nav, theme, animate, dispose, woodMat, cushionMat };
}
