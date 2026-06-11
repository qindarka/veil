/**
 * src/player/Avatar.ts
 * The procedural Veilwalker avatar: a hooded luminous figure ~1.7 m tall,
 * built to read beautifully under the bloom pass. Layered translucent lathe
 * robe in the archetype color (fading to transparent at the hem), a glowing
 * head orb under the hood, trailing wisp particles (a tiny Points system) and
 * a soft archetype-colored PointLight. Also owns the floating gait animation
 * (bobs while idle, leans + bobs faster while moving), the name-tag sprite,
 * transient emote-burst / chat-bubble sprites, parametric emote flourishes
 * (a ~1.4 s body animation per emote, eased back to exact neutral) and idle
 * life: subtle breathing plus an occasional head-orb flicker, randomized per
 * avatar so a party never pulses in sync.
 */

import * as THREE from 'three';
import { EMOTES } from '../../shared/constants';
import type { AnimState, EmoteId } from '../../shared/constants';

// ── Tuning ───────────────────────────────────────────────────────────────────

const ROBE_HEM_Y = 0.1; // robe hem floats slightly above the ground
const ROBE_TOP_Y = 1.32; // shoulder line
const HEAD_Y = 1.38; // glowing head orb center
const NAMETAG_Y = 2.05;
const WISP_COUNT = 26;

const FLOURISH_S = 1.4; // emote body-flourish duration
const BREATH_PERIOD_S = 4; // idle breathing cycle
const BREATH_AMP = 0.015; // ±1.5% scale
const FLICKER_MIN_S = 6; // min seconds between head-orb flickers
const FLICKER_MAX_S = 12; // max seconds between head-orb flickers
const FLICKER_S = 1.1; // duration of one flicker

/** Floating-gait parameters per animation state (eased between on change). */
const GAIT: Record<AnimState, { bobAmp: number; bobHz: number; lean: number }> = {
  idle: { bobAmp: 0.05, bobHz: 1.1, lean: 0 },
  walk: { bobAmp: 0.07, bobHz: 2.4, lean: 0.13 },
  run: { bobAmp: 0.1, bobHz: 3.4, lean: 0.26 },
};

// ── Shared resources ─────────────────────────────────────────────────────────

