/**
 * src/world/builders.ts
 * Procedural geometry library for the six dream-world locations. Stylized
 * high-fantasy look: flat-shaded MeshStandardMaterial, vertex-color gradients,
 * generous (but tasteful) emissive accents that read beautifully under bloom.
 * Everything is deterministic via seededRandom so all players see the same
 * world. All builders return objects positioned relative to the origin;
 * callers position and add them.
 */

import * as THREE from 'three';

// ── Randomness & noise ───────────────────────────────────────────────────────

/** mulberry32 — tiny deterministic PRNG. Same seed ⇒ same world on every client. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer-lattice hash in [0,1). Deterministic for (ix, iz, seed). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (seed | 0) + Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Smooth 2D value noise in [-1, 1]. Analytic and cheap — the same function is
 * used both to displace island vertices and to answer getHeight queries, which
 * keeps avatars exactly on the displaced surface.
 */
function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return (top + (bot - top) * sz) * 2 - 1;
}

/** GLSL-style smoothstep; works with reversed edges. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Darken (f<1) or lighten toward white (f>1) a hex color. */
function shadeHex(hex: number, f: number): number {
  const c = new THREE.Color(hex);
  if (f <= 1) c.multiplyScalar(f);
  else c.lerp(new THREE.Color(0xffffff), Math.min(1, f - 1));
  return c.getHex();
}

// ── Vertex-color gradient ────────────────────────────────────────────────────

