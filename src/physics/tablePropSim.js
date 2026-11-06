// Rapier simulation of one bumped tabletop. The table is a kinematic body
// that is physically shoved by the bump (a few millimetres, ringing out at
// the frame's natural frequency) and the props respond only through contact
// and friction, so a mug skids a little, a tall bottle rocks, and stacked
// items stay put unless the knock is hard. Bodies sleep as soon as they come
// to rest and the scene ends itself; nothing simulates while the café is
// undisturbed.
//
// Scene description (all in the café group's space, metres, kilograms):
//   top:   { x, y, z, yaw, shape: 'box' | 'cylinder', hx, hz, radius }
//          y is the tabletop surface height
//   props: [{ id, x, y, z, qx, qy, qz, qw, shape: 'box' | 'cylinder',
//             hx, hy, hz, radius, ox, oy, oz, mass, friction, restitution }]
//          (ox, oy, oz) offsets the collider from the body origin
//   kick:  { dx, dz, speed }  horizontal bump direction and impact speed

export const TABLE_STEP = 1 / 120;
export const MAX_SCENE_SECONDS = 3;
const SLAB = 0.02;

export function kickDisplacement(kick, t, out = { x: 0, y: 0, z: 0 }) {
  // a damped push-and-ring: the frame moves with the walker, then springs back
  const amplitude = Math.min(0.012, 0.0055 * kick.speed);
  const envelope = Math.exp(-t / 0.09);
  const swing = Math.sin(2 * Math.PI * 7.5 * t + 0.35) * envelope;
  const lift = Math.max(0, Math.sin(2 * Math.PI * 11 * t)) * Math.exp(-t / 0.05) * 0.35;
  out.x = kick.dx * amplitude * swing;
  out.z = kick.dz * amplitude * swing;
  out.y = amplitude * lift;
  return out;
}

export function createTableScene(RAPIER, scene) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = TABLE_STEP;
  const events = new RAPIER.EventQueue(true);
  const top = scene.top;
  const topBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(top.x, top.y - SLAB, top.z)
      .setRotation(yawQuaternion(top.yaw ?? 0)),
  );
  const topDesc = top.shape === 'cylinder'
    ? RAPIER.ColliderDesc.cylinder(SLAB, Math.max(0.05, top.radius))
    : RAPIER.ColliderDesc.cuboid(Math.max(0.05, top.hx), SLAB, Math.max(0.05, top.hz));
  world.createCollider(topDesc.setFriction(0.55).setRestitution(0.1), topBody);
  // the floor catches anything knocked off the edge
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(top.x, -0.05, top.z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.05, 4).setFriction(0.7), floor);

  const bodies = [];
  const handles = new Map();
  for (const prop of scene.props) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(prop.x, prop.y, prop.z)
        .setRotation({ x: prop.qx, y: prop.qy, z: prop.qz, w: prop.qw })
        .setLinearDamping(0.05)
        .setAngularDamping(0.15)
        .setCanSleep(true),
    );
    const desc = prop.shape === 'cylinder'
      ? RAPIER.ColliderDesc.cylinder(Math.max(0.004, prop.hy), Math.max(0.01, prop.radius))
      : RAPIER.ColliderDesc.cuboid(Math.max(0.004, prop.hx), Math.max(0.004, prop.hy), Math.max(0.004, prop.hz));
    desc.setTranslation(prop.ox ?? 0, prop.oy ?? prop.hy, prop.oz ?? 0)
      .setMass(Math.max(0.03, prop.mass))
      .setFriction(prop.friction ?? 0.45)
      .setRestitution(prop.restitution ?? 0.12)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(Math.max(0.4, prop.mass * 14));
    const collider = world.createCollider(desc, body);
    handles.set(collider.handle, prop.id);
    bodies.push({ id: prop.id, body });
  }

  const kick = scene.kick;
  const offset = { x: 0, y: 0, z: 0 };
  let t = 0;
  let restFrames = 0;
  const transforms = new Float32Array(bodies.length * 8);
  const contacts = [];

  function step(seconds) {
    contacts.length = 0;
    const steps = Math.max(1, Math.round(seconds / TABLE_STEP));
    for (let i = 0; i < steps; i += 1) {
      t += TABLE_STEP;
      kickDisplacement(kick, t, offset);
      topBody.setNextKinematicTranslation({ x: top.x + offset.x, y: top.y - SLAB + offset.y, z: top.z + offset.z });
      world.step(events);
      events.drainContactForceEvents((event) => {
        const a = handles.get(event.collider1());
        const b = handles.get(event.collider2());
        const force = event.totalForceMagnitude();
        if (a !== undefined) contacts.push({ id: a, force, other: b ?? -1 });
        if (b !== undefined) contacts.push({ id: b, force, other: a ?? -1 });
      });
    }
    let awake = 0;
    bodies.forEach(({ id, body }, index) => {
      const p = body.translation();
      const q = body.rotation();
      const o = index * 8;
      transforms[o] = id;
      transforms[o + 1] = p.x; transforms[o + 2] = p.y; transforms[o + 3] = p.z;
      transforms[o + 4] = q.x; transforms[o + 5] = q.y; transforms[o + 6] = q.z; transforms[o + 7] = q.w;
      if (!body.isSleeping()) {
        const v = body.linvel();
        const w = body.angvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z > 1e-5 || w.x * w.x + w.y * w.y + w.z * w.z > 1e-3) awake += 1;
      }
    });
    restFrames = awake === 0 && t > 0.45 ? restFrames + 1 : 0;
    return {
      t,
      transforms,
      contacts,
      awake,
      done: restFrames >= 3 || t >= MAX_SCENE_SECONDS,
    };
  }

  function dispose() {
    events.free();
    world.free();
  }

  return { step, dispose, get time() { return t; } };
}

function yawQuaternion(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
