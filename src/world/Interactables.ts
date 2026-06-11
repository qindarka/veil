/**
 * src/world/Interactables.ts
 * Factories for the standard interactables (portals, glyph plates, resonance
 * crystals, Echo NPCs, lore objects, shrines). Each returns a fully-wired
 * Interactable: a visual group with an emissive "beacon", a soft ground ring +
 * emissive boost on setHighlight(on), and a gentle idle animation in update().
 * Visual consistency across all six locations comes from these factories.
 */

import * as THREE from 'three';
import type { ArchetypeId } from '../../shared/archetypes';
import type { LocationId } from '../../shared/constants';
import type { Interactable, InteractableKind } from '../types';
import {
  createCrystalCluster,
  createEchoFigure,
  standardMat,
} from './builders';

export interface InteractableOpts {
  id: string;
  prompt: string;
  position: THREE.Vector3 | [number, number, number];
  radius?: number;
  requiresArchetype?: ArchetypeId;
}

const DEFAULT_RADIUS = 3.5;
const PORTAL_RADIUS = 4.5;

// ── Shared plumbing ──────────────────────────────────────────────────────────

function toVec3(p: THREE.Vector3 | [number, number, number]): THREE.Vector3 {
  return Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone();
}

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Floating text label (portal names / Echo names) drawn to a canvas sprite. */
function makeTextSprite(text: string, colorCss: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (g) {
    g.font = '600 52px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = colorCss;
    g.shadowBlur = 26;
    g.fillStyle = colorCss;
    // Double-pass: glow halo, then a brighter core for legibility.
    g.fillText(text, 256, 64);
    g.shadowBlur = 8;
    g.fillText(text, 256, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.4, 0.85, 1);
  return sprite;
}

/**
 * Base implementation shared by every factory. Holds the highlight state
 * machine: a soft additive ring at the base fades in, and registered emissive
 * materials get boosted, easing smoothly in update().
 */
class StdInteractable implements Interactable {
  readonly id: string;
  readonly kind: InteractableKind;
  readonly object = new THREE.Group();
  readonly prompt: string;
  readonly radius: number;
  requiresArchetype?: ArchetypeId;
  portalTo?: LocationId;

  /** Extra idle animation supplied by the factory. */
  idle?: (dt: number, elapsed: number) => void;

  private highlightTarget = 0;
  private highlightLevel = 0;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly glow: Array<{ mat: THREE.MeshStandardMaterial; base: number }> = [];
  private readonly fade: Array<{ mat: THREE.Material & { opacity: number }; base: number }> = [];

  constructor(kind: InteractableKind, opts: InteractableOpts, ringColor: number, ringRadius: number) {
    this.id = opts.id;
    this.kind = kind;
    this.prompt = opts.prompt;
    this.radius = opts.radius ?? (kind === 'portal' ? PORTAL_RADIUS : DEFAULT_RADIUS);
    if (opts.requiresArchetype) this.requiresArchetype = opts.requiresArchetype;
    this.object.position.copy(toVec3(opts.position));

    const ringGeo = new THREE.RingGeometry(ringRadius * 0.7, ringRadius, 36);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.y = 0.04;
    this.ring.visible = false;
    this.object.add(this.ring);
  }

  /** Register an emissive material whose intensity rises while highlighted. */
  registerGlow(mat: THREE.MeshStandardMaterial, base?: number): void {
    this.glow.push({ mat, base: base ?? mat.emissiveIntensity });
  }

  /** Register a transparent material whose opacity rises while highlighted. */
  registerFade(mat: THREE.Material & { opacity: number }): void {
    this.fade.push({ mat, base: mat.opacity });
  }

  setHighlight(on: boolean): void {
    this.highlightTarget = on ? 1 : 0;
  }

  update(dt: number, elapsed: number): void {
    // Ease the highlight level for a soft glow-up instead of a hard pop.
    const k = Math.min(1, dt * 9);
    this.highlightLevel += (this.highlightTarget - this.highlightLevel) * k;
    const level = this.highlightLevel;

    this.ring.visible = level > 0.02;
    if (this.ring.visible) {
      this.ringMat.opacity = 0.85 * level * (0.85 + 0.15 * Math.sin(elapsed * 3.2));
      this.ring.rotation.y += dt * 0.7;
    }
    const pulse = 1 + 0.12 * Math.sin(elapsed * 2.1 + (hashId(this.id) % 100) * 0.31);
    for (const g of this.glow) g.mat.emissiveIntensity = g.base * pulse * (1 + level * 1.4);
    for (const f of this.fade) f.mat.opacity = Math.min(1, f.base * (1 + level * 0.8));

    this.idle?.(dt, elapsed);
  }
}

// ── Portal ───────────────────────────────────────────────────────────────────

export function makePortal(
  opts: InteractableOpts & { to: LocationId; color?: number; label?: string },
): Interactable {
  const color = opts.color ?? 0x8d7bff;
  const it = new StdInteractable('portal', opts, color, 2.0);
  it.portalTo = opts.to;
  const g = it.object;

  // Torii-like luminous gate: two posts, an upswept lintel and a tie-beam.
  const stoneMat = standardMat({ color: 0x2c2344, flatShading: true, roughness: 0.9 });
  const glowMat = standardMat({ color: 0x140d24, emissive: color, emissiveIntensity: 0.9, flatShading: true });
  it.registerGlow(glowMat);

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.36, 4.0, 0.36), stoneMat);
    post.position.set(side * 1.7, 2.0, 0);
    post.rotation.z = side * -0.04; // slight inward lean
    g.add(post);
    // Glowing capitals.
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMat);
    cap.position.set(side * 1.7, 4.15, 0);
    g.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.32, 0.5), glowMat);
  lintel.position.y = 4.35;
  g.add(lintel);
  const tie = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.22, 0.4), stoneMat);
  tie.position.y = 3.45;
  g.add(tie);

  // Swirling disc: layered transparent additive discs spun at different rates.
  const discSpecs: Array<{ r: number; c: number; o: number; spd: number }> = [
    { r: 1.5, c: color, o: 0.34, spd: 0.5 },
    { r: 1.2, c: 0xffffff, o: 0.18, spd: -0.9 },
    { r: 0.85, c: color, o: 0.42, spd: 1.5 },
  ];
  const discs: Array<{ mesh: THREE.Mesh; spd: number }> = [];
  for (const s of discSpecs) {
    const mat = new THREE.MeshBasicMaterial({
      color: s.c,
      transparent: true,
      opacity: s.o,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    // CircleGeometry keeps uv-less swirl cheap; rotation sells the motion via
    // the slightly elliptical scale below.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(s.r, 40), mat);
    disc.position.y = 2.1;
    disc.scale.x = 0.92;
    g.add(disc);
    discs.push({ mesh: disc, spd: s.spd });
    it.registerFade(mat);
  }

  // Destination label floating above the gate.
  const label = makeTextSprite(opts.label ?? 'Veil Gate', cssHex(color));
  label.position.y = 5.2;
  g.add(label);

  it.idle = (dt, elapsed) => {
    for (const d of discs) d.mesh.rotation.z += dt * d.spd;
    const s = 1 + 0.04 * Math.sin(elapsed * 1.3);
    for (const d of discs) d.mesh.scale.set(0.92 * s, s, 1);
  };
  return it;
}

// ── Glyph plate ──────────────────────────────────────────────────────────────

export function makeGlyphPlate(opts: InteractableOpts & { color?: number }): Interactable {
  const color = opts.color ?? 0x4be3c3;
  const it = new StdInteractable('glyph', opts, color, 1.4);
  const g = it.object;

  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.3, 0.12, 24),
    standardMat({ color: 0x241c3a, flatShading: true, roughness: 0.8 }),
  );
  plate.position.y = 0.06;
  g.add(plate);

  // Engraved rune ring that brightens: emissive torus + orbiting rune shards.
  const runeMat = standardMat({ color: 0x0c0818, emissive: color, emissiveIntensity: 0.8, flatShading: true });
  it.registerGlow(runeMat);
  const torus = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.035, 8, 40), runeMat);
  torus.rotation.x = -Math.PI / 2;
  torus.position.y = 0.13;
  g.add(torus);

  const runes = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const rune = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09, 0), runeMat);
    const a = (i / 8) * Math.PI * 2;
    rune.position.set(Math.cos(a) * 0.82, 0.16, Math.sin(a) * 0.82);
    rune.rotation.set(a, a * 1.7, 0);
    runes.add(rune);
  }
  g.add(runes);

  // Central sigil dot.
  const sigil = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), runeMat);
  sigil.position.y = 0.2;
  g.add(sigil);

  it.idle = (dt, elapsed) => {
    runes.rotation.y += dt * 0.35;
    sigil.rotation.y -= dt * 0.8;
    sigil.position.y = 0.2 + Math.sin(elapsed * 1.6) * 0.03;
  };
  return it;
}

