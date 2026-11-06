import * as THREE from 'three';

// Shader upgrades for small, close-up materials the seated player looks at
// all session: drink surfaces and the steam above them. Both are a handful of
// pixels' worth of extra work, so every tier gets them.

export const materialTime = { value: 0 };

// Wisps: a domain-warped noise field drifts upward through each soft sprite,
// so steam curls and thins instead of reading as a round blob.
const STEAM_VERTEX = /* glsl */`
  attribute float aScale;
  attribute float aAlpha;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vAlpha = aAlpha;
    vSeed = float(gl_VertexID) * 7.13;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aScale * 360.0 / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

// Two fetches from a baked, tiling noise texture (r: wisps, gb: warp) keep
// this cheap even when the sprite over the player's own cup fills a large
// part of the screen.
const STEAM_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform vec3 uTint;
  uniform sampler2D uNoise;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    p.y = -p.y;
    float radial = smoothstep(0.5, 0.05, length(p * vec2(1.25, 0.85)));
    if (radial <= 0.0) discard;
    float t = uTime * 0.6 + vSeed;
    vec2 q = vec2(p.x * 0.6, p.y * 0.4 - t * 0.12) + vSeed * 0.37;
    vec2 warp = texture2D(uNoise, q + vec2(0.0, t * 0.05)).gb - 0.5;
    float wisp = texture2D(uNoise, q * 1.4 + warp * 0.45).r;
    float density = smoothstep(0.32, 0.85, wisp) * radial;
    // forward-scattering water droplets take on the warm room light
    vec3 color = mix(vec3(0.9, 0.9, 0.92), uTint, 0.35) * (0.85 + wisp * 0.3);
    gl_FragColor = vec4(color, density * vAlpha * 1.35);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Tiling value-noise fBm baked once: red drives the wisps, green/blue an
// independent field used to warp them.
let steamNoise = null;
function steamNoiseTexture() {
  if (steamNoise) return steamNoise;
  const size = 64;
  const lattice = (seed, period) => {
    const values = new Float32Array(period * period);
    let state = seed >>> 0;
    for (let i = 0; i < values.length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      values[i] = state / 4294967296;
    }
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => values[((j % period + period) % period) * period + ((i % period + period) % period)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  };
  const fbm = (seed) => {
    const octaves = [[lattice(seed, 4), 4, 0.55], [lattice(seed + 7, 8), 8, 0.3], [lattice(seed + 13, 16), 16, 0.15]];
    return (u, v) => octaves.reduce((sum, [noise, period, weight]) => sum + noise(u * period, v * period) * weight, 0);
  };
  const channels = [fbm(11), fbm(29), fbm(47)];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      channels.forEach((field, c) => { data[i + c] = Math.round(field(x / size, y / size) * 255); });
      data[i + 3] = 255;
    }
  }
  steamNoise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  steamNoise.wrapS = steamNoise.wrapT = THREE.RepeatWrapping;
  steamNoise.minFilter = steamNoise.magFilter = THREE.LinearFilter;
  steamNoise.userData.vibeShared = true;
  steamNoise.needsUpdate = true;
  return steamNoise;
}

function upgradeSteam(points, tint) {
  const previous = points.material;
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: materialTime, uTint: { value: new THREE.Color(tint) }, uNoise: { value: steamNoiseTexture() } },
    vertexShader: STEAM_VERTEX,
    fragmentShader: STEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  material.userData.vibeSteamUpgrade = true;
  points.material = material;
  previous.dispose();
}

// Coffee surfaces: glossy liquid with slow concentric ripples and a darker
// meniscus where it meets the cup wall.
function upgradeLiquid(material) {
  if (material.userData.vibeLiquidUpgrade) return;
  material.userData.vibeLiquidUpgrade = true;
  material.roughness = Math.min(material.roughness, 0.16);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = materialTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          float liquidR = length(vMapUv - 0.5);
          diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.43, 0.5, liquidR));
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_MAP
        {
          vec2 lp = vMapUv - 0.5;
          float lr = max(length(lp), 1e-4);
          float wave = cos(lr * 70.0 - uTime * 2.2) * 0.5 + cos(lr * 43.0 - uTime * 1.3 + 1.7) * 0.5;
          vec2 grad = (lp / lr) * wave * 0.035 * (1.0 - smoothstep(0.3, 0.5, lr));
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vMapUv), st1 = dFdy(vMapUv);
          vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float s = det == 0.0 ? 0.0 : inversesqrt(det);
          normal = normalize(normal - (T * s) * grad.x - (B * s) * grad.y);
        }
        #endif`);
  };
  material.customProgramCacheKey = () => 'vibe-liquid-v1';
  material.needsUpdate = true;
}

// Bulbs are unlit basic materials whose colour tops out at 1.0, so they could
// never exceed the bloom threshold or read as light sources. Give them HDR
// radiance; tone mapping still resolves them to warm white on every tier.
const PRACTICAL_RADIANCE = 5;
function isPracticalBulb(material) {
  if (!material.isMeshBasicMaterial || material.map || material.transparent || !material.toneMapped) return false;
  const { r, g, b } = material.color;
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.72 && Math.min(r, g, b) > 0.35;
}
function upgradePractical(material) {
  if (material.userData.vibePracticalUpgrade) return;
  material.userData.vibePracticalUpgrade = true;
  material.color.multiplyScalar(PRACTICAL_RADIANCE);
}

export function upgradeCafeMaterials(root, theme) {
  const steam = [];
  let practicals = 0;
  root.traverse((object) => {
    if (object.isPoints && object.geometry?.getAttribute('aAlpha') && object.material?.uniforms?.uMap
      && !object.material.userData.vibeSteamUpgrade) {
      steam.push(object);
    }
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      if (material.userData?.vibeLiquid) upgradeLiquid(material);
      else if (isPracticalBulb(material)) { upgradePractical(material); practicals += 1; }
    }
  });
  steam.forEach((points) => upgradeSteam(points, theme?.lampColor ?? 0xffd0a2));
  return { steam: steam.length, practicals };
}
