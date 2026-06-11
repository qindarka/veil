/**
 * src/core/SceneManager.ts
 * Owns the WebGL renderer, the single THREE.Scene, the perspective camera,
 * the global light rig and the post-processing chain. Locations never create
 * lights or fog themselves: they describe an EnvironmentSettings and the
 * SceneManager retargets its rig via applyEnvironment() on travel (instantly —
 * travel happens behind the DOM loading veil, so no transition is needed).
 */

import * as THREE from 'three';
import type {
  EnvironmentSettings,
  GameContext,
  ISceneManager,
  QualityLevel,
} from '../types';
import { createPostFx } from './postfx';
import type { PostFx } from './postfx';

/** Distance the directional lights sit from the origin (locations are ≤140m). */
const LIGHT_DISTANCE = 180;

export class SceneManager implements ISceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private ctx!: GameContext;
  private readonly post: PostFx;
  private readonly fog: THREE.FogExp2;

  // Light rig, owned here and retargeted per location.
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fill: THREE.DirectionalLight;

  private quality: QualityLevel = 'high';
  private currentEnv: EnvironmentSettings | null = null;
  private readonly onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    // Void indigo until the first location's environment arrives.
    this.scene.background = new THREE.Color(0x0b0716);
    this.fog = new THREE.FogExp2(0x0b0716, 0.008);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      600,
    );
    // Placeholder framing; PlayerController repositions the camera every frame.
    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1.5, 0);

    // ── Light rig ───────────────────────────────────────────────────────────
    this.ambient = new THREE.AmbientLight(0x9a8fc0, 0.5);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffe8c0, 1.6);
    this.sun.position.set(60, 120, 40);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target); // target must be in the graph to update

    // Subtle sky/ground wash that ties scenery into the fog color.
    this.hemi = new THREE.HemisphereLight(0x8d7bff, 0x0b0716, 0.35);
    this.scene.add(this.hemi);

    // Optional cool fill from roughly opposite the sun for stylized contrast;
    // intensity 0 unless the location's environment asks for it.
    this.fill = new THREE.DirectionalLight(0x4be3c3, 0);
    this.fill.position.set(-60, 40, -40);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    this.post = createPostFx(this.renderer, this.scene, this.camera);

    // Resize is owned here (renderer + camera + composer); nothing else listens.
    window.addEventListener('resize', this.onResize);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    // Apply the persisted quality preference, then follow live settings changes.
    this.setQuality(ctx.state.settings.quality);
    ctx.events.on('settings:changed', ({ settings }) => {
      if (settings.quality !== this.quality) this.setQuality(settings.quality);
    });
  }

  /**
   * Per-frame scene work happens in locations/avatars; the SceneManager itself
   * has nothing to tick — rendering is driven by render(dt) from Game's loop.
   */
  update(_dt: number, _elapsed: number): void {}

  applyEnvironment(env: EnvironmentSettings): void {
    this.currentEnv = env;

    (this.scene.background as THREE.Color).set(env.background);
    this.fog.color.set(env.fogColor);
    this.fog.density = env.fogDensity;

    this.ambient.color.set(env.ambientColor);
    this.ambient.intensity = env.ambientIntensity;

    // sunPosition is the direction TO the sun; park the key light far out so
    // shading reads as parallel across an entire 140m location.
    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.position
      .set(env.sunPosition[0], env.sunPosition[1], env.sunPosition[2])
      .normalize()
      .multiplyScalar(LIGHT_DISTANCE);
    this.sun.target.position.set(0, 0, 0);

    // Hemisphere wash derived from the environment so the horizon, fog and
    // bounce light always agree (subtle: a fraction of ambient intensity).
    this.hemi.color.set(env.fogColor);
    this.hemi.groundColor.set(env.background);
    this.hemi.intensity = env.ambientIntensity * 0.4;

    // Cool fill mirrors the sun direction (kept low so it sculpts, not lights).
    if (env.fillColor !== undefined) {
      this.fill.color.set(env.fillColor);
      this.fill.intensity = env.fillIntensity ?? 0.3;
      this.fill.position
        .set(-env.sunPosition[0], Math.max(env.sunPosition[1] * 0.5, 0.15), -env.sunPosition[2])
        .normalize()
        .multiplyScalar(LIGHT_DISTANCE);
      this.fill.target.position.set(0, 0, 0);
    } else {
      this.fill.intensity = 0;
    }

    this.post.setBloom(env.bloomStrength, env.bloomRadius, env.bloomThreshold);
    this.renderer.toneMappingExposure = env.exposure;
  }

  render(dt: number): void {
    this.post.composer.render(dt);
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    const dpr = window.devicePixelRatio || 1;
    // low: no bloom, hard 1.0 ratio. medium: bloom at 1.5. high: bloom at
    // native ratio capped at 2 (4K-and-up displays don't need more).
    const pixelRatio =
      quality === 'low' ? 1 : quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.post.setEnabled(quality !== 'low');
    this.renderer.setPixelRatio(pixelRatio);
    this.post.composer.setPixelRatio(pixelRatio);
    this.resize();
    // Re-assert bloom tuning in case the pass was rebuilt/toggled.
    if (this.currentEnv) {
      this.post.setBloom(
        this.currentEnv.bloomStrength,
        this.currentEnv.bloomRadius,
        this.currentEnv.bloomThreshold,
      );
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
