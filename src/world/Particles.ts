/**
 * src/world/Particles.ts
 * One GPU particle implementation (THREE.Points + custom ShaderMaterial)
 * parameterized by `kind`. All motion lives in the vertex shader driven by a
 * time uniform and per-particle seed/size/phase attributes, so updating a
 * system costs a single uniform write per frame. Sprites are drawn
 * procedurally in the fragment shader (soft radial falloff), additively
 * blended, depth-write off, unaffected by fog — built to glow under bloom.
 */

import * as THREE from 'three';
import { seededRandom } from './builders';

export type ParticleKind =
  | 'motes'
  | 'fireflies'
  | 'bubbles'
  | 'embers'
  | 'petals'
  | 'snow'
  | 'sparkfall';

export interface ParticleSystem {
  object: THREE.Points;
  update(dt: number, elapsed: number): void;
  setIntensity(v: number): void;
  dispose(): void;
}

const MAX_COUNT = 4000;

/** Per-kind look defaults; opts override. size is approximate world meters. */
const KIND_DEFAULTS: Record<ParticleKind, { color: number; size: number; opacity: number; height: number }> = {
  motes: { color: 0xffd27a, size: 0.16, opacity: 0.7, height: 10 },
  fireflies: { color: 0xc8ff7a, size: 0.2, opacity: 0.9, height: 6 },
  bubbles: { color: 0x9adcff, size: 0.22, opacity: 0.55, height: 12 },
  embers: { color: 0xff9d5c, size: 0.18, opacity: 0.85, height: 10 },
  petals: { color: 0xff6ec7, size: 0.24, opacity: 0.8, height: 12 },
  snow: { color: 0xeaf4ff, size: 0.18, opacity: 0.7, height: 14 },
  sparkfall: { color: 0xffd27a, size: 0.3, opacity: 0.9, height: 16 },
};

/**
 * Per-kind motion snippets injected into the vertex shader. Inputs in scope:
 * vec3 p (base position; xz in a disc, y in [0, uHeight]), uTime, aSeed [0,1),
 * aPhase [0,2π), uHeight. Must leave the final position in `p` and may write
 * vAlpha (defaults to 1.0).
 */
const MOTION: Record<ParticleKind, string> = {
  // Slow drift with a whole-field swirl around the center.
  motes: /* glsl */ `
    float ca = cos(uTime * 0.05 + aSeed * 6.2831);
    float sa = sin(uTime * 0.05 + aSeed * 6.2831);
    p.xz = mat2(ca, sa, -sa, ca) * p.xz;
    p.x += sin(uTime * 0.31 + aPhase) * 1.2;
    p.z += cos(uTime * 0.27 + aPhase * 1.7) * 1.2;
    p.y += sin(uTime * 0.4 + aPhase * 2.3) * 0.9;
    vAlpha = 0.6 + 0.4 * sin(uTime * 0.8 + aSeed * 40.0);
  `,
  // Wandering paths (summed sines per axis) + brightness flicker.
  fireflies: /* glsl */ `
    p.x += sin(uTime * 0.7 + aSeed * 31.4) * 2.0 + sin(uTime * 0.23 + aSeed * 17.0) * 1.3;
    p.z += cos(uTime * 0.6 + aSeed * 23.0) * 2.0 + cos(uTime * 0.19 + aSeed * 13.0) * 1.3;
    p.y += sin(uTime * 0.5 + aPhase) * 1.1;
    vAlpha = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 40.0), 2.0);
  `,
  // Rising with wobble; wraps at uHeight, fading in/out at the ends.
  bubbles: /* glsl */ `
    float spd = 0.6 + aSeed * 0.8;
    float y = mod(p.y + uTime * spd, uHeight);
    p.x += sin(uTime * 1.5 + aSeed * 20.0 + y * 0.6) * 0.25;
    p.z += cos(uTime * 1.3 + aSeed * 15.0 + y * 0.5) * 0.25;
    float f = y / uHeight;
    vAlpha = smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.85, f);
    p.y = y;
  `,
  // Rising fast, fading out as they climb.
  embers: /* glsl */ `
    float spd = 2.5 + aSeed * 3.0;
    float y = mod(p.y + uTime * spd, uHeight);
    float f = y / uHeight;
    p.x += sin(uTime * 2.0 + aSeed * 30.0) * 0.35 + f * (aSeed - 0.5) * 2.0;
    p.z += cos(uTime * 1.7 + aSeed * 20.0) * 0.35;
    p.y = y;
    vAlpha = (1.0 - f) * smoothstep(0.0, 0.05, f);
  `,
  // Falling with a wide sway, like drifting blossom.
  petals: /* glsl */ `
    float spd = 0.8 + aSeed * 0.6;
    float y = mod(p.y - uTime * spd, uHeight);
    p.x += sin(uTime * 1.2 + aSeed * 25.0 + y * 0.8) * 1.2;
    p.z += cos(uTime * 0.9 + aSeed * 12.0 + y * 0.6) * 1.2;
    p.y = y;
    vAlpha = (0.7 + 0.3 * sin(uTime * 2.0 + aPhase)) * smoothstep(0.0, 0.06, y / uHeight);
  `,
  // Falling slow, gentle sway.
  snow: /* glsl */ `
    float spd = 0.35 + aSeed * 0.35;
    float y = mod(p.y - uTime * spd, uHeight);
    p.x += sin(uTime * 0.6 + aSeed * 25.0 + y * 0.5) * 0.5;
    p.z += cos(uTime * 0.5 + aSeed * 14.0 + y * 0.4) * 0.5;
    p.y = y;
    vAlpha = smoothstep(0.0, 0.06, y / uHeight);
  `,
  // Fast falling luminous streaks (fragment shader stretches the sprite).
  sparkfall: /* glsl */ `
    float spd = 6.0 + aSeed * 6.0;
    float y = mod(p.y - uTime * spd, uHeight);
    float f = y / uHeight;
    p.x += sin(aSeed * 40.0) * 0.4;
    p.y = y;
    vAlpha = smoothstep(0.0, 0.12, f) * (0.35 + 0.65 * f);
  `,
};

