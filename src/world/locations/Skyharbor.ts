/**
 * src/world/locations/Skyharbor.ts
 * The Skyharbor — hub location. A cluster of floating islands adrift above an
 * endless sunset cloud-sea. Warm gold + teal palette. The main island carries
 * the Lantern Tree, the Loom of Echoes, Serai the Lantern-Bearer, the three
 * awakening glyphs and the lore objects; five satellite islets each bear one
 * portal gate and are linked to the main island by arcing light-bridges.
 */

import * as THREE from 'three';
import { LOCATION_NAMES } from '../../../shared/constants';
import type { LocationId, MusicMood } from '../../../shared/constants';
import { tryLoadModel } from '../../core/AssetLoader';
import type { EnvironmentSettings, GameContext, Vec3 } from '../../types';
import { LocationBase } from '../LocationBase';
import {
  createBridge,
  createCrystalCluster,
  createFloatingIsland,
  createLantern,
  createLightShaft,
  createRock,
  createRuinArch,
  createRuinColumn,
  createStylizedTree,
  createWaterPlane,
  seededRandom,
} from '../builders';
import {
  makeEchoNpc,
  makeGlyphPlate,
  makeLoreObject,
  makePortal,
  makeShrine,
} from '../Interactables';
import { createParticles } from '../Particles';
import { createSky } from '../Sky';

/** One walkable island: world-space center + analytic surface height. */
interface WalkIsland {
  x: number;
  z: number;
  y: number;
  radius: number;
  /** Surface height in island-local coords (relative to the island origin). */
  getHeight: (lx: number, lz: number) => number;
}

/** One walkable light-bridge between two islands. */
interface WalkBridge {
  from: THREE.Vector3;
  to: THREE.Vector3;
  halfWidth: number;
  arc: number;
}

const MAIN_RADIUS = 28;
const ISLET_RADIUS = 7;
const ISLET_DIST = 41;

/** The five portal islets, evenly fanned around the main island. */
const PORTAL_ISLETS: Array<{
  id: string;
  to: LocationId;
  label: string;
  prompt: string;
  angle: number;
  y: number;
  color: number;
}> = [
  {
    id: 'sky_portal_heart',
    to: 'heart-of-the-veil',
    label: LOCATION_NAMES['heart-of-the-veil'],
    prompt: 'Step through the gate to the Heart of the Veil',
    angle: -Math.PI / 2, // due north — the Heart waits straight ahead
    y: 0.8,
    color: 0xff6ec7,
  },
  {
    id: 'sky_portal_caelis',
    to: 'caelis',
    label: LOCATION_NAMES['caelis'],
    prompt: 'Step through the gate to Caelis, the Crystal City',
    angle: -Math.PI / 2 + (2 * Math.PI) / 5,
    y: -0.7,
    color: 0x8d7bff,
  },
  {
    id: 'sky_portal_archive',
    to: 'sunken-archive',
    label: LOCATION_NAMES['sunken-archive'],
    prompt: 'Step through the gate to the Sunken Archive',
    angle: -Math.PI / 2 + (4 * Math.PI) / 5,
    y: 0.5,
    color: 0x4be3c3,
  },
  {
    id: 'sky_portal_wood',
    to: 'wandering-wood',
    label: LOCATION_NAMES['wandering-wood'],
    prompt: 'Step through the gate to the Wandering Wood',
    angle: -Math.PI / 2 + (6 * Math.PI) / 5,
    y: -1.0,
    color: 0x9fe060,
  },
  {
    id: 'sky_portal_mirrormere',
    to: 'mirrormere',
    label: LOCATION_NAMES['mirrormere'],
    prompt: 'Step through the gate to the Mirrormere',
    angle: -Math.PI / 2 + (8 * Math.PI) / 5,
    y: 0.6,
    color: 0x7ab8ff,
  },
];

export class Skyharbor extends LocationBase {
  readonly id = 'skyharbor' as const;
  override readonly boundsRadius: number = 55;
  override readonly defaultMood: MusicMood = 'ambient';

