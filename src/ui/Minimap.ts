/**
 * src/ui/Minimap.ts
 * Bottom-left 220px circular canvas map of the current location, redrawn at
 * ~10Hz from UIManager.update. North-fixed: gold dots are interactables,
 * violet diamonds portals, archetype-colored dots visible party members, and
 * a white chevron (rotated by player yaw) marks you. World scale maps the
 * location's boundsRadius onto the canvas radius.
 */

import * as THREE from 'three';
import { LOCATION_NAMES } from '../../shared/constants';
import type { GameContext } from '../types';
import { cssColor, el } from './UIManager';

const SIZE = 220; // CSS pixels
const PADDING = 10; // keep markers off the rim

const COLOR_BG = 'rgba(13, 9, 28, 0.62)';
const COLOR_RING = 'rgba(255, 210, 122, 0.35)';
const COLOR_GRID = 'rgba(141, 123, 255, 0.14)';
const COLOR_GOLD = '#ffd27a';
const COLOR_VIOLET = '#8d7bff';

const tmpVec = new THREE.Vector3();

export class Minimap {
  private ctx: GameContext | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly c2d: CanvasRenderingContext2D | null;
  private readonly label: HTMLDivElement;
  private readonly dpr: number;
  private lastLabelLoc: string | null = null;

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
  }

  /** Full redraw; called at ~10Hz by UIManager. */
  redraw(): void {
    const game = this.ctx;
    const g = this.c2d;
    if (!game || !g) return;

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
}
