import { MathUtils } from 'three';

export function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function turnToward(from, to, dt, response = 6, maxRate = 4.2) {
  const step = angleDelta(from, to) * (1 - Math.exp(-response * dt));
  return from + MathUtils.clamp(step, -maxRate * dt, maxRate * dt);
}

// In-place walk clips were authored at approximately 0.8 metres per second.
// Match their cadence to travel, including the last small steps before a stop.
export function walkingTimeScale(speed) {
  return MathUtils.clamp(speed / 0.8, 0, 2);
}

// Render between fixed simulation ticks without feeding interpolated positions
// back into steering, reservations, audio or collision checks. Weak references
// let departing actors and disposed venues release their pose records normally.
export class MotionInterpolator {
  constructor() {
    this.poses = new WeakMap();
  }

  capture(root) {
    let pose = this.poses.get(root);
    if (!pose) {
      pose = {
        previousPosition: root.position.clone(), position: root.position.clone(),
        previousRotation: root.quaternion.clone(), rotation: root.quaternion.clone(),
        previousScale: root.scale.clone(), scale: root.scale.clone(),
        euler: root.rotation.clone(),
      };
      this.poses.set(root, pose);
    }
    pose.parent = root.parent;
    pose.previousPosition.copy(root.position);
    pose.previousRotation.copy(root.quaternion);
    pose.previousScale.copy(root.scale);
    pose.ready = false;
  }

  commit(root) {
    const pose = this.poses.get(root);
    if (!pose) return; // first frame of a newly spawned actor
    pose.position.copy(root.position);
    pose.rotation.copy(root.quaternion);
    pose.scale.copy(root.scale);
    pose.euler.copy(root.rotation);
    // A sidewalk wrap or a change of coordinate space is a discontinuity,
    // never a journey across the room. Start a fresh interval next tick.
    pose.ready = pose.parent === root.parent
      && pose.previousPosition.distanceToSquared(pose.position) < 1;
  }

  apply(root, alpha) {
    const pose = this.poses.get(root);
    if (!pose?.ready || pose.parent !== root.parent) return;
    alpha = MathUtils.clamp(alpha, 0, 1);
    root.position.lerpVectors(pose.previousPosition, pose.position, alpha);
    root.quaternion.slerpQuaternions(pose.previousRotation, pose.rotation, alpha);
    root.scale.lerpVectors(pose.previousScale, pose.scale, alpha);
    pose.applied = true;
  }

  restore(root) {
    const pose = this.poses.get(root);
    if (!pose?.applied) return;
    root.position.copy(pose.position);
    // Steering reads Euler yaw. Restoring only a quaternion can decompose a
    // 180-degree yaw into flipped X/Z axes and change the next steering turn.
    if (root.isBone) root.quaternion.copy(pose.rotation);
    else root.rotation.copy(pose.euler);
    root.scale.copy(pose.scale);
    root.updateMatrix();
    root.matrixWorldNeedsUpdate = true;
    pose.applied = false;
  }
}
