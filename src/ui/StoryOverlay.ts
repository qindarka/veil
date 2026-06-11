/**
 * src/ui/StoryOverlay.ts
 * Cinematic lower-third for story beats: speaker name in their color, beat
 * title, and prose revealed with a typewriter (~28 chars/s). Click completes
 * the reveal; once revealed it auto-dismisses after max(6s, 0.35s/word) —
 * unless someone is anchoring the scene (focus mode), in which case it
 * lingers until release or the next beat. Beats are queued, never dropped.
 * Addendum beats (focus reveals) get a gold "anchored memory" treatment.
 */

import type { StoryBeatPayload } from '../../shared/protocol';
import type { GameContext } from '../types';
import { el } from './UIManager';

const CHARS_PER_SEC = 28;
const MIN_DWELL_S = 6;
const DWELL_PER_WORD_S = 0.35;
/** Grace period after a focus release before a fully-dwelled beat dismisses. */
const RELEASE_GRACE_S = 1.5;
const FADE_OUT_MS = 230;

export class StoryOverlay {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private readonly speakerEl: HTMLSpanElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly badgeEl: HTMLSpanElement;
  private readonly textEl: HTMLDivElement;

  private queue: StoryBeatPayload[] = [];
  private current: StoryBeatPayload | null = null;
  private revealedChars = 0;
  private revealing = false;
  private dwellRemaining = 0;
  private focusHeld = false;
  private dismissing = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'story-overlay hidden');
    const head = el('div', 'story-head');
    this.speakerEl = el('span', 'story-speaker', '');
    this.titleEl = el('span', 'story-title', '');
    this.badgeEl = el('span', 'story-badge hidden', '✦ anchored memory');
    head.appendChild(this.speakerEl);
    head.appendChild(this.titleEl);
    head.appendChild(this.badgeEl);
    this.textEl = el('div', 'story-text', '');
    this.root.appendChild(head);
    this.root.appendChild(this.textEl);
    this.root.appendChild(el('div', 'story-hint', 'click to continue'));
    parent.appendChild(this.root);

    // First click completes the typewriter; a second click moves on.
    this.root.addEventListener('click', () => {
      if (!this.current || this.dismissing) return;
      if (this.revealing) this.completeReveal();
      else this.dismiss();
    });
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('story:beat', ({ beat }) => this.enqueue(beat));
    ctx.events.on('focus:changed', ({ holderId }) => {
      const held = holderId !== null;
      // On release, give a fully-dwelled beat a short grace before it goes.
      if (this.focusHeld && !held && this.current && !this.revealing) {
        this.dwellRemaining = Math.max(this.dwellRemaining, RELEASE_GRACE_S);
      }
      this.focusHeld = held;
    });
  }

  /** Driven from UIManager.update — typewriter + dwell countdown. */
  update(dt: number): void {
    if (!this.current || this.dismissing) return;

    if (this.revealing) {
      this.revealedChars += CHARS_PER_SEC * dt;
      const text = this.current.text;
      if (this.revealedChars >= text.length) {
        this.completeReveal();
      } else {
        this.textEl.textContent = text.slice(0, Math.floor(this.revealedChars));
      }
      return;
    }

    // Fully revealed: count down the dwell unless the scene is anchored.
    if (!this.focusHeld) {
      this.dwellRemaining -= dt;
      if (this.dwellRemaining <= 0) this.dismiss();
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private enqueue(beat: StoryBeatPayload): void {
    if (!this.current && !this.dismissing) {
      this.show(beat);
      return;
    }
    this.queue.push(beat);
    // A new beat moves a fully-revealed lingering beat along ("...until
    // release or the next beat"). Mid-reveal beats finish first.
    if (this.current && !this.revealing && !this.dismissing) this.dismiss();
  }

  private show(beat: StoryBeatPayload): void {
    this.current = beat;
    this.revealing = true;
    this.revealedChars = 0;
    this.dwellRemaining = 0;

    if (beat.speaker) {
      this.speakerEl.textContent = beat.speaker;
      this.speakerEl.style.color = beat.speakerColor ?? 'var(--veil-gold)';
      this.speakerEl.classList.remove('hidden');
    } else {
      this.speakerEl.classList.add('hidden');
    }
    this.titleEl.textContent = beat.title;
    this.badgeEl.classList.toggle('hidden', !beat.isAddendum);
    this.root.classList.toggle('story-addendum', beat.isAddendum === true);
    this.root.classList.remove('story-revealed', 'story-out');
    this.textEl.textContent = '';
    this.root.classList.remove('hidden'); // display toggle restarts the entry animation

    this.ctx?.audio.sfx('beat');
  }

  private completeReveal(): void {
    if (!this.current) return;
    this.revealing = false;
    this.textEl.textContent = this.current.text;
    const words = this.current.text.trim().split(/\s+/).length;
    this.dwellRemaining = Math.max(MIN_DWELL_S, words * DWELL_PER_WORD_S);
    this.root.classList.add('story-revealed');
  }

  private dismiss(): void {
    if (!this.current || this.dismissing) return;
    this.dismissing = true;
    this.root.classList.add('story-out');
    window.setTimeout(() => {
      this.root.classList.add('hidden');
      this.root.classList.remove('story-out');
      this.current = null;
      this.dismissing = false;
      const next = this.queue.shift();
      if (next) this.show(next);
    }, FADE_OUT_MS);
  }
}
