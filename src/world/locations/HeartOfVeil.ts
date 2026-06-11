/**
 * src/world/locations/HeartOfVeil.ts
 * The Heart of the Veil — the Act 3 climax stage. A platform of dark
 * mirror-glass adrift in a star-dense void, ribboned with aurora on every
 * horizon. Golden threads converge from all directions on the final Loom at
 * the platform's center, ringed by five ritual glyphs. Beyond the southern
 * edge the First Dreamer slumbers, colossal and half-formed from starlight.
 * Sparse, monumental, humbling — and warm: this is a rescue, not a battle.
 *
 * Terrain contract: the platform is perfectly flat at y = 0.
 */

import * as THREE from 'three';
import type { LocationId, MusicMood } from '../../../shared/constants';
import type { EnvironmentSettings, GameContext, Vec3 } from '../../types';
import { LocationBase } from '../LocationBase';
import { seededRandom, standardMat } from '../builders';
import { createParticles } from '../Particles';
import { createSky } from '../Sky';
import { makePortal, makeGlyphPlate, makeEchoNpc, makeShrine } from '../Interactables';
import { tryLoadModel } from '../../core/AssetLoader';

/** Radius of the glyph ritual circle — wide enough that the party must spread out. */
const GLYPH_RING_RADIUS = 18;
/** The visible platform extends a little past the walkable bounds (45). */
const PLATFORM_RADIUS = 46;

export class HeartOfVeil extends LocationBase {
  readonly id: LocationId = 'heart-of-the-veil';
  override readonly boundsRadius: number = 45;
  override readonly defaultMood: MusicMood = 'tension';

  /** Arrive at the platform's edge, facing the Loom and the Dreamer beyond (-Z). */
  readonly spawn = { position: [0, 0, 38] as Vec3, yaw: 0 };

  readonly environment: EnvironmentSettings = {
    background: 0x06030f,
    fogColor: 0x140d30,
    fogDensity: 0.0042, // thin — the void should read deep, not murky
    ambientColor: 0x3a2c72,
    ambientIntensity: 0.5,
    sunColor: 0xffd27a,
    sunIntensity: 1.6,
    sunPosition: [-0.2, 0.75, -0.62], // keyed from the Dreamer's direction
    fillColor: 0x4be3c3,
    fillIntensity: 0.45,
    bloomStrength: 1.25,
    bloomRadius: 0.85,
    bloomThreshold: 0.18,
    exposure: 1.18,
  };

  /** The mirror-glass platform is dead flat. */
  override getGroundHeight(_x: number, _z: number): number {
    return 0;
  }

  protected async buildScene(
    _ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const rand = seededRandom(0x4ea127);
    onProgress(0.05);

    this.buildPlatform();
    onProgress(0.2);

    this.buildLoom();
    this.buildGoldenThreads(rand);
    onProgress(0.4);

    // Hero set-piece: the First Dreamer. Asset swap point — falls back to a
    // procedural colossus of starlight.
    const dreamer = await tryLoadModel('heart_dreamer_figure');
    if (dreamer) {
      dreamer.position.set(0, -10, -78);
      this.group.add(dreamer);
    } else {
      this.buildProceduralDreamer();
    }
    onProgress(0.6);

    this.buildOrbitingShards(rand);
    onProgress(0.7);

    this.registerInteractables();
    onProgress(0.85);

    this.buildAtmosphere();
    onProgress(0.95);
  }

  // ── The mirror-glass platform ──────────────────────────────────────────────

