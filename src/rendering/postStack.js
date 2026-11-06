import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';
import { LUT_SIZE, buildLutData, gradeForTheme } from './colorGrade.js';

// SMAA embeds its lookup textures (~35 KB gzipped), so only the tiers that
// use it fetch it; FXAA covers the frames until it arrives.
let SMAAPassClass = null;
let smaaRequest = null;
function loadSmaa() {
  smaaRequest ??= import('three/examples/jsm/postprocessing/SMAAPass.js')
    .then((module) => { SMAAPassClass = module.SMAAPass; });
  return smaaRequest;
}

// One scene draw into an HDR target with a depth texture; every effect below
// derives from that pair. Nothing re-renders the scene (no normal pre-pass),
// which keeps the post stack's cost proportional to pixels, not geometry.

const FULLSCREEN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function shader(fragmentShader, uniforms = {}, defines = {}) {
  return new THREE.ShaderMaterial({
    uniforms, defines, vertexShader: FULLSCREEN_VERTEX, fragmentShader,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

function hdrTarget(width = 1, height = 1, options = {}) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    ...options,
  });
}

const LINEAR_DEPTH = /* glsl */`
  uniform float cameraNear;
  uniform float cameraFar;
  float viewDistance(float depth) {
    return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * depth - cameraFar) * -1.0;
  }`;

// Depth-aware separable blur: keeps AO from bleeding across silhouettes.
const AO_BLUR = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tAO;
  uniform sampler2D tDepth;
  uniform vec2 direction;
  ${LINEAR_DEPTH}
  void main() {
    float z0 = viewDistance(texture2D(tDepth, vUv).x);
    float sum = 0.0, weight = 0.0;
    for (int i = -3; i <= 3; i++) {
      vec2 uv = vUv + direction * float(i);
      float z = viewDistance(texture2D(tDepth, uv).x);
      float w = exp(-float(i * i) * 0.18) * max(0.0, 1.0 - abs(z - z0) / (0.06 * z0 + 0.02));
      sum += texture2D(tAO, uv).r * w;
      weight += w;
    }
    gl_FragColor = vec4(vec3(weight > 0.0 ? sum / weight : 1.0), 1.0);
  }`;

// Jimenez 2014 (CoD: AW) 13-tap downsample. The first level applies a soft
// knee and Karis averaging so single hot texels cannot sparkle.
const BLOOM_DOWN = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 texel;
  uniform float threshold;
  uniform float knee;
  uniform bool prefilter;
  vec3 t(vec2 o) { return texture2D(tInput, vUv + texel * o).rgb; }
  float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
  vec3 soft(vec3 c) {
    float l = max(c.r, max(c.g, c.b));
    float rq = clamp(l - threshold + knee, 0.0, 2.0 * knee);
    rq = rq * rq / (4.0 * knee + 1e-4);
    return c * max(rq, l - threshold) / max(l, 1e-4);
  }
  void main() {
    vec3 a = t(vec2(-2, 2)), b = t(vec2(0, 2)), c = t(vec2(2, 2));
    vec3 d = t(vec2(-2, 0)), e = t(vec2(0, 0)), f = t(vec2(2, 0));
    vec3 g = t(vec2(-2, -2)), h = t(vec2(0, -2)), i = t(vec2(2, -2));
    vec3 j = t(vec2(-1, 1)), k = t(vec2(1, 1)), l = t(vec2(-1, -1)), m = t(vec2(1, -1));
    vec3 color;
    if (prefilter) {
      vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
      vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25;
      vec3 g4 = (j + k + l + m) * 0.25;
      float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
      color = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3) * 0.125 + g4 * w4 * 0.5;
      color /= (w0 + w1 + w2 + w3) * 0.125 + w4 * 0.5;
      color = soft(min(color, vec3(64.0)));
    } else {
      color = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    }
    gl_FragColor = vec4(color, 1.0);
  }`;