// ── Resonance crystal ────────────────────────────────────────────────────────

export function makeResonanceCrystal(
  opts: InteractableOpts & { color?: number; corrupted?: boolean },
): Interactable {
  const color = opts.color ?? 0x8d7bff;
  const it = new StdInteractable('crystal', opts, opts.corrupted ? 0xff2a4d : color, 1.4);
  const g = it.object;

  const cluster = createCrystalCluster({
    count: 5,
    color,
    corrupted: opts.corrupted ?? false,
    emissiveIntensity: 0.9,
    minHeight: 1.1,
    maxHeight: 2.3,
    spread: 0.65,
    seed: hashId(opts.id),
  });
  g.add(cluster);

  // Register every emissive material in the cluster as a highlight beacon.
  const seen = new Set<THREE.Material>();
  cluster.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.isMeshStandardMaterial && !seen.has(mat)) {
      seen.add(mat);
      it.registerGlow(mat);
    }
  });

  // Rough rocky base so the spikes feel rooted.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 0.25, 9),
    standardMat({ color: 0x241c3a, flatShading: true, roughness: 1 }),
  );
  base.position.y = 0.1;
  g.add(base);

  // Pulse only — rotating rooted crystals would look wrong.
  it.idle = () => {};
  return it;
}

// ── Echo NPC ─────────────────────────────────────────────────────────────────

