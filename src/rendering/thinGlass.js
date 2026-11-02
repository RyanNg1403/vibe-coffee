import * as THREE from 'three';

// Architectural panes are effectively thin at café viewing distances. Fresnel
// reflections and alpha give them a clear centre and a readable grazing edge,
// without rendering the whole scene a second time for screen-space refraction.
// Reserve transmission for objects whose thickness actually needs refraction.
export function createThinGlass({ color = 0xe3edef, opacity = 0.24, roughness = 0.08, side = THREE.FrontSide } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    color, opacity, roughness, side,
    metalness: 0, ior: 1.5, transmission: 0,
    transparent: true, depthWrite: false, forceSinglePass: true,
    envMapIntensity: 0.85,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float glassFresnel = pow(1.0 - clamp(abs(dot(normal, geometryViewDir)), 0.0, 1.0), 3.0);
       diffuseColor.a *= mix(0.24, 1.0, glassFresnel);
       #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'vibe-thin-glass-v1';
  return material;
}
