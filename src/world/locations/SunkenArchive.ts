/**
 * src/world/locations/SunkenArchive.ts
 * The Sunken Archive — an Act 2 Echo location. A drowned marble library on
 * the seabed, lit by god-rays slanting from an unseen surface. Dream-logic
 * underwater: players walk the floor normally while bubbles rise, kelp sways
 * and plankton motes drift. The great Orrery turns at the heart of the hall;
 * three glyph wings radiate outward; Thessaly the Archivist still keeps her
 * reading desk.
 *
 * Terrain contract: getGroundHeight() is the analytic source of truth and the
 * visual seabed mesh is displaced from the very same function.
 */

import * as THREE from 'three';
import type { LocationId, MusicMood } from '../../../shared/constants';
import type { EnvironmentSettings, GameContext, Vec3 } from '../../types';
import { LocationBase } from '../LocationBase';
import {
  seededRandom,
  standardMat,
  createRuinColumn,
  createRuinArch,
  createLightShaft,
  createWaterPlane,
  createRock,
} from '../builders';
import { createParticles } from '../Particles';
import { createSky } from '../Sky';
import {
  makePortal,
  makeGlyphPlate,
  makeEchoNpc,
  makeLoreObject,
  makeShrine,
} from '../Interactables';
import { tryLoadModel } from '../../core/AssetLoader';

// ── Terrain (module scope so spawn/interactables can sample it) ─────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth01(t: number): number {
  const s = clamp01(t);
  return s * s * (3 - 2 * s);
}

/**
 * Analytic seabed: perfectly flat marble floor in the central hall (r < 16),
 * easing into gentle sand dunes farther out.
 */
function archiveGround(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const f = smooth01((d - 16) / 14);
  if (f <= 0) return 0;
  const ripple =
    0.55 * Math.sin(x * 0.18) * Math.cos(z * 0.16) + 0.3 * Math.sin((x + z) * 0.09 + 1.7);
  return ripple * f;
}

/** The three library wings radiate at these angles (spawn corridor at +Z stays clear). */
const WING_ANGLES = [Math.PI / 6, (5 * Math.PI) / 6, (3 * Math.PI) / 2];
const WING_DIST = 30;

// ── Location ─────────────────────────────────────────────────────────────────

export class SunkenArchive extends LocationBase {
  readonly id: LocationId = 'sunken-archive';
  override readonly boundsRadius: number = 55;
  override readonly defaultMood: MusicMood = 'exploration';

  /** Arrive at the drowned threshold south of the hall, facing the Orrery (-Z). */
  readonly spawn = { position: [0, archiveGround(0, 36), 36] as Vec3, yaw: 0 };

  readonly environment: EnvironmentSettings = {
    background: 0x062831,
    fogColor: 0x0d3c46,
    fogDensity: 0.021, // dense blue-green "water"
    ambientColor: 0x2f6f78,
    ambientIntensity: 0.8,
    sunColor: 0xaef0e6,
    sunIntensity: 1.35,
    sunPosition: [0.25, 0.9, 0.1],
    fillColor: 0x125260,
    fillIntensity: 0.6,
    bloomStrength: 1.05,
    bloomRadius: 0.8,
    bloomThreshold: 0.25,
    exposure: 1.05,
  };

  override getGroundHeight(x: number, z: number): number {
    return archiveGround(x, z);
  }

