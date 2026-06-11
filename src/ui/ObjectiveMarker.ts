/**
 * src/ui/ObjectiveMarker.ts
 * Screen-space goal indicator over the 3D view (HUD layer, pointer-events
 * none). Follows the current objective from src/story/objectives.ts: a
 * pulsing gold diamond with a distance readout when the nearest target is on
 * screen, or an arrow clamped to an inset screen border pointing toward it
 * when it is off screen / behind the camera. Objective resolution is
 * throttled to ~4Hz; the projection runs every frame from UIManager.update so
 * the marker sticks to the world.
 */

import * as THREE from 'three';
import type { LocationId } from '../../shared/constants';
import { localTargets, resolveObjective } from '../story/objectives';
import type { GameContext, Interactable } from '../types';
import { el } from './UIManager';

/** Objective re-resolution cadence (pure, but it touches arrays). */
const RESOLVE_INTERVAL_S = 0.25;
/** Inset border for the off-screen arrow (CSS px). */
const EDGE_MARGIN = 24;
/** The marker floats this far above the target object's origin (m). */
const TARGET_LIFT = 2.0;
/** Distance fade: gone by FADE_NEAR (glow + [E] prompt take over up close). */
const FADE_NEAR = 9;
const FADE_FAR = 12;

const tmpWorld = new THREE.Vector3();
const tmpView = new THREE.Vector3();
const tmpCandidate = new THREE.Vector3();

export class ObjectiveMarker {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private readonly diamond: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly distanceEl: HTMLDivElement;

  private ready = false;
  private traveling = false;
  private resolveAccum = RESOLVE_INTERVAL_S; // resolve on the first live frame
  private targets: Interactable[] = [];
  private visible = false;
  private mode: 'point' | 'edge' | null = null;
  private lastDistanceText = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'objective-marker hidden');
    this.diamond = el('div', 'objective-marker-diamond');
    this.arrow = el('div', 'objective-marker-arrow', '➤');
    this.distanceEl = el('div', 'objective-marker-distance', '');
    this.root.appendChild(this.diamond);
    this.root.appendChild(this.arrow);
    this.root.appendChild(this.distanceEl);
    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('game:ready', () => {
      this.ready = true;
    });
    ctx.events.on('world:travel-begin', () => {
      this.traveling = true;
      this.targets.length = 0; // the old location's objects are going away
    });
    ctx.events.on('world:travel-end', () => {
      this.traveling = false;
      this.resolveAccum = RESOLVE_INTERVAL_S; // re-resolve on the next frame
    });
  }

  /** Driven from UIManager.update at full rate (like the story overlay). */
  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    this.resolveAccum += dt;
    if (this.resolveAccum >= RESOLVE_INTERVAL_S) {
      this.resolveAccum %= RESOLVE_INTERVAL_S;
      this.refreshTargets();
    }

    if (
      !this.ready ||
      this.traveling ||
      ctx.player.cinematicActive ||
      ctx.net.offlineMode ||
      ctx.state.endingId !== null ||
      this.targets.length === 0
    ) {
      this.hide();
      return;
    }

    // Nearest target to the player; world positions read into reused vectors.
    const playerPos = ctx.player.position;
    let nearest: Interactable | null = null;
    let nearestDistSq = Infinity;
    for (const target of this.targets) {
      target.object.getWorldPosition(tmpCandidate);
      const dSq = tmpCandidate.distanceToSquared(playerPos);
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearest = target;
      }
    }
    if (!nearest) {
      this.hide();
      return;
    }

    const distance = Math.sqrt(nearestDistSq);
    nearest.object.getWorldPosition(tmpWorld);
    tmpWorld.y += TARGET_LIFT;

    const camera = ctx.scene.camera;
    tmpView.copy(tmpWorld).applyMatrix4(camera.matrixWorldInverse);
    const behind = tmpView.z >= 0; // three.js cameras look down -Z
    tmpWorld.project(camera);

    const w = window.innerWidth;
    const h = window.innerHeight;
    let sx = (tmpWorld.x * 0.5 + 0.5) * w;
    let sy = (-tmpWorld.y * 0.5 + 0.5) * h;
    const onScreen =
      !behind &&
      sx >= EDGE_MARGIN &&
      sx <= w - EDGE_MARGIN &&
      sy >= EDGE_MARGIN &&
      sy <= h - EDGE_MARGIN;

    if (onScreen) {
      // Close-up handoff: the interactable's own glow + [E] prompt take over.
      const opacity = Math.min(1, Math.max(0, (distance - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
      if (opacity <= 0) {
        this.hide();
        return;
      }
      this.setMode('point');
      this.root.style.opacity = String(opacity);
    } else {
      // Clamp to the inset border. Behind the camera the projection mirrors
      // both axes, so flip the direction back before aiming the arrow.
      let dx = sx - w / 2;
      let dy = sy - h / 2;
      if (behind) {
        dx = -dx;
        dy = -dy;
      }
      if (dx === 0 && dy === 0) dy = 1; // dead astern: point down
      const along = Math.min(
        (w / 2 - EDGE_MARGIN) / Math.max(Math.abs(dx), 1e-6),
        (h / 2 - EDGE_MARGIN) / Math.max(Math.abs(dy), 1e-6),
      );
      sx = w / 2 + dx * along;
      sy = h / 2 + dy * along;
      this.setMode('edge');
      this.arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      this.root.style.opacity = '1';
    }

    const distText = `${Math.round(distance)}m`;
    if (distText !== this.lastDistanceText) {
      this.lastDistanceText = distText;
      this.distanceEl.textContent = distText;
    }
    this.root.style.transform = `translate(${sx}px, ${sy}px)`;
    if (!this.visible) {
      this.visible = true;
      this.root.classList.remove('hidden');
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** ~4Hz: re-derive the local target interactables for the current objective. */
  private refreshTargets(): void {
    const ctx = this.ctx;
    this.targets.length = 0;
    if (!ctx || !this.ready || this.traveling) return;
    if (ctx.net.offlineMode || ctx.state.endingId !== null) return;
    const location = ctx.world.current;
    if (!location) return;

    const portals: Array<{ id: string; to: LocationId }> = [];
    for (const it of location.interactables) {
      if (it.kind === 'portal' && it.portalTo) portals.push({ id: it.id, to: it.portalTo });
    }
    const objective = resolveObjective(ctx.state);
    for (const id of localTargets(objective, ctx.world.currentId, portals)) {
      const target = ctx.world.getInteractable(id);
      if (target) this.targets.push(target);
    }
  }

  private setMode(mode: 'point' | 'edge'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.diamond.classList.toggle('hidden', mode !== 'point');
    this.arrow.classList.toggle('hidden', mode !== 'edge');
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('hidden');
  }
}