  // Sunset over the cloud-sea: peach fog, low warm key light, cool teal fill.
  readonly environment: EnvironmentSettings = {
    background: 0x241543,
    fogColor: 0xf0a878,
    fogDensity: 0.0028,
    ambientColor: 0x9a7fc8,
    ambientIntensity: 0.55,
    sunColor: 0xffd9a0,
    sunIntensity: 1.5,
    sunPosition: [-0.45, 0.22, -0.85],
    fillColor: 0x4be3c3,
    fillIntensity: 0.35,
    bloomStrength: 0.85,
    bloomRadius: 0.7,
    bloomThreshold: 0.72,
    exposure: 1.15,
  };

  // South rim of the main island, facing in toward the Lantern Tree.
  // y is corrected to the exact terrain height once the island is built.
  readonly spawn = { position: [0, 1, 18] as Vec3, yaw: Math.PI };

  /** Walkable surfaces for getGroundHeight: main island + the five islets. */
  private walkIslands: WalkIsland[] = [];
  private walkBridges: WalkBridge[] = [];

  protected async buildScene(
    ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const rand = seededRandom(2607); // fixed seed: identical layout for every player

    // ── Sky: peach horizon climbing to deep indigo, low warm sun ────────────
    const sky = createSky({
      topColor: 0x1d1140,
      horizonColor: 0xffa66b,
      bottomColor: 0x6e3a78,
      sunGlow: { position: [-110, 22, -190], color: 0xffc587 },
    });
    this.group.add(sky.group);
    this.addDynamic(sky);
    onProgress(0.08);

    // ── Islands ──────────────────────────────────────────────────────────────
    const main = createFloatingIsland({
      radius: MAIN_RADIUS,
      height: 16,
      topColor: 0x5fae6e,
      cliffColor: 0x6b4a7e,
      bottomColor: 0x2c1a4a,
      noiseAmp: 0.7,
      seed: 11,
    });
    this.group.add(main.group);
    this.walkIslands.push({ x: 0, z: 0, y: 0, radius: MAIN_RADIUS, getHeight: main.getHeight });

    for (let i = 0; i < PORTAL_ISLETS.length; i++) {
      const def = PORTAL_ISLETS[i];
      const cx = Math.cos(def.angle) * ISLET_DIST;
      const cz = Math.sin(def.angle) * ISLET_DIST;
      const islet = createFloatingIsland({
        radius: ISLET_RADIUS,
        height: 7,
        topColor: 0x5fae6e,
        cliffColor: 0x6b4a7e,
        bottomColor: 0x2c1a4a,
        noiseAmp: 0.4,
        seed: 31 + i,
      });
      islet.group.position.set(cx, def.y, cz);
      this.group.add(islet.group);
      this.walkIslands.push({
        x: cx,
        z: cz,
        y: def.y,
        radius: ISLET_RADIUS,
        getHeight: islet.getHeight,
      });
    }

    // Spawn sits on real terrain now that the height field exists.
    this.spawn.position[1] = this.getGroundHeight(this.spawn.position[0], this.spawn.position[2]);
    onProgress(0.22);

    // ── Light-bridges: main island rim → each islet rim ─────────────────────
    // NOTE: getGroundHeight assumes the bridge deck follows
    //   lerp(from.y, to.y, t) + arc * sin(PI * t)
    // which is the natural implementation of builders.createBridge's `arc`.
    const BRIDGE_ARC = 1.4;
    const BRIDGE_WIDTH = 2.4;
    for (const islet of this.walkIslands.slice(1)) {
      const dir = new THREE.Vector3(islet.x, 0, islet.z).normalize();
      const from = dir.clone().multiplyScalar(MAIN_RADIUS - 1.5);
      from.y = this.getGroundHeight(from.x, from.z);
      const to = new THREE.Vector3(islet.x, 0, islet.z).addScaledVector(dir, -(ISLET_RADIUS - 0.8));
      to.y = this.getGroundHeight(to.x, to.z);
      this.group.add(
        createBridge({ from, to, width: BRIDGE_WIDTH, color: 0xffd27a, arc: BRIDGE_ARC }),
      );
      this.walkBridges.push({ from, to, halfWidth: BRIDGE_WIDTH / 2, arc: BRIDGE_ARC });
    }
    onProgress(0.32);

    // ── The endless sunset cloud-sea far below ───────────────────────────────
    const cloudSea = createWaterPlane({
      // Kept a few stops below the fog color so the islands stay the bright
      // focal point and the sea doesn't bloom into a white wash.
      size: 700,
      color: 0xd9854f,
      deepColor: 0x6e3a78,
      opacity: 1.0,
      flowSpeed: 0.25,
    });
    cloudSea.mesh.position.y = -26;
    this.group.add(cloudSea.mesh);
    this.addDynamic({ update: (dt, elapsed) => cloudSea.update(dt, elapsed) });

    // God-rays: two big slanted sun shafts falling across the main island...
    for (const [sx, sz, tilt] of [
      [-14, -4, 0.32],
      [9, 9, 0.26],
    ] as const) {
      const shaft = createLightShaft({
        color: 0xffc98a,
        height: 55,
        radiusTop: 3.5,
        radiusBottom: 13,
        opacity: 0.1,
      });
      shaft.position.set(sx, 16, sz);
      shaft.rotation.z = tilt;
      this.group.add(shaft);
    }
    // ...and warm light spilling off the island edges into the void below.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.35;
      const shaft = createLightShaft({
        color: 0xffd9a0,
        height: 22,
        radiusTop: 1.4,
        radiusBottom: 6,
        opacity: 0.18,
      });
      shaft.position.set(Math.cos(a) * (MAIN_RADIUS - 1), -12, Math.sin(a) * (MAIN_RADIUS - 1));
      this.group.add(shaft);
    }

