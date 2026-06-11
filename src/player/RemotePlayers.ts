/**
 * src/player/RemotePlayers.ts
 * Avatars for the rest of the party. Builds/destroys Avatars from party
 * events, buffers the 10Hz position ticks and renders each remote player
 * INTERP_DELAY_MS in the past, interpolating position and yaw between buffered
 * samples for smooth motion. Remote avatars are only visible when they are in
 * the same location as the local player.
 */

import * as THREE from 'three';
import { ARCHETYPES } from '../../shared/archetypes';
import { INTERP_DELAY_MS } from '../../shared/constants';
import type { AnimState, LocationId } from '../../shared/constants';
import type { PlayerId, PlayerInfo, Vec3 } from '../../shared/protocol';
import type { GameContext, IRemotePlayers } from '../types';
import { Avatar } from './Avatar';

/** One buffered network sample of a remote player. */
interface Sample {
  /** Local receive time (performance.now() ms). */
  time: number;
  p: Vec3;
  ry: number;
  a: AnimState;
}

interface RemoteEntry {
  id: PlayerId;
  name: string;
  color: number;
  location: LocationId;
  avatar: Avatar;
  /** Small ring buffer of recent ticks, oldest first. */
  buffer: Sample[];
}

const MAX_BUFFER = 40; // ~4s of 10Hz ticks; plenty for the 150ms render delay

