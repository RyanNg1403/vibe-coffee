import { Box3, Vector3 } from 'three';
import { ROOM } from '../cafe.js';
import { EnvironmentLighting, applyShadowQuality, findSun, installPcss } from './lightingRig.js';
import { materialTime, upgradeCafeMaterials } from './materialUpgrades.js';
import { PostStack } from './postStack.js';
import {
  TIER_NAMES, detectAutoTier, qualityOverrideFromUrl, readGpuInfo, renderQuality, tierIndex,
} from './qualityTiers.js';

// Single entry point for main.js. It owns image-based lighting, shadow
// quality, material upgrades and the post stack, and exposes the active tier
// through `renderQuality` (src/rendering/qualityTiers.js) for other systems.
export function createRenderingSystem({ renderer, scene, camera }) {
  installPcss();
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const gpu = readGpuInfo(renderer.getContext());
  const autoTier = detectAutoTier({
    gpu,
    mobile: /Android|iPhone|iPad|Mobile/i.test(nav.userAgent ?? '') || (nav.maxTouchPoints > 1 && /Mac/.test(nav.platform ?? '')),
    deviceMemory: nav.deviceMemory ?? 8,
    cores: nav.hardwareConcurrency ?? 8,
    screenPixels: (globalThis.screen?.width ?? 1920) * (globalThis.screen?.height ?? 1080) * (globalThis.devicePixelRatio ?? 1),
  });
  renderQuality.autoTier = autoTier;
  const override = qualityOverrideFromUrl(globalThis.location?.search ?? '');
  const environment = new EnvironmentLighting(renderer, scene);
  const post = new PostStack(renderer, scene, camera);
  let cafe = null;
  let theme = null;
  let liquidScanAt = 0;
  let elapsed = 0;
  let configured = null;

  function configure() {
    const config = renderQuality.config;
    if (configured === config) return;
    configured = config;
    post.setConfig(config);
    environment.setProbe(config.probe);
    applyShadowQuality(renderer, scene, config.shadows);
  }

  const system = {
    quality: renderQuality,
    autoTier,
    override,
    gpu,
    environment,
    post,
    get config() { return renderQuality.config; },
    get tier() { return renderQuality.tier; },

    setTier(name) {
      renderQuality.setTier(name);
      configure();
    },

    // Discrete-tier interface for frame-time controllers: tiers run
    // 0 (low) .. 3 (ultra).
    qualityTarget: {
      tierCount: TIER_NAMES.length,
      getTier: () => tierIndex(renderQuality.tier),
      setTier: (index) => system.setTier(TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, Math.round(index)))]),
    },

    applyTheme(nextTheme, nextCafe) {
      theme = nextTheme;
      cafe = nextCafe;
      environment.applyTheme(theme, cafe);
      post.setTheme(theme, findSun(cafe?.group));
      // Open-air venues have no walls: only the sky feeds their shafts.
      post.setRoomBounds(theme.openAir
        ? new Box3(new Vector3(-1e4, -1e4, -1e4), new Vector3(1e4, 1e4, 1e4))
        : new Box3(new Vector3(-ROOM.W / 2, -0.5, -ROOM.D / 2), new Vector3(ROOM.W / 2, ROOM.H + 0.5, ROOM.D / 2)));
      if (cafe) upgradeCafeMaterials(cafe.group, theme);
      configure();
      // A rebuilt café brings new lights at their authored shadow defaults.
      if (cafe) applyShadowQuality(renderer, cafe.group, renderQuality.config.shadows);
    },

    setSize(width, height) { post.setSize(width, height); },
    resize() { post.resize(); },

    render(delta) {
      elapsed += delta;
      materialTime.value = elapsed;
      configure();
      environment.update();
      // Patrons are served drinks long after the room is built.
      if (cafe && elapsed >= liquidScanAt) {
        liquidScanAt = elapsed + 3;
        upgradeCafeMaterials(cafe.group, theme);
      }
      post.render(delta);
    },

    metrics() {
      const config = renderQuality.config;
      return {
        tier: renderQuality.tier,
        autoTier,
        gpu,
        post: config.post,
        antialias: config.antialias,
        msaa: config.msaa,
        ao: !!config.ao,
        bloom: !!config.bloom,
        godRays: !!config.godRays,
        dof: !!config.dof,
        shadowMapSize: config.shadows.mapSize,
        shadowFilter: config.shadows.filter,
        probeSize: environment.probeTarget ? config.probe?.size ?? 0 : 0,
        probeBakes: environment.probeBakes,
        postPasses: post.timings.passes,
      };
    },
  };
  return system;
}
