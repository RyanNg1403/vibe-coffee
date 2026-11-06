import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { loadDaylightEnvironment } from './daylightEnvironment.js';

// ---------- soft shadows ----------
// PCSS replaces Three's PCF-soft branch, so a tier opts in simply by choosing
// PCFSoftShadowMap; PCF tiers keep the stock 17-tap filter. Penumbrae widen
// with blocker distance: a chair leg's shadow is crisp at the floor and soft
// at the seat, like a real sun through glass.
const PCSS_BRANCH = /* glsl */`
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )

			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float noiseAngle = 6.28318530718 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
			float s = sin( noiseAngle ), c = cos( noiseAngle );
			mat2 rotation = mat2( c, s, -s, c );
			float searchRadius = 14.0 * shadowRadius;
			float blockerSum = 0.0, blockers = 0.0;
			for ( int i = 0; i < 12; i ++ ) {
				float r = sqrt( ( float( i ) + 0.5 ) / 12.0 );
				float a = float( i ) * 2.39996323;
				vec2 offset = rotation * vec2( cos( a ), sin( a ) ) * r * searchRadius * texelSize;
				float blockerDepth = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + offset ) );
				if ( blockerDepth < shadowCoord.z ) { blockerSum += blockerDepth; blockers += 1.0; }
			}
			if ( blockers > 0.0 ) {
				float penumbra = clamp( ( shadowCoord.z - blockerSum / blockers ) * 0.06 * shadowRadius, 1.25 * texelSize.x, 22.0 * texelSize.x );
				shadow = 0.0;
				for ( int i = 0; i < 20; i ++ ) {
					float r = sqrt( ( float( i ) + 0.5 ) / 20.0 );
					float a = float( i ) * 2.39996323;
					vec2 offset = rotation * vec2( cos( a ), sin( a ) ) * r * penumbra;
					shadow += texture2DCompare( shadowMap, shadowCoord.xy + offset, shadowCoord.z );
				}
				shadow /= 20.0;
			}

		#elif defined( SHADOWMAP_TYPE_VSM )`;

let pcssInstalled = false;
export function installPcss() {
  if (pcssInstalled) return true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const start = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  const end = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  if (start < 0 || end < start) return false;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + PCSS_BRANCH.trim() + chunk.slice(end + '#elif defined( SHADOWMAP_TYPE_VSM )'.length);
  pcssInstalled = true;
  return true;
}

export function applyShadowQuality(renderer, root, shadows) {
  const type = shadows.filter === 'pcss' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type !== type) {
    renderer.shadowMap.type = type;
    // Program keys do not include the shadow filter; force a recompile.
    root?.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) material.needsUpdate = true;
    });
  }
  root?.traverse((object) => {
    if (!object.isDirectionalLight || !object.castShadow) return;
    const shadow = object.shadow;
    if (shadow.mapSize.x !== shadows.mapSize) {
      shadow.mapSize.set(shadows.mapSize, shadows.mapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    shadow.radius = shadows.radius;
    // Larger maps resolve finer detail and need proportionally less bias.
    shadow.normalBias = 0.008 * (2048 / shadows.mapSize) ** 0.5;
    shadow.needsUpdate = true;
  });
  renderer.shadowMap.needsUpdate = true;
}

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Solid-angle weighted mean luminance of an equirectangular HDR (cached).
export function averageRadiance(texture) {
  if (texture.userData.vibeMeanRadiance !== undefined) return texture.userData.vibeMeanRadiance;
  const { data, width, height } = texture.image;
  const half = data instanceof Uint16Array;
  const read = half ? (i) => THREE.DataUtils.fromHalfFloat(data[i]) : (i) => data[i];
  let sum = 0, weight = 0;
  for (let y = 0; y < height; y += 4) {
    const w = Math.sin(((y + 0.5) / height) * Math.PI);
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      sum += luminance(read(i), read(i + 1), read(i + 2)) * w;
      weight += w;
    }
  }
  texture.userData.vibeMeanRadiance = weight ? sum / weight : 1;
  return texture.userData.vibeMeanRadiance;
}

export function findSun(root) {
  let sun = null;
  root?.traverse((object) => {
    if (object.isDirectionalLight && object.castShadow && !sun) sun = object;
  });
  return sun;
}

