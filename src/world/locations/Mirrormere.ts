/**
 * src/world/locations/Mirrormere.ts
 * The Mirrormere — a midnight lake of perfect stillness under an enormous low
 * moon. Silver/indigo/pale-blue palette, dense stars, sparse "memory motes"
 * falling like snow. Players walk the southern shore and a stepping-stone
 * path out onto the water, where the Dreamer's Reflection stands waiting.
 * Quiet, contemplative, beautiful.
 */

import * as THREE from 'three';
import { LOCATION_NAMES } from '../../../shared/constants';
import type { MusicMood } from '../../../shared/constants';
import { tryLoadModel } from '../../core/AssetLoader';
import type { EnvironmentSettings, GameContext, Vec3 } from '../../types';
import { LocationBase } from '../LocationBase';
import {
  createRock,
  createRuinArch,
  createRuinColumn,
  createWaterPlane,
  seededRandom,
  standardMat,
} from '../builders';
import {
  makeEchoNpc,
  makeLoreObject,
  makePortal,
  makeShrine,
} from '../Interactables';
import { createParticles } from '../Particles';
import { createSky } from '../Sky';

/** Walkable deck height of the stepping stones (just above the water at y=0). */
const STONE_TOP = 0.24;
/** Half-width of the walkable stepping-stone causeway. */
const PATH_HALF_WIDTH = 1.25;

/**
 * The stepping-stone causeways as polylines (x, z). The main path runs from
 * the south shore out to the Dreamer's Reflection; the spur bends toward the
 * half-sunk veilseer secret. getGroundHeight treats each as a capsule.
 */
const STONE_PATHS: Array<Array<[number, number]>> = [
  [
    [0, 44],
    [0.8, 38],
    [-0.7, 32],
    [0.6, 26],
    [0, 20],
    [0, 16.5],
  ],
  [
    [0.6, 26],
    [-3.5, 24.5],
    [-7, 23],
  ],
];

export class Mirrormere extends LocationBase {
  readonly id = 'mirrormere' as const;
  override readonly boundsRadius: number = 55;
  override readonly defaultMood: MusicMood = 'ambient';

  // Moonlit midnight: pale silver key from the low moon, indigo everything.
  readonly environment: EnvironmentSettings = {
    background: 0x0b0716,
    fogColor: 0x131838,
    fogDensity: 0.0065,
    ambientColor: 0x52608f,
    ambientIntensity: 0.5,
    sunColor: 0xd6e4ff,
    sunIntensity: 0.9,
    sunPosition: [0, 0.35, -0.92],
    fillColor: 0x8d7bff,
    fillIntensity: 0.25,
    bloomStrength: 0.8,
    bloomRadius: 0.65,
    bloomThreshold: 0.7,
    exposure: 1.0,
  };

  // South shore, facing north across the water toward the moon.
  readonly spawn = { position: [0, 1, 47] as Vec3, yaw: Math.PI };

  /**
   * Shore profile, radial from the lake center: a shallow glassy lakebed
   * (-0.4m, so a player who steps off the stones wades rather than falls),
   * lifting to a waterline beach near d=40 and climbing into dunes beyond.
   */
  private shoreHeight(x: number, z: number): number {
    const d = Math.hypot(x, z);
    const bed = -0.4;
    const lift = THREE.MathUtils.smoothstep(d, 34, 40) * 0.45; // beach break
    const rise = THREE.MathUtils.smoothstep(d, 38, 52) * 2.2; // climbing shore
    const dunes =
      THREE.MathUtils.smoothstep(d, 40, 55) * 0.3 * Math.sin(x * 0.3) * Math.sin(z * 0.25);
    return bed + lift + rise + dunes;
  }

