// Anticipatory avoidance after Karamouzas, Skinner & Guy (2014): the steering
// response grows with how soon two bodies would touch if both kept their
// current velocities (the power law of time-to-collision), and pushes along
// their separation at that predicted moment. Walkers start to drift aside
// seconds ahead instead of colliding and being shoved apart.

const HORIZON = 3;      // seconds; beyond this nobody adjusts
const TAU0 = 1.6;       // exponential cutoff of the power law
const MAX_PUSH = 1.6;

// Seconds until the discs touch, or Infinity when they never will.
export function timeToCollision(px, pz, vx, vz, radius) {
  const a = vx * vx + vz * vz;
  const b = px * vx + pz * vz;
  const c = px * px + pz * pz - radius * radius;
  if (c < 0) return 0;
  if (a < 1e-8 || b >= 0) return Infinity;
  const disc = b * b - a * c;
  if (disc <= 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 ? t : Infinity;
}

// Add an avoidance push to `dir` (the walker's desired unit direction) for
// one other agent. self/other: { x, z, vx, vz, radius }.
export function avoidAgent(dir, self, other, gain = 0.9) {
  const px = self.x - other.x;
  const pz = self.z - other.z;
  const vx = self.vx - other.vx;
  const vz = self.vz - other.vz;
  const radius = self.radius + other.radius;
  const tau = timeToCollision(px, pz, vx, vz, radius);
  if (tau > HORIZON) return 0;
  let nx;
  let nz;
  if (tau === 0) {
    nx = px; nz = pz;
  } else {
    nx = px + vx * tau;
    nz = pz + vz * tau;
  }
  let length = Math.hypot(nx, nz);
  if (length < 1e-5) {
    // head-on and centred: pick the walker's right-hand side consistently
    nx = -self.vz; nz = self.vx;
    length = Math.hypot(nx, nz) || 1;
  }
  const t = Math.max(tau, 0.15);
  const strength = Math.min(MAX_PUSH, gain * Math.exp(-t / TAU0) / (t * t) * (2 / t + 1 / TAU0) * 0.12);
  dir.x += (nx / length) * strength;
  dir.z += (nz / length) * strength;
  return strength;
}
