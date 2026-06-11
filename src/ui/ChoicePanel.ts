/**
 * src/ui/ChoicePanel.ts
 * Right-side group-vote panel. Opens on story:choice-open with the prompt and
 * option cards (label, description, live tally bar, vote count); clicking an
 * option casts/changes your vote via ctx.story.vote. A gold countdown bar
 * drains toward endsAt. On story:choice-result the winner glows and the panel
 * dismisses after 4s. Late joiners restore from state.activeChoice.
 */

import type { StoryChoicePayload } from '../../shared/protocol';
import type { PlayerId } from '../../shared/protocol';
import type { GameContext } from '../types';
import { el } from './UIManager';
import type { UIManager } from './UIManager';

const RESULT_LINGER_MS = 4000;
const FADE_OUT_MS = 280;

export class ChoicePanel {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private readonly eyebrow: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private readonly optionsEl: HTMLDivElement;
  private readonly votersEl: HTMLDivElement;
  private readonly countdownFill: HTMLDivElement;

  private choice: StoryChoicePayload | null = null;
  private endsAt = 0;
  private myPick: string | null = null;
  private resolved = false;
  /** Pending result-linger / fade timers — cancelled by open() so a stale
   *  hide can never blank the next (possibly chained) vote. */
  private lingerTimer: number | null = null;
  private fadeTimer: number | null = null;
  private optionCards = new Map<string, { card: HTMLButtonElement; fill: HTMLDivElement; count: HTMLSpanElement }>();

  constructor(
    private readonly ui: UIManager,
    parent: HTMLElement,
  ) {
    this.root = el('div', 'choice-panel hidden');
    this.eyebrow = el('div', 'choice-eyebrow', 'the party must decide');
    this.promptEl = el('div', 'choice-prompt', '');
    this.optionsEl = el('div');
    this.votersEl = el('div', 'choice-voters', '');
    const track = el('div', 'choice-countdown');
    this.countdownFill = el('div', 'choice-countdown-fill');
    track.appendChild(this.countdownFill);
    this.root.appendChild(this.eyebrow);
    this.root.appendChild(this.promptEl);
    this.root.appendChild(this.optionsEl);
    this.root.appendChild(this.votersEl);
    this.root.appendChild(track);
    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;

    ev.on('story:choice-open', ({ choice, endsAt }) => this.open(choice, endsAt));

    // Late joiners / reconnects: a vote may already be in flight — or the one
    // we were showing may have resolved while the socket was down, in which
    // case the snapshot is the only notice we'll ever get: close the panel.
    ev.on('net:welcome', ({ snapshot }) => {
      const active = snapshot.activeChoice;
      if (active && !snapshot.endingId) {
        this.open(active.choice, active.endsAt);
        this.applyTally(active.tally, active.votedIds);
      } else if (this.choice) {
        this.hide();
      }
    });

    ev.on('story:vote-tally', ({ choiceId, tally, votedIds }) => {
      if (this.choice?.id === choiceId) this.applyTally(tally, votedIds);
    });

    ev.on('story:choice-result', ({ choiceId, optionId }) => {
      if (this.choice?.id !== choiceId) return;
      this.resolved = true;
      this.eyebrow.textContent = 'the veil has decided';
      this.votersEl.textContent = '';
      for (const [id, parts] of this.optionCards) {
        parts.card.classList.toggle('choice-winner', id === optionId);
        parts.card.classList.toggle('choice-dimmed', id !== optionId);
        parts.card.classList.remove('choice-picked');
      }
      // Guard the linger: the server can open the NEXT vote milliseconds
      // after this result (deferred-choice drain), and a stale timer must
      // never hide a live vote.
      const lingerFor = choiceId;
      this.lingerTimer = window.setTimeout(() => {
        if (this.resolved && this.choice?.id === lingerFor) this.hide();
      }, RESULT_LINGER_MS);
    });
  }

  /** Countdown bar; driven from UIManager.update. */
  update(_dt: number): void {
    if (!this.choice || this.resolved) return;
    const duration = Math.max(1, this.choice.durationMs);
    const remaining = Math.max(0, this.endsAt - Date.now());
    this.countdownFill.style.width = `${Math.min(100, (remaining / duration) * 100)}%`;
    if (remaining === 0) this.eyebrow.textContent = 'the veil weighs the votes…';
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private open(choice: StoryChoicePayload, endsAt: number): void {
    // Cancel any pending hide/fade from a previous vote's resolution — votes
    // can chain back-to-back and the stale timers would blank this one.
    if (this.lingerTimer !== null) {
      window.clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.choice = choice;
    this.endsAt = endsAt;
    this.myPick = null;
    this.resolved = false;
    this.eyebrow.textContent = 'the party must decide';
    this.promptEl.textContent = choice.prompt;
    this.votersEl.textContent = 'no votes yet — choose';
    this.countdownFill.style.width = '100%';

    this.optionsEl.replaceChildren();
    this.optionCards.clear();
    for (const option of choice.options) {
      const card = el('button', 'choice-option');
      card.type = 'button';
      card.appendChild(el('div', 'choice-option-label', option.label));
      card.appendChild(el('div', 'choice-option-desc', option.description));
      const tally = el('div', 'choice-tally');
      const track = el('div', 'choice-tally-track');
      const fill = el('div', 'choice-tally-fill');
      track.appendChild(fill);
      const count = el('span', 'choice-count', '0');
      tally.appendChild(track);
      tally.appendChild(count);
      card.appendChild(tally);
      card.addEventListener('click', () => this.vote(option.id));
      this.optionCards.set(option.id, { card, fill, count });
      this.optionsEl.appendChild(card);
    }

    this.root.classList.remove('hidden', 'choice-out');
  }

  private vote(optionId: string): void {
    if (!this.choice || this.resolved) return;
    this.myPick = optionId;
    for (const [id, parts] of this.optionCards) {
      parts.card.classList.toggle('choice-picked', id === optionId);
    }
    this.ctx?.story.vote(this.choice.id, optionId);
    this.ui.sfx('ui-click');
  }

  private applyTally(tally: Record<string, number>, votedIds: PlayerId[]): void {
    if (!this.choice) return;
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    for (const [id, parts] of this.optionCards) {
      const votes = tally[id] ?? 0;
      parts.fill.style.width = total > 0 ? `${(votes / total) * 100}%` : '0%';
      parts.count.textContent = String(votes);
    }
    const online = this.ctx
      ? [...this.ctx.state.players.values()].filter((p) => p.online).length
      : 0;
    this.votersEl.textContent =
      online > 0 ? `${votedIds.length} of ${online} have voted` : `${votedIds.length} voted`;
  }

  private hide(): void {
    this.root.classList.add('choice-out');
    this.fadeTimer = window.setTimeout(() => {
      this.root.classList.add('hidden');
      this.root.classList.remove('choice-out');
      this.fadeTimer = null;
    }, FADE_OUT_MS);
    this.choice = null;
    this.myPick = null;
  }
}