  protected async buildScene(
    _ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void> {
    const rand = seededRandom(0xa2c41e);
    onProgress(0.05);

    this.buildSeabed();
    this.buildMarbleFloor();
    onProgress(0.2);

    // Hero set-piece: the great Orrery. Asset swap point — falls back to a
    // procedural rotating ring machine.
    const orrery = await tryLoadModel('archive_orrery');
    if (orrery) {
      orrery.position.set(0, 0, 0);
      this.group.add(orrery);
      this.addDynamic({
        update: (_dt: number, elapsed: number) => {
          orrery.rotation.y = elapsed * 0.08;
        },
      });
    } else {
      this.buildProceduralOrrery();
    }
    onProgress(0.4);

    this.buildColonnade();
    this.buildWings(rand);
    this.buildReadingDesk();
    this.buildMemoryPool();
    this.buildPearlCage();
    this.buildSealedFolio();
    onProgress(0.6);

    this.buildKelp(rand);
    this.buildBooks(rand);
    onProgress(0.75);

    this.registerInteractables();
    onProgress(0.85);

    this.buildAtmosphere();
    onProgress(0.95);
  }

  // ── Seabed & floor ─────────────────────────────────────────────────────────

  private buildSeabed(): void {
    const geo = new THREE.PlaneGeometry(130, 130, 150, 150);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const rand = seededRandom(417);

    const cSand = new THREE.Color(0x6e8f8a); // teal-bleached sand
    const cDeep = new THREE.Color(0x254b50); // darker water-shadow at distance
    const cCrest = new THREE.Color(0x8fb2a5); // dune crests catch the surface light
    const cAlgae = new THREE.Color(0x3e7a5a);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = archiveGround(x, z);
      pos.setY(i, y);

      const d = Math.hypot(x, z);
      tmp.copy(cSand).lerp(cDeep, smooth01((d - 20) / 34));
      tmp.lerp(cCrest, clamp01(y / 0.8) * 0.6);
      // Mottled algae patches via deterministic jitter.
      const algae = rand();
      if (algae > 0.82) tmp.lerp(cAlgae, (algae - 0.82) * 2.5);
      const j = (rand() - 0.5) * 0.05;
      colors[i * 3] = clamp01(tmp.r + j);
      colors[i * 3 + 1] = clamp01(tmp.g + j);
      colors[i * 3 + 2] = clamp01(tmp.b + j);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const seabed = new THREE.Mesh(
      geo,
      standardMat({ vertexColors: true, roughness: 0.85, metalness: 0.05, flatShading: true }),
    );
    seabed.name = 'archive-seabed';
    this.group.add(seabed);
  }

  private buildMarbleFloor(): void {
    // The hall's intact marble floor, just proud of the flat seabed center.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(17, 48),
      standardMat({ color: 0xd8e4e6, roughness: 0.4, metalness: 0.1, flatShading: true }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    this.group.add(floor);

    // Mosaic seam glowing faintly along the floor's rim.
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(16, 0.08, 8, 96),
      new THREE.MeshBasicMaterial({
        color: 0x4be3c3,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    seam.rotation.x = Math.PI / 2;
    seam.position.y = 0.06;
    this.group.add(seam);
  }

  // ── The great Orrery (procedural fallback) ─────────────────────────────────

  private buildProceduralOrrery(): void {
    const orrery = new THREE.Group();
    orrery.name = 'great-orrery';

    const marble = standardMat({ color: 0xcfdcdd, roughness: 0.4, metalness: 0.15, flatShading: true });
    const brass = standardMat({
      color: 0xd8c9a0,
      emissive: 0xffd27a,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.8,
    });

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 1.1, 18), marble);
    pedestal.position.y = 0.55;
    orrery.add(pedestal);

    // The dream-sun at the machine's heart.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 20, 14),
      standardMat({ color: 0xffe9b0, emissive: 0xffd27a, emissiveIntensity: 1.4, roughness: 0.3 }),
    );
    core.position.y = 3.0;
    orrery.add(core);

    // Three nested rings, each carrying a small "world", spinning at its own pace.
    const ringSpecs = [
      { r: 2.0, tiltX: 0.35, tiltZ: 0.1, planet: 0x4be3c3, speed: 0.35 },
      { r: 2.9, tiltX: -0.2, tiltZ: 0.4, planet: 0xff6ec7, speed: -0.22 },
      { r: 3.8, tiltX: 0.55, tiltZ: -0.25, planet: 0x8d7bff, speed: 0.14 },
    ];
    const ringMeshes: Array<{ mesh: THREE.Mesh; speed: number }> = [];
    for (const spec of ringSpecs) {
      const pivot = new THREE.Group();
      pivot.position.y = 3.0;
      pivot.rotation.x = Math.PI / 2 + spec.tiltX; // lay the torus roughly flat, then tilt
      pivot.rotation.z = spec.tiltZ;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(spec.r, 0.06, 8, 64), brass);
      // A little glowing world riding the ring; spinning the ring's local Z
      // carries it around the circle.
      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 8),
        standardMat({ color: 0xffffff, emissive: spec.planet, emissiveIntensity: 1.2 }),
      );
      planet.position.set(spec.r, 0, 0);
      ring.add(planet);
      pivot.add(ring);
      orrery.add(pivot);
      ringMeshes.push({ mesh: ring, speed: spec.speed });
    }
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        for (const r of ringMeshes) r.mesh.rotation.z = elapsed * r.speed;
      },
    });

    this.group.add(orrery);

    // A god-ray falls square on the machine.
    const shaft = createLightShaft({
      color: 0xbdf3ff,
      height: 42,
      radiusTop: 1.5,
      radiusBottom: 6,
      opacity: 0.13,
    });
    // The builder's beam is base-origin: it spans y 0..height from where it sits.
    shaft.position.set(0, 0, 0);
    this.group.add(shaft);
  }

  // ── Architecture ───────────────────────────────────────────────────────────

  private buildColonnade(): void {
    // Circular colonnade around the hall; every third column has toppled.
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.PI / 12;
      const x = Math.cos(a) * 14;
      const z = Math.sin(a) * 14;
      const col = createRuinColumn({
        height: 7,
        radius: 0.5,
        color: 0xc7d6d8,
        broken: i % 3 === 0,
        seed: 100 + i,
      });
      col.position.set(x, archiveGround(x, z), z);
      this.group.add(col);
    }

    // An arch over each wing entrance, facing the hall.
    for (const angle of WING_ANGLES) {
      const x = Math.cos(angle) * 17;
      const z = Math.sin(angle) * 17;
      const arch = createRuinArch({ width: 5.5, height: 6.5, color: 0xc7d6d8, seed: 7 });
      arch.position.set(x, archiveGround(x, z), z);
      // Orient the arch's span perpendicular to the radial direction.
      arch.rotation.y = -(angle + Math.PI / 2);
      this.group.add(arch);
    }
  }

  private buildWings(rand: () => number): void {
    const shelfMat = standardMat({ color: 0x8fa6a8, roughness: 0.7, metalness: 0.05, flatShading: true });

    for (const [w, angle] of WING_ANGLES.entries()) {
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const latX = -dirZ;
      const latZ = dirX;
      const wcx = dirX * WING_DIST;
      const wcz = dirZ * WING_DIST;

      // Flanking columns along the approach to each wing.
      for (const side of [-1, 1]) {
        const x = dirX * 22 + latX * side * 4.5;
        const z = dirZ * 22 + latZ * side * 4.5;
        const col = createRuinColumn({
          height: 6,
          radius: 0.45,
          color: 0xc7d6d8,
          broken: side > 0,
          seed: 200 + w * 2 + side,
        });
        col.position.set(x, archiveGround(x, z), z);
        this.group.add(col);
      }

      // Toppled shelves, leaning and half-sunk in the sand.
      for (let s = 0; s < 4; s++) {
        const along = -1 + rand() * 7;
        const side = (s % 2 === 0 ? -1 : 1) * (3.5 + rand() * 1.5);
        const x = wcx + dirX * along + latX * side;
        const z = wcz + dirZ * along + latZ * side;
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.0, 0.6), shelfMat);
        shelf.position.set(x, archiveGround(x, z) + 1.6, z);
        shelf.rotation.y = -angle + (rand() - 0.5) * 0.6;
        shelf.rotation.z = (rand() - 0.5) * 1.1; // some upright, some collapsed
        this.group.add(shelf);
      }

      // A weathered rock or two for seabed texture.
      const rx = wcx + latX * (rand() * 8 - 4) + dirX * 6;
      const rz = wcz + latZ * (rand() * 8 - 4) + dirZ * 6;
      const rock = createRock({ size: 0.8 + rand() * 1.2, color: 0x4a6a66, seed: 600 + w });
      rock.position.set(rx, archiveGround(rx, rz), rz);
      this.group.add(rock);
    }
  }

  private buildReadingDesk(): void {
    // Thessaly's reading desk — still standing, still tended.
    const desk = new THREE.Group();
    desk.name = 'reading-desk';
    const wood = standardMat({ color: 0x5e6e72, roughness: 0.7, metalness: 0.05, flatShading: true });
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.7), wood);
      leg.position.set(side * 0.8, 0.5, 0);
      desk.add(leg);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.0), wood);
    top.position.y = 1.06;
    top.rotation.x = -0.22; // slanted lectern surface
    desk.add(top);
    // An open tome glowing with patient blue script.
    const pageMat = standardMat({
      color: 0xeef6f8,
      emissive: 0x7ab8ff,
      emissiveIntensity: 0.7,
      roughness: 0.6,
    });
    for (const side of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.6), pageMat);
      page.position.set(side * 0.22, 1.18, 0.02);
      page.rotation.x = -0.22;
      page.rotation.z = side * 0.1;
      desk.add(page);
    }
    desk.position.set(7, archiveGround(7, -5), -5);
    desk.rotation.y = 0.8;
    this.group.add(desk);
  }

  private buildMemoryPool(): void {
    // A side chapel holding a basin of luminous remembered water.
    const px = -22.5;
    const pz = -13;
    const py = archiveGround(px, pz);

    const chapel = new THREE.Group();
    chapel.name = 'memory-pool';
    const marble = standardMat({ color: 0xcfdcdd, roughness: 0.45, metalness: 0.1, flatShading: true });

    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.8, 0.8, 24), marble);
    basin.position.y = 0.4;
    chapel.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.16, 8, 32), marble);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.84;
    chapel.add(rim);

    // The water itself — glowing from below, alive.
    const water = createWaterPlane({ size: 3.2, color: 0x9be8ff, deepColor: 0x14756e, opacity: 0.9 });
    water.mesh.position.y = 0.78;
    chapel.add(water.mesh);
    this.addDynamic(water);

    // Soft halo above the pool.
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({
        color: 0x9be8ff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.6;
    chapel.add(halo);

    // Four small columns marking the chapel corners.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const col = createRuinColumn({
        height: 4.5,
        radius: 0.35,
        color: 0xc7d6d8,
        broken: i === 2,
        seed: 800 + i,
      });
      col.position.set(Math.cos(a) * 4.5, 0, Math.sin(a) * 4.5);
      chapel.add(col);
    }

    chapel.position.set(px, py, pz);
    this.group.add(chapel);
  }

  /** A whisper of the deep, caged in pearl — only a Tidecaller hears it. */
  private buildPearlCage(): void {
    const cage = new THREE.Group();
    cage.name = 'pearl-cage';
    const marble = standardMat({ color: 0xb9cccd, roughness: 0.5, metalness: 0.1, flatShading: true });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.1, 10), marble);
    pedestal.position.y = 0.55;
    cage.add(pedestal);

    const pearl = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 18, 12),
      standardMat({ color: 0xfff4f6, emissive: 0xffd9e8, emissiveIntensity: 1.1, roughness: 0.2 }),
    );
    pearl.position.y = 1.6;
    cage.add(pearl);

    // Dome of slender half-circle ribs arching over the pearl. A torus arc of
    // π in the XY plane is already a vertical half-ring; spinning each rib
    // around Y fans them into a cage.
    const barMat = standardMat({ color: 0xd8c9a0, roughness: 0.4, metalness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 6, 24, Math.PI), barMat);
      bar.position.y = 1.6;
      bar.rotation.y = (i / 4) * Math.PI;
      cage.add(bar);
    }

    // The pearl breathes light, slowly, like a held whisper.
    this.addDynamic({
      update: (_dt: number, elapsed: number) => {
        (pearl.material as THREE.MeshStandardMaterial).emissiveIntensity =
          0.9 + Math.sin(elapsed * 0.9) * 0.35;
      },
    });

    cage.position.set(3, archiveGround(3, -39), -39);
    this.group.add(cage);
  }

  /** A folio sealed in dream-script — legible only to a Chronicler. */
  private buildSealedFolio(): void {
    const lectern = new THREE.Group();
    lectern.name = 'sealed-folio';
    const marble = standardMat({ color: 0xb9cccd, roughness: 0.5, metalness: 0.1, flatShading: true });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.2, 8), marble);
    post.position.y = 0.6;
    lectern.add(post);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.7), marble);
    slab.position.y = 1.25;
    slab.rotation.x = -0.35;
    lectern.add(slab);
    // The folio itself: shut tight, script crawling faintly across the cover.
    const folio = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.12, 0.45),
      standardMat({
        color: 0x24404f,
        emissive: 0x7ab8ff,
        emissiveIntensity: 0.55,
        roughness: 0.55,
        flatShading: true,
      }),
    );
    folio.position.y = 1.36;
    folio.rotation.x = -0.35;
    lectern.add(folio);
    lectern.position.set(-29, archiveGround(-29, 18.5), 18.5);
    lectern.rotation.y = -0.5;
    this.group.add(lectern);
  }

  // ── Kelp & books (instanced) ───────────────────────────────────────────────

  private buildKelp(rand: () => number): void {
    const KELP_COUNT = 70;
    const geo = new THREE.PlaneGeometry(0.55, 4.4, 1, 6);
    geo.translate(0, 2.2, 0); // pivot at the blade's base so it can sway from the floor
    const mat = standardMat({
      color: 0x2e8f6a,
      emissive: 0x174f3a,
      emissiveIntensity: 0.25,
      roughness: 0.8,
      flatShading: true,
    });
    mat.side = THREE.DoubleSide;
    const kelp = new THREE.InstancedMesh(geo, mat, KELP_COUNT);

    // Static placement data + per-blade sway phase.
    const blades: Array<{ x: number; y: number; z: number; yaw: number; scale: number; phase: number }> = [];
    let placed = 0;
    while (placed < KELP_COUNT) {
      const a = rand() * Math.PI * 2;
      const r = 24 + rand() * 26;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Keep wing glyph approaches and the spawn corridor readable.
      const nearWing = WING_ANGLES.some((wa) => {
        const wx = Math.cos(wa) * 33;
        const wz = Math.sin(wa) * 33;
        return Math.hypot(x - wx, z - wz) < 6;
      });
      if (nearWing || (Math.abs(x) < 5 && z > 24)) continue;
      blades.push({
        x,
        y: archiveGround(x, z),
        z,
        yaw: rand() * Math.PI * 2,
        scale: 0.7 + rand() * 0.8,
        phase: rand() * Math.PI * 2,
      });
      placed++;
    }

    // Per-frame sway: 70 matrix compositions — cheap, one draw call.
    const dummy = new THREE.Object3D();
    const sway = {
      update: (_dt: number, elapsed: number) => {
        for (let i = 0; i < blades.length; i++) {
          const b = blades[i];
          dummy.position.set(b.x, b.y, b.z);
          dummy.rotation.set(
            Math.sin(elapsed * 0.6 + b.phase * 1.3) * 0.06,
            b.yaw,
            Math.sin(elapsed * 0.8 + b.phase) * 0.13,
          );
          dummy.scale.set(b.scale, b.scale, b.scale);
          dummy.updateMatrix();
          kelp.setMatrixAt(i, dummy.matrix);
        }
        kelp.instanceMatrix.needsUpdate = true;
      },
    };
    sway.update(0, 0);
    this.addDynamic(sway);
    this.group.add(kelp);
  }

  private buildBooks(rand: () => number): void {
    // Heaps of glowing books spilled from the toppled shelves.
    const BOOK_COUNT = 150;
    const geo = new THREE.BoxGeometry(0.42, 0.1, 0.3);
    const mat = standardMat({
      color: 0xffffff, // per-instance tint below
      emissive: 0xffd27a,
      emissiveIntensity: 0.4,
      roughness: 0.6,
      flatShading: true,
    });
    const books = new THREE.InstancedMesh(geo, mat, BOOK_COUNT);

    // Heap centers: two per wing plus two in the hall.
    const heaps: Array<[number, number]> = [];
    for (const angle of WING_ANGLES) {
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      heaps.push([dirX * 28 - dirZ * 3, dirZ * 28 + dirX * 3]);
      heaps.push([dirX * 32 + dirZ * 4, dirZ * 32 - dirX * 4]);
    }
    heaps.push([10, 3], [-8, -9]);

    const palette = [
      new THREE.Color(0xffd27a),
      new THREE.Color(0x4be3c3),
      new THREE.Color(0xc89bff),
      new THREE.Color(0xfff3d0),
    ];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < BOOK_COUNT; i++) {
      const [hx, hz] = heaps[i % heaps.length];
      const ox = (rand() - 0.5) * 3.2;
      const oz = (rand() - 0.5) * 3.2;
      const x = hx + ox;
      const z = hz + oz;
      // Pile higher near the heap center.
      const pile = Math.max(0, 1 - Math.hypot(ox, oz) / 2.2);
      dummy.position.set(x, archiveGround(x, z) + 0.06 + rand() * 0.5 * pile, z);
      dummy.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5);
      const s = 0.8 + rand() * 0.6;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      books.setMatrixAt(i, dummy.matrix);
      books.setColorAt(i, palette[Math.floor(rand() * palette.length)]);
    }
    books.instanceMatrix.needsUpdate = true;
    if (books.instanceColor) books.instanceColor.needsUpdate = true;
    this.group.add(books);
  }

  // ── Canonical interactables ────────────────────────────────────────────────

  private registerInteractables(): void {
    const g = archiveGround;

    // Thessaly, the Archivist — an azure Echo at her reading desk.
    this.addInteractable(
      makeEchoNpc({
        id: 'arc_echo_thessaly',
        name: 'Thessaly, the Archivist',
        color: 0x7ab8ff,
        prompt: 'Speak with Thessaly, the Archivist',
        position: [8.6, g(8.6, -6.6), -6.6],
        radius: 4,
      }),
    );

    // Three glyphs, one at the end of each wing — the co-op ritual.
    const glyphPrompts = [
      'Trace the drowned glyph of the east wing',
      'Trace the drowned glyph of the west wing',
      'Trace the drowned glyph of the far wing',
    ];
    WING_ANGLES.forEach((angle, i) => {
      const x = Math.cos(angle) * 33.5;
      const z = Math.sin(angle) * 33.5;
      this.addInteractable(
        makeGlyphPlate({
          id: `arc_glyph_${i + 1}`,
          prompt: glyphPrompts[i],
          position: [x, g(x, z), z],
          radius: 3.5,
          color: 0x4be3c3,
        }),
      );
    });

    // The Memory Pool — moral choice: read what it holds, or seal it.
    this.addInteractable(
      makeShrine({
        id: 'arc_memory_pool',
        prompt: 'Gaze into the Memory Pool',
        position: [-20.2, g(-20.2, -11), -11],
        radius: 4.5,
        color: 0x9be8ff,
      }),
    );

    // Lore.
    this.addInteractable(
      makeLoreObject({
        id: 'arc_lore_tablet',
        loreKind: 'tablet',
        prompt: 'Read the barnacled tablet',
        position: [6, g(6, 26), 26],
        radius: 3.5,
        color: 0x7ab8ff,
      }),
    );
    this.addInteractable(
      makeLoreObject({
        id: 'arc_lore_orrery',
        loreKind: 'orrery',
        prompt: 'Study the great Orrery',
        position: [0, g(0, 4.8), 4.8],
        radius: 4.5,
        color: 0xffd27a,
      }),
    );

    // Portal home.
    this.addInteractable(
      makePortal({
        id: 'arc_portal_sky',
        to: 'skyharbor',
        label: 'The Skyharbor',
        prompt: 'Rise back to the Skyharbor',
        position: [0, g(0, 42), 42],
        radius: 4,
        color: 0xffd27a,
      }),
    );

    // Archetype secrets.
    this.addInteractable(
      makeShrine({
        id: 'arc_hidden_chronicler',
        prompt: 'Unseal the folio of dream-script',
        position: [-29, g(-29, 18.5), 18.5],
        radius: 3.5,
        requiresArchetype: 'chronicler',
        color: 0x7ab8ff,
      }),
    );
    this.addInteractable(
      makeShrine({
        id: 'arc_hidden_tidecaller',
        prompt: 'Listen to the pearl-caged whisper',
        position: [3, g(3, -39), -39],
        radius: 3.5,
        requiresArchetype: 'tidecaller',
        color: 0x4be3c3,
      }),
    );
  }

  // ── Sky, god-rays, particles ───────────────────────────────────────────────

  private buildAtmosphere(): void {
    // The "sky" is the water column: deep teal, with aurora bands playing the
    // role of light caustics rippling on the unseen surface far above.
    const sky = createSky({
      topColor: 0x03141c,
      horizonColor: 0x0d4a52,
      bottomColor: 0x02232b,
      stars: false,
      aurora: true,
      auroraColor: 0x37e0b8,
      sunGlow: { position: [15, 80, 8], color: 0xc4f1ef, size: 34 },
    });
    this.group.add(sky.group);
    this.addDynamic(sky);

    // Parallel god-rays slanting from the surface.
    const shaftSpots: Array<[number, number, number]> = [
      [-18, 6, 44],
      [12, 18, 40],
      [24, -14, 46],
      [-8, -26, 42],
      [-32, -4, 38],
    ];
    for (const [x, z, h] of shaftSpots) {
      const shaft = createLightShaft({
        color: 0xaef0e6,
        height: h,
        radiusTop: 1.8,
        radiusBottom: 6.5,
        opacity: 0.09,
      });
      // Base-origin beam: spans y 0..height; tilting leans it from the floor up.
      shaft.position.set(x, 0, z);
      shaft.rotation.z = 0.21; // all rays share one slant, like true sunlight
      this.group.add(shaft);
    }

    // Bubbles rising everywhere.
    const bubbles = createParticles({
      kind: 'bubbles',
      count: 360,
      areaRadius: 52,
      height: 30,
      yBase: 0,
      color: 0xbdf3ff,
      size: 0.35,
      opacity: 0.5,
    });
    this.group.add(bubbles.object);
    this.addDynamic(bubbles);

    // Plankton motes drifting in the water column.
    const motes = createParticles({
      kind: 'motes',
      count: 300,
      areaRadius: 50,
      height: 22,
      yBase: 0.5,
      color: 0x9be8d8,
      size: 0.4,
      opacity: 0.45,
    });
    this.group.add(motes.object);
    this.addDynamic(motes);
  }
}