// ---------- image-based lighting ----------
// Three layers: a procedural room environment while assets load, the credited
// HDR photograph (sky through the windows, outdoor reflections), and a probe
// captured inside each café so metals, glass and satin wood reflect the room
// they are in and pick up its warm bounce light.
export class EnvironmentLighting {
  constructor(renderer, scene, { deferSky = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.fallbackTarget = this.pmrem.fromScene(room, 0.04);
    room.dispose();
    this.hdrTarget = null;
    this.skyRadiance = null;
    this.ready = null;
    this.probeTarget = null;
    this.probeEnabled = false;
    this.probeSize = 0;
    this.theme = null;
    this.cafe = null;
    this.probeDirty = false;
    this.probeBakes = 0;
    this.framesWaitingForSky = 0;
    scene.environment = this.fallbackTarget.texture;
    if (!deferSky) this.loadSky();
  }

  // Streaming visits call this after the room's first frame, so the HDR never
  // sits in front of it.
  loadSky() {
    if (this.ready) return this.ready;
    this.framesWaitingForSky = 0;
    this.ready = loadDaylightEnvironment().then((texture) => {
      let target;
      try {
        target = this.pmrem.fromEquirectangular(texture);
        this.skyRadiance = averageRadiance(texture);
      } finally {
        // The prefiltered cube doubles as the (blurred) sky: a blurred equirect
        // background would make Three build a second, identical PMREM and keep
        // the half-float equirect resident on both sides.
        texture.dispose();
        this.pmrem.dispose();
      }
      this.hdrTarget = target;
      this.applyTheme(this.theme, this.cafe);
    }).catch((error) => console.warn('[environment] HDR lighting unavailable:', error.message));
    return this.ready;
  }

  // Three r166 keeps a material's program when scene.environment changes to
  // a PMREM of a different size, sampling it with the old mip layout.
  setEnvironment(texture) {
    const scene = this.scene;
    const previous = scene.environment;
    scene.environment = texture;
    if (!previous || !texture || previous.image?.height === texture.image?.height) return;
    scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) material.needsUpdate = true;
    });
  }

  get baseEnvironment() {
    return (this.hdrTarget ?? this.fallbackTarget).texture;
  }

  setProbe(probe) {
    const size = probe?.size ?? 0;
    if (size === this.probeSize) return;
    this.probeSize = size;
    this.probeDirty = true;
    if (!size) this.disposeProbe();
  }

  applyTheme(theme, cafe) {
    this.theme = theme;
    this.cafe = cafe;
    if (!theme) return;
    const scene = this.scene;
    const night = theme.timeOfDay === 'night' || /night/i.test(theme.outside ?? '');
    this.setEnvironment(this.baseEnvironment);
    scene.environmentRotation.y = Math.PI * 0.6;
    scene.environmentIntensity = theme.envIntensity ?? 0.35;
    if (this.hdrTarget) {
      scene.background = this.hdrTarget.texture;
      scene.backgroundBlurriness = theme.rain ? 0.2 : 0.06;
      const daylight = { morning: 0.78, noon: 0.9, sunset: 0.72 }[theme.timeOfDay] ?? 0.72;
      scene.backgroundIntensity = night ? 0.018 : daylight * (theme.rain ? 0.45 : 1);
      scene.backgroundRotation.y = Math.PI * 0.6;
      cafe?.group.traverse((object) => {
        if (object.userData.illustratedBackdrop) object.visible = false;
      });
    }
    this.disposeProbe();
    this.probeDirty = true;
  }

  // Call once per rendered frame; bakes are deferred so a café switch never
  // pays for six cube faces in the same frame it builds the room.
  update() {
    if (!this.probeDirty || !this.probeSize || !this.cafe || !this.theme) return false;
    // Wait for the photographic sky; a probe of the fallback room would be
    // replaced moments later anyway.
    if (!this.hdrTarget && this.framesWaitingForSky++ < 90) return false;
    this.probeDirty = false;
    this.bakeProbe();
    return true;
  }

  bakeProbe() {
    const { renderer, scene, cafe, theme } = this;
    const cubeTarget = new THREE.WebGLCubeRenderTarget(this.probeSize, { type: THREE.HalfFloatType });
    const cubeCamera = new THREE.CubeCamera(0.05, 40, cubeTarget);
    // Above head height in the central aisle, below the pendant line.
    const center = cafe.probeCenter ?? new THREE.Vector3(0, 1.95, 0.4);
    cubeCamera.position.copy(center);
    cubeCamera.updateMatrixWorld(true);
    const previousTarget = renderer.getRenderTarget();
    const previousShadowAuto = renderer.shadowMap.autoUpdate;
    const hidden = [];
    // Particles and animated characters would bake in as frozen smudges and
    // ghosts on every reflection.
    scene.traverse((object) => {
      if ((object.isPoints || object.isSkinnedMesh || object.userData.vibeTransient) && object.visible) {
        object.visible = false;
        hidden.push(object);
      }
    });
    // Capture under the same sky lighting the café would have without a probe.
    this.setEnvironment(this.baseEnvironment);
    scene.environmentRotation.y = Math.PI * 0.6;
    scene.environmentIntensity = theme.envIntensity ?? 0.35;
    renderer.shadowMap.autoUpdate = false;
    cubeCamera.update(renderer, scene);
    hidden.forEach((object) => { object.visible = true; });
    renderer.shadowMap.autoUpdate = previousShadowAuto;
    renderer.setRenderTarget(previousTarget);
    // A generator reused across sizes left later probes under-filtered.
    const generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromCubemap(cubeTarget.texture);
    generator.dispose();
    // Spherical-harmonic L0 is the probe's mean radiance.
    const sh = LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget).sh.coefficients[0];
    const probeRadiance = luminance(sh.x, sh.y, sh.z) / (4 * Math.PI * 0.282095);
    cubeTarget.dispose();
    this.disposeProbe();
    this.probeTarget = target;
    this.setEnvironment(target.texture);
    // The probe supplies the room's colour and direction (warm wood bounce,
    // windows in the reflections); its overall level is normalised to the
    // sky photograph's mean radiance that each café's ambient was art
    // directed against, so exposure stays where the themes put it.
    const skyRadiance = this.skyRadiance ?? probeRadiance;
    const ratio = THREE.MathUtils.clamp(skyRadiance / Math.max(probeRadiance, 1e-4), 0.25, 64);
    this.probeNormalization = ratio;
    this.probeStats = { probeRadiance, skyRadiance, usedHdr: !!this.hdrTarget };
    scene.environmentRotation.y = 0;
    scene.environmentIntensity = (theme.envIntensity ?? 0.35) * ratio;
    this.probeBakes += 1;
  }

  disposeProbe() {
    if (!this.probeTarget) return;
    if (this.scene.environment === this.probeTarget.texture) {
      this.setEnvironment(this.baseEnvironment);
      this.scene.environmentRotation.y = Math.PI * 0.6;
      this.scene.environmentIntensity = this.theme?.envIntensity ?? 0.35;
    }
    this.probeTarget.dispose();
    this.probeTarget = null;
  }

  dispose() {
    this.disposeProbe();
    this.fallbackTarget.dispose();
    this.hdrTarget?.dispose();
    this.pmrem.dispose();
  }
}
