/**
 * src/world/Sky.ts
 * Gradient sky dome plus optional stars, aurora curtains and a sun glow.
 * The dome is an inverted sphere (BackSide) with a 3-stop vertical gradient
 * shader; stars are twinkling Points; the aurora is a few large additive
 * curtain planes with an animated band shader. fog/depthWrite are off so the
 * sky never interacts with scene fog or occludes geometry incorrectly.
 */

import * as THREE from 'three';
import { seededRandom } from './builders';

export interface SkyDome {
  group: THREE.Group;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

const SKY_RADIUS = 400;

// ── Dome shader ──────────────────────────────────────────────────────────────

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 col = h >= 0.0
    ? mix(uHorizon, uTop, pow(h, 0.62))
    : mix(uHorizon, uBottom, pow(-h, 0.7));
  // A faint warm band hugging the horizon adds depth to the gradient.
  col += uHorizon * 0.18 * exp(-abs(h) * 9.0);
  // Tiny dither to hide gradient banding.
  col += (fract(sin(dot(vDir.xz, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ── Stars shader ─────────────────────────────────────────────────────────────

const STARS_VERT = /* glsl */ `
uniform float uTime;
attribute float aSize;
attribute float aPhase;
attribute float aSpd;
varying float vTwinkle;
varying float vWarm;
void main() {
  vTwinkle = 0.45 + 0.55 * sin(uTime * (0.5 + aSpd) + aPhase);
  vWarm = fract(aPhase * 0.618);
  gl_PointSize = aSize * (0.8 + vTwinkle * 0.6);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STARS_FRAG = /* glsl */ `
varying float vTwinkle;
varying float vWarm;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  vec3 col = mix(vec3(1.0, 0.95, 0.82), vec3(0.74, 0.84, 1.0), vWarm);
  gl_FragColor = vec4(col, a * vTwinkle);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ── Aurora shader ────────────────────────────────────────────────────────────

const AURORA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // Layered sin "noise" bands sliding horizontally — cheap curtain shimmer.
  float x = vUv.x * 8.0 + uPhase;
  float n = sin(x + uTime * 0.32 + sin(x * 2.7 - uTime * 0.21) * 1.4)
          + 0.5 * sin(x * 3.1 - uTime * 0.45);
  float band = smoothstep(0.05, 0.95, n * 0.35 + 0.5);
  // Curtains: brightest near the lower edge, dissolving upward.
  float v = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.1, vUv.y);
  // Fade the curtain's left/right ends.
  float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  float shimmer = 0.8 + 0.2 * sin(uTime * 0.7 + vUv.x * 40.0);
  vec3 col = uColor * (0.55 + 0.45 * band) * shimmer;
  // Hue drift toward violet at the top, like real curtains.
  col = mix(col, col.bgr * 0.8, vUv.y * 0.45);
  gl_FragColor = vec4(col, band * v * ends * 0.55);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ── Sun glow texture (procedural radial sprite) ──────────────────────────────

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createSky(opts: {
  topColor: number;
  horizonColor: number;
  bottomColor: number;
  stars?: boolean;
  aurora?: boolean;
  auroraColor?: number;
  sunGlow?: { position: [number, number, number]; color: number; size?: number };
}): SkyDome {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const animated: Array<{ uTime: { value: number } }> = [];

  // Dome.
  const domeGeo = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
  const domeMat = new THREE.ShaderMaterial({
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    uniforms: {
      uTop: { value: new THREE.Color(opts.topColor) },
      uHorizon: { value: new THREE.Color(opts.horizonColor) },
      uBottom: { value: new THREE.Color(opts.bottomColor) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -100; // paint first; everything else draws over it
  group.add(dome);
  materials.push(domeMat);
  geometries.push(domeGeo);

  // Stars on the upper hemisphere.
  if (opts.stars) {
    const n = 700;
    const rng = seededRandom(0x57a5);
    const pos = new Float32Array(n * 3);
    const aSize = new Float32Array(n);
    const aPhase = new Float32Array(n);
    const aSpd = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      // Random direction biased above the horizon.
      do {
        v.set(rng() * 2 - 1, rng(), rng() * 2 - 1);
      } while (v.lengthSq() < 0.01 || v.y < 0.04);
      v.normalize().multiplyScalar(SKY_RADIUS * 0.96);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      aSize[i] = 1.2 + rng() * 2.2;
      aPhase[i] = rng() * Math.PI * 2;
      aSpd[i] = rng() * 1.5;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    starGeo.setAttribute('aSpd', new THREE.BufferAttribute(aSpd, 1));
    const starMat = new THREE.ShaderMaterial({
      vertexShader: STARS_VERT,
      fragmentShader: STARS_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -99;
    group.add(stars);
    materials.push(starMat);
    geometries.push(starGeo);
    animated.push(starMat.uniforms as unknown as { uTime: { value: number } });
  }

  // Aurora: three big additive curtains arced around the dome.
  if (opts.aurora) {
    const color = new THREE.Color(opts.auroraColor ?? 0x4be3c3);
    const curtainGeo = new THREE.PlaneGeometry(420, 170, 1, 1);
    geometries.push(curtainGeo);
    const angles = [0.4, 2.4, 4.5];
    for (let i = 0; i < angles.length; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: AURORA_VERT,
        fragmentShader: AURORA_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: i * 7.31 },
          uColor: { value: color.clone() },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const curtain = new THREE.Mesh(curtainGeo, mat);
      const a = angles[i];
      curtain.position.set(Math.cos(a) * 250, 140 + i * 18, Math.sin(a) * 250);
      curtain.lookAt(0, 40, 0);
      curtain.rotateX(-0.12); // slight backward tilt, hanging-curtain feel
      curtain.frustumCulled = false;
      curtain.renderOrder = -98;
      group.add(curtain);
      materials.push(mat);
      animated.push(mat.uniforms as unknown as { uTime: { value: number } });
    }
  }

  // Sun glow: billboarded additive disc.
  if (opts.sunGlow) {
    const tex = makeGlowTexture();
    textures.push(tex);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: opts.sunGlow.color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(...opts.sunGlow.position);
    const s = opts.sunGlow.size ?? 60;
    sprite.scale.set(s, s, 1);
    sprite.renderOrder = -97;
    group.add(sprite);
    materials.push(mat);
  }

  let time = 0;
  return {
    group,
    update(dt: number, _elapsed: number): void {
      time += dt;
      for (const u of animated) u.uTime.value = time;
    },
    dispose(): void {
      group.removeFromParent();
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
      for (const t of textures) t.dispose();
      group.clear();
    },
  };
}