/** Interpolate angles along the shortest arc. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

export class RemotePlayers implements IRemotePlayers {
  private ctx!: GameContext;
  private readonly entries = new Map<PlayerId, RemoteEntry>();
  private readonly unsubs: Array<() => void> = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;

    this.unsubs.push(
      // Welcome doubles as reconnect: rebuild the whole roster from scratch.
      ctx.events.on('net:welcome', ({ snapshot }) => {
        this.removeAll();
        for (const p of snapshot.players) {
          // Offline players persist in the campaign but should not stand
          // around as frozen ghosts; they get an avatar when they rejoin.
          if (p.id !== snapshot.you.id && p.online) this.addPlayer(p);
        }
      }),

      ctx.events.on('party:player-joined', ({ player }) => {
        if (player.id === ctx.state.playerId) return;
        this.addPlayer(player);
        ctx.audio.sfx('player-join');
      }),

      ctx.events.on('party:player-left', ({ playerId }) => {
        if (this.removePlayer(playerId)) ctx.audio.sfx('player-leave');
      }),

      ctx.events.on('party:player-location', ({ playerId, location }) => {
        const entry = this.entries.get(playerId);
        if (!entry) return;
        entry.location = location;
        this.refreshVisibility(entry);
      }),

      // 10Hz batch: push samples into each player's ring buffer.
      ctx.events.on('net:tick', ({ players }) => {
        const now = performance.now();
        for (const t of players) {
          if (t.id === ctx.state.playerId) continue;
          const entry = this.entries.get(t.id);
          if (!entry) continue; // joins arrive via party:player-joined
          entry.buffer.push({ time: now, p: t.p, ry: t.ry, a: t.a });
          if (entry.buffer.length > MAX_BUFFER) entry.buffer.shift();
          if (t.loc !== entry.location) {
            entry.location = t.loc;
            this.refreshVisibility(entry);
          }
        }
      }),

      ctx.events.on('chat:message', ({ from, text, self }) => {
        if (!self) this.entries.get(from)?.avatar.showChatBubble(text);
      }),

      ctx.events.on('chat:emote', ({ from, emote, self }) => {
        if (!self) this.entries.get(from)?.avatar.showEmote(emote);
      }),

      ctx.events.on('settings:changed', ({ settings }) => {
        for (const entry of this.entries.values()) {
          entry.avatar.setNameTagVisible(settings.showNameTags);
        }
      }),

      // We moved: only avatars sharing the new location should be visible.
      ctx.events.on('world:travel-end', () => {
        for (const entry of this.entries.values()) this.refreshVisibility(entry);
      }),
    );
  }

  // ── Roster management ──────────────────────────────────────────────────────

  private addPlayer(p: PlayerInfo): void {
    this.removePlayer(p.id); // reconnects replace any stale avatar
    const color = ARCHETYPES[p.archetype].color;
    const avatar = new Avatar({ color, name: p.name });
    avatar.setNameTagVisible(this.ctx.state.settings.showNameTags);
    avatar.group.position.set(p.pos[0], p.pos[1], p.pos[2]);
    avatar.group.rotation.y = p.yaw;
    // Remote avatars live at the scene root so location swaps never eat them.
    this.ctx.scene.scene.add(avatar.group);
    const entry: RemoteEntry = {
      id: p.id,
      name: p.name,
      color,
      location: p.location,
      avatar,
      buffer: [{ time: performance.now(), p: [p.pos[0], p.pos[1], p.pos[2]], ry: p.yaw, a: 'idle' }],
    };
    this.entries.set(p.id, entry);
    this.refreshVisibility(entry);
  }

  private removePlayer(id: PlayerId): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.avatar.dispose(); // dispose() removes the group from the scene
    this.entries.delete(id);
    return true;
  }

  private removeAll(): void {
    for (const id of [...this.entries.keys()]) this.removePlayer(id);
  }

  private refreshVisibility(entry: RemoteEntry): void {
    entry.avatar.group.visible = entry.location === this.ctx.world.currentId;
  }

  // ── Per-frame interpolation ────────────────────────────────────────────────

  update(dt: number, elapsed: number): void {
    // Render the past so there is always a newer sample to interpolate toward.
    const renderTime = performance.now() - INTERP_DELAY_MS;

    for (const entry of this.entries.values()) {
      const buf = entry.buffer;
      // Drop samples that are now older than the segment we render, always
      // keeping two so an interpolation pair remains available.
      while (buf.length > 2 && buf[1].time <= renderTime) buf.shift();
      if (!entry.avatar.group.visible || buf.length === 0) continue;

      let x: number;
      let z: number;
      let ry: number;
      let anim: AnimState;
      if (buf.length === 1 || renderTime <= buf[0].time) {
        // Only one sample, or we are behind the buffer: hold the oldest.
        const s = buf[0];
        x = s.p[0];
        z = s.p[2];
        ry = s.ry;
        anim = s.a;
      } else if (renderTime >= buf[buf.length - 1].time) {
        // Network stall: hold the newest sample until fresh ticks arrive.
        const s = buf[buf.length - 1];
        x = s.p[0];
        z = s.p[2];
        ry = s.ry;
        anim = s.a;
      } else {
        const a = buf[0];
        const b = buf[1];
        const t = (renderTime - a.time) / (b.time - a.time);
        x = a.p[0] + (b.p[0] - a.p[0]) * t;
        z = a.p[2] + (b.p[2] - a.p[2]) * t;
        ry = lerpAngle(a.ry, b.ry, t);
        anim = b.a; // anim comes from the newer sample
      }

      // Glue y to the local terrain rather than trusting the network y; both
      // clients share identical procedural ground, so this just removes jitter.
      const y = this.ctx.world.getGroundHeight(x, z);
      entry.avatar.group.position.set(x, y, z);
      entry.avatar.group.rotation.y = ry;
      entry.avatar.setAnim(anim);
      entry.avatar.update(dt, elapsed);
    }
  }

  // ── IRemotePlayers ─────────────────────────────────────────────────────────

  getVisible(): Array<{ id: PlayerId; name: string; color: number; position: THREE.Vector3 }> {
    const out: Array<{ id: PlayerId; name: string; color: number; position: THREE.Vector3 }> = [];
    for (const entry of this.entries.values()) {
      if (!entry.avatar.group.visible) continue;
      out.push({
        id: entry.id,
        name: entry.name,
        color: entry.color,
        position: entry.avatar.group.position.clone(),
      });
    }
    return out;
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.removeAll();
  }
}
