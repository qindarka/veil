/**
 * src/world/locations/WanderingWood.ts
 * The Wandering Wood — a twilight bioluminescent forest. Teal and violet
 * canopies with emissive rims, giant glowing mushrooms, rolling mossy ground,
 * thick teal fog and green aurora ribbons above the canopy. The colossal
 * Heartwood rises at the center; three mossy waystone crystals are spread
 * wide so the co-op attunement invites the party to split up.
 */

import * as THREE from 'three';
import { LOCATION_NAMES } from '../../../shared/constants';
import type { MusicMood } from '../../../shared/constants';
import { tryLoadModel } from '../../core/AssetLoader';
import type { EnvironmentSettings, GameContext, Vec3 } from '../../types';
import { LocationBase } from '../LocationBase';
import {
  createCrystalCluster,
  createLightShaft,
  createRock,
  createRuinArch,
  createStylizedTree,
  createTreeField,
  seededRandom,
  standardMat,
} from '../builders';
import {
  makeEchoNpc,
  makeLoreObject,
  makePortal,
  makeResonanceCrystal,
  makeShrine,
} from '../Interactables';
import { createParticles } from '../Particles';
import { createSky } from '../Sky';

export class WanderingWood extends LocationBase {
  readonly id = 'wandering-wood' as const;
  override readonly boundsRadius: number = 60;
  override readonly defaultMood: MusicMood = 'exploration';

  // Deep teal twilight: thick fog, soft moon-through-canopy key, violet fill.
  readonly environment: EnvironmentSettings = {
    background: 0x06121c,
    fogColor: 0x103336,
    fogDensity: 0.02,
    ambientColor: 0x3f7a80,
    ambientIntensity: 0.75,
    sunColor: 0x9be8d8,
    sunIntensity: 0.55,
    sunPosition: [0.25, 0.9, 0.2],
    fillColor: 0x8d7bff,
    fillIntensity: 0.45,
    bloomStrength: 1.15,
    bloomRadius: 0.85,
    bloomThreshold: 0.55,
    exposure: 1.05,
  };

  // Southern glade, facing north toward the Heartwood. y corrected on build.
  readonly spawn = { position: [0, 1, 33] as Vec3, yaw: Math.PI };

  /**
   * Rolling mossy ground: gentle layered sine height field. Purely analytic,
   * so getGroundHeight is exact everywhere (including before build).
   */
  private heightAt(x: number, z: number): number {
    return (
      1.5 * Math.sin(x * 0.07) * Math.cos(z * 0.06) +
      0.8 * Math.sin(x * 0.16 + 1.7) * Math.cos(z * 0.13 + 0.6) +
      0.35 * Math.sin(x * 0.31 + 4.1) * Math.sin(z * 0.27 + 2.3)
    );
  }

