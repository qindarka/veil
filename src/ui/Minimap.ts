/**
 * src/ui/Minimap.ts
 * Bottom-left 220px circular canvas map of the current location, redrawn at
 * ~10Hz from UIManager.update. North-fixed: gold dots are interactables,
 * violet diamonds portals, archetype-colored dots visible party members, and
 * a white chevron (rotated by player yaw) marks you. Pulsing gold stars mark
 * the current objective targets (src/story/objectives.ts), expanding teal
 * rings are crew pings (G), and a gold rim chevron points at the nearest
 * objective when every target sits beyond the rim. World scale maps the
 * location's boundsRadius onto the canvas radius.
 */

import * as THREE from 'three';
import { LOCATION_NAMES } from '../../shared/constants';
import type { LocationId } from '../../shared/constants';
import { localTargets, resolveObjective } from '../story/objectives';
import type { GameContext, Vec3 } from '../types';
import { cssColor, el } from './UIManager';

const SIZE = 220; // CSS pixels
const PADDING = 10; // keep markers off the rim

const COLOR_BG = 'rgba(13, 9, 28, 0.62)';
const COLOR_RING = 'rgba(255, 210, 122, 0.35)';
const COLOR_GRID = 'rgba(141, 123, 255, 0.14)';
const COLOR_GOLD = '#ffd27a';
const COLOR_VIOLET = '#8d7bff';

/** Crew pings live this long on the map (ms). */
const PING_LIFE_MS = 8000;
/** One expand-and-fade cycle of a ping ring (ms). */
const PING_CYCLE_MS = 1400;

const tmpVec = new THREE.Vector3();

export class Minimap {
  private ctx: GameContext | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly c2d: CanvasRenderingContext2D | null;
  private readonly label: HTMLDivElement;
  private readonly dpr: number;
  private lastLabelLoc: string | null = null;
  /** Crew pings (party:marker), pruned once older than PING_LIFE_MS. */
  private pings: Array<{ p: Vec3; at: number; location: LocationId }> = [];

  constructor(parent: HTMLElement) {
    const wrap = el('div', 'minimap-wrap');
    this.canvas = el('canvas', 'minimap-canvas');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * this.dpr;
    this.canvas.height = SIZE * this.dpr;
    this.c2d = this.canvas.getContext('2d');
    this.label = el('div', 'minimap-label', '');
    wrap.appendChild(this.canvas);
    wrap.appendChild(this.label);
    parent.appendChild(wrap);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('party:marker', ({ p, location }) => {
      this.pings.push({ p, at: performance.now(), location });
    });
  }

