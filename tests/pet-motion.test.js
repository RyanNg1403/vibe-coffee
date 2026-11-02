import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, Group, QuaternionKeyframeTrack, VectorKeyframeTrack, Vector3 } from 'three';
import { Pet, CatPet, DogPet, PetSystem, findPetFloorSpot, isPetFloorClear } from '../src/pets.js';
import { angleDelta } from '../src/npc/motion.js';
import { DoorCoordinator } from '../src/doorFlow.js';
import { getBlueprint } from '../src/cafe/interiorLayouts.js';

const dt = 1 / 30;
function clips() {
  // Prefix collisions deliberately come first, matching a possible glTF order.
  return ['idle_2_headlow', 'idle_eating', 'idle_2', 'idle', 'walk', 'headbutt', 'death', 'eating']
    .map(name => new AnimationClip(name, 1, []));
}
function cafe() {
  return { group: new Group(), colliders: [], nav: { door: new Vector3() } };
}

test('cats and dogs accelerate, brake and arrive without exceeding their travel or turn limits', () => {
  for (const kind of ['cat', 'dog']) {
    const pet = new Pet(cafe(), kind, new Group(), clips());
    pet.mesh.rotation.y = Math.PI; // turn around before moving forward
    pet._walkTo(0, 2);
    let arrived = false, peakSpeed = 0, finalMovingSpeed = 0;
    for (let tick = 0; tick < 600 && !arrived; tick++) {
      const before = pet.mesh.position.clone();
      const yaw = pet.mesh.rotation.y;
      const previousVelocity = pet.velocity.clone();
      arrived = pet._step(dt);
      const speed = pet.mesh.position.distanceTo(before) / dt;
      peakSpeed = Math.max(peakSpeed, speed);
      if (!arrived && speed > 0) finalMovingSpeed = speed;
      assert.ok(speed <= pet.speed + 1e-8, `${kind}: bounded travel`);
      assert.ok(Math.abs(angleDelta(yaw, pet.mesh.rotation.y)) <= 3.6 * dt + 1e-8, `${kind}: bounded turn`);
      assert.ok(pet.velocity.distanceTo(previousVelocity) <= 2.1 * dt + 1e-8, `${kind}: bounded acceleration/braking`);
      if (tick < 6) assert.ok(pet.mesh.position.z > -0.001, 'no backwards skating during the initial turn');
    }
    assert.ok(arrived, `${kind}: arrival cannot stall indefinitely`);
    assert.ok(peakSpeed > pet.speed * 0.9);
    assert.ok(finalMovingSpeed < pet.speed * 0.15, `${kind}: decelerates before stopping`);
    assert.ok(pet.mesh.position.distanceTo(new Vector3(0, 0, 2)) < 0.11);
    pet.dispose();
  }
});

test('walk cadence follows actual movement and stops at a blocked room boundary', () => {
  const pet = new Pet(cafe(), 'cat', new Group(), clips());
  pet._walkTo(0, 2);
  for (let i = 0; i < 20; i++) {
    const before = pet.mesh.position.clone();
    pet._step(dt);
    const speed = before.distanceTo(pet.mesh.position) / dt;
    if (pet.mode === 'walk') assert.ok(Math.abs(pet.actions.walk.timeScale - speed / pet.speed) < 1e-8);
  }
  pet.mesh.position.set(0, 0, 6.1);
  pet.mesh.rotation.y = 0;
  pet.velocity.set(0, pet.speed);
  pet._walkTo(0, 8);
  pet._step(dt);
  assert.equal(pet.mode, 'idle');
  assert.equal(pet.velocity.length(), 0);
  pet.dispose();
});

test('a cat brakes gradually when it greets a nearby player', () => {
  const cat = new CatPet(cafe(), 'cat', new Group(), clips());
  cat._walkTo(0, 2);
  cat.velocity.set(0, cat.speed);
  cat.update(dt, new Vector3(0, 1, 0.8));
  assert.equal(cat.state, 'watchPlayer');
  assert.ok(cat.velocity.length() > 0 && cat.velocity.length() < cat.speed);
  for (let i = 0; i < 15; i++) cat.update(dt, new Vector3(0, 1, 0.8));
  assert.ok(cat.velocity.length() < 1e-8);
  cat.dispose();
});