  override getGroundHeight(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  protected async buildScene(
    _ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const rand = seededRandom(4242);
    const groundAt = (x: number, z: number) => this.heightAt(x, z);

    // ── Sky: near-black teal night with green aurora ribbons + stars ────────
    const sky = createSky({
      topColor: 0x040b18,
      horizonColor: 0x0d3038,
      bottomColor: 0x06141c,
      stars: true,
      aurora: true,
      auroraColor: 0x52e89a,
    });
    this.group.add(sky.group);
    this.addDynamic(sky);
    onProgress(0.08);

    // ── Mossy terrain: displaced plane with a vertex-color moss gradient ────
    const groundGeo = new THREE.PlaneGeometry(140, 140, 80, 80);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x123832); // shaded hollows
    const high = new THREE.Color(0x2c6b52); // moonlit moss crowns
    const tealKiss = new THREE.Color(0x1d6e6e);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      // Height-driven moss gradient with a faint teal shimmer band.
      const t = THREE.MathUtils.clamp((h + 2.6) / 5.2, 0, 1);
      c.copy(low).lerp(high, t);
      const shimmer = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.19);
      c.lerp(tealKiss, shimmer * 0.18);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      standardMat({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }),
    );
    this.group.add(ground);
    onProgress(0.22);

    // ── Forest: two instanced canopy fields (teal + violet) ─────────────────
    this.group.add(
      createTreeField({
        count: 120,
        areaRadius: 58,
        minHeight: 8,
        maxHeight: 15,
        trunkColor: 0x241f3d,
        canopyColor: 0x14555e,
        canopyEmissive: 0x0e4a52,
        seed: 7,
        getHeight: groundAt,
        exclusionRadius: 15, // keep the Heartwood glade open
      }),
    );
    this.group.add(
      createTreeField({
        count: 50,
        areaRadius: 56,
        minHeight: 6,
        maxHeight: 11,
        trunkColor: 0x2a2148,
        canopyColor: 0x4b3a8f,
        canopyEmissive: 0x32256b,
        seed: 13,
        getHeight: groundAt,
        exclusionRadius: 15,
      }),
    );
    onProgress(0.38);

    // ── Hero set-piece: the Heartwood, colossal at the center ────────────────
    const heartY = groundAt(0, 0);
    const heartwoodModel = await tryLoadModel('wood_heartwood_tree');
    if (heartwoodModel) {
      fitModelHeight(heartwoodModel, 32);
      heartwoodModel.position.set(0, heartY, 0);
      this.group.add(heartwoodModel);
    } else {
      const heartwood = createStylizedTree({
        height: 32,
        trunkColor: 0x33284f,
        canopyColor: 0x23c2a5,
        canopyEmissive: 0x16826e,
        layers: 5,
        seed: 3,
      });
      heartwood.scale.set(2.0, 1.0, 2.0); // broaden without stretching height
      heartwood.position.set(0, heartY, 0);
      this.group.add(heartwood);
    }
    // Moonlight column falling through the Heartwood canopy.
    const heartShaft = createLightShaft({
      color: 0x6fffd8,
      height: 34,
      radiusTop: 2.5,
      radiusBottom: 9,
      opacity: 0.14,
    });
    heartShaft.position.set(0, 17, 0);
    this.group.add(heartShaft);
    // Glow crystals nested in the roots, plus a teal heart-light.
    const rootCrystals = createCrystalCluster({
      count: 7,
      color: 0x35e3b8,
      emissiveIntensity: 1.2,
      minHeight: 0.6,
      maxHeight: 1.8,
      spread: 5,
      seed: 9,
    });
    rootCrystals.position.set(0, heartY, 0);
    this.group.add(rootCrystals);
    const heartLight = new THREE.PointLight(0x3fe8c8, 42, 28, 2);
    heartLight.position.set(0, heartY + 6, 3);
    this.group.add(heartLight);
    onProgress(0.52);

    // ── Giant bioluminescent mushrooms (instanced stems + caps) ─────────────
    const MUSHROOMS = 30;
    const stemGeo = new THREE.CylinderGeometry(0.22, 0.4, 1, 6);
    const capGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const stemMat = standardMat({ color: 0xbcb4a6, roughness: 0.9, flatShading: true });
    const capMat = standardMat({
      color: 0xffffff, // white base so per-instance colors read true
      emissive: 0x27c8b8,
      emissiveIntensity: 0.65,
      roughness: 0.6,
      flatShading: true,
    });
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, MUSHROOMS);
    const caps = new THREE.InstancedMesh(capGeo, capMat, MUSHROOMS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const capColA = new THREE.Color(0x3fe8d0);
    const capColB = new THREE.Color(0x9d7bff);
    const capCol = new THREE.Color();
    for (let i = 0; i < MUSHROOMS; i++) {
      // Three giant heroes near paths, the rest scattered mid-forest.
      const hero = i < 3;
      const a = hero ? [0.9, 2.6, 4.4][i] : rand() * Math.PI * 2;
      const r = hero ? 18 + i * 4 : 10 + rand() * 45;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = hero ? 3.2 + rand() * 0.8 : 0.6 + rand() * 1.6;
      const y = groundAt(x, z);
      const stemH = 1.4 * s;
      q.setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.12));
      m.compose(new THREE.Vector3(x, y + stemH / 2, z), q, new THREE.Vector3(s, stemH, s));
      stems.setMatrixAt(i, m);
      m.compose(
        new THREE.Vector3(x, y + stemH, z),
        q,
        new THREE.Vector3(1.15 * s, 0.75 * s, 1.15 * s),
      );
      caps.setMatrixAt(i, m);
      caps.setColorAt(i, capCol.copy(capColA).lerp(capColB, rand()));
    }
    this.group.add(stems, caps);
    onProgress(0.62);

    // ── Scenery: stump circle, scattered rocks, hidden-place decor ──────────
    // Stump circle near Rowan (six mossy stumps).
    const stumpGeo = new THREE.CylinderGeometry(0.55, 0.7, 0.8, 7);
    const stumpMat = standardMat({ color: 0x3d2f52, roughness: 1, flatShading: true });
    const stumps = new THREE.InstancedMesh(stumpGeo, stumpMat, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = -16 + Math.cos(a) * 3.2;
      const z = 16 + Math.sin(a) * 3.2;
      m.compose(
        new THREE.Vector3(x, groundAt(x, z) + 0.4, z),
        q.setFromEuler(new THREE.Euler(0, rand() * Math.PI, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      stumps.setMatrixAt(i, m);
    }
    this.group.add(stumps);

    for (let i = 0; i < 8; i++) {
      const a = rand() * Math.PI * 2;
      const r = 8 + rand() * 48;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const rock = createRock({ size: 0.6 + rand() * 1.4, color: 0x2f4a55, seed: 200 + i });
      rock.position.set(x, groundAt(x, z), z);
      this.group.add(rock);
    }

    // The grown-over green door (thornwalker's hidden way): a small arch
    // swallowed by luminous growth at the far southwestern edge.
    const doorX = -39;
    const doorZ = -26;
    const greenDoor = new THREE.Group();
    greenDoor.add(createRuinArch({ width: 3.5, height: 5, color: 0x2c4a3a, seed: 21 }));
    const doorVines = createCrystalCluster({
      count: 6,
      color: 0x9fe060,
      emissiveIntensity: 0.9,
      minHeight: 0.5,
      maxHeight: 1.6,
      spread: 2.2,
      seed: 22,
    });
    greenDoor.add(doorVines);
    greenDoor.position.set(doorX, groundAt(doorX, doorZ), doorZ);
    greenDoor.rotation.y = 0.7;
    this.group.add(greenDoor);

    // The old guardian-stone (warden's hidden ward) to the northeast.
    const wardX = 36;
    const wardZ = 22;
    const wardStone = createRock({ size: 2.6, color: 0x46566b, seed: 23 });
    wardStone.position.set(wardX, groundAt(wardX, wardZ), wardZ);
    this.group.add(wardStone);
    const wardGlow = createCrystalCluster({
      count: 4,
      color: 0x6fe08a,
      emissiveIntensity: 0.8,
      minHeight: 0.4,
      maxHeight: 1.0,
      spread: 1.8,
      seed: 24,
    });
    wardGlow.position.set(wardX + 1.5, groundAt(wardX + 1.5, wardZ + 1), wardZ + 1);
    this.group.add(wardGlow);
    onProgress(0.72);

    // ── Canonical interactables ──────────────────────────────────────────────
    const at = (x: number, z: number): [number, number, number] => [x, groundAt(x, z), z];

    this.addInteractable(
      makeEchoNpc({
        id: 'wood_echo_rowan',
        prompt: 'Speak with Rowan, Warden of the Wood',
        position: at(-16, 16),
        color: 0x9fe060,
        name: 'Rowan, Warden of the Wood',
      }),
    );
    // Three waystones flung wide (~65m apart) — attuning all three at once
    // is the co-op puzzle, so the party has to split up through the fog.
    const waystones: Array<[string, number, number]> = [
      ['wood_waystone_1', -36, -14],
      ['wood_waystone_2', 33, -20],
      ['wood_waystone_3', 6, 38],
    ];
    for (const [wid, wx, wz] of waystones) {
      this.addInteractable(
        makeResonanceCrystal({
          id: wid,
          prompt: 'Attune the mossy waystone',
          position: at(wx, wz),
          color: 0x6fe0a8,
        }),
      );
      // A couple of rocks so each waystone reads as an old marker site.
      for (let k = 0; k < 2; k++) {
        const rx = wx + (rand() - 0.5) * 5;
        const rz = wz + (rand() - 0.5) * 5;
        const rock = createRock({ size: 0.5 + rand() * 0.8, color: 0x2f4a55, seed: 230 + k });
        rock.position.set(rx, groundAt(rx, rz), rz);
        this.group.add(rock);
      }
    }
    this.addInteractable(
      makeShrine({
        id: 'wood_heartwood',
        prompt: 'Lay your hands on the Heartwood',
        position: at(0, 6.5),
        color: 0x3fe8c8,
      }),
    );
    this.addInteractable(
      makeLoreObject({
        id: 'wood_lore_stump',
        prompt: 'Read the rings of the elder stump',
        position: at(-20, 12),
        loreKind: 'stump',
        color: 0x9fe060,
      }),
    );
    this.addInteractable(
      makeShrine({
        id: 'wood_hidden_thornwalker',
        prompt: 'Part the grown-over green door',
        position: at(doorX + 1.5, doorZ + 2),
        color: 0x9fe060,
        requiresArchetype: 'thornwalker',
      }),
    );
    this.addInteractable(
      makeShrine({
        id: 'wood_hidden_warden',
        prompt: 'Wake the old guardian-stone',
        position: at(wardX - 2, wardZ - 1.5),
        color: 0x6fe08a,
        requiresArchetype: 'warden',
      }),
    );
    this.addInteractable(
      makePortal({
        id: 'wood_portal_sky',
        prompt: 'Step through the gate to the Skyharbor',
        position: at(10, 36),
        to: 'skyharbor',
        color: 0xffd27a,
        label: LOCATION_NAMES['skyharbor'],
      }),
    );
    onProgress(0.85);

    // ── Atmosphere: dense fireflies, drifting petals ─────────────────────────
    const firefliesA = createParticles({
      kind: 'fireflies',
      count: 450,
      areaRadius: 56,
      height: 7,
      yBase: 0.6,
      color: 0xaef27a,
      opacity: 0.9,
    });
    this.group.add(firefliesA.object);
    this.addDynamic(firefliesA);

    const firefliesB = createParticles({
      kind: 'fireflies',
      count: 120,
      areaRadius: 50,
      height: 10,
      yBase: 2,
      color: 0xb89bff,
      opacity: 0.7,
    });
    this.group.add(firefliesB.object);
    this.addDynamic(firefliesB);

    const petals = createParticles({
      kind: 'petals',
      count: 240,
      areaRadius: 50,
      height: 14,
      yBase: 0.5,
      color: 0x8fe8c8,
      opacity: 0.85,
    });
    this.group.add(petals.object);
    this.addDynamic(petals);

    // Spawn snaps to the terrain now that everything is placed.
    this.spawn.position[1] = groundAt(this.spawn.position[0], this.spawn.position[2]);
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
