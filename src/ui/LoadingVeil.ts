/**
 * src/ui/LoadingVeil.ts
 * Full-screen opaque veil shown while travelling between locations: the
 * destination's name, a glowing progress filament fed by loading:progress,
 * a pulsing sigil and cycling lore tips from the story data. Fades out on
 * loading:done.
 */

import { LOCATION_NAMES } from '../../shared/constants';
import { STORY } from '../../shared/storyData';
import type { GameContext } from '../types';
import { el } from './UIManager';

const TIP_CYCLE_MS = 4000;
const FADE_OUT_MS = 720;

export class LoadingVeil {
  private readonly root: HTMLDivElement;
  private readonly locationEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly tipEl: HTMLDivElement;
  private tipTimer = 0;
  private tipIndex = 0;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'loading-veil hidden');
    this.root.appendChild(el('div', 'veil-sigil'));
    this.locationEl = el('div', 'veil-location', '');
    this.statusEl = el('div', 'veil-status', 'weaving the dream…');
    const track = el('div', 'veil-track');
    this.fill = el('div', 'veil-fill');
    track.appendChild(this.fill);
    this.tipEl = el('div', 'veil-tip', '');
    this.root.appendChild(this.locationEl);
    this.root.appendChild(this.statusEl);
    this.root.appendChild(track);
    this.root.appendChild(this.tipEl);
    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    const ev = ctx.events;

    ev.on('world:travel-begin', ({ to }) => this.show(LOCATION_NAMES[to]));

    ev.on('loading:progress', ({ progress, label }) => {
      this.fill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
      this.statusEl.textContent = label;
    });

    ev.on('loading:done', () => this.fadeOut());
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private show(locationName: string): void {
    window.clearTimeout(this.hideTimer);
    this.locationEl.textContent = locationName;
    this.statusEl.textContent = 'weaving the dream…';
    this.fill.style.width = '0%';
    this.root.classList.remove('hidden', 'veil-fading');
    this.startTipCycle();
  }

  private fadeOut(): void {
    this.stopTipCycle();
    this.root.classList.add('veil-fading');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.add('hidden'), FADE_OUT_MS);
  }

  private startTipCycle(): void {
    this.stopTipCycle();
    const tips = STORY.loreTips;
    if (!tips || tips.length === 0) {
      this.tipEl.textContent = '';
      return;
    }
    this.tipIndex = Math.floor(Math.random() * tips.length);
    this.tipEl.textContent = tips[this.tipIndex];
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % tips.length;
      this.tipEl.classList.add('tip-swap');
      window.setTimeout(() => {
        this.tipEl.textContent = tips[this.tipIndex];
        this.tipEl.classList.remove('tip-swap');
      }, 450);
    }, TIP_CYCLE_MS);
  }

  private stopTipCycle(): void {
    if (this.tipTimer) {
      window.clearInterval(this.tipTimer);
      this.tipTimer = 0;
    }
  }
}
