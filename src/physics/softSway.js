import * as THREE from 'three';

// Hair and loose clothing secondary motion without cloth simulation. Each
// avatar gets a damped spring per soft region (hair hangs from the head bone,
// skirts and coats from the hips) driven by that bone's acceleration and the
// local air. The spring's offset is handed to the GPU as a few uniforms; a
// vertex-shader hook displaces skinned vertices of the matching materials by
// that offset, weighted by how far below the anchor they hang, so the crown
// and waistband stay put while tips and hems swing. One shader variant per
// kind is shared by every avatar (per-material uniform objects).

// A hanging length L tilts by a/g under acceleration a, so its tip lags
// about L·a/g; with hair's stiffness the steady lag is ~0.009·a (hair) and
// ~0.012·a (hems), i.e. gain = lag·ω² in the spring below.
export const SOFT_KINDS = Object.freeze({
  hair: { match: /hair/i, bone: 'Head', start: -0.04, length: 0.32, radius: 0.24, omega: 9, damping: 0.35, gain: 0.7, wind: 0.035, limit: 0.05 },
  cloth: { match: /dress|skirt|coat|cardigan|apron|scarf|gown/i, bone: 'Hips', start: 0.08, length: 0.6, radius: 0.5, omega: 7, damping: 0.5, gain: 0.6, wind: 0.025, limit: 0.07 },
});

const _anchor = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _local = new THREE.Vector3();
const _wind = { x: 0, z: 0 };

function patch(material, kind, uniforms) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSoftAnchor;
uniform vec3 uSoftDown;
uniform vec3 uSoftOffset;
uniform vec4 uSoftShape; // start, length, radius, local units per metre`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
{
  vec3 softRel = transformed - uSoftAnchor;
  float softBelow = dot(softRel, uSoftDown) / uSoftShape.w;
  float softSide = length(softRel - uSoftDown * dot(softRel, uSoftDown)) / uSoftShape.w;
  float softWeight = smoothstep(uSoftShape.x, uSoftShape.x + uSoftShape.y, softBelow)
    * (1.0 - smoothstep(uSoftShape.z, uSoftShape.z * 1.6, softSide));
  transformed += uSoftOffset * softWeight;
}`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|vibe-soft-${kind}`;
  material.needsUpdate = true;
}

export class SoftSway {
  constructor() {
    this.seen = new WeakSet();
    this.entries = new WeakMap();
    this.patched = 0;
    this.enabled = true;
    this.maxDistance = 9;
  }

  // Patch an avatar's own (cloned) materials once.
  install(avatar) {
    if (!avatar || this.seen.has(avatar)) return this.entries.get(avatar) ?? null;
    this.seen.add(avatar);
    const regions = [];
    const root = avatar.inner ?? avatar.root;
    for (const [kind, spec] of Object.entries(SOFT_KINDS)) {
      const bone = avatar.bones?.[spec.bone];
      if (!bone) continue;
      let mesh = null;
      const uniforms = {
        uSoftAnchor: { value: new THREE.Vector3() },
        uSoftDown: { value: new THREE.Vector3(0, -1, 0) },
        uSoftOffset: { value: new THREE.Vector3() },
        uSoftShape: { value: new THREE.Vector4(spec.start, spec.length, spec.radius, 1) },
      };
      root.traverse((object) => {
        if (!object.isSkinnedMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material || !spec.match.test(material.name ?? '') || material.userData.vibeSoft) continue;
          material.userData.vibeSoft = kind;
          patch(material, kind, uniforms);
          mesh ??= object;
          this.patched += 1;
        }
      });
      if (mesh) {
        regions.push({
          kind, spec, bone, mesh, uniforms,
          offset: new THREE.Vector3(), velocity: new THREE.Vector3(),
          last: null, lastVelocity: new THREE.Vector3(),
        });
      }
    }
    const entry = regions.length ? { regions } : null;
    if (entry) this.entries.set(avatar, entry);
    return entry;
  }

  // Per rendered frame, after interpolation and before the render call.
  update(dt, avatars, air, viewer) {
    if (dt <= 0) return;
    const maxD2 = this.maxDistance * this.maxDistance;
    for (const avatar of avatars) {
      const entry = this.entries.get(avatar);
      if (!entry) continue;
      const root = avatar.root;
      const far = !this.enabled || !root.parent || (viewer
        && (root.position.x - viewer.x) ** 2 + (root.position.z - viewer.z) ** 2 > maxD2);
      for (const region of entry.regions) this._step(region, dt, far, air);
    }
  }

  _step(region, dt, far, air) {
    const { spec, bone, mesh, uniforms, offset, velocity } = region;
    if (far) {
      if (offset.lengthSq() > 0) {
        offset.set(0, 0, 0);
        velocity.set(0, 0, 0);
        uniforms.uSoftOffset.value.set(0, 0, 0);
      }
      region.last = null;
      return;
    }
    bone.getWorldPosition(_anchor);
    // bone acceleration by finite differences (first frame: at rest)
    let ax = 0, ay = 0, az = 0;
    if (region.last) {
      const vx = (_anchor.x - region.last.x) / dt;
      const vy = (_anchor.y - region.last.y) / dt;
      const vz = (_anchor.z - region.last.z) / dt;
      // teleports and reparenting are not motion
      if (vx * vx + vz * vz < 25) {
        ax = (vx - region.lastVelocity.x) / dt;
        ay = (vy - region.lastVelocity.y) / dt;
        az = (vz - region.lastVelocity.z) / dt;
      }
      region.lastVelocity.set(vx, vy, vz);
    } else {
      region.last = new THREE.Vector3();
    }
    region.last.copy(_anchor);
    const limitA = 40;
    ax = THREE.MathUtils.clamp(ax, -limitA, limitA);
    ay = THREE.MathUtils.clamp(ay, -limitA, limitA);
    az = THREE.MathUtils.clamp(az, -limitA, limitA);
    let wx = 0, wz = 0;
    if (air?.active) {
      air.sample(_anchor.x, _anchor.y - spec.length * 0.5, _anchor.z, _wind);
      wx = _wind.x; wz = _wind.z;
    }
    // hanging mass lags the anchor (−a) and leans downwind
    const w = spec.omega;
    const c = 2 * spec.damping * w;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      velocity.x += (w * w * (wx * spec.wind - offset.x) - c * velocity.x - ax * spec.gain) * h;
      velocity.y += (w * w * (0 - offset.y) - c * velocity.y - ay * spec.gain * 0.5) * h;
      velocity.z += (w * w * (wz * spec.wind - offset.z) - c * velocity.z - az * spec.gain) * h;
      offset.addScaledVector(velocity, h);
    }
    if (offset.length() > spec.limit) offset.setLength(spec.limit);
    // express anchor, down axis, offset and scale in the skinned mesh's space
    mesh.updateWorldMatrix(true, false);
    _local.copy(_anchor);
    mesh.worldToLocal(_local);
    uniforms.uSoftAnchor.value.copy(_local);
    _probe.copy(_anchor).y -= 1;
    mesh.worldToLocal(_probe).sub(_local);
    const unitsPerMetre = _probe.length() || 1;
    uniforms.uSoftDown.value.copy(_probe).divideScalar(unitsPerMetre);
    uniforms.uSoftShape.value.w = unitsPerMetre;
    _probe.copy(_anchor).add(offset);
    mesh.worldToLocal(_probe).sub(_local);
    uniforms.uSoftOffset.value.copy(_probe);
  }
}