// 3x3 tent upsample, additively blended into the next larger mip.
const BLOOM_UP = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 texel;
  uniform float radius;
  vec3 t(vec2 o) { return texture2D(tInput, vUv + texel * o * radius).rgb; }
  void main() {
    vec3 c = t(vec2(0)) * 4.0
      + (t(vec2(-1, 0)) + t(vec2(1, 0)) + t(vec2(0, -1)) + t(vec2(0, 1))) * 2.0
      + t(vec2(-1, -1)) + t(vec2(1, -1)) + t(vec2(-1, 1)) + t(vec2(1, 1));
    gl_FragColor = vec4(c / 16.0, 1.0);
  }`;

// Sun shafts: daylight seen through the windows (any texel whose world
// position lies outside the room box, or the sky) is the light source; a
// radial gather toward the sun's screen position scatters it through the
// room's air (GPU Gems 3, ch. 13).
const SHAFT_MASK = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform vec2 sunUv;
  uniform float aspect;
  uniform mat4 projectionInverse;
  uniform mat4 cameraWorld;
  uniform vec3 roomMin;
  uniform vec3 roomMax;
  void main() {
    float depth = texture2D(tDepth, vUv).x;
    vec4 view = projectionInverse * vec4(vec3(vUv, depth) * 2.0 - 1.0, 1.0);
    vec3 world = (cameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
    vec3 outside3 = step(roomMax, world) + step(world, roomMin);
    float outside = max(step(0.99999, depth), clamp(outside3.x + outside3.y + outside3.z, 0.0, 1.0));
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 d = (vUv - sunUv) * vec2(aspect, 1.0);
    float halo = 0.35 + 0.65 * exp(-dot(d, d) * 2.5);
    gl_FragColor = vec4(c * outside * smoothstep(0.06, 0.7, l) * halo, 1.0);
  }`;

const SHAFT_BLUR = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 sunUv;
  uniform float density;
  uniform float decay;
  uniform float jitter;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec2 delta = (vUv - sunUv) * density / float(SAMPLES);
    vec2 uv = vUv - delta * ign(gl_FragCoord.xy + jitter);
    float illumination = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      uv -= delta;
      sum += texture2D(tInput, clamp(uv, 0.0, 1.0)).rgb * illumination;
      illumination *= decay;
    }
    gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
  }`;

// Autofocus: a 1x1 target eases toward the distance under the screen centre.
const FOCUS = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform sampler2D tPrevious;
  uniform float blend;
  ${LINEAR_DEPTH}
  void main() {
    float z = 0.0;
    for (int i = -2; i <= 2; i++) for (int j = -1; j <= 1; j++) {
      z += min(viewDistance(texture2D(tDepth, vec2(0.5) + vec2(float(i) * 0.03, float(j) * 0.04)).x), 12.0);
    }
    z /= 15.0;
    float previous = texture2D(tPrevious, vec2(0.5)).r;
    gl_FragColor = vec4(previous <= 0.0 ? z : mix(previous, z, blend), 0.0, 0.0, 1.0);
  }`;