test('dog settling turns over several ticks instead of snapping toward its owner', () => {
  const owner = { state: 'sitting', mesh: new Group() };
  owner.mesh.position.set(0, 0, -2);
  const dog = new DogPet(cafe(), 'dog', new Group(), clips(), owner, new Vector3());
  dog.mesh.position.set(0, 0, 0);
  dog.mesh.rotation.y = 0;
  dog.velocity.set(0, 0);
  dog._walkTo(0, 0);
  dog.update(dt, null);
  assert.equal(dog.state, 'settle');
  assert.ok(Math.abs(dog.mesh.rotation.y) <= 3.6 * dt + 1e-8);
  for (let i = 0; i < 60; i++) {
    const yaw = dog.mesh.rotation.y;
    dog.update(dt, null);
    assert.ok(Math.abs(angleDelta(yaw, dog.mesh.rotation.y)) <= 3.6 * dt + 1e-8);
  }
  assert.ok(Math.abs(angleDelta(dog.mesh.rotation.y, Math.PI)) < 0.1);
  assert.equal(dog.actions.idle.getClip().name, 'idle');
  assert.equal(dog.actions.alert.getClip().name, 'idle_2');
  assert.equal(dog.actions.sniff.getClip().name, 'idle_2_headlow');
  dog.dispose();
});

test('pet render interpolation restores simulation poses without feeding smoothing into movement', () => {
  const room = cafe();
  const system = new PetSystem(room, new Map(), {});
  system.dogTimer = Infinity;
  const cat = system._adopt(new CatPet(room, 'cat', new Group(), clips()));
  cat._walkTo(0, 2);
  system.update(dt, null, null);
  const simulated = cat.mesh.position.clone();
  const velocity = cat.velocity.clone();
  system.interpolate(0.5);
  assert.ok(cat.mesh.position.z > 0 && cat.mesh.position.z < simulated.z);
  system.restoreSimulationPose();
  assert.ok(cat.mesh.position.distanceTo(simulated) < 1e-12);
  assert.ok(cat.velocity.distanceTo(velocity) < 1e-12);
  system.dispose();
});


test('a dog waits for the shared door and enters and leaves without teleporting or disappearing inside', () => {
  const room = cafe();
  room.nav.door.set(0, 0, 6.35);
  room.nav.doorOutside = new Vector3(0, 0, 7.23);
  const entrance = { openness: 0, direction: null, setDirection(value) { this.direction = value; } };
  const doorFlow = new DoorCoordinator(entrance);
  const owner = { state: 'sitting', mesh: new Group() };
  owner.mesh.position.set(1, 0, 3);
  const dog = new DogPet(room, 'dog', new Group(), clips(), owner, new Vector3(1, 0, 4));
  dog.doorFlow = doorFlow;
  const stranger = {};
  doorFlow.join(stranger, 'out');
  const initial = dog.mesh.position.clone();
  for (let tick = 0; tick < 30; tick++) dog.update(dt, null);
  assert.ok(dog.mesh.position.distanceTo(initial) < 1e-10, 'the dog waits behind existing door traffic');
  doorFlow.release(stranger);
  let entered = false;
  for (let tick = 0; tick < 1600 && !dog.dead; tick++) {
    doorFlow.update();
    entrance.openness = Math.max(0, Math.min(1, entrance.openness + (entrance.direction ? 1 : -1) * dt * 2));
    const previous = dog.mesh.position.clone();
    dog.update(dt, null);
    assert.ok(previous.distanceTo(dog.mesh.position) <= dog.speed * dt + 1e-8, 'every doorway step stays within travel speed');
    if (dog.mesh.position.z > 6.1) assert.ok(Math.abs(dog.mesh.position.x) <= 0.38, 'front wall crossed only through doorway');
    if (dog.state === 'settle') { entered = true; owner.state = 'leaving'; }
  }
  assert.ok(entered, 'dog reaches its human');
  assert.ok(dog.dead, 'exit is reachable');
  assert.ok(dog.mesh.position.z > room.nav.doorOutside.z, 'dog only leaves the scene outside the cafe');
  assert.equal(doorFlow.active, null);
  dog.dispose();
});

