/**
 * src/world/locations/Caelis.ts
 * Caelis, the Crystal City — an Act 2 Echo location. A once-radiant city
 * grown from violet/magenta crystal: a great tiled plaza ringed by three
 * raised terraces, crystal spires at the bounds, slow-orbiting shards
 * overhead and one district blackened by the Hush. The dark Hush Shard
 * beats faintly at the plaza heart.
 *
 * Terrain contract: getGroundHeight() is the analytic source of truth; the
 * visual terrain mesh is displaced from the very same function so avatars
 * stand exactly on what they see.
 */

import * as THREE from 'three';
import type { LocationId, MusicMood } from '../../../shared/constants';
import type { EnvironmentSettings, GameContext, Vec3 } from '../../types';
import { LocationBase } from '../LocationBase';
import {
  seededRandom,
  standardMat,
  createCrystalCluster,
  createRuinColumn,
  createRuinArch,
  createLantern,
  createLightShaft,
  createBridge,
  createRock,
} from '../builders';
import { createParticles } from '../Particles';
import { createSky } from '../Sky';
import {
  makePortal,
  makeResonanceCrystal,
  makeEchoNpc,
  makeLoreObject,
  makeShrine,
} from '../Interactables';
import { tryLoadModel } from '../../core/AssetLoader';

// ── Terrain definition (module scope so spawn/interactables can sample it) ──

/** The three raised terraces ringing the plaza. Angles avoid the spawn gate at +Z (π/2). */
const TERRACES = [
  { angle: Math.PI / 6, height: 3.0 }, // east terrace (resonance 1, the silent chime nearby)
  { angle: (5 * Math.PI) / 6, height: 2.6 }, // west terrace — the corrupted district
  { angle: (3 * Math.PI) / 2, height: 3.4 }, // far terrace — the ruined throne hall
].map((t) => ({
  ...t,
  cx: Math.cos(t.angle) * 34,
  cz: Math.sin(t.angle) * 34,
}));

const TERRACE_R_TOP = 7.5; // flat top radius
const TERRACE_R_FOOT = 14; // ramp reaches ground here

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0..1 smoothstep of an already-normalized parameter. */
function smooth01(t: number): number {
  const s = clamp01(t);
  return s * s * (3 - 2 * s);
}

/** Smallest signed difference between two angles. */
function angleDelta(a: number, b: number): number {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** Analytic ground height: flat plaza with smooth terrace mounds. */
function caelisGround(x: number, z: number): number {
  let y = 0;
  for (const t of TERRACES) {
    const d = Math.hypot(x - t.cx, z - t.cz);
    if (d >= TERRACE_R_FOOT) continue;
    const s = d <= TERRACE_R_TOP ? 1 : 1 - (d - TERRACE_R_TOP) / (TERRACE_R_FOOT - TERRACE_R_TOP);
    y = Math.max(y, t.height * smooth01(s));
  }
  return y;
}

/**
 * How corrupted a point is (0..1): an angular wedge around the west terrace,
 * growing with distance from the plaza heart. Drives terrain tinting and the
 * placement of blackened crystal.
 */
const CORRUPT_ANGLE = (5 * Math.PI) / 6;
function corruptionFactor(x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d < 10) return 0;
  const wedge = Math.max(0, 1 - Math.abs(angleDelta(Math.atan2(z, x), CORRUPT_ANGLE)) / 0.9);
  return wedge * Math.min(1, (d - 10) / 18);
}

/** Double-thump heartbeat curve, period 1 — used by the Hush Shard. */
function heartbeat(t: number): number {
  const p = t - Math.floor(t);
  const thump = (c: number, w: number) => Math.exp(-((p - c) * (p - c)) / (w * w));
  return Math.min(1, thump(0.07, 0.05) + 0.55 * thump(0.26, 0.05));
}

// ── Location ─────────────────────────────────────────────────────────────────