  /** Full redraw; called at ~10Hz by UIManager. */
  redraw(): void {
    const game = this.ctx;
    const g = this.c2d;
    if (!game || !g) return;

    const now = performance.now();
    if (this.pings.length > 0) {
      this.pings = this.pings.filter((ping) => now - ping.at < PING_LIFE_MS);
    }

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const r = SIZE / 2 - 1;

    // Disc background + clip so nothing bleeds past the rim.
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = COLOR_BG;
    g.fillRect(0, 0, SIZE, SIZE);

    const location = game.world.current;
    if (location) {
      const scale = (r - PADDING) / location.boundsRadius;
      const you = game.player.position;

      // Faint concentric rings for depth.
      g.strokeStyle = COLOR_GRID;
      g.lineWidth = 1;
      for (const f of [0.33, 0.66]) {
        g.beginPath();
        g.arc(cx, cy, (r - PADDING) * f, 0, Math.PI * 2);
        g.stroke();
      }

      // World (x, z) → canvas, north(-Z) up, clamped inside the ring.
      const project = (x: number, z: number): [number, number] => {
        let px = x * scale;
        let py = z * scale;
        const d = Math.hypot(px, py);
        const max = r - PADDING;
        if (d > max) {
          px = (px / d) * max;
          py = (py / d) * max;
        }
        return [cx + px, cy + py];
      };

      // Interactables: gold dots; portals: violet diamonds. Skip attuned
      // objects the local archetype cannot sense.
      const myArchetype = game.state.you?.archetype;
      for (const it of location.interactables) {
        if (it.requiresArchetype && it.requiresArchetype !== myArchetype) continue;
        it.object.getWorldPosition(tmpVec);
        const [px, py] = project(tmpVec.x, tmpVec.z);
        if (it.kind === 'portal') {
          g.save();
          g.translate(px, py);
          g.rotate(Math.PI / 4);
          g.fillStyle = COLOR_VIOLET;
          g.shadowColor = COLOR_VIOLET;
          g.shadowBlur = 6;
          g.fillRect(-3.2, -3.2, 6.4, 6.4);
          g.restore();
        } else {
          g.fillStyle = COLOR_GOLD;
          g.shadowColor = COLOR_GOLD;
          g.shadowBlur = 5;
          g.beginPath();
          g.arc(px, py, 2.8, 0, Math.PI * 2);
          g.fill();
          g.shadowBlur = 0;
        }
      }

      // Visible party members (same location), in their archetype colors.
      for (const remote of game.remotes.getVisible()) {
        const [px, py] = project(remote.position.x, remote.position.z);
        const color = cssColor(remote.color);
        g.fillStyle = color;
        g.shadowColor = color;
        g.shadowBlur = 6;
        g.beginPath();
        g.arc(px, py, 3.4, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
      }

      // Objective guidance: a pulsing gold star on each current goal target
      // (same resolution path as the screen-space marker). When every target
      // sits beyond the rim, a rim chevron points toward the nearest instead.
      if (!game.net.offlineMode && game.state.endingId === null) {
        const portals: Array<{ id: string; to: LocationId }> = [];
        for (const it of location.interactables) {
          if (it.kind === 'portal' && it.portalTo) portals.push({ id: it.id, to: it.portalTo });
        }
        const objective = resolveObjective(game.state);
        const pulse = 0.5 + 0.5 * Math.sin(now / 240);
        let anyOnMap = false;
        let anyTarget = false;
        let nearestAngle = 0;
        let nearestDistSq = Infinity;
        for (const id of localTargets(objective, game.world.currentId, portals)) {
          const target = game.world.getInteractable(id);
          if (!target) continue;
          anyTarget = true;
          target.object.getWorldPosition(tmpVec);
          const dSq = (tmpVec.x - you.x) ** 2 + (tmpVec.z - you.z) ** 2;
          if (dSq < nearestDistSq) {
            nearestDistSq = dSq;
            nearestAngle = Math.atan2(tmpVec.z, tmpVec.x);
          }
          if (Math.hypot(tmpVec.x, tmpVec.z) * scale <= r - PADDING) {
            const [px, py] = project(tmpVec.x, tmpVec.z);
            this.drawStar(g, px, py, 4.2 + pulse * 1.8, 0.65 + 0.35 * pulse);
            anyOnMap = true;
          }
        }
        if (anyTarget && !anyOnMap) {
          this.drawRimChevron(g, cx, cy, r - PADDING, nearestAngle, 0.65 + 0.35 * pulse);
        }
      }

      // Crew pings (G): expanding, fading teal rings — same location only.
      for (const ping of this.pings) {
        if (ping.location !== game.world.currentId) continue;
        const age = now - ping.at;
        const cycle = (age % PING_CYCLE_MS) / PING_CYCLE_MS;
        const fade = 1 - age / PING_LIFE_MS;
        const [px, py] = project(ping.p[0], ping.p[2]);
        g.strokeStyle = `rgba(75, 227, 195, ${(0.9 * (1 - cycle) * fade).toFixed(3)})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(px, py, 2.5 + cycle * 12, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = `rgba(75, 227, 195, ${(0.85 * fade).toFixed(3)})`;
        g.beginPath();
        g.arc(px, py, 2, 0, Math.PI * 2);
        g.fill();
      }

      // You: white chevron rotated by yaw (map stays north-fixed). With
      // rotation.y = yaw, world forward is (-sin yaw, -cos yaw) in (x, z),
      // which equals a canvas rotation of -yaw applied to an up-pointing
      // chevron.
      const [px, py] = project(you.x, you.z);
      g.save();
      g.translate(px, py);
      g.rotate(-game.player.yaw);
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(255, 255, 255, 0.9)';
      g.shadowBlur = 8;
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2.4);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.restore();
    }

    g.restore();

    // Rim ring + north marker (drawn unclipped so they stay crisp).
    g.strokeStyle = COLOR_RING;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = COLOR_RING;
    g.font = '9px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('N', cx, 11);

    // Location display name beneath the disc (only touch the DOM on change).
    const id = game.world.currentId;
    if (id !== this.lastLabelLoc) {
      this.lastLabelLoc = id;
      this.label.textContent = id ? LOCATION_NAMES[id] : '';
    }
  }

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  /** Four-point sparkle star with a soft gold glow. */
  private drawStar(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    alpha: number,
  ): void {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = COLOR_GOLD;
    g.shadowColor = COLOR_GOLD;
    g.shadowBlur = 9;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const spoke = i % 2 === 0 ? radius : radius * 0.42;
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const px = x + Math.cos(a) * spoke;
      const py = y + Math.sin(a) * spoke;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.restore();
  }

  /** Gold chevron on the rim pointing outward along `angle` (canvas radians). */
  private drawRimChevron(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    alpha: number,
  ): void {
    g.save();
    g.globalAlpha = alpha;
    g.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    g.rotate(angle + Math.PI / 2); // chevron path points "up"; aim it outward
    g.fillStyle = COLOR_GOLD;
    g.shadowColor = COLOR_GOLD;
    g.shadowBlur = 8;
    g.beginPath();
    g.moveTo(0, -6.5);
    g.lineTo(5, 3);
    g.lineTo(0, 0.6);
    g.lineTo(-5, 3);
    g.closePath();
    g.fill();
    g.restore();
  }
}
