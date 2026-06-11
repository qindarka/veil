/**
 * src/world/WorldManager.ts
 * Registry of the six dream-world locations, the travel flow (loading veil,
 * environment swap, spawn teleport, server notify), proximity queries for the
 * interaction system, and temporary random-event particle overlays.
 * Locations are instantiated lazily on first travel and cached forever after
 * their first build, so revisits are instant.
 */

import * as THREE from 'three';
import { LOCATION_NAMES } from '../../shared/constants';
import type { LocationId } from '../../shared/constants';
import type {
  GameContext,
  ILocation,
  Interactable,
  IWorldManager,
  Vec3,
} from '../types';
import { Beacons } from './Beacons';
import { createLightShaft } from './builders';
import { createParticles } from './Particles';
import type { ParticleKind, ParticleSystem } from './Particles';
import { Skyharbor } from './locations/Skyharbor';
import { WanderingWood } from './locations/WanderingWood';
import { Mirrormere } from './locations/Mirrormere';
import { Caelis } from './locations/Caelis';
import { SunkenArchive } from './locations/SunkenArchive';
import { HeartOfVeil } from './locations/HeartOfVeil';

/** Class registry — constructed lazily so only visited locations cost memory. */
const REGISTRY: Record<LocationId, new () => ILocation> = {
  'skyharbor': Skyharbor,
  'caelis': Caelis,
  'sunken-archive': SunkenArchive,
  'wandering-wood': WanderingWood,
  'mirrormere': Mirrormere,
  'heart-of-the-veil': HeartOfVeil,
};

/** Players spawn on a ring around the spawn point so they don't stack. */
const SPAWN_RING_RADIUS = 1.5;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TMP_VEC = new THREE.Vector3();

interface FxOverlay {
  sys: ParticleSystem;
  remaining: number;
  total: number;
}

export class WorldManager implements IWorldManager {
  private ctx!: GameContext;
  private readonly instances = new Map<LocationId, ILocation>();
  private readonly builtIds = new Set<LocationId>();
  private _current: ILocation | null = null;
  private _currentId: LocationId | null = null;
  private traveling = false;
  /** Temporary random-event particle overlays (see onRandomEvent). */
  private overlays: FxOverlay[] = [];
  /** Golden objective-guidance pillars (src/story/objectives.ts). */
  private readonly beacons = new Beacons();
  /** Short-lived crew-ping pillars (party:marker). */
  private pings: Array<{
    group: THREE.Group;
    shaftMat: THREE.MeshBasicMaterial;
    ringMat: THREE.MeshBasicMaterial;
    ring: THREE.Mesh;
    remaining: number;
  }> = [];

  get currentId(): LocationId | null {
    return this._currentId;
  }

  get current(): ILocation | null {
    return this._current;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('interact:request', ({ objectId }) => this.handleInteract(objectId));
    ctx.events.on('event:random', ({ event }) => {
      this.onRandomEvent(event.fx, event.location, event.durationMs);
    });
    // Objective guidance beacons follow the campaign state: anything that can
    // move the golden path re-resolves them.
    const refreshBeacons = () => this.beacons.refresh(this.ctx, this._current);
    ctx.events.on('story:flags', refreshBeacons);
    ctx.events.on('locations:unlocked', refreshBeacons);
    ctx.events.on('world:travel-end', refreshBeacons);
    ctx.events.on('net:welcome', refreshBeacons);
    ctx.events.on('story:ending', refreshBeacons);
    ctx.events.on('party:marker', ({ p, location }) => {
      if (location === this._currentId) this.spawnPing(p);
    });
  }

  /** Teal "come here" pillar + expanding ground ring, fading over ~8s. */
  private spawnPing(p: [number, number, number]): void {
    if (!this._current) return;
    const group = new THREE.Group();
    const shaft = createLightShaft({
      color: 0x4be3c3,
      height: 18,
      radiusTop: 0.18,
      radiusBottom: 0.8,
      opacity: 0.26,
    });
    const shaftMat = shaft.material as THREE.MeshBasicMaterial;
    group.add(shaft);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4be3c3,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);

