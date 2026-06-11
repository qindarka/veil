/**
 * src/core/postfx.ts
 * Post-processing chain for the dream-world look: RenderPass → UnrealBloomPass
 * (luminous magic) → a custom grade pass (subtle vignette + gentle saturation
 * and shadow lift, keeping blacks a faintly luminous indigo) → OutputPass
 * (tone mapping + sRGB conversion in three 0.184).
 *
 * SceneManager owns the returned PostFx handle; per-location bloom settings
 * arrive through setBloom() from EnvironmentSettings on travel.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface PostFx {
  composer: EffectComposer;
  setSize(w: number, h: number): void;
  setBloom(strength: number, radius: number, threshold: number): void;
  /** Toggle the bloom pass (quality "low" disables it). */
  setEnabled(bloomOn: boolean): void;
}

/**
 * Vignette + color grade. Runs in linear HDR space (before OutputPass tone
 * maps), so the lift/saturation behave like a photographic grade rather than
 * crushing display-referred values. Uniform defaults are deliberately gentle;
 * tweak here to retune the whole game's look.
 */
export const VeilGradeShader = {
  name: 'VeilGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** 1.0 = neutral; >1 pushes the saturated high-fantasy palette. */
    uSaturation: { value: 1.08 },
    /** Additive shadow lift; a whisper of indigo so blacks never go dead. */
    uLift: { value: new THREE.Color(0.012, 0.009, 0.022) },
    /** 0 = off, 1 = fully dark corners. */
    uVignetteStrength: { value: 0.32 },
    /** Distance from screen center (in UV units) where darkening peaks. */
    uVignetteRadius: { value: 0.78 },
    /** Width of the falloff band leading into the vignette. */
    uVignetteSoftness: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform vec3 uLift;
    uniform float uVignetteStrength;
    uniform float uVignetteRadius;
    uniform float uVignetteSoftness;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);

      // Lift shadows toward luminous indigo, then saturate around luminance.
      vec3 col = texel.rgb + uLift;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // Soft radial vignette; multiplied in linear space so the tone mapper
      // rolls the corners off gracefully instead of clipping them.
      float dist = distance(vUv, vec2(0.5));
      float falloff = smoothstep(uVignetteRadius - uVignetteSoftness, uVignetteRadius, dist);
      col *= 1.0 - uVignetteStrength * falloff;

      gl_FragColor = vec4(col, texel.a);
    }
  `,
};

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Resolution argument only seeds internal target sizes; composer.setSize
  // keeps them in sync afterwards. Defaults are mild — locations retune via
  // setBloom() from their EnvironmentSettings.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.width, size.height),
    0.7, // strength
    0.4, // radius
    0.85, // threshold
  );
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(VeilGradeShader);
  composer.addPass(gradePass);

  // OutputPass applies tone mapping (ACES, set on the renderer) and the
  // linear→sRGB conversion; it must stay last in the chain.
  composer.addPass(new OutputPass());

  return {
    composer,
    setSize(w: number, h: number): void {
      // EffectComposer.setSize cascades to every pass (incl. bloom targets).
      composer.setSize(w, h);
    },
    setBloom(strength: number, radius: number, threshold: number): void {
      bloomPass.strength = strength;
      bloomPass.radius = radius;
      bloomPass.threshold = threshold;
    },
    setEnabled(bloomOn: boolean): void {
      bloomPass.enabled = bloomOn;
    },
  };
}
