import * as THREE from 'three';

// Architectural panes are effectively thin at café viewing distances, so they
// stay alpha-blended rather than paying for a transmission re-render. Output
// is premultiplied: the transmitted (diffuse) term scales with coverage while
// reflections are added at full strength, as on real glass. Schlick Fresnel
// (F0 = 0.04 for n = 1.5) drives coverage, so a pane is nearly invisible head
// on and turns into a mirror of the room at grazing angles.
export function createThinGlass({ color = 0xe3edef, opacity = 0.24, roughness = 0.08, side = THREE.FrontSide } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    color, opacity, roughness, side,
    metalness: 0, ior: 1.5, transmission: 0,
    transparent: true, depthWrite: false, forceSinglePass: true,
    premultipliedAlpha: true,
    envMapIntensity: 1,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float glassCos = clamp(abs(dot(normal, geometryViewDir)), 0.0, 1.0);
       float glassFresnel = 0.04 + 0.96 * pow(1.0 - glassCos, 5.0);
       float glassAlpha = clamp(diffuseColor.a * (0.55 + 0.45 * (1.0 - glassCos)) + glassFresnel * 0.6, 0.0, 1.0);
       vec3 glassLight = totalDiffuse * glassAlpha + totalSpecular * (1.0 + glassFresnel * 1.5) + totalEmissiveRadiance;
       // premultiplied_alpha_fragment multiplies rgb by alpha again
       gl_FragColor = vec4(glassLight / max(glassAlpha, 1e-3), glassAlpha);`,
    );
  };
  material.customProgramCacheKey = () => 'vibe-thin-glass-v2';
  return material;
}
