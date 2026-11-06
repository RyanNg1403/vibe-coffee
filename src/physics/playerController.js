import { Vector3 } from 'three';
import { intentToWorld } from './movementIntent.js';

// First-person character controller. Consumes one movement intent per frame
// (see movementIntent.js) and owns everything between "what the player
// wants" and "where the eye is": the walk motor (acceleration, glide,
// sprint), the collision sequence (static furniture with table knocks, crowd,
// door leaf, static again, floor surfaces and stair portals), gait and eye
// smoothing. Room geometry stays in main.js and is reached through `world`:
//
//   world.position          Vector3 the player stands on (x, z used)
//   world.groundY()         current floor height
//   world.levelId()         current floor id (changes only via commit)
//   world.resolveStatic(p)  push p out of furniture and walls
//   world.resolveCrowd(p)   push p out of people
//   world.commit(p)         accept p onto the walk surfaces (may refuse/slide)
//   world.onFootstep(position, weight)

const PLAYER_EYE = 1.55;

export class PlayerController {
  constructor(realism, world) {
    this.realism = realism;
    this.world = world;
    this.eyeHeight = PLAYER_EYE;
    this._proposed = new Vector3();
    this._drive = { x: 0, z: 0 };
    this._wish = { x: 0, z: 0 };
    this._gait = { footstep: false, weight: 0 };
    this.pose = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, moved: false };
  }

  step(dt, intent, yaw) {
    const realism = this.realism;
    const world = this.world;
    const motor = realism.motor;
    const position = world.position;
    const proposed = this._proposed;
    let moved = false;
    intentToWorld(intent, yaw, this._wish);
    const drive = motor.drive(dt, this._wish.x, this._wish.z, this._drive, !!intent?.sprint);
    if (motor.speed > 0) {
      moved = true;
      proposed.x = position.x + drive.x;
      proposed.y = 0;
      proposed.z = position.z + drive.z;
      realism.beginPlayerMove(proposed);
      world.resolveStatic(proposed);
      realism.notePlayerFurniture(proposed, world.levelId());
      world.resolveCrowd(proposed);
      realism.resolvePlayer(proposed, world.levelId());
      realism.resolveChairs?.(proposed, world.levelId(), motor);
      // a person can push the player toward a table edge; resolve the room
      // again so the systems cannot squeeze the camera into props
      world.resolveStatic(proposed);
      const fromX = position.x;
      const fromZ = position.z;
      world.commit(proposed);
      motor.settle(dt, position.x - fromX, position.z - fromZ);
    } else if (realism.resolvePlayer(proposed.copy(position), world.levelId())) {
      // standing in the door's swing: the leaf shoves you aside
      moved = true;
      world.resolveStatic(proposed);
      world.commit(proposed);
    }
    const groundY = world.groundY();
    const gait = motor.gait(dt, groundY, Math.cos(yaw), -Math.sin(yaw), this._gait);
    if (gait.footstep) {
      moved = true;
      world.onFootstep?.(position, gait.weight);
    }
    if (motor.moving) moved = true;
    realism.updatePlayer(position, groundY, world.levelId(), true);
    const pose = this.pose;
    pose.x = position.x + motor.swayX;
    pose.y = motor.eyeY + this.eyeHeight + motor.bobY;
    pose.z = position.z + motor.swayZ;
    pose.roll = motor.roll;
    pose.pitch = motor.pitch;
    pose.moved = moved;
    return pose;
  }
}