// One soft radial-gradient texture shared by every avatar's wisps and halos.
// Intentionally never disposed: it is tiny and lives for the whole session.
let softTexture: THREE.CanvasTexture | null = null;
function getSoftTexture(): THREE.Texture {
  if (softTexture) return softTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  softTexture = new THREE.CanvasTexture(canvas);
  return softTexture;
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// ── Easing ───────────────────────────────────────────────────────────────────

/** Sine-squared bell: eases 0 → 1 → 0 over u ∈ [0,1], exactly 0 at both ends. */
function bell(u: number): number {
  const s = Math.sin(Math.PI * u);
  return s * s;
}

/** Hermite smoothstep of u clamped to [0,1]. */
function smooth01(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/** Ease in over the first quarter, hold at 1, ease out over the last quarter. */
function plateau(u: number): number {
  return smooth01(u / 0.25) * (1 - smooth01((u - 0.75) / 0.25));
}

// ── Robe shader ──────────────────────────────────────────────────────────────
// A vertical alpha gradient (transparent at the hem) plus a fresnel rim so the
// silhouette glows; emissive boost feeds the bloom pass.

const ROBE_VERT = /* glsl */ `
  uniform float uHemY;
  uniform float uTopY;
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vH = clamp((position.y - uHemY) / (uTopY - uHemY), 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalMatrix * normal;
    vViewDir = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const ROBE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uEmissive;
  uniform float uRim; // 0 = solid alpha, 1 = alpha concentrated on the rim
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.0);
    vec3 col = uColor * (0.30 + 0.70 * vH) + uColor * fres * 0.9 + uColor * uEmissive;
    float hemFade = smoothstep(0.0, 0.55, vH);
    float alpha = uOpacity * hemFade * mix(1.0, 0.3 + 0.7 * fres, uRim);
    gl_FragColor = vec4(col, alpha);
  }
`;

function makeRobeMaterial(
  color: THREE.Color,
  opts: { opacity: number; emissive: number; rim: number; additive: boolean },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ROBE_VERT,
    fragmentShader: ROBE_FRAG,
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opts.opacity },
      uEmissive: { value: opts.emissive },
      uRim: { value: opts.rim },
      uHemY: { value: ROBE_HEM_Y },
      uTopY: { value: ROBE_TOP_Y },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ── Canvas sprite helpers ────────────────────────────────────────────────────

function roundedRectPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draw a rounded dark pill with centered text; returns the canvas. */
function makePillCanvas(
  text: string,
  opts: { font: string; textCss: string; bgCss: string; borderCss: string; padX: number; height: number },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) {
    canvas.width = canvas.height = 2; // 2d context unavailable; blank sprite
    return canvas;
  }
  probe.font = opts.font;
  const textW = Math.ceil(probe.measureText(text).width);
  canvas.width = Math.max(8, textW + opts.padX * 2);
  canvas.height = opts.height;
  const g = canvas.getContext('2d')!; // resizing reset the state; re-acquire
  g.font = opts.font;
  const r = opts.height / 2 - 3;
  roundedRectPath(g, 1.5, 1.5, canvas.width - 3, canvas.height - 3, r);
  g.fillStyle = opts.bgCss;
  g.fill();
  g.strokeStyle = opts.borderCss;
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = opts.textCss;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  return canvas;
}

function spriteFromCanvas(canvas: HTMLCanvasElement, worldHeight: number): THREE.Sprite {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((worldHeight * canvas.width) / canvas.height, worldHeight, 1);
  return sprite;
}

// ── Transient sprites (emotes / chat bubbles) ────────────────────────────────

interface TransientSprite {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  /** Total world-space rise over the lifetime (meters). */
  rise: number;
  baseY: number;
  baseScaleX: number;
  baseScaleY: number;
  /** Scale pop-in (used by emotes). */
  pop: boolean;
  isBubble: boolean;
}

// ── Avatar ───────────────────────────────────────────────────────────────────

export class Avatar {
  readonly group = new THREE.Group();

  private readonly color: THREE.Color;
  private readonly body = new THREE.Group();
  /**
   * Inner container holding the visible body meshes (robe, hood, orb, halo).
   * Single-writer split: the controller/interpolation drives `group`, the
   * gait drives `body`, and emote flourishes + breathing drive ONLY this —
   * never the group root, name tag, chat bubbles or emoji sprites.
   */
  private readonly innerBody = new THREE.Group();
  private readonly robeMaterials: THREE.ShaderMaterial[] = [];
  private readonly hoodMaterial: THREE.MeshStandardMaterial;
  private readonly orb: THREE.Mesh;
  private readonly halo: THREE.Sprite;
  private readonly light: THREE.PointLight;
  private readonly wisps: THREE.Points;
  private readonly wispGeo: THREE.BufferGeometry;
  private readonly wispPhase: number[] = [];
  private readonly wispSpeed: number[] = [];
  private readonly nameTag: THREE.Sprite;

  private animState: AnimState = 'idle';
  private bobAmp = GAIT.idle.bobAmp;
  private bobHz = GAIT.idle.bobHz;
  private lean = 0;
  private bobPhase = Math.random() * Math.PI * 2; // desync avatars from each other

  /** Active emote flourish (null when the body is at neutral). */
  private flourish: { emote: EmoteId; age: number } | null = null;
  // Idle life, randomized per avatar so a party never breathes/flickers in sync.
  private readonly breathPhase = Math.random() * Math.PI * 2;
  private readonly breathHz = (0.9 + Math.random() * 0.2) / BREATH_PERIOD_S;
  private flickerIn = FLICKER_MIN_S + Math.random() * (FLICKER_MAX_S - FLICKER_MIN_S);
  private flickerAge = FLICKER_S; // >= FLICKER_S means not flickering

  private transients: TransientSprite[] = [];
  private bubble: TransientSprite | null = null;
  private disposed = false;

  constructor(opts: { color: number; name: string; isSelf?: boolean }) {
    this.color = new THREE.Color(opts.color);
    this.group.add(this.body);
    this.body.add(this.innerBody);

    // — Robe: two lathe shells, inner soft-solid + outer additive ghost layer.
    const profile = [
      new THREE.Vector2(0.48, ROBE_HEM_Y),
      new THREE.Vector2(0.42, 0.34),
      new THREE.Vector2(0.33, 0.66),
      new THREE.Vector2(0.26, 0.95),
      new THREE.Vector2(0.2, 1.18),
      new THREE.Vector2(0.155, ROBE_TOP_Y),
    ];
    const robeGeo = new THREE.LatheGeometry(profile, 28);
    const inner = new THREE.Mesh(
      robeGeo,
      makeRobeMaterial(this.color, { opacity: 0.85, emissive: 0.18, rim: 0.35, additive: false }),
    );
    const outer = new THREE.Mesh(
      robeGeo,
      makeRobeMaterial(this.color, { opacity: 0.4, emissive: 0.5, rim: 1, additive: true }),
    );
    outer.scale.set(1.13, 1.0, 1.13);
    inner.renderOrder = 1;
    outer.renderOrder = 2;
    this.robeMaterials.push(inner.material as THREE.ShaderMaterial, outer.material as THREE.ShaderMaterial);
    this.innerBody.add(inner, outer);

    // — Hood: a partial lathe (open 63° at the front, +Z) so the orb shows.
    const hoodProfile = [
      new THREE.Vector2(0.005, 0.46),
      new THREE.Vector2(0.13, 0.4),
      new THREE.Vector2(0.21, 0.26),
      new THREE.Vector2(0.235, 0.08),
      new THREE.Vector2(0.22, 0),
    ];
    const gap = 1.1; // radians of frontal opening
    const hoodGeo = new THREE.LatheGeometry(hoodProfile, 24, gap / 2, Math.PI * 2 - gap);
    const hoodColor = new THREE.Color(0x14102a).lerp(this.color, 0.22);
    this.hoodMaterial = new THREE.MeshStandardMaterial({
      color: hoodColor,
      emissive: this.color,
      emissiveIntensity: 0.12,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const hood = new THREE.Mesh(hoodGeo, this.hoodMaterial);
    hood.position.y = ROBE_TOP_Y - 0.02;
    hood.rotation.x = 0.1; // slight forward tilt over the face
    this.innerBody.add(hood);

    // — Glowing head orb (+ additive halo). toneMapped:false so it blooms hard.
    const orbColor = this.color.clone().lerp(new THREE.Color(0xffffff), 0.55);
    this.orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 20, 16),
      new THREE.MeshBasicMaterial({ color: orbColor, toneMapped: false }),
    );
    this.orb.position.set(0, HEAD_Y, 0.03);
    const haloMat = new THREE.SpriteMaterial({
      map: getSoftTexture(),
      color: this.color,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.halo = new THREE.Sprite(haloMat);
    this.halo.scale.setScalar(0.5);
    this.halo.position.copy(this.orb.position);
    this.halo.renderOrder = 3;
    this.innerBody.add(this.orb, this.halo);

    // — Soft personal light in the archetype color.
    this.light = new THREE.PointLight(opts.color, 1.2, 6);
    this.light.position.set(0, 1.5, 0);
    this.group.add(this.light);

    // — Trailing wisp particles: a tiny Points system spiralling up the robe.
    this.wispGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(WISP_COUNT * 3);
    for (let i = 0; i < WISP_COUNT; i++) {
      this.wispPhase.push(Math.random() * Math.PI * 2);
      this.wispSpeed.push(0.5 + Math.random() * 0.8);
    }
    this.wispGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const wispMat = new THREE.PointsMaterial({
      map: getSoftTexture(),
      color: this.color.clone().lerp(new THREE.Color(0xffffff), 0.3),
      size: 0.07,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.wisps = new THREE.Points(this.wispGeo, wispMat);
    this.wisps.renderOrder = 3;
    this.wisps.frustumCulled = false; // positions move every frame; skip bounds churn
    this.group.add(this.wisps);

    // — Name tag: rounded dark pill, archetype-colored text.
    const tagCanvas = makePillCanvas(opts.name, {
      font: '600 34px Georgia, "Times New Roman", serif',
      textCss: colorToCss(opts.color),
      bgCss: 'rgba(11, 7, 22, 0.78)',
      borderCss: `${colorToCss(opts.color)}66`,
      padX: 26,
      height: 64,
    });
    this.nameTag = spriteFromCanvas(tagCanvas, 0.3);
    this.nameTag.position.y = NAMETAG_Y;
    this.nameTag.renderOrder = 4;
    // Your own tag would only block your camera; hide it by default.
    this.nameTag.visible = !opts.isSelf;
    this.group.add(this.nameTag);
  }

  /** Switch gait targets; actual params ease over in update(). */
  setAnim(a: AnimState): void {
    this.animState = a;
  }

  setNameTagVisible(v: boolean): void {
    this.nameTag.visible = v;
  }

  /**
   * Emoji burst sprite that pops in, floats up and fades over ~2 s, plus a
   * ~1.4 s parametric body flourish (see updateFlourish). A new emote
   * restarts the flourish from neutral.
   */
  showEmote(emote: EmoteId): void {
    this.flourish = { emote, age: 0 };
    const def = EMOTES.find((e) => e.id === emote);
    const icon = def ? def.icon : '✨';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 112;
    const g = canvas.getContext('2d');
    if (g) {
      // Faint archetype-colored burst behind the emoji.
      const grad = g.createRadialGradient(56, 56, 4, 56, 56, 54);
      grad.addColorStop(0, `${colorToCss(this.color.getHex())}59`);
      grad.addColorStop(1, `${colorToCss(this.color.getHex())}00`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 112, 112);
      g.font = '64px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(icon, 56, 60);
    }
    const sprite = spriteFromCanvas(canvas, 0.5);
    sprite.position.y = 2.3;
    sprite.renderOrder = 5;
    this.group.add(sprite);
    this.transients.push({
      sprite,
      age: 0,
      life: 2,
      rise: 0.85,
      baseY: 2.3,
      baseScaleX: sprite.scale.x,
      baseScaleY: sprite.scale.y,
      pop: true,
      isBubble: false,
    });
  }

  /** Truncated chat-text bubble shown above the head for ~4 s. */
  showChatBubble(text: string): void {
    // Only one bubble at a time; the newest replaces the old immediately.
    if (this.bubble) this.removeTransient(this.bubble);
    const shown = text.length > 64 ? `${text.slice(0, 63)}…` : text;
    const canvas = makePillCanvas(shown, {
      font: '500 30px Georgia, "Times New Roman", serif',
      textCss: 'rgba(240, 236, 255, 0.96)',
      bgCss: 'rgba(16, 12, 32, 0.88)',
      borderCss: 'rgba(255, 210, 122, 0.45)',
      padX: 24,
      height: 60,
    });
    const sprite = spriteFromCanvas(canvas, 0.26);
    sprite.position.y = NAMETAG_Y + 0.38;
    sprite.renderOrder = 5;
    this.group.add(sprite);
    const t: TransientSprite = {
      sprite,
      age: 0,
      life: 4,
      rise: 0.08,
      baseY: sprite.position.y,
      baseScaleX: sprite.scale.x,
      baseScaleY: sprite.scale.y,
      pop: false,
      isBubble: true,
    };
    this.transients.push(t);
    this.bubble = t;
  }

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;

    // — Gait: ease bob amplitude/frequency and lean toward the anim targets.
    const target = GAIT[this.animState];
    const k = 1 - Math.exp(-8 * dt);
    this.bobAmp += (target.bobAmp - this.bobAmp) * k;
    this.bobHz += (target.bobHz - this.bobHz) * k;
    this.lean += (target.lean - this.lean) * k;
    // Advance phase by current frequency so frequency changes never jump.
    this.bobPhase += dt * this.bobHz * Math.PI * 2;
    this.body.position.y = 0.04 + Math.sin(this.bobPhase) * this.bobAmp;
    this.body.rotation.x = this.lean + Math.sin(this.bobPhase * 0.5) * 0.015;
    this.body.rotation.z = Math.sin(this.bobPhase * 0.43) * 0.02;

    // — Emote flourish: pose the inner body container for this frame.
    const flourish = this.updateFlourish(dt);

    // — Idle life: breathing on the inner container (composed with any
    //   flourish scale pulse) + an occasional gentle head-orb flicker.
    const breath = 1 + Math.sin(this.breathPhase + elapsed * this.breathHz * Math.PI * 2) * BREATH_AMP;
    this.innerBody.scale.setScalar(breath * flourish.scale);
    this.flickerIn -= dt;
    if (this.flickerIn <= 0) {
      this.flickerIn = FLICKER_MIN_S + Math.random() * (FLICKER_MAX_S - FLICKER_MIN_S);
      this.flickerAge = 0;
    }
    let flickerGlow = 0;
    if (this.flickerAge < FLICKER_S) {
      this.flickerAge += dt;
      const fu = Math.min(1, this.flickerAge / FLICKER_S);
      flickerGlow = bell(fu) * 0.45 * (0.7 + 0.3 * Math.sin(fu * Math.PI * 6)); // soft, slightly uneven
    }

    // — Head orb pulse + light flicker (subtle life), boosted by any glow.
    const glow = Math.min(1, flourish.glow + flickerGlow);
    const pulse = (1 + Math.sin(elapsed * 2.3 + this.bobPhase * 0.2) * 0.08) * (1 + glow * 0.35);
    this.orb.scale.setScalar(pulse);
    this.halo.scale.setScalar(0.5 * (1 + glow * 0.45));
    (this.halo.material as THREE.SpriteMaterial).opacity =
      Math.min(1, 0.55 + Math.sin(elapsed * 2.3) * 0.15 + glow * 0.3);
    this.light.intensity = 1.2 + Math.sin(elapsed * 3.1) * 0.08 + glow * 0.9;

    // — Wisps: each particle rises in a loose spiral around the robe and loops.
    const pos = this.wispGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < WISP_COUNT; i++) {
      const speed = this.wispSpeed[i];
      const phase = this.wispPhase[i];
      const yT = (elapsed * 0.16 * speed + phase / (Math.PI * 2)) % 1;
      const y = 0.12 + yT * 1.7;
      const r = (0.3 + 0.14 * Math.sin(elapsed * speed + i)) * (1 - yT * 0.35);
      const ang = phase + elapsed * 0.7 * speed + yT * 2.5;
      pos.setXYZ(i, Math.cos(ang) * r, y, Math.sin(ang) * r);
    }
    pos.needsUpdate = true;

    // — Transient sprites (emotes / chat bubbles): rise, pop, fade, expire.
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.age += dt;
      if (t.age >= t.life) {
        this.removeTransient(t);
        continue;
      }
      const u = t.age / t.life;
      const fadeIn = Math.min(1, t.age / 0.18);
      const fadeOut = Math.min(1, (t.life - t.age) / (t.isBubble ? 0.5 : 0.7));
      t.sprite.material.opacity = Math.min(fadeIn, fadeOut);
      t.sprite.position.y = t.baseY + (1 - (1 - u) * (1 - u)) * t.rise; // ease-out rise
      if (t.pop) {
        const s = 1 - Math.pow(1 - Math.min(1, t.age / 0.25), 3); // cubic pop-in
        t.sprite.scale.set(t.baseScaleX * s, t.baseScaleY * s, 1);
      }
    }
  }

  /**
   * Advance the active emote flourish and pose the inner body container for
   * this frame. Every shape is parametric in u = age / FLOURISH_S with
   * envelopes that are exactly 0 at u = 0 and u = 1 (spins end at exactly
   * 2π), so the body returns precisely to neutral; on completion the
   * transform is hard-reset to zero. Returns this frame's extra inner-body
   * scale factor and head-orb glow boost (0..1).
   */
  private updateFlourish(dt: number): { scale: number; glow: number } {
    const pos = this.innerBody.position;
    const rot = this.innerBody.rotation;
    if (!this.flourish) return { scale: 1, glow: 0 };
    this.flourish.age += dt;
    const u = this.flourish.age / FLOURISH_S;
    if (u >= 1) {
      this.flourish = null;
      pos.set(0, 0, 0);
      rot.set(0, 0, 0);
      return { scale: 1, glow: 0 };
    }
    pos.set(0, 0, 0);
    rot.set(0, 0, 0);
    let scale = 1;
    let glow = 0;
    const env = bell(u);
    switch (this.flourish.emote) {
      case 'wave': // friendly side-lean + bob
        rot.z = env * 0.24;
        pos.y = env * 0.06 * Math.sin(u * Math.PI * 4);
        break;
      case 'dance': // one full eased spin with two small hops
        rot.y = Math.PI * 2 * smooth01(u);
        pos.y = 0.07 * Math.abs(Math.sin(u * Math.PI * 2));
        break;
      case 'point': // lean forward and hold
        rot.x = 0.32 * plateau(u);
        break;
      case 'laugh': // quick little shakes
        rot.z = env * 0.085 * Math.sin(u * Math.PI * 14);
        pos.y = env * 0.025 * Math.abs(Math.sin(u * Math.PI * 7));
        break;
      case 'heart':
      case 'sparkle': // scale pulse + brighter head-orb glow
        scale = 1 + env * 0.09;
        glow = env;
        break;
      case 'ponder': // slow pensive sway, tipped back as if peering up
        rot.z = env * 0.13 * Math.sin(u * Math.PI * 2);
        rot.x = env * -0.07;
        break;
      case 'cheer': // two hops, with a single spin on the second
        pos.y = 0.13 * Math.abs(Math.sin(u * Math.PI * 2));
        rot.y = Math.PI * 2 * smooth01((u - 0.45) / 0.55);
        break;
    }
    return { scale, glow };
  }

  private removeTransient(t: TransientSprite): void {
    const idx = this.transients.indexOf(t);
    if (idx >= 0) this.transients.splice(idx, 1);
    this.group.remove(t.sprite);
    t.sprite.material.map?.dispose();
    t.sprite.material.dispose();
    if (this.bubble === t) this.bubble = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of [...this.transients]) this.removeTransient(t);
    this.group.removeFromParent();
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of this.robeMaterials) m.dispose();
    this.hoodMaterial.dispose();
    (this.orb.material as THREE.Material).dispose();
    (this.halo.material as THREE.SpriteMaterial).dispose(); // map is the shared soft texture
    (this.wisps.material as THREE.Material).dispose();
    this.nameTag.material.map?.dispose();
    this.nameTag.material.dispose();
  }
}