function buildVertexShader(kind: ParticleKind): string {
  return /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uHeight;
uniform float uYBase;
attribute float aSeed;
attribute float aSize;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec3 p = position;
  vAlpha = 1.0;
  ${MOTION[kind]}
  p.y += uYBase;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float px = uSize * aSize * (600.0 / max(0.1, -mv.z));
  gl_PointSize = min(px, 96.0);
  gl_Position = projectionMatrix * mv;
}
`;
}

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  #ifdef STREAK
  // Narrow the sprite horizontally so fast fall reads as a streak.
  uv.x *= 3.5;
  uv.y *= 1.1;
  #endif
  float d = length(uv);
  float a = smoothstep(0.5, 0.0, d);
  a *= a; // soft shoulder
  float core = smoothstep(0.16, 0.0, d); // hot center for bloom pickup
  vec3 col = uColor * (0.75 + core * 0.9);
  gl_FragColor = vec4(col, a * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createParticles(opts: {
  kind: ParticleKind;
  count: number;
  areaRadius: number;
  height?: number;
  yBase?: number;
  color?: number;
  size?: number;
  opacity?: number;
}): ParticleSystem {
  const def = KIND_DEFAULTS[opts.kind];
  const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(opts.count)));
  const height = opts.height ?? def.height;
  const baseOpacity = opts.opacity ?? def.opacity;

  // Buffer sizes are fixed at creation; motion is purely shader-side.
  const rng = seededRandom(0xbeef ^ count);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * opts.areaRadius;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = rng() * height;
    positions[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = rng();
    sizes[i] = 0.6 + rng() * 0.8;
    phases[i] = rng() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  // Generous bound (we also disable frustum culling; this is belt & braces).
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, height / 2, 0),
    opts.areaRadius + height,
  );

  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: opts.size ?? def.size },
    uHeight: { value: height },
    uYBase: { value: opts.yBase ?? 0 },
    uColor: { value: new THREE.Color(opts.color ?? def.color) },
    uOpacity: { value: baseOpacity },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: buildVertexShader(opts.kind),
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    defines: opts.kind === 'sparkfall' ? { STREAK: 1 } : {},
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // positions are displaced in the shader

  let time = 0;
  return {
    object: points,
    update(dt: number, _elapsed: number): void {
      // Accumulate locally so systems created mid-session don't "jump".
      time += dt;
      uniforms.uTime.value = time;
    },
    setIntensity(v: number): void {
      uniforms.uOpacity.value = baseOpacity * THREE.MathUtils.clamp(v, 0, 1);
    },
    dispose(): void {
      points.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}