export class Caelis extends LocationBase {
  readonly id: LocationId = 'caelis';
  override readonly boundsRadius: number = 60;
  override readonly defaultMood: MusicMood = 'exploration';

  /** Spawn gate at the south rim of the plaza, facing the Hush Shard (-Z). */
  readonly spawn = { position: [0, 0, 44] as Vec3, yaw: 0 };

  readonly environment: EnvironmentSettings = {
    background: 0x150a2a,
    fogColor: 0x2c1547,
    fogDensity: 0.0085,
    ambientColor: 0x5e4a96,
    ambientIntensity: 0.55,
    sunColor: 0xffd9b0,
    sunIntensity: 1.5,
    sunPosition: [0.35, 0.75, 0.3],
    fillColor: 0x6f5bd0,
    fillIntensity: 0.5,
    bloomStrength: 0.95,
    bloomRadius: 0.75,
    bloomThreshold: 0.22,
    exposure: 1.12,
  };

  override getGroundHeight(x: number, z: number): number {
    return caelisGround(x, z);
  }

  protected async buildScene(
    _ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const rand = seededRandom(0xcae715);
    onProgress(0.05);

    this.buildTerrain();
    onProgress(0.2);

    this.buildHushShard();
    this.buildPlazaDressing(rand);
    onProgress(0.35);

    // Hero set-piece: the great crown-spire behind the throne terrace.
    // Asset swap point — falls back to a tall procedural crystal cluster.
    const hero = await tryLoadModel('caelis_spire');
    if (hero) {
      hero.position.set(12, 0, -48);
      this.group.add(hero);
    } else {
      const spire = createCrystalCluster({
        count: 9,
        color: 0xc06bff,
        emissiveIntensity: 0.85,
        minHeight: 16,
        maxHeight: 32,
        spread: 7,
        seed: 77,
      });
      spire.position.set(12, 0, -48);
      this.group.add(spire);
    }
    onProgress(0.5);

    this.buildSpireRing(rand);
    this.buildTerraces(rand);
    this.buildBridges();
    this.buildFloatingShards(rand);
    onProgress(0.7);

    this.registerInteractables();
    onProgress(0.85);

    this.buildAtmosphere();
    onProgress(0.95);
  }

  // ── Terrain ────────────────────────────────────────────────────────────────