  /** Shore everywhere, overridden by the stepping-stone causeways. */
  override getGroundHeight(x: number, z: number): number {
    let h = this.shoreHeight(x, z);
    for (const path of STONE_PATHS) {
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i];
        const [bx, bz] = path[i + 1];
        const abx = bx - ax;
        const abz = bz - az;
        const lenSq = abx * abx + abz * abz;
        if (lenSq < 1e-6) continue;
        const t = THREE.MathUtils.clamp(((x - ax) * abx + (z - az) * abz) / lenSq, 0, 1);
        const lateral = Math.hypot(x - (ax + abx * t), z - (az + abz * t));
        if (lateral <= PATH_HALF_WIDTH) h = Math.max(h, STONE_TOP);
      }
    }
    return h;
  }

  protected async buildScene(
    _ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const rand = seededRandom(7177);
    const shoreAt = (x: number, z: number) => this.shoreHeight(x, z);

    // ── Sky: dense stars over a deep indigo night, moon-glow on the horizon ─
    const sky = createSky({
      topColor: 0x05030f,
      horizonColor: 0x1b2150,
      bottomColor: 0x0b0716,
      stars: true,
      sunGlow: { position: [0, 30, -160], color: 0xbcd2ff },
    });
    this.group.add(sky.group);
    this.addDynamic(sky);

    // The enormous low moon: a bare disc plus a soft additive halo. fog:false
    // keeps it luminous through the distance haze.
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(17, 48),
      new THREE.MeshBasicMaterial({ color: 0xeef3ff, fog: false }),
    );
    moon.position.set(0, 30, -170);
    moon.lookAt(0, 2, 47);
    this.group.add(moon);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x7e9bff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const halo = new THREE.Mesh(new THREE.CircleGeometry(28, 48), haloMat);
    halo.position.set(0, 30, -171);
    halo.lookAt(0, 2, 47);
    this.group.add(halo);
    this.addDynamic({
      update: (_dt, elapsed) => {
        haloMat.opacity = 0.24 + 0.05 * Math.sin(elapsed * 0.4);
      },
    });
    onProgress(0.12);

    // ── The mere: dark glassy water + the lakebed/shore terrain beneath ─────
    const water = createWaterPlane({
      size: 180,
      color: 0x1a2752,
      deepColor: 0x05060f,
      opacity: 0.93,
      flowSpeed: 0.05, // perfect stillness, barely breathing
    });
    this.group.add(water.mesh);
    this.addDynamic({ update: (dt, elapsed) => water.update(dt, elapsed) });

    const groundGeo = new THREE.PlaneGeometry(150, 150, 72, 72);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const deep = new THREE.Color(0x0a0d22); // drowned lakebed
    const sand = new THREE.Color(0x3a4470); // moonlit silver-blue shore
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.shoreHeight(x, z);
      pos.setY(i, h);
      const t = THREE.MathUtils.clamp((h + 0.4) / 2.8, 0, 1);
      c.copy(deep).lerp(sand, t);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
    this.group.add(
      new THREE.Mesh(
        groundGeo,
        standardMat({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }),
      ),
    );

    // The moon's reflection: a long faint lane of light across the still water.
    const laneMat = new THREE.MeshBasicMaterial({
      color: 0xbcd2ff,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(5, 110), laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.03, -35);
    this.group.add(lane);
    this.addDynamic({
      update: (_dt, elapsed) => {
        laneMat.opacity = 0.11 + 0.04 * (0.5 + 0.5 * Math.sin(elapsed * 0.7));
      },
    });
    onProgress(0.35);

    // ── Stepping stones along the causeway polylines ─────────────────────────
    const stonePlacements: Array<{ x: number; z: number; rot: number; s: number }> = [];
    for (const path of STONE_PATHS) {
      let carry = 0; // distance carried over between segments
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i];
        const [bx, bz] = path[i + 1];
        const segLen = Math.hypot(bx - ax, bz - az);
        for (let dWalk = carry; dWalk < segLen; dWalk += 2.0) {
          const t = dWalk / segLen;
          stonePlacements.push({
            x: ax + (bx - ax) * t + (rand() - 0.5) * 0.3,
            z: az + (bz - az) * t + (rand() - 0.5) * 0.3,
            rot: rand() * Math.PI * 2,
            s: 0.85 + rand() * 0.4,
          });
        }
        carry = 0;
      }
    }
    const stoneGeo = new THREE.CylinderGeometry(1.0, 1.3, 0.5, 7);
    const stoneMat = standardMat({ color: 0x8d99bd, roughness: 0.85, flatShading: true });
    const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, stonePlacements.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    stonePlacements.forEach((s, i) => {
      q.setFromEuler(new THREE.Euler(0, s.rot, 0));
      // Cylinder is 0.5 tall and centered: top sits at STONE_TOP.
      m.compose(new THREE.Vector3(s.x, STONE_TOP - 0.25, s.z), q, new THREE.Vector3(s.s, 1, s.s));
      stones.setMatrixAt(i, m);
    });
    this.group.add(stones);
    onProgress(0.5);

    // ── Hero set-piece: the weathered stone arch on the shore ───────────────
    const archX = -12;
    const archZ = 41;
    const archY = shoreAt(archX, archZ);
    const archModel = await tryLoadModel('mirrormere_arch');
    if (archModel) {
      fitModelHeight(archModel, 8.5);
      archModel.position.set(archX, archY, archZ);
      archModel.rotation.y = Math.atan2(-archX, -archZ); // opening frames the lake
      this.group.add(archModel);
    } else {
      const arch = createRuinArch({ width: 6.5, height: 8.5, color: 0x8f9cc0, seed: 17 });
      arch.position.set(archX, archY, archZ);
      arch.rotation.y = Math.atan2(-archX, -archZ);
      this.group.add(arch);
    }
    // Fallen stones at its feet — long weathered by the mere.
    for (let i = 0; i < 3; i++) {
      const rx = archX + (rand() - 0.5) * 7;
      const rz = archZ + (rand() - 0.5) * 5;
      const rock = createRock({ size: 0.6 + rand() * 1.0, color: 0x5a6488, seed: 300 + i });
      rock.position.set(rx, shoreAt(rx, rz), rz);
      this.group.add(rock);
    }

    // The still pool: a glowing basin set into the western shore.
    const poolX = -20;
    const poolZ = 43;
    const poolY = shoreAt(poolX, poolZ);
    const poolMat = new THREE.MeshBasicMaterial({
      color: 0x9fc8ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(poolX, poolY + 0.06, poolZ);
    this.group.add(pool);
    this.addDynamic({
      update: (_dt, elapsed) => {
        poolMat.opacity = 0.42 + 0.12 * (0.5 + 0.5 * Math.sin(elapsed * 0.9));
      },
    });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const rx = poolX + Math.cos(a) * 2.9;
      const rz = poolZ + Math.sin(a) * 2.9;
      const rock = createRock({ size: 0.4 + rand() * 0.4, color: 0x5a6488, seed: 320 + i });
      rock.position.set(rx, shoreAt(rx, rz), rz);
      this.group.add(rock);
    }

    // Half-sunk ruin column offshore, beside the veilseer's hidden truth.
    const sunkCol = createRuinColumn({
      height: 5,
      radius: 0.5,
      color: 0x6b769e,
      broken: true,
      seed: 19,
    });
    sunkCol.position.set(-11, -1.6, 20.5);
    sunkCol.rotation.z = 0.5;
    this.group.add(sunkCol);
    onProgress(0.65);

    // ── Reeds: thin instanced cones rimming the waterline ────────────────────
    const reedPlacements: Array<{ x: number; z: number; lean: number; bearing: number; s: number }> = [];
    while (reedPlacements.length < 130) {
      const a = rand() * Math.PI * 2;
      const d = 39.5 + rand() * 4;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.abs(x) < 4 && z > 30) continue; // keep the causeway entry clear
      reedPlacements.push({
        x,
        z,
        lean: (rand() - 0.5) * 0.25,
        bearing: rand() * Math.PI * 2,
        s: 0.8 + rand() * 0.8,
      });
    }
    const reedGeo = new THREE.ConeGeometry(0.07, 1.7, 5);
    const reedMat = standardMat({ color: 0x274d44, roughness: 0.9, flatShading: true });
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, reedPlacements.length);
    reedPlacements.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(r.lean, r.bearing, 0));
      const y = shoreAt(r.x, r.z);
      // Cone is centered on its own y; raise by half-height (scaled).
      m.compose(
        new THREE.Vector3(r.x, y + (1.7 * r.s) / 2 - 0.1, r.z),
        q,
        new THREE.Vector3(r.s, r.s, r.s),
      );
      reeds.setMatrixAt(i, m);
    });
    this.group.add(reeds);
    onProgress(0.75);

    // ── Canonical interactables ──────────────────────────────────────────────
    // The Dreamer's Reflection stands ON the still water at the causeway's end.
    const npcX = 0;
    const npcZ = 13.5;
    this.addInteractable(
      makeEchoNpc({
        id: 'mir_echo_reflection',
        prompt: "Approach the Dreamer's Reflection",
        position: [npcX, 0.05, npcZ],
        color: 0xd6e4ff,
        name: "The Dreamer's Reflection",
      }),
    );
    // A soft pulsing glow on the water beneath the figure — its "reflection".
    const npcGlowMat = new THREE.MeshBasicMaterial({
      color: 0xbcd2ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const npcGlow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), npcGlowMat);
    npcGlow.rotation.x = -Math.PI / 2;
    npcGlow.position.set(npcX, 0.02, npcZ);
    this.group.add(npcGlow);
    this.addDynamic({
      update: (_dt, elapsed) => {
        npcGlowMat.opacity = 0.3 + 0.12 * (0.5 + 0.5 * Math.sin(elapsed * 1.1));
      },
    });
    const npcLight = new THREE.PointLight(0xbcd2ff, 18, 18, 2);
    npcLight.position.set(npcX, 2.5, npcZ);
    this.group.add(npcLight);

    this.addInteractable(
      makeShrine({
        id: 'mir_still_pool',
        prompt: 'Kneel at the still pool',
        position: [poolX + 2, shoreAt(poolX + 2, poolZ + 1.5), poolZ + 1.5],
        color: 0x9fc8ff,
      }),
    );
    this.addInteractable(
      makeLoreObject({
        id: 'mir_lore_shore',
        prompt: 'Sift the memory-glass washed up on the shore',
        position: [5, shoreAt(5, 43), 43],
        loreKind: 'generic',
        color: 0x7ab8ff,
      }),
    );
    // Veilseer-only: a drowned truth off the spur, half-sunk in the shallows.
    this.addInteractable(
      makeShrine({
        id: 'mir_hidden_veilseer',
        prompt: 'Peer through the Hush at the drowned door',
        position: [-9.2, -0.1, 22.2],
        color: 0x8d7bff,
        requiresArchetype: 'veilseer',
      }),
    );
    this.addInteractable(
      makePortal({
        id: 'mir_portal_sky',
        prompt: 'Step through the gate to the Skyharbor',
        position: [12, shoreAt(12, 45), 45],
        to: 'skyharbor',
        color: 0xffd27a,
        label: LOCATION_NAMES['skyharbor'],
      }),
    );
    onProgress(0.88);

    // ── Atmosphere: memory motes falling like slow snow + low water mist ─────
    const memoryMotes = createParticles({
      kind: 'snow',
      count: 260,
      areaRadius: 55,
      height: 24,
      yBase: 0.2,
      color: 0xcfe0ff,
      size: 0.4,
      opacity: 0.8,
    });
    this.group.add(memoryMotes.object);
    this.addDynamic(memoryMotes);

    const mist = createParticles({
      kind: 'motes',
      count: 120,
      areaRadius: 42,
      height: 2,
      yBase: 0.1,
      color: 0x8da6ff,
      opacity: 0.3,
    });
    this.group.add(mist.object);
    this.addDynamic(mist);

    // Snap spawn to the dune it stands on.
    this.spawn.position[1] = this.getGroundHeight(
      this.spawn.position[0],
      this.spawn.position[2],
    );
    onProgress(0.95);
  }
}

/**
 * Uniformly scale a loaded GLB so its bounding-box height matches the target,
 * then drop it so its base sits at y=0 of its own origin.
 */
function fitModelHeight(model: THREE.Group, targetHeight: number): void {
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  if (h > 0.001) model.scale.multiplyScalar(targetHeight / h);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;
}