/** Write a bottom→top vertex "color" attribute spanning the geometry's Y range. */
export function applyVerticalGradient(
  geo: THREE.BufferGeometry,
  bottom: number,
  top: number,
): void {
  geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  const pos = geo.getAttribute('position');
  const span = Math.max(1e-5, bb.max.y - bb.min.y);
  const cb = new THREE.Color(bottom);
  const ct = new THREE.Color(top);
  const c = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - bb.min.y) / span, 0, 1);
    c.copy(cb).lerp(ct, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ── Materials ────────────────────────────────────────────────────────────────

export function standardMat(opts: {
  color?: number;
  vertexColors?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: opts.vertexColors ?? false,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.0,
    flatShading: opts.flatShading ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

// ── Floating island ──────────────────────────────────────────────────────────

/**
 * Polar-grid disc with per-vertex height + color callbacks. Used for the
 * island top so we get interior vertices to displace (CircleGeometry has none).
 */
function makePolarDisc(
  radius: number,
  rings: number,
  segs: number,
  heightFn: (x: number, z: number) => number,
  colorFn: (x: number, z: number, h: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const r = (radius * i) / rings;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = heightFn(x, z);
      positions.push(x, h, z);
      colorFn(x, z, h, c);
      colors.push(c.r, c.g, c.b);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * row + j;
      const b = a + 1;
      const d = a + row;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createFloatingIsland(opts: {
  radius: number;
  height?: number;
  topColor: number;
  cliffColor: number;
  bottomColor: number;
  noiseAmp?: number;
  seed?: number;
}): { group: THREE.Group; getHeight: (x: number, z: number) => number } {
  const { radius, topColor, cliffColor, bottomColor } = opts;
  const height = opts.height ?? radius * 0.85;
  const amp = opts.noiseAmp ?? Math.max(1.1, radius * 0.05);
  const seed = opts.seed ?? 1;

  // The analytic height function. Stored once and reused by both the vertex
  // displacement below and getHeight — guaranteed to agree everywhere.
  const freq = 3.0 / radius;
  const heightFn = (x: number, z: number): number => {
    const d = Math.hypot(x, z);
    // Rolls to exactly 0 at the rim so the top meets the cliff cleanly.
    const edge = smoothstep(radius, radius * 0.55, d);
    const n =
      valueNoise2(x * freq, z * freq, seed) * amp +
      valueNoise2(x * freq * 2.7, z * freq * 2.7, seed ^ 0x9e3779) * amp * 0.35;
    const dome = (1 - Math.min(1, (d / radius) ** 2)) * amp * 0.55;
    return (n + dome + amp * 0.45) * edge;
  };

  const group = new THREE.Group();

  // Top surface: displaced disc with a cliff→meadow radial+height gradient.
  const cTop = new THREE.Color(topColor);
  const cCliff = new THREE.Color(cliffColor);
  const topGeo = makePolarDisc(radius, 14, 56, heightFn, (x, z, h, out) => {
    const t = THREE.MathUtils.clamp(0.25 + h / (amp * 1.4), 0, 1);
    out.copy(cCliff).lerp(cTop, t);
  });
  const topMesh = new THREE.Mesh(
    topGeo,
    standardMat({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  topMesh.receiveShadow = true;
  group.add(topMesh);

  // Rocky tapered underside: open cylinder, noise-displaced except at the top
  // ring so it stays welded to the disc rim.
  const underGeo = new THREE.CylinderGeometry(radius, radius * 0.06, height, 56, 7, true);
  underGeo.translate(0, -height / 2, 0);
  {
    const pos = underGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const v = 1 + y / height; // 1 at top ring, 0 at the tip
      const n = valueNoise2(x * 0.45, z * 0.45, seed ^ 0x51ab);
      const disp = n * radius * 0.13 * (1 - v);
      const len = Math.hypot(x, z);
      if (len > 1e-4) {
        pos.setX(i, x + (x / len) * disp);
        pos.setZ(i, z + (z / len) * disp);
      }
      pos.setY(i, y + valueNoise2(z * 0.6, x * 0.6, seed ^ 0x33cd) * height * 0.05 * (1 - v));
    }
    pos.needsUpdate = true;
    underGeo.computeVertexNormals();
  }
  applyVerticalGradient(underGeo, bottomColor, cliffColor);
  const underMesh = new THREE.Mesh(
    underGeo,
    standardMat({ vertexColors: true, flatShading: true, roughness: 1 }),
  );
  group.add(underMesh);

  return { group, getHeight: heightFn };
}

// ── Crystals ─────────────────────────────────────────────────────────────────

export function createCrystalCluster(opts: {
  count: number;
  color: number;
  emissiveIntensity?: number;
  minHeight: number;
  maxHeight: number;
  spread: number;
  corrupted?: boolean;
  seed?: number;
}): THREE.Group {
  const rng = seededRandom(opts.seed ?? 7);
  const group = new THREE.Group();
  const corrupted = opts.corrupted ?? false;
  const baseColor = corrupted ? shadeHex(opts.color, 0.3) : opts.color;
  const emissive = corrupted ? 0x8f1030 : opts.color;
  const intensity = (opts.emissiveIntensity ?? 0.8) * (corrupted ? 0.55 : 1);

  const mat = standardMat({
    color: baseColor,
    emissive,
    emissiveIntensity: intensity,
    flatShading: true,
    roughness: 0.35,
    metalness: 0.1,
  });
  // Bright red "veins" laid on the surface of corrupted spikes.
  const veinMat = corrupted
    ? standardMat({ color: 0x140208, emissive: 0xff2a4d, emissiveIntensity: 1.6, flatShading: true })
    : null;

  for (let i = 0; i < opts.count; i++) {
    const h = THREE.MathUtils.lerp(opts.minHeight, opts.maxHeight, rng());
    const rBase = h * (0.14 + rng() * 0.1);
    // 6-sided spike: a cylinder tapering to a point.
    const geo = new THREE.CylinderGeometry(0, rBase, h, 6, 1);
    geo.translate(0, h / 2, 0);
    const spike = new THREE.Mesh(geo, mat);
    const a = rng() * Math.PI * 2;
    const d = rng() * opts.spread;
    spike.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    // Lean outward from the cluster center for a "burst" silhouette.
    spike.rotation.set((rng() - 0.5) * 0.45, rng() * Math.PI * 2, (rng() - 0.5) * 0.45);
    spike.rotateOnWorldAxis(
      new THREE.Vector3(Math.cos(a + Math.PI / 2), 0, Math.sin(a + Math.PI / 2)),
      Math.min(0.35, d * 0.2),
    );
    group.add(spike);

    if (veinMat) {
      for (let v = 0; v < 2; v++) {
        const vein = new THREE.Mesh(new THREE.BoxGeometry(0.025, h * 0.45, 0.025), veinMat);
        const va = rng() * Math.PI * 2;
        vein.position.set(Math.cos(va) * rBase * 0.55, h * (0.3 + rng() * 0.3), Math.sin(va) * rBase * 0.55);
        vein.rotation.z = (rng() - 0.5) * 0.5;
        spike.add(vein);
      }
    }
  }
  return group;
}

// ── Trees ────────────────────────────────────────────────────────────────────

export function createStylizedTree(opts: {
  height: number;
  trunkColor: number;
  canopyColor: number;
  canopyEmissive?: number;
  layers?: number;
  seed?: number;
}): THREE.Group {
  const rng = seededRandom(opts.seed ?? 11);
  const h = opts.height;
  const layers = opts.layers ?? 3;
  const group = new THREE.Group();

  const trunkGeo = new THREE.CylinderGeometry(h * 0.035, h * 0.06, h * 0.45, 6);
  trunkGeo.translate(0, h * 0.225, 0);
  applyVerticalGradient(trunkGeo, shadeHex(opts.trunkColor, 0.7), shadeHex(opts.trunkColor, 1.05));
  group.add(new THREE.Mesh(trunkGeo, standardMat({ vertexColors: true, flatShading: true })));

  const canopyMat = standardMat({
    vertexColors: true,
    flatShading: true,
    emissive: opts.canopyEmissive ?? 0x000000,
    emissiveIntensity: opts.canopyEmissive !== undefined ? 0.35 : 1,
    roughness: 0.9,
  });
  for (let i = 0; i < layers; i++) {
    const f = i / Math.max(1, layers - 1); // 0 bottom layer → 1 top layer
    const radius = h * 0.3 * (1 - f * 0.55) * (0.9 + rng() * 0.2);
    const coneH = h * 0.34;
    const geo = new THREE.ConeGeometry(radius, coneH, 7);
    const y = h * 0.38 + f * h * 0.42;
    geo.translate((rng() - 0.5) * h * 0.04, y, (rng() - 0.5) * h * 0.04);
    applyVerticalGradient(geo, shadeHex(opts.canopyColor, 0.75), shadeHex(opts.canopyColor, 1.25));
    group.add(new THREE.Mesh(geo, canopyMat));
  }
  return group;
}

export function createTreeField(opts: {
  count: number;
  areaRadius: number;
  minHeight: number;
  maxHeight: number;
  trunkColor: number;
  canopyColor: number;
  canopyEmissive?: number;
  seed?: number;
  getHeight?: (x: number, z: number) => number;
  exclusionRadius?: number;
}): THREE.Group {
  const rng = seededRandom(opts.seed ?? 23);
  const group = new THREE.Group();
  const exclusion = opts.exclusionRadius ?? 0;

  // Place trees first; the instanced meshes are sized to the placed count.
  const placements: Array<{ x: number; y: number; z: number; h: number; rot: number; tint: number }> = [];
  for (let i = 0; i < opts.count; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * opts.areaRadius;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      if (d >= exclusion) {
        ok = true;
        break;
      }
    }
    if (!ok) continue;
    placements.push({
      x,
      y: opts.getHeight ? opts.getHeight(x, z) : 0,
      z,
      h: THREE.MathUtils.lerp(opts.minHeight, opts.maxHeight, rng()),
      rot: rng() * Math.PI * 2,
      tint: 0.85 + rng() * 0.3,
    });
  }
  const n = placements.length;
  if (n === 0) return group;

  // Unit geometries scaled per instance: trunk 0..1, cones centered base-up.
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.12, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(0.5, 1, 7);
  coneGeo.translate(0, 0.5, 0);

  const trunkMat = standardMat({ color: opts.trunkColor, flatShading: true });
  const canopyMat = standardMat({
    color: opts.canopyColor,
    flatShading: true,
    emissive: opts.canopyEmissive ?? 0x000000,
    emissiveIntensity: opts.canopyEmissive !== undefined ? 0.3 : 1,
  });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const canopyA = new THREE.InstancedMesh(coneGeo, canopyMat, n);
  const canopyB = new THREE.InstancedMesh(coneGeo.clone(), canopyMat, n);

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const canopyBase = new THREE.Color(opts.canopyColor);
  for (let i = 0; i < n; i++) {
    const p = placements[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.set(p.h * 0.8, p.h * 0.5, p.h * 0.8);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + p.h * 0.38, p.z);
    dummy.scale.set(p.h * 0.62, p.h * 0.5, p.h * 0.62);
    dummy.updateMatrix();
    canopyA.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + p.h * 0.64, p.z);
    dummy.scale.set(p.h * 0.42, p.h * 0.44, p.h * 0.42);
    dummy.updateMatrix();
    canopyB.setMatrixAt(i, dummy.matrix);

    tint.copy(canopyBase).multiplyScalar(p.tint);
    canopyA.setColorAt(i, tint);
    canopyB.setColorAt(i, tint);
  }
  group.add(trunks, canopyA, canopyB);
  return group;
}

// ── Ruins ────────────────────────────────────────────────────────────────────

export function createRuinColumn(opts: {
  height: number;
  radius: number;
  color: number;
  broken?: boolean;
  seed?: number;
}): THREE.Group {
  const rng = seededRandom(opts.seed ?? 31);
  const { height, radius, color } = opts;
  const group = new THREE.Group();
  const mat = standardMat({ vertexColors: true, flatShading: true, roughness: 0.95 });

  const baseGeo = new THREE.BoxGeometry(radius * 2.8, radius * 0.8, radius * 2.8);
  baseGeo.translate(0, radius * 0.4, 0);
  applyVerticalGradient(baseGeo, shadeHex(color, 0.7), shadeHex(color, 1.0));
  group.add(new THREE.Mesh(baseGeo, mat));

  const shaftH = opts.broken ? height * (0.35 + rng() * 0.3) : height;
  const shaftGeo = new THREE.CylinderGeometry(radius, radius * 1.12, shaftH, 10);
  shaftGeo.translate(0, radius * 0.8 + shaftH / 2, 0);
  applyVerticalGradient(shaftGeo, shadeHex(color, 0.75), shadeHex(color, 1.15));
  group.add(new THREE.Mesh(shaftGeo, mat));

  if (opts.broken) {
    // Jagged rubble crown where the shaft snapped.
    const capGeo = new THREE.IcosahedronGeometry(radius * 1.05, 0);
    capGeo.scale(1, 0.5, 1);
    capGeo.translate(0, radius * 0.8 + shaftH, 0);
    applyVerticalGradient(capGeo, shadeHex(color, 0.8), shadeHex(color, 1.05));
    group.add(new THREE.Mesh(capGeo, mat));
    group.rotation.z = (rng() - 0.5) * 0.1;
  } else {
    const capGeo = new THREE.BoxGeometry(radius * 2.5, radius * 0.7, radius * 2.5);
    capGeo.translate(0, radius * 0.8 + shaftH + radius * 0.35, 0);
    applyVerticalGradient(capGeo, shadeHex(color, 0.85), shadeHex(color, 1.2));
    group.add(new THREE.Mesh(capGeo, mat));
  }
  return group;
}

export function createRuinArch(opts: {
  width: number;
  height: number;
  color: number;
  seed?: number;
}): THREE.Group {
  const { width, height, color } = opts;
  const seed = opts.seed ?? 41;
  const group = new THREE.Group();
  const colRadius = width * 0.07;
  const colH = height - width * 0.18;

  const left = createRuinColumn({ height: colH, radius: colRadius, color, seed });
  left.position.x = -width / 2;
  const right = createRuinColumn({ height: colH, radius: colRadius, color, seed: seed + 1 });
  right.position.x = width / 2;
  group.add(left, right);

  // Half-torus spanning the columns.
  const archGeo = new THREE.TorusGeometry(width / 2, width * 0.06, 8, 28, Math.PI);
  archGeo.translate(0, 0, 0);
  applyVerticalGradient(archGeo, shadeHex(color, 0.8), shadeHex(color, 1.2));
  const arch = new THREE.Mesh(
    archGeo,
    standardMat({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  arch.position.y = colH;
  group.add(arch);
  return group;
}

// ── Lantern ──────────────────────────────────────────────────────────────────

export function createLantern(opts: { color: number; height?: number; light?: boolean }): THREE.Group {
  const h = opts.height ?? 2.4;
  const group = new THREE.Group();

  const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, h, 6);
  poleGeo.translate(0, h / 2, 0);
  group.add(new THREE.Mesh(poleGeo, standardMat({ color: 0x2a2238, flatShading: true })));

  // Glowing cage — emissive does the work under bloom.
  const cage = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.24, 0),
    standardMat({ color: 0x1a1410, emissive: opts.color, emissiveIntensity: 2.0, flatShading: true }),
  );
  cage.scale.y = 1.4;
  cage.position.y = h + 0.18;
  group.add(cage);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.14, 6),
    standardMat({ color: 0x2a2238, flatShading: true }),
  );
  cap.position.y = h + 0.52;
  group.add(cap);

  if (opts.light ?? true) {
    const light = new THREE.PointLight(opts.color, 1.6, 8, 2);
    light.position.y = h + 0.2;
    group.add(light);
  }
  return group;
}

// ── Water ────────────────────────────────────────────────────────────────────

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying float vWave;
varying vec2 vWorldXZ;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float w = sin(wp.x * 0.35 + uTime * 0.9) * 0.5
          + sin(wp.z * 0.28 - uTime * 0.7) * 0.5
          + sin((wp.x + wp.z) * 0.12 + uTime * 0.4);
  p.y += w * 0.12;
  vWave = w;
  vWorldXZ = wp.xz;
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uDeep;
uniform float uOpacity;
uniform float uTime;
varying float vWave;
varying vec2 vWorldXZ;
#include <fog_pars_fragment>
void main() {
  float crest = smoothstep(-1.2, 1.4, vWave);
  vec3 col = mix(uDeep, uColor, crest);
  // Drifting glints + crest sheen, emissive enough to catch the bloom pass.
  // Two rotated, incommensurate sine lattices gated by a slow drifting mask:
  // glints appear only where both align inside a patch, reading as scattered
  // glitter. (A single axis-aligned sine product reads as a uniform dot grid
  // when the plane is seen from above.)
  vec2 p = vWorldXZ;
  vec2 q = vec2(p.x * 0.7071 - p.y * 0.7071, p.x * 0.7071 + p.y * 0.7071);
  float g1 = sin(p.x * 1.93 + uTime * 1.3) * sin(p.y * 2.41 - uTime * 1.1);
  float g2 = sin(q.x * 3.17 - uTime * 0.7) * sin(q.y * 2.73 + uTime * 0.9);
  float mask = 0.5 + 0.5 * sin(p.x * 0.11 + uTime * 0.23) * sin(p.y * 0.13 - uTime * 0.17);
  float sparkle = pow(max(0.0, g1 * g2), 6.0) * mask;
  col += uColor * sparkle * 0.55;
  col += uColor * pow(crest, 3.0) * 0.45;
  gl_FragColor = vec4(col, uOpacity);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createWaterPlane(opts: {
  size: number;
  color: number;
  deepColor: number;
  opacity?: number;
  flowSpeed?: number;
}): { mesh: THREE.Mesh; update: (dt: number, elapsed: number) => void } {
  const geo = new THREE.PlaneGeometry(opts.size, opts.size, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(opts.color) },
      uDeep: { value: new THREE.Color(opts.deepColor) },
      uOpacity: { value: opts.opacity ?? 0.85 },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: true, // blends into the location's fog like the built-in materials
  });
  const mesh = new THREE.Mesh(geo, mat);
  const flow = opts.flowSpeed ?? 1;
  let time = 0;
  return {
    mesh,
    update: (dt: number, _elapsed: number) => {
      time += dt * flow;
      uniforms.uTime.value = time;
    },
  };
}

// ── Light shaft (god ray) ────────────────────────────────────────────────────

export function createLightShaft(opts: {
  color: number;
  height: number;
  radiusTop: number;
  radiusBottom: number;
  opacity?: number;
}): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(opts.radiusTop, opts.radiusBottom, opts.height, 24, 1, true);
  geo.translate(0, opts.height / 2, 0);
  // Additive blending treats vertex color as brightness: fade the beam to
  // black at the bottom so it dissolves into the scene instead of ending hard.
  applyVerticalGradient(geo, shadeHex(opts.color, 0.04), opts.color);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: opts.opacity ?? 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  return new THREE.Mesh(geo, mat);
}

// ── Bridge ───────────────────────────────────────────────────────────────────

export function createBridge(opts: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  width?: number;
  color: number;
  arc?: number;
}): THREE.Group {
  const group = new THREE.Group();
  const width = opts.width ?? 2;
  const from = opts.from.clone();
  const to = opts.to.clone();
  const span = to.clone().sub(from);
  const length = span.length();
  const arc = opts.arc ?? length * 0.07;
  const n = Math.max(4, Math.ceil(length / 0.85));

  const centerAt = (t: number, out: THREE.Vector3): THREE.Vector3 =>
    out.copy(from).addScaledVector(span, t).setY(
      THREE.MathUtils.lerp(from.y, to.y, t) + Math.sin(t * Math.PI) * arc,
    );

  // Planks as one InstancedMesh, each looking at the next sample so they
  // follow the arc's slope.
  const plankGeo = new THREE.BoxGeometry(width, 0.1, (length / n) * 1.12);
  const plankMat = standardMat({ color: opts.color, flatShading: true });
  const planks = new THREE.InstancedMesh(plankGeo, plankMat, n);
  const dummy = new THREE.Object3D();
  const next = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    centerAt(t, dummy.position);
    centerAt(Math.min(1, t + 0.02), next);
    dummy.lookAt(next);
    dummy.updateMatrix();
    planks.setMatrixAt(i, dummy.matrix);
  }
  group.add(planks);

  // Two glowing hand-rails following the arc.
  const railMat = standardMat({
    color: shadeHex(opts.color, 0.9),
    emissive: shadeHex(opts.color, 1.4),
    emissiveIntensity: 0.25,
    flatShading: true,
  });
  const up = new THREE.Vector3(0, 1, 0);
  const perp = new THREE.Vector3(span.x, 0, span.z).normalize().cross(up).multiplyScalar(width / 2);
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const p = centerAt(i / 12, new THREE.Vector3());
      p.addScaledVector(perp, side);
      p.y += 0.5;
      pts.push(p);
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.04, 5);
    group.add(new THREE.Mesh(tube, railMat));
  }
  return group;
}

