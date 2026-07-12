// Fitted salon library (CAFE_INTERIOR_REBUILD_PLAN §5): proportioned bays
// with backing, plinth, stiles, exact shelf planes and crown trim. Every
// object on a shelf is parented to the library group in shelf-local
// coordinates and sits exactly on its support plane, 30-50 mm behind the
// shelf edge. Books are a single InstancedMesh (one draw call, one material,
// per-instance colors) with 65-80% occupied width per shelf run.
import * as THREE from 'three';

// restrained burgundy / olive / ochre / cream / ink spines (plan §5)
const SPINE_COLORS = [0x7d3a2c, 0x6f7240, 0x9a7a3c, 0xd9cdb4, 0x2b2f3a, 0x5a2f3d];
const BOOK_DEPTH = 0.15;

export function buildFittedLibrary({
  group, spec, wallX, helpers, mats, models, cloneModel, rand,
}) {
  const { box, roundedBox, cyl } = helpers;
  const { woodMat, woodDarkMat, metalMat, ceramicMat } = mats;
  const span = spec.z1 - spec.z0;
  const centerZ = (spec.z0 + spec.z1) / 2;
  const height = spec.height ?? 2.16;
  const bays = spec.bays ?? 5;
  const caseDepth = 0.34;
  const stileW = 0.045;
  const bayWidth = (span - stileW * (bays + 1)) / bays;
  const shelfYs = [0.35, 0.79, 1.23, 1.67];
  const shelfThickness = 0.028;
  const frontFaceX = -caseDepth / 2; // local; the room-facing edge

  const library = new THREE.Group();
  library.position.set(wallX - caseDepth / 2 - 0.02, 0, centerZ);

  // -- carcass ---------------------------------------------------------------
  const plinth = roundedBox(caseDepth + 0.02, 0.09, span + 0.02, woodDarkMat, 0.02);
  plinth.position.y = 0.045;
  library.add(plinth);
  const backing = box(0.02, height - 0.09, span, woodDarkMat);
  backing.position.set(caseDepth / 2 - 0.01, 0.09 + (height - 0.09) / 2, 0);
  library.add(backing);
  const crown = roundedBox(caseDepth + 0.05, 0.07, span + 0.06, woodDarkMat, 0.022);
  crown.position.y = height - 0.035;
  library.add(crown);
  for (let i = 0; i <= bays; i += 1) {
    const z = -span / 2 + stileW / 2 + i * (stileW + bayWidth);
    const stile = box(caseDepth - 0.02, height - 0.16, stileW, woodMat);
    stile.position.set(0, 0.09 + (height - 0.16) / 2, z);
    library.add(stile);
  }
  for (let bay = 0; bay < bays; bay += 1) {
    const bayCenterZ = -span / 2 + stileW + bayWidth / 2 + bay * (stileW + bayWidth);
    for (const shelfY of shelfYs) {
      const shelf = box(caseDepth - 0.06, shelfThickness, bayWidth, woodMat);
      shelf.position.set(0, shelfY - shelfThickness / 2, bayCenterZ);
      library.add(shelf);
    }
  }

  // -- instanced books ---------------------------------------------------------
  // Books stand 30-50 mm behind the shelf edge: front of the book block at
  // frontFace + 0.04, so the instance centre x is fixed for every book.
  const bookCenterX = frontFaceX + 0.04 + BOOK_DEPTH / 2;
  // geometry/material are owned by this café build and disposed with it
  const bookGeometry = new THREE.BoxGeometry(1, 1, 1);
  const bookMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });
  const capacity = bays * shelfYs.length * 16;
  const books = new THREE.InstancedMesh(bookGeometry, bookMaterial, capacity);
  books.castShadow = true;
  books.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  const xAxis = new THREE.Vector3(1, 0, 0);
  let count = 0;
  const decorSlots = []; // gaps we intentionally leave for objects

  const placeBook = (shelfWorldY, z, width, bookHeight, lean = 0) => {
    if (count >= capacity) return;
    quaternion.setFromAxisAngle(xAxis, lean);
    matrix.compose(
      new THREE.Vector3(bookCenterX, shelfWorldY + bookHeight / 2, z),
      quaternion,
      new THREE.Vector3(BOOK_DEPTH, bookHeight, width),
    );
    books.setMatrixAt(count, matrix);
    books.setColorAt(count, color.setHex(SPINE_COLORS[Math.floor(rand(0, SPINE_COLORS.length)) % SPINE_COLORS.length]));
    count += 1;
  };

  const placeFlatStack = (shelfWorldY, z, width) => {
    // two or three books lying flat; `width` is the run they occupy along z
    const n = rand(0, 1) < 0.5 ? 2 : 3;
    let y = shelfWorldY;
    for (let i = 0; i < n && count < capacity; i += 1) {
      const thickness = rand(0.035, 0.05);
      quaternion.setFromAxisAngle(xAxis, Math.PI / 2);
      matrix.compose(
        new THREE.Vector3(bookCenterX, y + thickness / 2, z),
        quaternion,
        new THREE.Vector3(BOOK_DEPTH, width - rand(0, 0.03), thickness),
      );
      books.setMatrixAt(count, matrix);
      books.setColorAt(count, color.setHex(SPINE_COLORS[Math.floor(rand(0, SPINE_COLORS.length)) % SPINE_COLORS.length]));
      count += 1;
      y += thickness;
    }
  };

  for (let bay = 0; bay < bays; bay += 1) {
    const bayCenterZ = -span / 2 + stileW + bayWidth / 2 + bay * (stileW + bayWidth);
    shelfYs.forEach((shelfY, shelfIndex) => {
      const usable = bayWidth - 0.06;
      // 65-80% of the run is occupied; the rest becomes air and decor gaps
      const targetFill = usable * rand(0.65, 0.8);
      let filled = 0;
      let z = bayCenterZ - usable / 2;
      let leanNext = rand(0, 1) < 0.22;
      // roughly one shelf in three keeps a decor slot instead of pure books
      const decorShelf = (bay + shelfIndex) % 3 === 2;
      const decorWidth = decorShelf ? Math.min(0.34, usable * 0.35) : 0;
      const flatStack = !decorShelf && rand(0, 1) < 0.3;
      const flatWidth = flatStack ? rand(0.16, 0.2) : 0;
      while (filled < targetFill - decorWidth - flatWidth) {
        const w = rand(0.03, 0.055);
        const h = rand(0.17, 0.26);
        placeBook(shelfY, z + w / 2, w, h, leanNext ? -0.1 : 0);
        leanNext = false;
        z += w + 0.006;
        filled += w + 0.006;
        if (rand(0, 1) < 0.06) { // occasional breathing gap in the run
          z += 0.03;
          filled += 0.03;
        }
      }
      if (flatStack) {
        placeFlatStack(shelfY, z + flatWidth / 2 + 0.02, flatWidth);
        z += flatWidth + 0.04;
      }
      if (decorShelf) {
        decorSlots.push({ shelfY, z: z + decorWidth / 2 + 0.02, width: decorWidth, bay, shelfIndex });
      }
    });
  }
  books.count = count;
  books.instanceMatrix.needsUpdate = true;
  if (books.instanceColor) books.instanceColor.needsUpdate = true;
  library.add(books);

  // -- shelf objects (shelf-local, tagged for the decor audit) -----------------
  const onShelf = (object, shelfY, name) => {
    object.userData.surfaceY = shelfY;
    object.userData.surfaceName = name;
    return object;
  };
  let plantsPlaced = 0;
  decorSlots.forEach((slot, index) => {
    const name = `library-bay${slot.bay + 1}-shelf${slot.shelfIndex + 1}`;
    const kind = index % 4;
    if (kind === 0) {
      // brass bookend pair holding the run
      for (const side of [-1, 1]) {
        const bookend = box(0.09, 0.11, 0.012, metalMat);
        bookend.position.set(bookCenterX, slot.shelfY + 0.055, slot.z + side * (slot.width / 2 - 0.01));
        library.add(onShelf(bookend, slot.shelfY, name));
      }
      const mid = box(0.08, 0.1, Math.max(0.04, slot.width - 0.08), woodDarkMat);
      mid.position.set(bookCenterX, slot.shelfY + 0.05, slot.z);
      library.add(onShelf(mid, slot.shelfY, name));
    } else if (kind === 1) {
      // two small ceramics
      for (const [dz, r, h] of [[-0.06, 0.032, 0.11], [0.055, 0.042, 0.075]]) {
        const vase = cyl(r, r * 0.82, h, ceramicMat, 12);
        vase.position.set(bookCenterX, slot.shelfY + h / 2, slot.z + dz);
        library.add(onShelf(vase, slot.shelfY, name));
      }
    } else if (kind === 2) {
      // a small framed photograph leaning on the backing
      const photoFrame = box(0.018, 0.16, 0.13, woodDarkMat);
      photoFrame.position.set(bookCenterX + 0.03, slot.shelfY + 0.08, slot.z);
      photoFrame.rotation.z = -0.09;
      library.add(onShelf(photoFrame, slot.shelfY, name));
      const photo = box(0.006, 0.12, 0.095, ceramicMat);
      photo.position.set(bookCenterX + 0.016, slot.shelfY + 0.08, slot.z);
      photo.rotation.z = -0.09;
      library.add(onShelf(photo, slot.shelfY, name));
    } else if (plantsPlaced < 2) {
      // at most two small plants live in the unit (plan §5)
      const pot = cloneModel(models, 'plant_succulent');
      if (pot) {
        pot.scale.setScalar(0.5);
        pot.position.set(bookCenterX, slot.shelfY, slot.z);
        library.add(onShelf(pot, slot.shelfY, name));
        plantsPlaced += 1;
      }
    } else {
      const jar = cyl(0.04, 0.036, 0.1, ceramicMat, 12);
      jar.position.set(bookCenterX, slot.shelfY + 0.05, slot.z);
      library.add(onShelf(jar, slot.shelfY, name));
    }
  });

  group.add(library);

  const worldFrontX = wallX - 0.02 - caseDepth;
  return {
    library,
    bookInstances: count,
    collider: {
      rect: { x0: worldFrontX - 0.04, x1: wallX, z0: spec.z0 - 0.06, z1: spec.z1 + 0.06 },
    },
    contactShadows: [
      { x: worldFrontX - 0.1, z: centerZ - span / 4, size: 1.6 },
      { x: worldFrontX - 0.1, z: centerZ + span / 4, size: 1.6 },
    ],
  };
}