export function makeEchoNpc(opts: InteractableOpts & { color: number; name: string }): Interactable {
  const it = new StdInteractable('npc', opts, opts.color, 1.1);
  const g = it.object;

  const figure = createEchoFigure({ color: opts.color, height: 1.9 });
  g.add(figure.group);

  // Name floats above the spirit in its accent color.
  const label = makeTextSprite(opts.name, cssHex(opts.color));
  label.position.y = 2.45;
  label.scale.set(2.6, 0.65, 1);
  g.add(label);

  // Boost the figure's emissive materials on highlight.
  const seen = new Set<THREE.Material>();
  figure.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.isMeshStandardMaterial && mat.emissiveIntensity > 0 && !seen.has(mat)) {
      seen.add(mat);
      it.registerGlow(mat);
    }
  });

  it.idle = (dt, elapsed) => figure.update(dt, elapsed);
  return it;
}

// ── Lore objects ─────────────────────────────────────────────────────────────

export type LoreKind = 'tablet' | 'mural' | 'bell' | 'stump' | 'orrery' | 'fountain' | 'generic';

export function makeLoreObject(
  opts: InteractableOpts & { loreKind?: LoreKind; color?: number },
): Interactable {
  const color = opts.color ?? 0xffd27a;
  const it = new StdInteractable('lore', opts, color, 1.1);
  const g = it.object;
  const kind: LoreKind = opts.loreKind ?? 'generic';

  const stoneMat = standardMat({ color: 0x352a52, flatShading: true, roughness: 0.95 });
  const glowMat = standardMat({ color: 0x140d24, emissive: color, emissiveIntensity: 0.9, flatShading: true });
  it.registerGlow(glowMat);

  switch (kind) {
    case 'tablet': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.6), stoneMat);
      base.position.y = 0.125;
      g.add(base);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.15, 0.12), stoneMat);
      slab.position.set(0, 0.78, 0);
      slab.rotation.x = -0.22;
      g.add(slab);
      // Glowing script panel floating a hair in front of the slab face
      // (child of the slab so it inherits the tilt).
      const script = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.92), glowMat);
      script.position.set(0, 0.02, 0.07);
      slab.add(script);
      break;
    }
    case 'mural': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.7, 0.14), stoneMat);
      frame.position.y = 1.15;
      g.add(frame);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), glowMat);
      art.position.set(0, 1.15, 0.08);
      g.add(art);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.5), stoneMat);
      sill.position.y = 0.15;
      g.add(sill);
      break;
    }
    case 'bell': {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.0, 6), stoneMat);
        post.position.set(side * 0.7, 1.0, 0);
        g.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.18), stoneMat);
      beam.position.y = 2.0;
      g.add(beam);
      // Bell: an inverted glowing-rimmed cone with a clapper orb.
      const bell = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 12), stoneMat);
      body.rotation.x = Math.PI;
      body.position.y = -0.3;
      bell.add(body);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 20), glowMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.56;
      bell.add(rim);
      const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMat);
      clapper.position.y = -0.62;
      bell.add(clapper);
      bell.position.y = 1.95;
      g.add(bell);
      it.idle = (_dt, elapsed) => {
        bell.rotation.z = Math.sin(elapsed * 0.9) * 0.06; // gentle sway
      };
      break;
    }
    case 'stump': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.55, 9), stoneMat);
      trunk.position.y = 0.275;
      g.add(trunk);
      // Glowing growth rings on the cut face.
      for (const r of [0.42, 0.27, 0.13]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 6, 28), glowMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.56;
        g.add(ring);
      }
      break;
    }
    case 'orrery': {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.0, 8), stoneMat);
      pedestal.position.y = 0.5;
      g.add(pedestal);
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), glowMat);
      heart.position.y = 1.35;
      g.add(heart);
      const rings: THREE.Mesh[] = [];
      for (const [r, tilt] of [
        [0.42, 0.4],
        [0.58, -0.7],
      ] as Array<[number, number]>) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 36), glowMat);
        ring.position.y = 1.35;
        ring.rotation.x = tilt;
        g.add(ring);
        rings.push(ring);
      }
      it.idle = (dt, _elapsed) => {
        rings[0].rotation.z += dt * 0.5;
        rings[1].rotation.y += dt * 0.32;
      };
      break;
    }
    case 'fountain': {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.4, 14), stoneMat);
      basin.position.y = 0.2;
      g.add(basin);
      // Luminous "water" surface.
      const waterMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      it.registerFade(waterMat);
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.88, 20), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.42;
      g.add(water);
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.9, 8), stoneMat);
      column.position.y = 0.85;
      g.add(column);
      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glowMat);
      finial.position.y = 1.45;
      g.add(finial);
      it.idle = (_dt, elapsed) => {
        finial.position.y = 1.45 + Math.sin(elapsed * 1.4) * 0.05;
        finial.rotation.y = elapsed * 0.6;
      };
      break;
    }
    case 'generic':
    default: {
      // A leaning standing-stone with a glowing glyph face.
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.45), stoneMat);
      stone.position.y = 0.8;
      stone.rotation.set(0.04, 0.5, 0.06);
      g.add(stone);
      const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.9), glowMat);
      glyph.position.set(0, 0.05, 0.24);
      stone.add(glyph);
      break;
    }
  }
  return it;
}