  private buildTerrain(): void {
    // Displace a dense plane from the same analytic function avatars walk on.
    const geo = new THREE.PlaneGeometry(124, 124, 150, 150);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const rand = seededRandom(901);

    const cPlaza = new THREE.Color(0xd9d0f4); // pale crystal tile
    const cOuter = new THREE.Color(0x9583cd); // deeper violet field
    const cCrest = new THREE.Color(0xeee4ff); // terrace tops catch more light
    const cHush = new THREE.Color(0x201126); // blackened district
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = caelisGround(x, z);
      pos.setY(i, y);

      const d = Math.hypot(x, z);
      tmp.copy(cPlaza).lerp(cOuter, smooth01((d - 24) / 30));
      tmp.lerp(cCrest, clamp01(y / 3.4) * 0.8);
      tmp.lerp(cHush, corruptionFactor(x, z) * 0.85);
      // Tiny per-vertex jitter sells the shattered-tile look with flat shading.
      const j = (rand() - 0.5) * 0.07;
      colors[i * 3] = clamp01(tmp.r + j);
      colors[i * 3 + 1] = clamp01(tmp.g + j);
      colors[i * 3 + 2] = clamp01(tmp.b + j);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const terrain = new THREE.Mesh(
      geo,
      standardMat({ vertexColors: true, roughness: 0.55, metalness: 0.12, flatShading: true }),
    );
    terrain.name = 'caelis-terrain';
    this.group.add(terrain);

    // Luminous inlay seams on the plaza floor — gold and violet rings.
    const ringSpecs: Array<{ r: number; color: number; opacity: number }> = [
      { r: 12, color: 0xffd27a, opacity: 0.5 },
      { r: 22, color: 0x8d7bff, opacity: 0.35 },
    ];
    for (const spec of ringSpecs) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r, 0.09, 8, 96),
        new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: spec.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.07;
      this.group.add(ring);
    }
  }

  // ── The Hush Shard ─────────────────────────────────────────────────────────

  private buildHushShard(): void {
    const heart = new THREE.Group();
    heart.name = 'hush-shard';

    const shardGeo = new THREE.OctahedronGeometry(1, 0);
    const shardMat = standardMat({
      color: 0x0c0712,
      emissive: 0x550f1c,
      emissiveIntensity: 0.4,
      roughness: 0.25,
      metalness: 0.7,
      flatShading: true,
    });
    const shard = new THREE.Mesh(shardGeo, shardMat);
    const baseScale = new THREE.Vector3(2.4, 5.6, 2.4);
    shard.scale.copy(baseScale);
    shard.position.y = 5.0;
    shard.rotation.y = 0.5;
    heart.add(shard);

    // Smoldering crimson veins along the facet edges.
    const veins = new THREE.LineSegments(
      new THREE.EdgesGeometry(shardGeo),
      new THREE.LineBasicMaterial({
        color: 0xff3b4e,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    veins.position.copy(shard.position);
    veins.rotation.copy(shard.rotation);
    heart.add(veins);

    // Dim ember core glowing through the black crystal.
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff4030,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), coreMat);
    core.scale.set(1.3, 3.4, 1.3);
    core.position.y = 5.0;
    core.rotation.y = 0.5;
    heart.add(core);

    // Gold containment ring laid into the tiles around it.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.6, 0.1, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    heart.add(ring);

    // The shard faintly *beats* — a slow double-thump of glow and swell.
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        const beat = heartbeat(elapsed * 0.45);
        (shard.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + beat * 0.9;
        coreMat.opacity = 0.16 + beat * 0.3;
        const s = 1 + beat * 0.03;
        shard.scale.set(baseScale.x * s, baseScale.y * s, baseScale.z * s);
        veins.scale.copy(shard.scale).multiplyScalar(1.012);
      },
    });

    this.group.add(heart);
  }

  // ── Plaza dressing: fountain, lanterns, rubble ─────────────────────────────

  private buildPlazaDressing(rand: () => number): void {
    // The dry singing fountain — Aurel keeps vigil beside it.
    const fountain = new THREE.Group();
    fountain.name = 'singing-fountain';
    const marble = standardMat({ color: 0xcfc6e8, roughness: 0.5, metalness: 0.1, flatShading: true });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.8, 24), marble);
    basin.position.y = 0.4;
    fountain.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.18, 8, 32), marble);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.85;
    fountain.add(rim);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.4, 10), marble);
    pedestal.position.y = 1.5;
    fountain.add(pedestal);
    // The crystal bloom that used to sing — now dry and quiet, barely lit.
    const bloom = createCrystalCluster({
      count: 4,
      color: 0x8d7bff,
      emissiveIntensity: 0.25,
      minHeight: 0.8,
      maxHeight: 1.6,
      spread: 0.5,
      seed: 5,
    });
    bloom.position.y = 2.1;
    fountain.add(bloom);
    fountain.position.set(16, 0, 4);
    this.group.add(fountain);

    // Lanterns around the plaza ring and flanking the spawn gate.
    const lanternSpots: Array<[number, number]> = [
      [14.1, 14.1],
      [-14.1, 14.1],
      [-14.1, -14.1],
      [14.1, -14.1],
      [-3, 49],
      [3, 49],
    ];
    for (const [x, z] of lanternSpots) {
      const lantern = createLantern({ color: 0xffd27a, height: 3.2 });
      lantern.position.set(x, caelisGround(x, z), z);
      this.group.add(lantern);
    }

    // Crystal rubble where the tiles shattered.
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const r = 25 + rand() * 18;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const rock = createRock({ size: 0.5 + rand() * 1.1, color: 0x8b7cc0, seed: 60 + i });
      rock.position.set(x, caelisGround(x, z), z);
      this.group.add(rock);
    }
  }

  // ── Spire ring at the city bounds ──────────────────────────────────────────

  private buildSpireRing(rand: () => number): void {
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.13;
      // Leave the spawn gate (+Z) open so the skyline frames the arrival shot.
      if (Math.abs(angleDelta(a, Math.PI / 2)) < 0.42) continue;
      const r = 47 + rand() * 8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const corrupted = corruptionFactor(x, z) > 0.45;
      const cluster = createCrystalCluster({
        count: 5 + Math.floor(rand() * 4),
        color: corrupted ? 0xff4a3d : rand() < 0.5 ? 0xb96bff : 0xff6ec7,
        emissiveIntensity: corrupted ? 0.5 : 0.7,
        minHeight: 7,
        maxHeight: 18,
        spread: 5,
        corrupted,
        seed: 300 + i,
      });
      cluster.position.set(x, caelisGround(x, z), z);
      this.group.add(cluster);
    }

    // Smaller crystal stands between plaza and bounds.
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      if (Math.abs(angleDelta(a, Math.PI / 2)) < 0.35) continue;
      const r = 28 + rand() * 12;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const corrupted = corruptionFactor(x, z) > 0.5;
      const cluster = createCrystalCluster({
        count: 3 + Math.floor(rand() * 3),
        color: corrupted ? 0xff4a3d : 0x9d6bff,
        emissiveIntensity: 0.6,
        minHeight: 2,
        maxHeight: 5.5,
        spread: 2.5,
        corrupted,
        seed: 400 + i,
      });
      cluster.position.set(x, caelisGround(x, z), z);
      this.group.add(cluster);
    }
  }

  // ── Terraces: throne hall, décor ───────────────────────────────────────────

  private buildTerraces(rand: () => number): void {
    const north = TERRACES[2];

    // Throne hall ruin on the north terrace. The entrance arch sits on the
    // inner edge of the terrace top, facing the plaza.
    const hallY = north.height;
    const arch = createRuinArch({ width: 5, height: 6.5, color: 0xbfb0e8, seed: 21 });
    arch.position.set(0, caelisGround(0, -27), -27);
    this.group.add(arch);

    const columnSpots: Array<[number, number, boolean]> = [
      [-4.5, -31.5, false],
      [4.5, -31.5, true],
      [-4.5, -36.5, true],
      [4.5, -36.5, false],
    ];
    for (const [x, z, broken] of columnSpots) {
      const col = createRuinColumn({ height: 6, radius: 0.55, color: 0xbfb0e8, broken, seed: 30 + Math.floor(x + z) });
      col.position.set(x, caelisGround(x, z), z);
      this.group.add(col);
    }

    // The shattered throne itself — pale crystal, faintly lit from within.
    const throne = new THREE.Group();
    const throneMat = standardMat({
      color: 0xd6c8ff,
      emissive: 0x5b48b8,
      emissiveIntensity: 0.3,
      roughness: 0.35,
      metalness: 0.2,
      flatShading: true,
    });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.3), throneMat);
    seat.position.y = 0.55;
    throne.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.4, 0.4), throneMat);
    back.position.set(0, 2.2, -0.6);
    back.rotation.x = -0.12; // cracked backward
    throne.add(back);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 1.2), throneMat);
      arm.position.set(side * 1.0, 1.1, 0.1);
      throne.add(arm);
    }
    throne.position.set(0, hallY, -37.2);
    throne.rotation.y = Math.PI; // faces the plaza
    this.group.add(throne);

    // Each terrace gets its own small crystal stand and lantern.
    for (const [idx, t] of TERRACES.entries()) {
      const deco = createCrystalCluster({
        count: 3,
        color: idx === 1 ? 0xff4a3d : 0xc89bff,
        emissiveIntensity: 0.55,
        minHeight: 1.2,
        maxHeight: 2.6,
        spread: 1.4,
        corrupted: idx === 1, // the west terrace lies inside the Hush district
        seed: 500 + idx,
      });
      const dx = t.cx * 0.88;
      const dz = t.cz * 0.88;
      deco.position.set(dx, caelisGround(dx, dz), dz);
      this.group.add(deco);
    }

    // The cold crystal forge in the corrupted outskirts (Embersmith secret).
    this.buildColdForge();

    // The silent crystal chime on the east terrace's skirt (Songweaver secret).
    this.buildSilentChime(rand);
  }

  /** A smith's hearth gone dark — only the Embersmith can feel its want. */
  private buildColdForge(): void {
    const forge = new THREE.Group();
    forge.name = 'cold-forge';
    const iron = standardMat({ color: 0x1a1420, roughness: 0.45, metalness: 0.8, flatShading: true });
    const stone = standardMat({ color: 0x241a2e, roughness: 0.8, metalness: 0.1, flatShading: true });

    const hearth = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.7, 12), stone);
    hearth.position.y = 0.35;
    forge.add(hearth);
    const coals = createCrystalCluster({
      count: 5,
      color: 0xff4a3d,
      emissiveIntensity: 0.18, // barely smoldering — the forge is cold
      minHeight: 0.25,
      maxHeight: 0.5,
      spread: 0.7,
      corrupted: true,
      seed: 41,
    });
    coals.position.y = 0.7;
    forge.add(coals);
    const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), stone);
    anvilBase.position.set(2.0, 0.25, 0.4);
    forge.add(anvilBase);
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 0.55), iron);
    anvil.position.set(2.0, 0.72, 0.4);
    forge.add(anvil);

    forge.position.set(-43, caelisGround(-43, 25), 25);
    this.group.add(forge);

    // A faint drift of dying embers above the hearth.
    const embers = createParticles({
      kind: 'embers',
      count: 36,
      areaRadius: 1.6,
      height: 3,
      yBase: 0.8,
      color: 0xff7a45,
      size: 0.3,
      opacity: 0.5,
    });
    embers.object.position.set(-43, caelisGround(-43, 25), 25);
    embers.setIntensity(0.4);
    this.group.add(embers.object);
    this.addDynamic(embers);
  }

  /** Hanging crystal bars that make no sound — until a Songweaver listens. */
  private buildSilentChime(rand: () => number): void {
    const chime = new THREE.Group();
    chime.name = 'silent-chime';
    const frameMat = standardMat({ color: 0xbfb0e8, roughness: 0.4, metalness: 0.2, flatShading: true });
    const barMat = standardMat({
      color: 0xc89bff,
      emissive: 0xc89bff,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.3,
      flatShading: true,
    });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.6, 6), frameMat);
      post.position.set(side * 0.9, 1.3, 0);
      chime.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), frameMat);
    crossbar.position.y = 2.55;
    chime.add(crossbar);
    const bars: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const len = 1.0 + i * 0.25;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, len, 0.1), barMat);
      bar.position.set(-0.55 + i * 0.55, 2.45 - len / 2 - 0.1, 0);
      chime.add(bar);
      bars.push(bar);
    }
    // The bars sway almost imperceptibly, as if remembering wind.
    const phases = bars.map(() => rand() * Math.PI * 2);
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        for (let i = 0; i < bars.length; i++) {
          bars[i].rotation.z = Math.sin(elapsed * 0.7 + phases[i]) * 0.05;
        }
      },
    });
    chime.position.set(40, caelisGround(40, 24.6), 24.6);
    this.group.add(chime);
  }

  // ── Bridges & floating shards ──────────────────────────────────────────────

  private buildBridges(): void {
    // Slender high crystal arcs spanning terrace to terrace — pure spectacle,
    // far above walkable ground (deck height ~10m + arc), so terrain stays exact.
    const deckY = 10.5;
    for (let i = 0; i < TERRACES.length; i++) {
      const a = TERRACES[i];
      const b = TERRACES[(i + 1) % TERRACES.length];
      const bridge = createBridge({
        from: new THREE.Vector3(a.cx, deckY, a.cz),
        to: new THREE.Vector3(b.cx, deckY, b.cz),
        width: 1.5,
        color: 0xcdb8ff,
        arc: 5,
      });
      this.group.add(bridge);
    }
  }

  private buildFloatingShards(rand: () => number): void {
    // Two counter-rotating swarms of crystal shards drifting over the city.
    const geo = new THREE.OctahedronGeometry(0.7, 0);
    const mat = standardMat({
      color: 0xbfa9ff,
      emissive: 0x7050d8,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.4,
      flatShading: true,
    });
    const dummy = new THREE.Object3D();
    const wraps: THREE.Group[] = [];
    const counts = [34, 26];
    for (let g = 0; g < 2; g++) {
      const im = new THREE.InstancedMesh(geo, mat, counts[g]);
      for (let i = 0; i < counts[g]; i++) {
        const a = rand() * Math.PI * 2;
        const r = 12 + rand() * 36;
        dummy.position.set(Math.cos(a) * r, 16 + rand() * 20, Math.sin(a) * r);
        dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
        const s = 0.4 + rand() * 1.3;
        dummy.scale.set(s, s * (1 + rand()), s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      const wrap = new THREE.Group();
      wrap.add(im);
      this.group.add(wrap);
      wraps.push(wrap);
    }
    // Whole-group rotation: one matrix each per frame, zero per-instance cost.
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        wraps[0].rotation.y = elapsed * 0.02;
        wraps[1].rotation.y = elapsed * -0.013;
      },
    });
  }

  // ── Canonical interactables ────────────────────────────────────────────────

  private registerInteractables(): void {
    const [east, west, north] = TERRACES;
    const g = caelisGround;

    // Aurel, the Crystalwright — a violet Echo keeping vigil by the dry fountain.
    this.addInteractable(
      makeEchoNpc({
        id: 'cae_echo_aurel',
        name: 'Aurel, the Crystalwright',
        color: 0x8d7bff,
        prompt: 'Speak with Aurel, the Crystalwright',
        position: [13.2, g(13.2, 7.6), 7.6],
        radius: 4,
      }),
    );

    // The Hush Shard — the moral heart of Caelis.
    this.addInteractable(
      makeShrine({
        id: 'cae_hush_shard',
        prompt: 'Lay your hands on the Hush Shard',
        position: [0, 0, 5.4],
        radius: 5,
        color: 0xff3b4e,
      }),
    );

    // Three resonance crystals, one per terrace — the co-op puzzle.
    this.addInteractable(
      makeResonanceCrystal({
        id: 'cae_resonance_1',
        prompt: 'Attune the eastern resonance crystal',
        position: [east.cx + 1.5, east.height, east.cz + 1.5],
        radius: 3.5,
        color: 0xff6ec7,
      }),
    );
    this.addInteractable(
      makeResonanceCrystal({
        id: 'cae_resonance_2',
        prompt: 'Attune the silenced resonance crystal',
        position: [west.cx + 1.5, west.height, west.cz - 1.5],
        radius: 3.5,
        color: 0xff4a3d,
        corrupted: true, // it stands inside the Hush district, waiting to be cleansed
      }),
    );
    this.addInteractable(
      makeResonanceCrystal({
        id: 'cae_resonance_3',
        prompt: 'Attune the northern resonance crystal',
        position: [north.cx - 4.2, north.height, north.cz + 2.6],
        radius: 3.5,
        color: 0xb96bff,
      }),
    );

    // Lore.
    this.addInteractable(
      makeLoreObject({
        id: 'cae_lore_throne',
        loreKind: 'generic',
        prompt: 'Stand before the shattered throne',
        position: [0, north.height, -35.4],
        radius: 4,
        color: 0xd6c8ff,
      }),
    );
    this.addInteractable(
      makeLoreObject({
        id: 'cae_lore_fountain',
        loreKind: 'fountain',
        prompt: 'Listen at the dry singing fountain',
        position: [16, 0, 7.2],
        radius: 4,
        color: 0x8d7bff,
      }),
    );

    // Portal home.
    this.addInteractable(
      makePortal({
        id: 'cae_portal_sky',
        to: 'skyharbor',
        label: 'The Skyharbor',
        prompt: 'Step through to the Skyharbor',
        position: [0, g(0, 50), 50],
        radius: 4,
        color: 0xffd27a,
      }),
    );

    // Archetype secrets.
    this.addInteractable(
      makeShrine({
        id: 'cae_hidden_songweaver',
        prompt: 'Wake the silent crystal chime',
        position: [40, g(40, 26.4), 26.4],
        radius: 3.5,
        requiresArchetype: 'songweaver',
        color: 0xc89bff,
      }),
    );
    this.addInteractable(
      makeShrine({
        id: 'cae_hidden_embersmith',
        prompt: 'Kindle the cold crystal forge',
        position: [-41, g(-41, 23.5), 23.5],
        radius: 3.5,
        requiresArchetype: 'embersmith',
        color: 0xff9d5c,
      }),
    );
  }

  // ── Sky, light shafts, particles ───────────────────────────────────────────

  private buildAtmosphere(): void {
    const sky = createSky({
      topColor: 0x190b33,
      horizonColor: 0x5a2a7a,
      bottomColor: 0x0b0716,
      stars: true,
      aurora: true,
      auroraColor: 0xff6ec7,
      sunGlow: { position: [80, 90, 60], color: 0xffd27a, size: 26 },
    });
    this.group.add(sky.group);
    this.addDynamic(sky);

    // Dusty god-rays slanting across the plaza.
    const shaftSpots: Array<[number, number, number]> = [
      [8, -10, 30],
      [-14, -2, 34],
      [20, 14, 26],
      [-6, 22, 28],
    ];
    for (const [x, z, h] of shaftSpots) {
      const shaft = createLightShaft({
        color: 0xffd9a8,
        height: h,
        radiusTop: 1.2,
        radiusBottom: 4.5,
        opacity: 0.1,
      });
      // The builder's beam is base-origin: it spans y 0..height from where it sits.
      shaft.position.set(x, 0, z);
      shaft.rotation.z = 0.1;
      this.group.add(shaft);
    }

    // City-wide drifting crystal dust.
    const motes = createParticles({
      kind: 'motes',
      count: 240,
      areaRadius: 54,
      height: 26,
      yBase: 0.5,
      color: 0xcabaff,
      size: 0.5,
      opacity: 0.55,
    });
    this.group.add(motes.object);
    this.addDynamic(motes);

    // Sparkfall raining off the corrupted district.
    const sparks = createParticles({
      kind: 'sparkfall',
      count: 160,
      areaRadius: 17,
      height: 22,
      yBase: 0,
      color: 0xff5a3c,
      size: 0.45,
      opacity: 0.8,
    });
    sparks.object.position.set(-33, 0, 19);
    this.group.add(sparks.object);
    this.addDynamic(sparks);

    // Violet fireflies haunting the dry fountain.
    const fireflies = createParticles({
      kind: 'fireflies',
      count: 50,
      areaRadius: 9,
      height: 4,
      yBase: 0.4,
      color: 0xc89bff,
      size: 0.4,
      opacity: 0.8,
    });
    fireflies.object.position.set(16, 0, 4);
    this.group.add(fireflies.object);
    this.addDynamic(fireflies);
  }
}