  private buildPlatform(): void {
    // Dark glass: low albedo, high metalness — bloom-lit accents do the rest.
    const glass = standardMat({
      color: 0x0e0a22,
      emissive: 0x14102e,
      emissiveIntensity: 0.25,
      roughness: 0.12,
      metalness: 0.85,
      flatShading: true,
    });
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS + 3, 3, 64),
      glass,
    );
    slab.position.y = -1.5; // top face at exactly y = 0
    slab.name = 'mirror-platform';
    this.group.add(slab);

    // Luminous seams: the outer rim, the glyph ritual circle, the loom circle.
    const rings: Array<{ r: number; color: number; opacity: number; tube: number }> = [
      { r: PLATFORM_RADIUS + 0.3, color: 0xffd27a, opacity: 0.7, tube: 0.16 },
      { r: GLYPH_RING_RADIUS, color: 0x4be3c3, opacity: 0.35, tube: 0.08 },
      { r: 7, color: 0x8d7bff, opacity: 0.35, tube: 0.08 },
    ];
    for (const spec of rings) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r, spec.tube, 8, 128),
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

    // A faint teal light-skirt falling away beneath the platform into the void.
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATFORM_RADIUS, 20, 24, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x4be3c3,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    skirt.position.y = -15;
    this.group.add(skirt);
  }

  // ── The final Loom ─────────────────────────────────────────────────────────

  private buildLoom(): void {
    const loom = new THREE.Group();
    loom.name = 'final-loom';

    const crystal = standardMat({
      color: 0x9b8cf0,
      emissive: 0x6f5bd0,
      emissiveIntensity: 0.6,
      roughness: 0.25,
      metalness: 0.3,
      flatShading: true,
    });

    // Dais of darker glass with a bright rim.
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 5.0, 0.5, 24),
      standardMat({ color: 0x1a1438, emissive: 0x2a1f66, emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.6, flatShading: true }),
    );
    dais.position.y = 0.25;
    loom.add(dais);
    const daisRim = new THREE.Mesh(
      new THREE.TorusGeometry(4.6, 0.07, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    daisRim.rotation.x = Math.PI / 2;
    daisRim.position.y = 0.52;
    loom.add(daisRim);

    // Two crystal pylons leaning together, joined by an arc — the frame.
    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 8.5, 6), crystal);
      pylon.position.set(side * 3.4, 4.5, 0);
      pylon.rotation.z = side * -0.18;
      loom.add(pylon);
    }
    const crown = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.22, 8, 32, Math.PI), crystal);
    crown.position.y = 8.4;
    loom.add(crown);

    // Vertical warp threads strung inside the frame (one instanced mesh).
    const warpGeo = new THREE.CylinderGeometry(0.02, 0.02, 7.4, 4, 1, true);
    const warpMat = new THREE.MeshBasicMaterial({
      color: 0xffe9b0,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const WARPS = 9;
    const warps = new THREE.InstancedMesh(warpGeo, warpMat, WARPS);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < WARPS; i++) {
      dummy.position.set(-2.8 + (i / (WARPS - 1)) * 5.6, 4.5, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      warps.setMatrixAt(i, dummy.matrix);
    }
    warps.instanceMatrix.needsUpdate = true;
    loom.add(warps);

    // The half-woven dream shimmering between the threads.
    const weaveMat = new THREE.MeshBasicMaterial({
      color: 0x9be8d8,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const weave = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 6.8), weaveMat);
    weave.position.y = 4.4;
    loom.add(weave);

    // The Loom breathes: weave shimmer and warp glow swell together.
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        weaveMat.opacity = 0.09 + (Math.sin(elapsed * 0.6) * 0.5 + 0.5) * 0.09;
        warpMat.opacity = 0.4 + Math.sin(elapsed * 0.9 + 1.2) * 0.15;
      },
    });

    this.group.add(loom);
  }

  /** Threads of golden light converging on the Loom from every horizon. */
  private buildGoldenThreads(rand: () => number): void {
    const THREADS = 20;
    const LENGTH = 110;
    const hub = new THREE.Vector3(0, 9.5, 0); // just above the Loom's crown
    const up = new THREE.Vector3(0, 1, 0);

    const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const threads = new THREE.InstancedMesh(geo, mat, THREADS);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < THREADS; i++) {
      const az = (i / THREADS) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const el = 0.15 + rand() * 0.55; // all threads come down out of the void
      const dir = new THREE.Vector3(
        Math.cos(az) * Math.cos(el),
        Math.sin(el),
        Math.sin(az) * Math.cos(el),
      );
      const far = hub.clone().addScaledVector(dir, LENGTH);
      dummy.position.copy(hub).lerp(far, 0.5);
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.scale.set(1, LENGTH, 1);
      dummy.updateMatrix();
      threads.setMatrixAt(i, dummy.matrix);
    }
    threads.instanceMatrix.needsUpdate = true;

    const wrap = new THREE.Group();
    wrap.add(threads);
    this.group.add(wrap);

    // The whole fan of threads turns imperceptibly and pulses like slow breath.
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        wrap.rotation.y = elapsed * 0.008;
        mat.opacity = 0.24 + (Math.sin(elapsed * 0.45) * 0.5 + 0.5) * 0.12;
      },
    });
  }

  // ── The First Dreamer (procedural fallback) ────────────────────────────────

  private buildProceduralDreamer(): void {
    // A colossal sleeping figure (~40m) half-formed from starlight, seated in
    // the void beyond the platform's far edge. Simple monumental silhouette +
    // emissive seams; bloom and fog do the painterly work.
    const dreamer = new THREE.Group();
    dreamer.name = 'first-dreamer';

    const body = standardMat({
      color: 0x16113a,
      emissive: 0x241a5e,
      emissiveIntensity: 0.35,
      roughness: 0.6,
      metalness: 0.2,
      flatShading: true,
    });

    // Torso, chest and bowed head.
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), body);
    pelvis.position.y = 8;
    dreamer.add(pelvis);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 14, 12), body);
    torso.position.y = 17;
    dreamer.add(torso);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(5.5, 16, 12), body);
    chest.position.y = 23;
    dreamer.add(chest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(3.8, 16, 12), body);
    head.position.set(0, 29.5, 1.6); // bowed gently toward the platform
    head.rotation.x = 0.35;
    dreamer.add(head);

    // Shoulders and folded arms, barely suggested.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), body);
      shoulder.position.set(side * 6.2, 24.5, 0);
      dreamer.add(shoulder);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.5, 12, 8), body);
      arm.position.set(side * 4.6, 17.5, 2.2);
      arm.rotation.z = side * 0.45;
      arm.rotation.x = -0.25;
      dreamer.add(arm);
    }

    // Below the waist the figure dissolves into light — an additive skirt.
    const dissolve = new THREE.Mesh(
      new THREE.CylinderGeometry(6.5, 11, 18, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    dissolve.position.y = -1;
    dreamer.add(dissolve);

    // Emissive seams: rings of starlight banding the body.
    const seamMat = new THREE.MeshBasicMaterial({
      color: 0xffe9b0,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const seamSpecs: Array<{ r: number; y: number; rx: number }> = [
      { r: 6.6, y: 12, rx: Math.PI / 2 },
      { r: 5.9, y: 19, rx: Math.PI / 2 },
      { r: 5.2, y: 24.5, rx: Math.PI / 2 },
    ];
    for (const spec of seamSpecs) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(spec.r, 0.12, 6, 48), seamMat);
      seam.position.y = spec.y;
      seam.rotation.x = spec.rx;
      dreamer.add(seam);
    }

    // A halo behind the bowed head.
    const halo = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.18, 8, 64), seamMat);
    halo.position.set(0, 30.5, -1.5);
    halo.rotation.x = 0.35;
    dreamer.add(halo);

    // The dream-heart, glowing through the chest.
    const heartMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const heart = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), heartMat);
    heart.position.set(0, 23, 2.8);
    dreamer.add(heart);

    // Slow breath: the heart swells and the seams brighten with it.
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        const breath = Math.sin(elapsed * 0.4) * 0.5 + 0.5; // ~16s cycle
        const s = 1 + breath * 0.18;
        heart.scale.set(s, s, s);
        heartMat.opacity = 0.5 + breath * 0.35;
        seamMat.opacity = 0.4 + breath * 0.3;
      },
    });

    dreamer.position.set(0, -10, -78);
    dreamer.scale.setScalar(1.15); // ~40m from dissolve-skirt to halo
    this.group.add(dreamer);

    // Starlight condensing around the half-formed body.
    const stardust = createParticles({
      kind: 'motes',
      count: 180,
      areaRadius: 16,
      height: 46,
      yBase: 0,
      color: 0xffe9b0,
      size: 0.6,
      opacity: 0.7,
    });
    stardust.object.position.set(0, -10, -78);
    this.group.add(stardust.object);
    this.addDynamic(stardust);
  }

  // ── Orbiting glass shards ──────────────────────────────────────────────────

  private buildOrbitingShards(rand: () => number): void {
    const geo = new THREE.OctahedronGeometry(0.9, 0);
    const mat = standardMat({
      color: 0x2a2150,
      emissive: 0x4be3c3,
      emissiveIntensity: 0.4,
      roughness: 0.1,
      metalness: 0.8,
      flatShading: true,
    });
    const dummy = new THREE.Object3D();
    const wraps: THREE.Group[] = [];
    // Outer belt beyond the platform edge; inner belt high overhead.
    const belts = [
      { count: 36, rMin: 50, rMax: 68, yMin: 2, yMax: 26, speed: 0.012 },
      { count: 22, rMin: 28, rMax: 42, yMin: 18, yMax: 34, speed: -0.02 },
    ];
    for (const belt of belts) {
      const im = new THREE.InstancedMesh(geo, mat, belt.count);
      for (let i = 0; i < belt.count; i++) {
        const a = rand() * Math.PI * 2;
        const r = belt.rMin + rand() * (belt.rMax - belt.rMin);
        dummy.position.set(Math.cos(a) * r, belt.yMin + rand() * (belt.yMax - belt.yMin), Math.sin(a) * r);
        dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
        // Squashed octahedra read as panes of broken mirror-glass.
        const s = 0.5 + rand() * 1.4;
        dummy.scale.set(s, s * (1.2 + rand() * 0.6), s * 0.3);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      const wrap = new THREE.Group();
      wrap.add(im);
      this.group.add(wrap);
      wraps.push(wrap);
    }
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        wraps[0].rotation.y = elapsed * belts[0].speed;
        wraps[1].rotation.y = elapsed * belts[1].speed;
      },
    });
  }

  // ── Canonical interactables ────────────────────────────────────────────────

  private registerInteractables(): void {
    // The First Dreamer — communed with from the platform's far edge, where a
    // tendril of the colossus' starlight reaches the glass.
    this.addInteractable(
      makeEchoNpc({
        id: 'heart_dreamer',
        name: 'The First Dreamer',
        color: 0xffd27a,
        prompt: 'Reach toward the First Dreamer',
        position: [0, 0, -39],
        radius: 4.5,
      }),
    );

    // The final Loom — the ending choice begins here.
    this.addInteractable(
      makeShrine({
        id: 'heart_loom',
        prompt: 'Touch the final Loom',
        position: [0, 0, 5.8],
        radius: 5,
        color: 0xffd27a,
      }),
    );

    // Five ritual glyphs in a wide circle — the party must spread out.
    // Glyph 1 faces the Dreamer (-Z); the rest fan out evenly.
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      this.addInteractable(
        makeGlyphPlate({
          id: `heart_glyph_${i + 1}`,
          prompt: 'Kneel at the ritual glyph',
          position: [Math.cos(a) * GLYPH_RING_RADIUS, 0, Math.sin(a) * GLYPH_RING_RADIUS],
          radius: 3.5,
          color: 0xffd27a,
        }),
      );
    }

    // The way back, near the spawn edge.
    this.addInteractable(
      makePortal({
        id: 'heart_portal_sky',
        to: 'skyharbor',
        label: 'The Skyharbor',
        prompt: 'Step back beneath open sky',
        position: [7, 0, 41],
        radius: 4,
        color: 0x4be3c3,
      }),
    );
  }

  // ── Sky & particles ────────────────────────────────────────────────────────

  private buildAtmosphere(): void {
    // Star-dense void, aurora ribboning every horizon, and a warm glow rising
    // behind the Dreamer.
    const sky = createSky({
      topColor: 0x040210,
      horizonColor: 0x1d1140,
      bottomColor: 0x02010a,
      stars: true,
      aurora: true,
      auroraColor: 0x5ee8c8,
      sunGlow: { position: [0, 30, -90], color: 0xffd27a, size: 40 },
    });
    this.group.add(sky.group);
    this.addDynamic(sky);

    // Drifting starlight over the whole platform.
    const motes = createParticles({
      kind: 'motes',
      count: 220,
      areaRadius: 42,
      height: 26,
      yBase: 0.5,
      color: 0xfff3d0,
      size: 0.4,
      opacity: 0.55,
    });
    this.group.add(motes.object);
    this.addDynamic(motes);

    // Gold sparkfall raining gently around the Loom.
    const sparks = createParticles({
      kind: 'sparkfall',
      count: 140,
      areaRadius: 7,
      height: 14,
      yBase: 0,
      color: 0xffd27a,
      size: 0.4,
      opacity: 0.8,
    });
    this.group.add(sparks.object);
    this.addDynamic(sparks);
  }
}
