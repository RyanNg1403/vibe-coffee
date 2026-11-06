// First-person locomotion as a damped point mass. Input sets a desired
// velocity; muscles accelerate toward it and floor friction brakes, so the
// walker ramps up, glides a step when keys are released, and leans into
// strafes. Gait (head bob, lateral weight shift, footfalls) is driven by the
// distance actually travelled, so it slows, quiets and settles with the body
// instead of snapping off when the keys are released.

export const MOTOR_DEFAULTS = Object.freeze({
  maxSpeed: 2.0,          // m/s; the previous constant walking speed
  acceleration: 6.5,      // m/s² when speeding up toward the input
  braking: 9.5,           // m/s² when stopping or reversing (shoe friction)
  stepLength: 0.72,       // metres per footfall
  bobHeight: 0.026,       // vertical centre-of-mass excursion at full speed
  swayWidth: 0.012,       // lateral weight shift at full speed
  stepRoll: 0.0045,       // head roll that follows the weight shift
  leanPerAccel: 0.0028,   // camera roll/pitch per m/s² of body acceleration
  maxLean: 0.026,
  eyeFrequency: 17,       // critically damped eye-height spring (stairs, ledges)
  maxEyeLag: 0.12,
});

// Exact critically damped spring step: unconditionally stable for any dt.
export function criticalSpring(x, v, target, omega, dt) {
  const x0 = x - target;
  const e = Math.exp(-omega * dt);
  const tmp = (v + omega * x0) * dt;
  return { x: target + (x0 + tmp) * e, v: (v - omega * tmp) * e };
}

export class PlayerMotor {
  constructor(options = {}) {
    this.options = { ...MOTOR_DEFAULTS, ...options };
    this.reducedMotion = false;
    this.reset();
  }

  reset(groundY = null) {
    this.vx = 0;
    this.vz = 0;
    this.intendedX = 0;
    this.intendedZ = 0;
    this.phase = 0;
    this.amplitude = 0;
    this.eyeY = groundY;
    this.eyeVY = 0;
    this.roll = 0;
    this.pitch = 0;
    this._leanRollV = 0;
    this._leanPitchV = 0;
    this._prevVX = 0;
    this._prevVZ = 0;
    this.bobY = 0;
    this.swayX = 0;
    this.swayZ = 0;
    this.lastImpactSpeed = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  // still gliding or still settling its gait: the frame scheduler should keep
  // rendering at interactive rate until the body is at rest
  get moving() { return this.speed > 0.015 || this.amplitude > 0.02; }

  // Integrate the desired velocity and return the unconstrained displacement.
  drive(dt, inputX, inputZ, out = { x: 0, z: 0 }) {
    const o = this.options;
    const length = Math.hypot(inputX, inputZ);
    const targetX = length > 1e-6 ? (inputX / length) * o.maxSpeed : 0;
    const targetZ = length > 1e-6 ? (inputZ / length) * o.maxSpeed : 0;
    const dvx = targetX - this.vx;
    const dvz = targetZ - this.vz;
    const dv = Math.hypot(dvx, dvz);
    this._prevVX = this.vx;
    this._prevVZ = this.vz;
    if (dv > 1e-9) {
      const opposing = this.vx * dvx + this.vz * dvz < 0;
      const rate = length < 1e-6 || opposing ? o.braking : o.acceleration;
      const k = Math.min(1, (rate * dt) / dv);
      this.vx += dvx * k;
      this.vz += dvz * k;
    }
    if (Math.hypot(this.vx, this.vz) < 0.01 && length < 1e-6) {
      this.vx = 0;
      this.vz = 0;
    }
    this.intendedX = this.vx;
    this.intendedZ = this.vz;
    out.x = this.vx * dt;
    out.z = this.vz * dt;
    return out;
  }

  // Feed back the displacement that survived collision. Velocity lost into an
  // obstacle is removed (so the walker slides instead of grinding into a
  // table) and its magnitude is reported as the normal impact speed.
  settle(dt, actualDX, actualDZ) {
    if (dt <= 0) return 0;
    const ax = actualDX / dt;
    const az = actualDZ / dt;
    const lostX = this.intendedX - ax;
    const lostZ = this.intendedZ - az;
    const impact = Math.hypot(lostX, lostZ);
    // NPC shoves can add displacement; never let them inject extra speed
    const actual = Math.hypot(ax, az);
    const cap = Math.max(this.speed, 1e-9);
    const scale = actual > cap ? cap / actual : 1;
    this.vx = ax * scale;
    this.vz = az * scale;
    this.lastImpactSpeed = impact;
    return impact;
  }

  // Advance gait and eye height. (rightX, rightZ) is the camera's horizontal
  // right vector, used for lateral sway and strafe lean. Returns whether a
  // footfall landed this frame and how heavy it was.
  gait(dt, groundY, rightX, rightZ, result = { footstep: false, weight: 0 }) {
    const o = this.options;
    const speed = this.speed;
    result.footstep = false;
    result.weight = 0;

    const before = Math.floor(this.phase / Math.PI);
    this.phase += (speed * dt / o.stepLength) * Math.PI;
    const targetAmplitude = Math.min(1, speed / o.maxSpeed);
    this.amplitude += (targetAmplitude - this.amplitude) * (1 - Math.exp(-7 * dt));
    if (this.amplitude < 0.002 && speed < 0.015) this.amplitude = 0;
    if (Math.floor(this.phase / Math.PI) !== before && this.amplitude > 0.12) {
      result.footstep = true;
      result.weight = Math.min(1, 0.35 + this.amplitude * 0.75);
    }

    if (this.eyeY == null || !Number.isFinite(this.eyeY)) {
      this.eyeY = groundY;
      this.eyeVY = 0;
    } else {
      const s = criticalSpring(this.eyeY, this.eyeVY, groundY, o.eyeFrequency, dt);
      this.eyeY = s.x;
      this.eyeVY = s.v;
      if (Math.abs(this.eyeY - groundY) > o.maxEyeLag) {
        this.eyeY = groundY + Math.sign(this.eyeY - groundY) * o.maxEyeLag;
      }
    }

    const motion = this.reducedMotion ? 0 : 1;
    const a = this.amplitude * motion;
    // eye is lowest at heel strike (phase = kπ) and highest at mid-stance
    this.bobY = a * o.bobHeight * (0.5 - 0.5 * Math.cos(this.phase * 2) - 0.5);
    const shift = a * o.swayWidth * Math.sin(this.phase);
    this.swayX = rightX * shift;
    this.swayZ = rightZ * shift;

    // A walker leans into acceleration: strafing rolls the view toward the
    // push, setting off dips it slightly, braking lifts it.
    let leanRoll = 0;
    let leanPitch = 0;
    if (dt > 0 && motion) {
      const axw = (this.intendedX - this._prevVX) / dt;
      const azw = (this.intendedZ - this._prevVZ) / dt;
      const lateral = axw * rightX + azw * rightZ;
      // horizontal forward is the right vector rotated a quarter turn
      const forward = axw * rightZ - azw * rightX;
      leanRoll = clamp(-lateral * o.leanPerAccel, -o.maxLean, o.maxLean);
      leanPitch = clamp(-forward * o.leanPerAccel * 0.6, -o.maxLean, o.maxLean);
    }
    const r = criticalSpring(this.roll, this._leanRollV, leanRoll + a * o.stepRoll * Math.sin(this.phase), 9, dt);
    this.roll = r.x;
    this._leanRollV = r.v;
    const p = criticalSpring(this.pitch, this._leanPitchV, leanPitch, 9, dt);
    this.pitch = p.x;
    this._leanPitchV = p.v;
    return result;
  }
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