    // Distant decorative islands drifting in the cloud-sea (not walkable).
    const drifters: Array<{ obj: THREE.Object3D; baseY: number; phase: number }> = [];
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const r = 95 + rand() * 60;
      const small = createFloatingIsland({
        radius: 3.5 + rand() * 4,
        height: 5,
        topColor: 0x5fae6e,
        cliffColor: 0x6b4a7e,
        bottomColor: 0x2c1a4a,
        noiseAmp: 0.4,
        seed: 100 + i,
      });
      const baseY = -16 + rand() * 28;
      small.group.position.set(Math.cos(a) * r, baseY, Math.sin(a) * r);
      this.group.add(small.group);
      drifters.push({ obj: small.group, baseY, phase: rand() * Math.PI * 2 });
    }
    this.addDynamic({
      update: (_dt, elapsed) => {
        for (const d of drifters) {
          d.obj.position.y = d.baseY + Math.sin(elapsed * 0.25 + d.phase) * 1.6;
        }
      },
    });
    onProgress(0.45);

    // ── Hero set-piece 1: the Lantern Tree ───────────────────────────────────
    const treeX = -9;
    const treeZ = -7;
    const treeY = this.getGroundHeight(treeX, treeZ);
    const lanternTreeModel = await tryLoadModel('skyharbor_lantern_tree');
    if (lanternTreeModel) {
      fitModelHeight(lanternTreeModel, 17);
      lanternTreeModel.position.set(treeX, treeY, treeZ);
      this.group.add(lanternTreeModel);
    } else {
      const tree = createStylizedTree({
        height: 17,
        trunkColor: 0x4a3358,
        canopyColor: 0x2e8f7a,
        canopyEmissive: 0x1a5f4f,
        layers: 4,
        seed: 5,
      });
      tree.position.set(treeX, treeY, treeZ);
      this.group.add(tree);
      // Dozens of lanterns hung through the canopy.
      for (let i = 0; i < 18; i++) {
        const a = rand() * Math.PI * 2;
        const r = 2.5 + rand() * 3.6;
        const lantern = createLantern({ color: rand() < 0.7 ? 0xffd27a : 0x4be3c3 });
        lantern.position.set(
          treeX + Math.cos(a) * r,
          treeY + 8.5 + rand() * 6,
          treeZ + Math.sin(a) * r,
        );
        this.group.add(lantern);
      }
    }
    // One warm light makes the whole canopy glow on the avatars below.
    const treeLight = new THREE.PointLight(0xffc98a, 36, 32, 2);
    treeLight.position.set(treeX, treeY + 9, treeZ);
    this.group.add(treeLight);
    onProgress(0.58);

    // ── Hero set-piece 2: the Loom of Echoes ─────────────────────────────────
    const loomX = 11;
    const loomZ = -9;
    const loomY = this.getGroundHeight(loomX, loomZ);
    const loomModel = await tryLoadModel('skyharbor_loom');
    if (loomModel) {
      fitModelHeight(loomModel, 9);
      loomModel.position.set(loomX, loomY, loomZ);
      loomModel.rotation.y = -0.9;
      this.group.add(loomModel);
    } else {
      const loom = new THREE.Group();
      loom.add(createRuinArch({ width: 7, height: 9, color: 0xcdb8e8, seed: 2 }));
      // Threads of light strung through the arch — the campaign made visible.
      const threadMat = new THREE.LineBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pts: number[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = (i / 14) * 2 - 1; // -1..1 across the opening
        const x = t * 2.9;
        const yTop = 1.5 + 6.6 * Math.sqrt(Math.max(0, 1 - t * t));
        pts.push(x, yTop, 0, x, 0.12, 0);
      }
      const threadGeo = new THREE.BufferGeometry();
      threadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      loom.add(new THREE.LineSegments(threadGeo, threadMat));
      this.addDynamic({
        update: (_dt, elapsed) => {
          threadMat.opacity = 0.55 + 0.22 * Math.sin(elapsed * 1.7);
        },
      });
      loom.position.set(loomX, loomY, loomZ);
      loom.rotation.y = -0.9;
      this.group.add(loom);

      // A pair of broken columns flanking the Loom for ruin flavor.
      for (const [dx, dz] of [
        [-5, 2],
        [4.5, 3],
      ] as const) {
        const col = createRuinColumn({
          height: 4 + rand() * 2,
          radius: 0.45,
          color: 0xcdb8e8,
          broken: true,
          seed: 40 + Math.floor(dx),
        });
        col.position.set(loomX + dx, this.getGroundHeight(loomX + dx, loomZ + dz), loomZ + dz);
        this.group.add(col);
      }
    }
    onProgress(0.68);

    // ── Scenery accents: crystals + rocks around the main island ────────────
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 1.1;
      const r = MAIN_RADIUS - 5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const cluster = createCrystalCluster({
        count: 5,
        color: i === 1 ? 0xffd27a : 0x4be3c3,
        emissiveIntensity: 1.1,
        minHeight: 0.8,
        maxHeight: 2.2,
        spread: 2.5,
        seed: 60 + i,
      });
      cluster.position.set(x, this.getGroundHeight(x, z), z);
      this.group.add(cluster);
    }
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const r = 6 + rand() * (MAIN_RADIUS - 10);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const rock = createRock({ size: 0.5 + rand() * 1.1, color: 0x7a6296, seed: 70 + i });
      rock.position.set(x, this.getGroundHeight(x, z), z);
      this.group.add(rock);
    }

    // ── Canonical interactables ──────────────────────────────────────────────
    const at = (x: number, z: number, lift = 0): [number, number, number] => [
      x,
      this.getGroundHeight(x, z) + lift,
      z,
    ];

    // Serai greets newcomers near the spawn quay, then drifts home to her
    // lamp once the party has met her (serai-met). Both spots are fixed, so
    // every client renders her identically; the interactable's collider and
    // all guidance (beacon, marker, proximity audio) follow her object.
    const seraiGreet = new THREE.Vector3(...at(0.8, 11.5));
    const seraiHome = new THREE.Vector3(...at(2.5, 3));
    const serai = this.addInteractable(
      makeEchoNpc({
        id: 'sky_echo_serai',
        prompt: 'Speak with Serai, the Lantern-Bearer',
        position: ctx.state.flags.has('serai-met')
          ? (seraiHome.toArray() as [number, number, number])
          : (seraiGreet.toArray() as [number, number, number]),
        color: 0xffd27a,
        name: 'Serai, the Lantern-Bearer',
      }),
    );
    this.addDynamic({
      update: (dt: number) => {
        const target = ctx.state.flags.has('serai-met') ? seraiHome : seraiGreet;
        const obj = serai.object;
        const dx = target.x - obj.position.x;
        const dz = target.z - obj.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.05) return;
        // Unhurried drift (~10s for the walk home), gliding over the terrain.
        const ease = 1 - Math.exp(-0.35 * dt);
        obj.position.x += dx * ease;
        obj.position.z += dz * ease;
        obj.position.y = this.getGroundHeight(obj.position.x, obj.position.z);
        // Face the direction of travel, gently.
        const facing = Math.atan2(dx, dz);
        const cur = obj.rotation.y;
        let d = facing - cur;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        obj.rotation.y = cur + d * ease;
      },
    });
    this.addInteractable(
      makeShrine({
        id: 'sky_loom',
        prompt: 'Read the threads of the Loom of Echoes',
        position: at(loomX - 1.2, loomZ + 2.2),
        color: 0xffd27a,
      }),
    );
    // The awakening ritual: three glyphs in a wide triangle (~15.6m sides) so
    // the party has to spread out to light them together.
    const glyphRing: Array<[string, number, number]> = [
      ['sky_glyph_1', 0, 11],
      ['sky_glyph_2', -7.8, -2.5],
      ['sky_glyph_3', 7.8, -2.5],
    ];
    const glyphColors = [0xffd27a, 0x4be3c3, 0x8d7bff];
    glyphRing.forEach(([gid, gx, gz], i) => {
      this.addInteractable(
        makeGlyphPlate({
          id: gid,
          prompt: 'Press your palm to the awakening glyph',
          position: at(gx, gz),
          color: glyphColors[i],
        }),
      );
    });
    this.addInteractable(
      makeLoreObject({
        id: 'sky_lore_mural',
        prompt: 'Study the faded mural of the First Dreamers',
        position: at(-17, 1),
        loreKind: 'mural',
        color: 0xc89bff,
      }),
    );
    this.addInteractable(
      makeLoreObject({
        id: 'sky_lore_bell',
        prompt: 'Ring the harbor bell',
        position: at(15, 7),
        loreKind: 'bell',
        color: 0xffd27a,
      }),
    );
    // Lumenkeeper-only cache of gathered light, tucked near the rim.
    this.addInteractable(
      makeShrine({
        id: 'sky_hidden_lumen',
        prompt: 'Gather the cache of hidden light',
        position: at(-19, 13),
        color: 0xffe9b8,
        requiresArchetype: 'lumen',
      }),
    );
    // Portal gates, one per islet.
    for (const def of PORTAL_ISLETS) {
      const px = Math.cos(def.angle) * ISLET_DIST;
      const pz = Math.sin(def.angle) * ISLET_DIST;
      this.addInteractable(
        makePortal({
          id: def.id,
          prompt: def.prompt,
          position: at(px, pz),
          to: def.to,
          color: def.color,
          label: def.label,
        }),
      );
    }
    onProgress(0.82);

    // ── Atmosphere particles ─────────────────────────────────────────────────
    const motes = createParticles({
      kind: 'motes',
      count: 350,
      areaRadius: 50,
      height: 14,
      yBase: 0.5,
      color: 0xffd27a,
      opacity: 0.8,
    });
    this.group.add(motes.object);
    this.addDynamic(motes);

    const fireflies = createParticles({
      kind: 'fireflies',
      count: 60,
      areaRadius: 26,
      height: 6,
      yBase: 0.8,
      color: 0x4be3c3,
    });
    this.group.add(fireflies.object);
    this.addDynamic(fireflies);

    // Streams of light falling off two island edges into the cloud-sea.
    for (const [ex, ez] of [
      [MAIN_RADIUS - 2, 6],
      [-(MAIN_RADIUS - 4), -9],
    ] as const) {
      const spill = createParticles({
        kind: 'sparkfall',
        count: 90,
        areaRadius: 3,
        height: 18,
        color: 0xffd9a0,
        opacity: 0.85,
      });
      spill.object.position.set(ex, -2, ez);
      this.group.add(spill.object);
      this.addDynamic(spill);
    }
    onProgress(0.95);
  }

  /**
   * Nearest-surface logic across the main island, the five islets and the
   * five light-bridges. Inside an island we sample its analytic height field;
   * on a bridge we follow the arc; off every surface we return the nearest
   * rim height so nobody falls into the void (bounds clamping keeps players
   * close anyway).
   */
  /**
   * Keep players on actual ground. The harbor is islands + light-bridges over
   * a cloud void; getGroundHeight alone would happily report a rim height
   * while the player strolls onto thin air. If `pos` is outside every
   * walkable footprint, project it back onto the nearest one.
   */
  constrainPosition(pos: THREE.Vector3): void {
    if (this.walkIslands.length === 0) return; // not built yet
    const MARGIN = 0.45; // stay this far inside any edge

    let bestDx = 0;
    let bestDz = 0;
    let bestDistSq = Infinity;
    let inside = false;

    for (const isl of this.walkIslands) {
      const dx = pos.x - isl.x;
      const dz = pos.z - isl.z;
      const d = Math.hypot(dx, dz);
      if (d <= isl.radius - MARGIN) {
        inside = true;
        break;
      }
      // Projection onto the island rim (toward its center).
      const s = d > 1e-6 ? (isl.radius - MARGIN) / d : 0;
      const px = isl.x + dx * s;
      const pz = isl.z + dz * s;
      const distSq = (pos.x - px) ** 2 + (pos.z - pz) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestDx = px;
        bestDz = pz;
      }
    }

    if (!inside) {
      for (const b of this.walkBridges) {
        const abx = b.to.x - b.from.x;
        const abz = b.to.z - b.from.z;
        const lenSq = abx * abx + abz * abz;
        if (lenSq < 1e-6) continue;
        const t = THREE.MathUtils.clamp(
          ((pos.x - b.from.x) * abx + (pos.z - b.from.z) * abz) / lenSq,
          0,
          1,
        );
        const cx = b.from.x + abx * t;
        const cz = b.from.z + abz * t;
        const lx = pos.x - cx;
        const lz = pos.z - cz;
        const lateral = Math.hypot(lx, lz);
        if (lateral <= b.halfWidth - 0.15) {
          inside = true;
          break;
        }
        // Projection onto the deck edge.
        const s = lateral > 1e-6 ? (b.halfWidth - 0.15) / lateral : 0;
        const px = cx + lx * s;
        const pz = cz + lz * s;
        const distSq = (pos.x - px) ** 2 + (pos.z - pz) ** 2;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestDx = px;
          bestDz = pz;
        }
      }
    }

    if (!inside && bestDistSq < Infinity) {
      pos.x = bestDx;
      pos.z = bestDz;
    }
  }

  override getGroundHeight(x: number, z: number): number {
    if (this.walkIslands.length === 0) return 0; // not built yet
    let bestScore = Infinity;
    let bestHeight = 0;

    for (const isl of this.walkIslands) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      const d = Math.hypot(dx, dz);
      const score = d - isl.radius; // negative inside
      let lx = dx;
      let lz = dz;
      if (d > isl.radius && d > 1e-6) {
        // Sample at the rim when outside so the height field stays valid.
        const s = (isl.radius * 0.98) / d;
        lx *= s;
        lz *= s;
      }
      if (score < bestScore) {
        bestScore = score;
        bestHeight = isl.y + isl.getHeight(lx, lz);
      }
    }

    for (const b of this.walkBridges) {
      const abx = b.to.x - b.from.x;
      const abz = b.to.z - b.from.z;
      const lenSq = abx * abx + abz * abz;
      if (lenSq < 1e-6) continue;
      const t = THREE.MathUtils.clamp(
        ((x - b.from.x) * abx + (z - b.from.z) * abz) / lenSq,
        0,
        1,
      );
      const px = b.from.x + abx * t;
      const pz = b.from.z + abz * t;
      const lateral = Math.hypot(x - px, z - pz);
      if (lateral > b.halfWidth + 0.5) continue;
      const score = lateral - b.halfWidth;
      if (score < bestScore) {
        bestScore = score;
        // Deck centerline (matches builders.createBridge) + half plank height.
        bestHeight =
          THREE.MathUtils.lerp(b.from.y, b.to.y, t) + b.arc * Math.sin(Math.PI * t) + 0.05;
      }
    }

    return bestHeight;
  }
}

/**
 * Uniformly scale a loaded GLB so its bounding-box height matches the target,
 * then drop it so its base sits at y=0 of its own origin. Keeps hand-made
 * assets aligned with the procedural layout regardless of authoring scale.
 */
function fitModelHeight(model: THREE.Group, targetHeight: number): void {
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  if (h > 0.001) model.scale.multiplyScalar(targetHeight / h);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;
}