// ── Rock ─────────────────────────────────────────────────────────────────────

export function createRock(opts: { size: number; color: number; seed?: number }): THREE.Mesh {
  const seed = opts.seed ?? 53;
  const geo = new THREE.IcosahedronGeometry(opts.size, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = valueNoise2(v.x * 1.3 + v.y * 0.7, v.z * 1.3 - v.y * 0.5, seed);
    v.multiplyScalar(1 + n * 0.28);
    pos.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  applyVerticalGradient(geo, shadeHex(opts.color, 0.65), shadeHex(opts.color, 1.15));
  return new THREE.Mesh(geo, standardMat({ vertexColors: true, flatShading: true, roughness: 1 }));
}

// ── Echo figure (luminous spirit) ────────────────────────────────────────────

export function createEchoFigure(opts: { color: number; height?: number }): {
  group: THREE.Group;
  update: (dt: number, elapsed: number) => void;
} {
  const group = new THREE.Group();
  const inner = new THREE.Group(); // bobbed/breathed; `group` stays caller-positioned
  group.add(inner);
  const color = opts.color;

  // Layered translucent lathe robe — outer veil + brighter inner core.
  const profile = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.5, 0.03),
    new THREE.Vector2(0.42, 0.28),
    new THREE.Vector2(0.27, 0.72),
    new THREE.Vector2(0.21, 1.02),
    new THREE.Vector2(0.12, 1.18),
  ];
  const robeGeo = new THREE.LatheGeometry(profile, 24);
  const outerMat = standardMat({
    color: shadeHex(color, 0.4),
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.35,
    flatShading: false,
  });
  outerMat.depthWrite = false;
  outerMat.side = THREE.DoubleSide;
  const outer = new THREE.Mesh(robeGeo, outerMat);
  inner.add(outer);

  const innerMat = standardMat({
    color: shadeHex(color, 0.5),
    emissive: shadeHex(color, 1.3),
    emissiveIntensity: 1.2,
    transparent: true,
    opacity: 0.65,
  });
  innerMat.depthWrite = false;
  const core = new THREE.Mesh(robeGeo.clone(), innerMat);
  core.scale.set(0.72, 0.97, 0.72);
  inner.add(core);

  // Glowing head orb — the brightest element; blooms into a halo.
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 20, 14),
    standardMat({ color: 0x0a0612, emissive: shadeHex(color, 1.6), emissiveIntensity: 2.6 }),
  );
  orb.position.y = 1.34;
  inner.add(orb);

  // Inner light so the spirit illuminates its surroundings.
  const light = new THREE.PointLight(color, 2, 10, 2);
  light.position.y = 1.0;
  inner.add(light);

  // Three tiny orbiting wisps.
  const wisps: THREE.Mesh[] = [];
  const wispMat = standardMat({ color: 0x000000, emissive: shadeHex(color, 1.7), emissiveIntensity: 2.2 });
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), wispMat);
    wisps.push(w);
    inner.add(w);
  }

  const scale = (opts.height ?? 1.8) / 1.5; // built ~1.5m tall
  group.scale.setScalar(scale);

  const update = (_dt: number, elapsed: number): void => {
    inner.position.y = 0.06 + Math.sin(elapsed * 0.8) * 0.07; // slow bob
    const breathe = 1 + Math.sin(elapsed * 1.4) * 0.02;
    outer.scale.set(breathe, 1, breathe);
    orb.material.emissiveIntensity = 2.6 + Math.sin(elapsed * 2.1) * 0.5;
    light.intensity = 2 + Math.sin(elapsed * 1.7) * 0.35;
    for (let i = 0; i < wisps.length; i++) {
      const a = elapsed * 0.9 + (i * Math.PI * 2) / wisps.length;
      wisps[i].position.set(Math.cos(a) * 0.5, 0.85 + Math.sin(elapsed * 1.3 + i * 2.1) * 0.18, Math.sin(a) * 0.5);
    }
  };
  return { group, update };
}