// ── Shrine ───────────────────────────────────────────────────────────────────

export function makeShrine(opts: InteractableOpts & { color?: number }): Interactable {
  const color = opts.color ?? 0xffd27a;
  const it = new StdInteractable('shrine', opts, color, 1.2);
  const g = it.object;

  const stoneMat = standardMat({ color: 0x352a52, flatShading: true, roughness: 0.95 });
  const glowMat = standardMat({ color: 0x140d24, emissive: color, emissiveIntensity: 1.3, flatShading: true });
  it.registerGlow(glowMat);

  // Tapered pedestal with a glowing collar and floating emblem.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 1.1, 8), stoneMat);
  pedestal.position.y = 0.55;
  g.add(pedestal);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.1, 8), stoneMat);
  plate.position.y = 1.15;
  g.add(plate);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 24), glowMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.21;
  g.add(collar);

  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), glowMat);
  emblem.position.y = 1.65;
  emblem.scale.y = 1.35;
  g.add(emblem);

  // Three small kneeling-stones around the base.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), stoneMat);
    stone.position.set(Math.cos(a) * 0.95, 0.11, Math.sin(a) * 0.95);
    stone.rotation.y = a;
    g.add(stone);
  }

  it.idle = (_dt, elapsed) => {
    emblem.position.y = 1.65 + Math.sin(elapsed * 1.2) * 0.07; // bob
    emblem.rotation.y = elapsed * 0.7; // slow spin
  };
  return it;
}
