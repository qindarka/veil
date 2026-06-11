/**
 * src/ui/ActTitleCard.ts
 * Cinematic full-screen title card for act transitions: a letterspaced
 * eyebrow ("ACT II"), a large serif title and a thin gold rule over a soft
 * radial dim. Shows only when the campaign act genuinely advances mid-play —
 * the known act is seeded from every welcome snapshot, so joining or
 * reconnecting into act 2/3 never replays the card. pointer-events: none
 * throughout; it never blocks input.
 */

import type { GameContext } from '../types';
import { actRoman, el } from './UIManager';

const ACT_TITLES: Record<number, string> = {
  1: 'The Skyharbor',
  2: 'The Three Echoes',
  3: 'The Heart of the Veil',
};

/** Fade/blur in (~700ms) + hold; fade out runs after. ~4.5s total. */
const HOLD_MS = 3800;
const FADE_OUT_MS = 700;

export class ActTitleCard {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private readonly eyebrowEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;

  /** Last act we consider "seen"; null until the first welcome/flags arrives. */
  private knownAct: number | null = null;

  private holdHandle = 0;
  private fadeHandle = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'act-card hidden');
    const inner = el('div', 'act-card-inner');
    this.eyebrowEl = el('div', 'act-card-eyebrow', '');
    this.titleEl = el('div', 'act-card-title', '');
    inner.appendChild(this.eyebrowEl);
    inner.appendChild(this.titleEl);
    inner.appendChild(el('div', 'act-card-rule'));
    this.root.appendChild(inner);
    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;

    // Seed the known act from every welcome snapshot so (re)joining a room
    // already in act 2/3 never replays the transition card.
    ctx.events.on('net:welcome', ({ snapshot }) => {
      this.knownAct = snapshot.act;
    });

    // Only a genuine advance (act > known act) shows the card; decreases and
    // repeats are ignored. A flags message before any welcome just seeds.
    ctx.events.on('story:flags', ({ act }) => {
      const known = this.knownAct;
      this.knownAct = known === null ? act : Math.max(known, act);
      if (known !== null && act > known) this.show(act);
    });

    // The loading veil owns the screen during travel.
    ctx.events.on('world:travel-begin', () => this.hideNow());
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private show(act: number): void {
    this.clearTimers();
    this.eyebrowEl.textContent = `Act ${actRoman(act)}`;
    this.titleEl.textContent = ACT_TITLES[act] ?? 'Beyond the Veil';
    // Replace + restart even when a card is already showing.
    this.root.classList.remove('hidden', 'act-card-out', 'act-card-in');
    void this.root.offsetWidth; // restart the CSS animation
    this.root.classList.add('act-card-in');
    this.ctx?.audio.sfx('beat');
    this.holdHandle = window.setTimeout(() => this.fadeOut(), HOLD_MS);
  }

  private fadeOut(): void {
    this.holdHandle = 0;
    this.root.classList.add('act-card-out');
    this.fadeHandle = window.setTimeout(() => this.hideNow(), FADE_OUT_MS);
  }

  private hideNow(): void {
    this.clearTimers();
    this.root.classList.add('hidden');
    this.root.classList.remove('act-card-in', 'act-card-out');
  }

  private clearTimers(): void {
    if (this.holdHandle) {
      window.clearTimeout(this.holdHandle);
      this.holdHandle = 0;
    }
    if (this.fadeHandle) {
      window.clearTimeout(this.fadeHandle);
      this.fadeHandle = 0;
    }
  }
}