// Half-resolution golden-angle gather. Alpha carries the circle of confusion
// so the composite can blend sharp and defocused images per pixel.
const DOF = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tFocus;
  uniform vec2 texel;
  uniform float maxBlur;
  uniform float nearStrength;
  uniform float farStrength;
  ${LINEAR_DEPTH}
  // Thin-lens defocus is proportional to |1/focus - 1/z|. The near field is
  // kept gentle so a laptop under the player's hands never turns to mush.
  float coc(vec2 uv, float focus) {
    float z = viewDistance(texture2D(tDepth, uv).x);
    float c = 1.0 / max(focus, 0.3) - 1.0 / max(z, 0.05);
    return clamp(c > 0.0 ? c * farStrength : -c * nearStrength, 0.0, 0.75);
  }
  void main() {
    float focus = texture2D(tFocus, vec2(0.5)).r;
    float c0 = coc(vUv, focus);
    vec3 sum = texture2D(tScene, vUv).rgb;
    float weight = 1.0;
    const float GOLDEN = 2.39996323;
    for (int i = 1; i < 24; i++) {
      float r = sqrt(float(i) / 24.0);
      float a = float(i) * GOLDEN;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * maxBlur * c0 * texel;
      float cs = coc(uv, focus);
      // background samples may not bleed over a sharper foreground
      float w = smoothstep(r - 0.25, r, max(cs, c0 * 0.5));
      sum += texture2D(tScene, uv).rgb * w;
      weight += w;
    }
    gl_FragColor = vec4(sum / weight, c0);
  }`;

const COMPOSITE = /* glsl */`
  precision highp sampler3D;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tAO;
  uniform sampler2D tShafts;
  uniform sampler2D tDof;
  uniform sampler3D tLut;
  uniform float bloomStrength;
  uniform float aoIntensity;
  uniform vec3 shaftColor;
  uniform vec3 whiteBalance;
  uniform float vignette;
  uniform float grain;
  uniform float grainSeed;
  uniform float aberration;
  uniform float lutSize;
  uniform sampler2D tDepth;
  uniform vec2 aoTexel;
  ${LINEAR_DEPTH}
  #include <tonemapping_pars_fragment>
  // Depth-aware 4-tap upsample of the reduced-resolution AO. Bilinear taps at
  // ±0.75 texel cover a 3x3 footprint, so this doubles as the AO denoise on
  // tiers that skip the separate blur passes.
  float sampleAO(vec2 uv) {
    float z0 = viewDistance(texture2D(tDepth, uv).x);
    float sum = 0.0, weight = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 1 || i == 3 ? 0.75 : -0.75, i >= 2 ? 0.75 : -0.75) * aoTexel;
      float z = viewDistance(texture2D(tDepth, uv + o).x);
      float w = max(0.0, 1.0 - abs(z - z0) / (0.05 * z0 + 0.02)) + 1e-3;
      sum += texture2D(tAO, uv + o).r * w;
      weight += w;
    }
    return sum / weight;
  }
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    vec2 d = vUv - 0.5;
    vec3 color;
    #ifdef USE_ABERRATION
      vec2 shift = d * dot(d, d) * aberration * 4.0;
      color = vec3(texture2D(tScene, vUv + shift).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - shift).b);
    #else
      color = texture2D(tScene, vUv).rgb;
    #endif
    #ifdef USE_DOF
      vec4 dof = texture2D(tDof, vUv);
      color = mix(color, dof.rgb, smoothstep(0.05, 0.5, dof.a));
    #endif
    #ifdef USE_AO
      float ao = sampleAO(vUv);
      // emissive lamps and the bright street stay unoccluded
      float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color *= mix(1.0, ao, aoIntensity * (1.0 - smoothstep(1.0, 4.0, lum)));
    #endif
    #ifdef USE_BLOOM
      color += texture2D(tBloom, vUv).rgb * bloomStrength;
    #endif
    #ifdef USE_SHAFTS
      color += texture2D(tShafts, vUv).rgb * shaftColor;
    #endif
    color *= whiteBalance;
    color = AgXToneMapping(color);
    color = sRGBTransferOETF(vec4(color, 1.0)).rgb;
    color = texture(tLut, color * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb;
    color *= mix(1.0, 1.0 - dot(d, d) * 1.6, vignette);
    // luminance-weighted grain: strongest in the mid-tones, like film
    float l = dot(color, vec3(0.299, 0.587, 0.114));
    float n = hash(gl_FragCoord.xy + grainSeed) + hash(gl_FragCoord.yx * 1.37 + grainSeed) - 1.0;
    color += n * grain * (0.35 + 4.0 * l * (1.0 - l));
    gl_FragColor = vec4(color, 1.0);
  }`;

export class PostStack {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.config = null;
    this.width = 1;
    this.height = 1;
    this.quad = new FullScreenQuad(null);
    this.elapsed = 0;
    this.frame = 0;
    this.sunDirection = new THREE.Vector3(0.4, 0.6, 0.7).normalize();
    this.shaftStrength = 0;
    this.bloomStrength = 0.2;
    this.shaftColor = new THREE.Color(1, 0.85, 0.65);
    this.sceneTarget = null;
    this.aoTargets = [];
    this.bloomMips = [];
    this.shaftTargets = [];
    this.dofTarget = null;
    this.focusTargets = [];
    this.ldrTarget = null;
    this.smaa = null;
    this.timings = { passes: 0 };

    this.lut = new THREE.Data3DTexture(buildLutData(gradeForTheme({})), LUT_SIZE, LUT_SIZE, LUT_SIZE);
    this.lut.format = THREE.RGBAFormat;
    this.lut.type = THREE.UnsignedByteType;
    this.lut.minFilter = this.lut.magFilter = THREE.LinearFilter;
    this.lut.wrapS = this.lut.wrapT = this.lut.wrapR = THREE.ClampToEdgeWrapping;
    this.lut.unpackAlignment = 1;
    this.lut.needsUpdate = true;
    this.whiteBalance = new THREE.Vector3(1, 1, 1);

    const near = { value: camera.near };
    const far = { value: camera.far };
    this.near = near;
    this.far = far;
    this.gtaoNoise = generateMagicSquareNoise();
    this.aoMaterial = new THREE.ShaderMaterial({
      ...GTAOShader,
      defines: { ...GTAOShader.defines, NORMAL_VECTOR_TYPE: 0, SAMPLES: 8 },
      uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
      vertexShader: FULLSCREEN_VERTEX,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.aoMaterial.uniforms.tNoise.value = this.gtaoNoise;
    Object.assign(this.aoMaterial.uniforms, { cameraNear: near, cameraFar: far });
    this.aoBlur = shader(AO_BLUR, {
      tAO: { value: null }, tDepth: { value: null }, direction: { value: new THREE.Vector2() },
      cameraNear: near, cameraFar: far,
    });
    this.bloomDown = shader(BLOOM_DOWN, {
      tInput: { value: null }, texel: { value: new THREE.Vector2() },
      threshold: { value: 1.1 }, knee: { value: 0.6 }, prefilter: { value: false },
    });
    this.bloomUp = shader(BLOOM_UP, {
      tInput: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 },
    });
    this.bloomUp.blending = THREE.AdditiveBlending;
    this.bloomUp.transparent = true;
    this.shaftMask = shader(SHAFT_MASK, {
      tScene: { value: null }, tDepth: { value: null }, sunUv: { value: new THREE.Vector2() },
      aspect: { value: 1 }, projectionInverse: { value: new THREE.Matrix4() },
      cameraWorld: { value: new THREE.Matrix4() },
      roomMin: { value: new THREE.Vector3(-1e4, -1e4, -1e4) }, roomMax: { value: new THREE.Vector3(1e4, 1e4, 1e4) },
    });
    this.shaftBlur = shader(SHAFT_BLUR, {
      tInput: { value: null }, sunUv: { value: new THREE.Vector2() },
      density: { value: 0.9 }, decay: { value: 0.97 }, jitter: { value: 0 },
    }, { SAMPLES: 40 });
    this.focusMaterial = shader(FOCUS, {
      tDepth: { value: null }, tPrevious: { value: null }, blend: { value: 0.1 },
      cameraNear: near, cameraFar: far,
    });
    this.dofMaterial = shader(DOF, {
      tScene: { value: null }, tDepth: { value: null }, tFocus: { value: null },
      texel: { value: new THREE.Vector2() }, maxBlur: { value: 5 },
      nearStrength: { value: 0.1 }, farStrength: { value: 1.6 },
      cameraNear: near, cameraFar: far,
    });
    this.composite = shader(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, tAO: { value: null },
      tShafts: { value: null }, tDof: { value: null }, tLut: { value: this.lut },
      toneMappingExposure: { value: 1 },
      bloomStrength: { value: 0.2 }, aoIntensity: { value: 1 },
      shaftColor: { value: new THREE.Vector3() }, whiteBalance: { value: this.whiteBalance },
      vignette: { value: 0.32 }, grain: { value: 0 }, grainSeed: { value: 0 },
      aberration: { value: 0 }, lutSize: { value: LUT_SIZE },
      tDepth: { value: null }, aoTexel: { value: new THREE.Vector2() },
      cameraNear: near, cameraFar: far,
    });
    this.fxaa = new THREE.ShaderMaterial({
      ...FXAAShader,
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      depthTest: false, depthWrite: false, toneMapped: false,
    });
  }

  get enabled() { return !!this.config?.post; }

  setConfig(config) {
    this.config = config;
    this.disposeTargets();
    if (!config.post) return;
    this.sceneTarget = hdrTarget(1, 1, { depthBuffer: true, samples: config.msaa });
    this.sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    if (config.ao) {
      this.aoTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, {
        depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      }));
      if (this.aoMaterial.defines.SAMPLES !== config.ao.samples) {
        this.aoMaterial.defines.SAMPLES = config.ao.samples;
        this.aoMaterial.needsUpdate = true;
      }
      Object.assign(this.aoMaterial.uniforms, {});
      this.aoMaterial.uniforms.radius.value = config.ao.radius;
      this.aoMaterial.uniforms.thickness.value = 0.6;
      this.aoMaterial.uniforms.distanceExponent.value = 1.4;
      this.aoMaterial.uniforms.distanceFallOff.value = 1;
      this.aoMaterial.uniforms.scale.value = 1.15;
    }
    if (config.bloom) {
      this.bloomMips = Array.from({ length: config.bloom.levels }, () => hdrTarget());
    }
    if (config.godRays) {
      this.shaftTargets = [0, 1].map(() => hdrTarget());
      if (this.shaftBlur.defines.SAMPLES !== config.godRays.samples) {
        this.shaftBlur.defines.SAMPLES = config.godRays.samples;
        this.shaftBlur.needsUpdate = true;
      }
    }
    if (config.dof) {
      this.dofTarget = hdrTarget();
      this.focusTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType, depthBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      }));
      this.dofMaterial.uniforms.maxBlur.value = config.dof.maxBlur;
    }
    if (config.antialias !== 'none') {
      this.ldrTarget = new THREE.WebGLRenderTarget(1, 1, {
        depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      });
    }
    if (config.antialias === 'smaa') {
      if (SMAAPassClass) this.smaa = new SMAAPassClass(1, 1);
      else {
        loadSmaa().then(() => {
          if (this.config !== config || this.smaa) return;
          this.smaa = new SMAAPassClass(1, 1);
          this.resize();
        }).catch((error) => console.warn('[rendering] SMAA unavailable, using FXAA:', error.message));
      }
    }

    const defines = this.composite.defines;
    for (const key of Object.keys(defines)) delete defines[key];
    if (config.ao) defines.USE_AO = '';
    if (config.bloom) defines.USE_BLOOM = '';
    if (config.godRays) defines.USE_SHAFTS = '';
    if (config.dof) defines.USE_DOF = '';
    if (config.chromaticAberration > 0) defines.USE_ABERRATION = '';
    this.composite.needsUpdate = true;
    this.composite.uniforms.aberration.value = config.chromaticAberration;
    this.composite.uniforms.grain.value = config.grain;
    this.composite.uniforms.aoIntensity.value = config.ao?.intensity ?? 0;
    this.resize();
  }

  setSize(width, height) {
    this.cssWidth = width;
    this.cssHeight = height;
    this.resize();
  }

  resize() {
    if (!this.config?.post || !this.cssWidth) return;
    const ratio = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.round(this.cssWidth * ratio));
    const h = Math.max(1, Math.round(this.cssHeight * ratio));
    this.width = w;
    this.height = h;
    this.sceneTarget.setSize(w, h);
    const { ao, bloom, godRays, dof } = this.config;
    if (ao) {
      const aw = Math.max(1, Math.ceil(w * ao.scale));
      const ah = Math.max(1, Math.ceil(h * ao.scale));
      this.aoTargets.forEach((target) => target.setSize(aw, ah));
      this.aoMaterial.uniforms.resolution.value.set(aw, ah);
      this.composite.uniforms.aoTexel.value.set(1 / aw, 1 / ah);
    }
    if (bloom) {
      let bw = w * bloom.scale, bh = h * bloom.scale;
      for (const mip of this.bloomMips) {
        mip.setSize(Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
        bw /= 2; bh /= 2;
      }
    }
    if (godRays) {
      const sw = Math.max(1, Math.round(w * godRays.scale));
      const sh = Math.max(1, Math.round(h * godRays.scale));
      this.shaftTargets.forEach((target) => target.setSize(sw, sh));
    }
    if (dof) {
      this.dofTarget.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
      this.dofMaterial.uniforms.texel.value.set(1 / Math.round(w / 2), 1 / Math.round(h / 2));
    }
    this.ldrTarget?.setSize(w, h);
    this.smaa?.setSize(w, h);
    this.fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  // Interior volume used to tell daylight outside the windows from the room.
  setRoomBounds(box) {
    this.shaftMask.uniforms.roomMin.value.copy(box.min);
    this.shaftMask.uniforms.roomMax.value.copy(box.max);
  }

  setTheme(theme, sunLight = null) {
    const grade = gradeForTheme(theme);
    this.lut.image.data.set(buildLutData(grade));
    this.lut.needsUpdate = true;
    this.whiteBalance.set(...grade.whiteBalance);
    // Bloom is energy conserving here (a fraction of the blurred HDR image),
    // so the authored theme strengths are rescaled rather than reused as-is.
    this.bloomStrength = 0.05 + (theme.bloom ?? 0.2) * 0.32;
    const night = theme.timeOfDay === 'night';
    const lowSun = theme.timeOfDay === 'sunset' || theme.timeOfDay === 'morning';
    this.shaftStrength = night ? 0 : (lowSun ? 1.15 : 0.7) * (theme.rain ? 0.35 : 1);
    if (sunLight) {
      this.sunDirection.copy(sunLight.position).sub(sunLight.target.position).normalize();
      this.shaftColor.copy(sunLight.color);
    }
    this.vignette = night ? 0.4 : 0.3;
  }

  pass(material, target, clear = true) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear(true, false, false);
    this.quad.render(this.renderer);
    this.timings.passes += 1;
  }

  render(delta = 1 / 30) {
    const { renderer, scene, camera, config } = this;
    if (!config?.post) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    this.elapsed += delta;
    this.frame += 1;
    this.timings.passes = 0;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    renderer.autoClear = false;
    const depth = this.sceneTarget.depthTexture;
    const sceneTexture = this.sceneTarget.texture;
    this.near.value = camera.near;
    this.far.value = camera.far;
    const u = this.composite.uniforms;
    u.tScene.value = sceneTexture;

    if (config.ao) {
      const ao = this.aoMaterial.uniforms;
      ao.tDepth.value = depth;
      ao.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      ao.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      // sky pixels are discarded by the shader and must read as unoccluded
      const clearColor = renderer.getClearColor(new THREE.Color());
      const clearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0xffffff, 1);
      this.pass(this.aoMaterial, this.aoTargets[0]);
      renderer.setClearColor(clearColor, clearAlpha);
      if (config.ao.blur) {
        const [a, b] = this.aoTargets;
        const blur = this.aoBlur.uniforms;
        blur.tDepth.value = depth;
        blur.tAO.value = a.texture;
        blur.direction.value.set(1 / a.width, 0);
        this.pass(this.aoBlur, b);
        blur.tAO.value = b.texture;
        blur.direction.value.set(0, 1 / a.height);
        this.pass(this.aoBlur, a);
      }
      u.tAO.value = this.aoTargets[0].texture;
      u.tDepth.value = depth;
    }

    if (config.bloom) {
      const mips = this.bloomMips;
      const down = this.bloomDown.uniforms;
      let source = sceneTexture;
      let sourceWidth = this.width, sourceHeight = this.height;
      mips.forEach((mip, index) => {
        down.tInput.value = source;
        down.texel.value.set(1 / sourceWidth, 1 / sourceHeight);
        down.prefilter.value = index === 0;
        this.pass(this.bloomDown, mip);
        source = mip.texture;
        sourceWidth = mip.width; sourceHeight = mip.height;
      });
      const up = this.bloomUp.uniforms;
      for (let index = mips.length - 1; index > 0; index -= 1) {
        up.tInput.value = mips[index].texture;
        up.texel.value.set(1 / mips[index].width, 1 / mips[index].height);
        this.pass(this.bloomUp, mips[index - 1], false);
      }
      u.tBloom.value = mips[0].texture;
      u.bloomStrength.value = this.bloomStrength / Math.max(1, mips.length * 0.5);
    }

    u.shaftColor.value.set(0, 0, 0);
    if (config.godRays && this.shaftStrength > 0) {
      const sunPoint = new THREE.Vector3().copy(camera.position).addScaledVector(this.sunDirection, 50);
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const facing = THREE.MathUtils.smoothstep(forward.dot(this.sunDirection), -0.15, 0.55);
      sunPoint.project(camera);
      if (facing > 0.001) {
        const sunUv = new THREE.Vector2(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5);
        const mask = this.shaftMask.uniforms;
        mask.tScene.value = sceneTexture;
        mask.tDepth.value = depth;
        mask.sunUv.value.copy(sunUv);
        mask.aspect.value = this.width / this.height;
        mask.projectionInverse.value.copy(camera.projectionMatrixInverse);
        mask.cameraWorld.value.copy(camera.matrixWorld);
        this.pass(this.shaftMask, this.shaftTargets[0]);
        const blur = this.shaftBlur.uniforms;
        blur.tInput.value = this.shaftTargets[0].texture;
        blur.sunUv.value.copy(sunUv);
        blur.jitter.value = (this.frame % 8) * 7.3;
        this.pass(this.shaftBlur, this.shaftTargets[1]);
        u.tShafts.value = this.shaftTargets[1].texture;
        const k = this.shaftStrength * facing;
        u.shaftColor.value.set(this.shaftColor.r * k, this.shaftColor.g * k, this.shaftColor.b * k);
      }
    }

    if (config.dof) {
      const [current, previous] = this.focusTargets;
      const focus = this.focusMaterial.uniforms;
      focus.tDepth.value = depth;
      focus.tPrevious.value = previous.texture;
      focus.blend.value = 1 - Math.exp(-delta * 3);
      this.pass(this.focusMaterial, current);
      this.focusTargets.reverse();
      const dof = this.dofMaterial.uniforms;
      dof.tScene.value = sceneTexture;
      dof.tDepth.value = depth;
      dof.tFocus.value = current.texture;
      this.pass(this.dofMaterial, this.dofTarget);
      u.tDof.value = this.dofTarget.texture;
    }

    u.toneMappingExposure.value = renderer.toneMappingExposure;
    u.vignette.value = this.vignette ?? 0.3;
    // Animated grain reads as flicker at the 24 fps ambient cadence, so only
    // tiers with temporal AA-like smoothing (high/ultra) re-seed it per frame.
    u.grainSeed.value = config.effectLevel >= 1 ? (this.frame % 64) * 17.0 : 0;

    if (config.antialias === 'none') {
      this.pass(this.composite, null);
    } else {
      this.pass(this.composite, this.ldrTarget);
      if (config.antialias === 'smaa' && this.smaa) {
        this.smaa.renderToScreen = true;
        this.smaa.render(renderer, null, this.ldrTarget);
        this.timings.passes += 3;
      } else {
        this.fxaa.uniforms.tDiffuse.value = this.ldrTarget.texture;
        this.pass(this.fxaa, null);
      }
    }
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  disposeTargets() {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    for (const target of [...this.aoTargets, ...this.bloomMips, ...this.shaftTargets, ...this.focusTargets]) {
      target.dispose();
    }
    this.dofTarget?.dispose();
    this.ldrTarget?.dispose();
    this.smaa?.dispose();
    this.sceneTarget = null;
    this.aoTargets = [];
    this.bloomMips = [];
    this.shaftTargets = [];
    this.focusTargets = [];
    this.dofTarget = null;
    this.ldrTarget = null;
    this.smaa = null;
  }

  dispose() {
    this.disposeTargets();
    this.lut.dispose();
    this.gtaoNoise.dispose();
    for (const material of [this.aoMaterial, this.aoBlur, this.bloomDown, this.bloomUp,
      this.shaftMask, this.shaftBlur, this.focusMaterial, this.dofMaterial, this.composite, this.fxaa]) {
      material.dispose();
    }
    this.quad.dispose();
  }
}