    group.position.set(p[0], this.getGroundHeight(p[0], p[2]), p[2]);
    this._current.group.add(group);
    this.pings.push({ group, shaftMat, ringMat, ring, remaining: 8 });
    this.ctx.audio.sfx('chime');
  }

  private clearPings(): void {
    for (const ping of this.pings) {
      ping.group.parent?.remove(ping.group);
      ping.ring.geometry.dispose();
      ping.ringMat.dispose();
      ping.shaftMat.dispose();
    }
    this.pings.length = 0;
  }

  // ── Travel ─────────────────────────────────────────────────────────────────

  async travelTo(id: LocationId): Promise<void> {
    // Guard against concurrent/re-entrant travels (double-pressed portals,
    // server echoes); also no-op when already standing in the destination.
    if (this.traveling || id === this._currentId) return;
    this.traveling = true;
    const { events, scene, player, net, state, audio } = this.ctx;
    const label = LOCATION_NAMES[id];

    events.emit('world:travel-begin', { to: id });
    audio.sfx('portal');

    try {
      // Leave the old location.
      if (this._current) {
        this._current.onExit?.(this.ctx);
        scene.scene.remove(this._current.group);
      }
      this.clearOverlays(); // event fx belong to the place we just left
      this.clearPings();

      // Lazily instantiate, build once, cache forever.
      let loc = this.instances.get(id);
      if (!loc) {
        loc = new REGISTRY[id]();
        this.instances.set(id, loc);
      }
      if (!this.builtIds.has(id)) {
        events.emit('loading:progress', { progress: 0, label });
        await loc.build(this.ctx, (p) => {
          events.emit('loading:progress', { progress: THREE.MathUtils.clamp(p, 0, 1), label });
        });
        this.builtIds.add(id);
      }

      // Swap the world in.
      scene.applyEnvironment(loc.environment);
      scene.scene.add(loc.group);
      this._current = loc;
      this._currentId = id;

      // Teleport to spawn plus a deterministic ring offset per player so the
      // party fans out instead of spawning inside each other.
      const h = hashString(state.playerId ?? 'veilwalker');
      const angle = ((h % 3600) / 3600) * Math.PI * 2;
      const sx = loc.spawn.position[0] + Math.cos(angle) * SPAWN_RING_RADIUS;
      const sz = loc.spawn.position[2] + Math.sin(angle) * SPAWN_RING_RADIUS;
      const pos: Vec3 = [sx, loc.getGroundHeight(sx, sz), sz];
      player.teleport(pos, loc.spawn.yaw);

      loc.onEnter?.(this.ctx);
      net.send({ t: 'enterLocation', location: id });

      events.emit('world:travel-end', { location: id });
      events.emit('loading:done', {});

      // Only steer the soundtrack when nothing dramatic is playing — the
      // server owns tension/climax/hopeful moods.
      if (state.mood === 'ambient' || state.mood === 'exploration') {
        events.emit('audio:mood', { mood: loc.defaultMood });
      }
    } catch (err) {
      // A failed build must not strand the UI behind the loading veil.
      events.emit('loading:done', {});
      throw err;
    } finally {
      this.traveling = false;
    }
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  /**
   * Local handling of the interact key. Portals resolve entirely client-side
   * (the server re-validates enterLocation); everything else goes to the
   * StoryDirector.
   */
  private handleInteract(objectId: string): void {
    if (this.traveling) return;
    const { net, ui, audio, state } = this.ctx;
    const it = this.getInteractable(objectId);

    if (it && it.kind === 'portal' && it.portalTo) {
      const to = it.portalTo;
      if (state.isUnlocked(to)) {
        void this.travelTo(to);
      } else {
        ui.toast(
          `The way to ${LOCATION_NAMES[to]} is sealed — the Veil has not yet opened this path.`,
          'gold',
        );
        audio.sfx('denied');
      }
      return;
    }

    // Non-portal (or unknown id — let the server be the judge).
    net.send({ t: 'interact', objectId });
    audio.sfx('interact');
  }

  findNearestInteractable(pos: THREE.Vector3): Interactable | null {
    if (this.traveling || !this._current) return null;
    const archetype = this.ctx.state.you?.archetype;
    let best: Interactable | null = null;
    let bestDist = Infinity;
    for (const it of this._current.interactables) {
      // Archetype-attuned objects are invisible to everyone else.
      if (it.requiresArchetype && it.requiresArchetype !== archetype) continue;
      const d = it.object.getWorldPosition(TMP_VEC).distanceTo(pos);
      if (d <= it.radius && d < bestDist) {
        bestDist = d;
        best = it;
      }
    }
    return best;
  }

  getInteractable(id: string): Interactable | null {
    if (!this._current) return null;
    return this._current.interactables.find((it) => it.id === id) ?? null;
  }

  // ── Terrain queries ────────────────────────────────────────────────────────

  getGroundHeight(x: number, z: number): number {
    return this._current ? this._current.getGroundHeight(x, z) : 0;
  }

  clampToBounds(pos: THREE.Vector3): void {
    if (!this._current) return;
    const r = this._current.boundsRadius;
    const d = Math.hypot(pos.x, pos.z);
    if (d > r) {
      const s = r / d;
      pos.x *= s;
      pos.z *= s;
    }
    // Locations with voids (floating islands, bridges) additionally pull the
    // position back onto an actual walkable surface.
    this._current.constrainPosition?.(pos);
  }

  // ── Random-event fx overlays ───────────────────────────────────────────────

  /**
   * Every fx kind gets the same simple treatment — a temporary particle
   * overlay around the player (sparkfall uses streaks, everything else gets
   * tinted motes). Deliberately minimal: the event toast/journal carries the
   * narrative weight; this just makes the air shimmer for the duration.
   */
  private onRandomEvent(
    fx: 'motes' | 'aurora' | 'hush' | 'sparkfall' | 'none' | undefined,
    location: LocationId | null,
    durationMs: number,
  ): void {
    if (!fx || fx === 'none') return;
    if (location !== null && location !== this._currentId) return;
    if (!this._current) return;

    let kind: ParticleKind = 'motes';
    let color = 0xffd27a;
    switch (fx) {
      case 'sparkfall':
        kind = 'sparkfall';
        color = 0xffe9a8;
        break;
      case 'aurora':
        color = 0x4be3c3;
        break;
      case 'hush':
        color = 0x8d7bff;
        break;
      case 'motes':
        color = 0xffd27a;
        break;
    }

    const sys = createParticles({
      kind,
      count: 700,
      areaRadius: 18,
      height: 16,
      color,
      size: 0.24,
      opacity: 0.9,
    });
    const p = this.ctx.player.position;
    sys.object.position.set(p.x, this.getGroundHeight(p.x, p.z), p.z);
    this.ctx.scene.scene.add(sys.object);
    const total = Math.max(1, durationMs / 1000);
    this.overlays.push({ sys, remaining: total, total });
  }

  private clearOverlays(): void {
    for (const o of this.overlays) o.sys.dispose();
    this.overlays.length = 0;
  }

  // ── Frame tick ─────────────────────────────────────────────────────────────

  update(dt: number, elapsed: number): void {
    this._current?.update(dt, elapsed);
    this.beacons.update(dt, elapsed);

    // Crew pings: ring expands over the first second, everything fades out
    // across the last two.
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i];
      ping.remaining -= dt;
      if (ping.remaining <= 0) {
        ping.group.parent?.remove(ping.group);
        ping.ring.geometry.dispose();
        ping.ringMat.dispose();
        ping.shaftMat.dispose();
        this.pings.splice(i, 1);
        continue;
      }
      const age = 8 - ping.remaining;
      const grow = 1 + Math.min(age, 1) * 2.2;
      ping.ring.scale.setScalar(grow);
      const fade = Math.min(1, ping.remaining / 2);
      const pulse = 0.8 + 0.2 * Math.sin(age * 5);
      ping.shaftMat.opacity = 0.26 * fade * pulse;
      ping.ringMat.opacity = 0.5 * fade * (1 - Math.min(age, 1) * 0.5);
    }

    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const o = this.overlays[i];
      o.remaining -= dt;
      if (o.remaining <= 0) {
        o.sys.dispose();
        this.overlays.splice(i, 1);
        continue;
      }
      o.sys.update(dt, elapsed);
      // Ease in over the first half-second and out over the last second.
      const age = o.total - o.remaining;
      o.sys.setIntensity(Math.min(1, age / 0.5, o.remaining / 1.0));
    }
  }

  dispose(): void {
    this.clearOverlays();
    if (this._current) this.ctx.scene.scene.remove(this._current.group);
    for (const loc of this.instances.values()) loc.dispose();
    this.instances.clear();
    this.builtIds.clear();
    this._current = null;
    this._currentId = null;
  }
}