test('pet bone interpolation restores the exact mixer pose as well as the root', () => {
  const room = cafe(), root = new Group(), head = new Bone();
  head.name = 'Head'; root.add(head);
  const animation = new AnimationClip('idle', 1, [new QuaternionKeyframeTrack('Head.quaternion', [0, 1], [0, 0, 0, 1, 0, Math.sin(0.5), 0, Math.cos(0.5)]), new VectorKeyframeTrack('Head.scale', [0, 1], [1, 1, 1, 1, 0.5, 1])]);
  const system = new PetSystem(room, new Map(), {});
  system.dogTimer = Infinity;
  system._adopt(new CatPet(room, 'cat', root, [animation]));
  system.update(dt, null, null);
  const simulated = head.quaternion.clone();
  const simulatedScale = head.scale.clone();
  system.interpolate(0.5);
  assert.ok(head.quaternion.angleTo(simulated) > 0.001, 'bone pose interpolated between ticks');
  assert.ok(head.scale.y > simulatedScale.y && head.scale.y < 1, 'blink scale interpolates too');
  system.restoreSimulationPose();
  assert.deepEqual(head.scale.toArray(), simulatedScale.toArray());
  assert.deepEqual(head.quaternion.toArray(), simulated.toArray(), 'mixer result restored exactly');
  system.dispose();
});


test('a blocked dog cannot skip the interior approach and reserve the shared door', () => {
  const room = cafe(); room.nav.door.set(0, 0, 6.35); room.nav.doorOutside = new Vector3(0, 0, 7.23);
  const dog = new DogPet(room, 'dog', new Group(), clips(), {state:'sitting',mesh:new Group()}, new Vector3());
  const flow = new DoorCoordinator({openness:0,setDirection(){}});
  dog.doorFlow = flow; dog.mesh.position.set(0,0,2); dog.velocity.set(0,0);
  dog._walkTo(0, 7.53); dog.state='leaving';
  // A persistent physical obstruction prevents displacement. It must never
  // turn the generic 3.5-second wandering timeout into permission to use a door.
  dog._move = () => {dog.velocity.set(0,0);return 0;};
  for(let tick=0;tick<300;tick++) {flow.update();dog.update(dt,null);}
  assert.equal(dog.target.approach,true);
  assert.equal(flow.active,null);
  assert.equal(flow.queueLength,0);
  assert.equal(dog.dead,false);
  dog.dispose();
});


test('pet spawn, wandering and companion rest targets respect every venue layout', () => {
  for (const venue of ['goldenhour', 'roastery', 'midnight', 'terrace']) {
    const room = {colliders:getBlueprint(venue).colliders};
    for (let attempt=0;attempt<80;attempt++) {
      const point=findPetFloorSpot(room);
      assert.ok(point && isPetFloorClear(room,point), `${venue}: clear floor target`);
    }
    for(const obstacle of room.colliders.filter(c=>(c.levelId??'ground')==='ground'&&c.r)) {
      const preferred={x:obstacle.x,z:obstacle.z};
      const rest=findPetFloorSpot(room,preferred);
      if(rest) {
        assert.ok(isPetFloorClear(room,rest));
        assert.ok(Math.hypot(rest.x-preferred.x,rest.z-preferred.z)<=.751, 'companion remains near its human');
      }
    }
  }
  assert.equal(findPetFloorSpot({colliders:[{rect:{x0:-20,x1:20,z0:-20,z1:20}}]}),null,
    'a fully obstructed layout cannot produce a hidden pet inside furniture');
});
