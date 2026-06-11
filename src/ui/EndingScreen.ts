/**
 * src/ui/EndingScreen.ts
 * The campaign finale: on story:ending the screen slow-fades to deep indigo,
 * the ending title and main text appear, then epilogue paragraphs reveal one
 * by one (4s apart; click to skip ahead), closing with "The Veil remembers
 * you.", the party roster and a Continue Exploring button — the campaign
 * carries on in epilogue mode after dismissal.
 */

import { ARCHETYPES } from '../../shared/archetypes';
import type { EndingPayload } from '../../shared/protocol';
import type { GameContext } from '../types';
import { el, ghostButton } from './UIManager';
import type { UIManager } from './UIManager';

const PARAGRAPH_INTERVAL_MS = 4000;
/** Must outlast the .ending opacity transition so display:none doesn't cut it. */
const FADE_OUT_MS = 2700;

export class EndingScreen {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private paragraphs: HTMLElement[] = [];
  private footer: HTMLElement | null = null;
  private revealIndex = 0;
  private revealTimer = 0;
  private showing = false;
  /** Ending already displayed this session (dedupes snapshot replays). */
  private shownEndingId: string | null = null;

  constructor(
    private readonly ui: UIManager,
    parent: HTMLElement,
  ) {
    this.root = el('div', 'ending hidden');
    parent.appendChild(this.root);

    // Click anywhere (except the button) skips to the next paragraph.
    this.root.addEventListener('click', () => this.advance());
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('story:ending', ({ ending }) => this.show(ending));
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private show(ending: EndingPayload): void {
    if (this.showing) return;
    // Welcome snapshots replay the finale for players who missed it live —
    // but a routine reconnect must not re-run it for someone who already saw
    // this ending in this session.
    if (this.shownEndingId === ending.id) return;
    this.shownEndingId = ending.id;
    this.showing = true;
    this.ui.hideAllPanels(); // the finale owns the screen
    this.ui.setCapture('ending', true);
    this.ctx?.player.setFrozen(true);

    const inner = el('div', 'ending-inner');
    inner.appendChild(el('div', 'ending-eyebrow', 'the dream resolves'));
    inner.appendChild(el('h1', 'ending-title', ending.title));
    inner.appendChild(el('div', 'ending-text', ending.text));

    // Epilogue paragraphs, hidden until their reveal tick.
    const epilogue = el('div', 'ending-epilogue');
    this.paragraphs = ending.epilogue.map((text) => {
      const p = el('p', '', text);
      epilogue.appendChild(p);
      return p;
    });
    inner.appendChild(epilogue);

    // Footer: remembrance line, party roster, continue button.
    this.footer = el('div', 'ending-footer');
    this.footer.appendChild(el('div', 'ending-remember', 'The Veil remembers you.'));
    const roster = el('div', 'ending-roster');
    const players = this.ctx ? [...this.ctx.state.players.values()] : [];
    for (const p of players.sort((a, b) => a.joinedAt - b.joinedAt)) {
      const arch = ARCHETYPES[p.archetype];
      const row = el('div', 'ending-walker');
      const dot = el('span', 'party-dot');
      dot.style.background = arch.colorCss;
      dot.style.color = arch.colorCss;
      row.appendChild(dot);
      row.appendChild(el('span', '', p.name));
      row.appendChild(el('span', 'ending-walker-arch', arch.name));
      roster.appendChild(row);
    }
    this.footer.appendChild(roster);
    const continueBtn = ghostButton('Continue Exploring', 'btn-primary');
    continueBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also count as a skip-ahead click
      this.dismiss();
    });
    this.footer.appendChild(continueBtn);
    inner.appendChild(this.footer);

    this.root.replaceChildren(inner);
    this.root.classList.remove('hidden');
    // Two frames so the opacity transition (the slow indigo fade) runs.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => this.root.classList.add('ending-visible')),
    );

    this.revealIndex = 0;
    this.scheduleNextReveal();
  }

  /** Reveal the next epilogue paragraph (timer tick or click-to-skip). */
  private advance(): void {
    if (!this.showing) return;
    window.clearTimeout(this.revealTimer);
    if (this.revealIndex < this.paragraphs.length) {
      this.paragraphs[this.revealIndex].classList.add('ep-revealed');
      this.revealIndex++;
      this.scheduleNextReveal();
    } else {
      this.footer?.classList.add('ep-revealed');
    }
  }

  private scheduleNextReveal(): void {
    this.revealTimer = window.setTimeout(() => this.advance(), PARAGRAPH_INTERVAL_MS);
  }

  private dismiss(): void {
    window.clearTimeout(this.revealTimer);
    this.showing = false;
    this.root.classList.remove('ending-visible');
    window.setTimeout(() => this.root.classList.add('hidden'), FADE_OUT_MS);
    this.ui.setCapture('ending', false);
    this.ctx?.player.setFrozen(false);
    this.ui.toast('The dream continues — wander as long as you wish', 'gold');
  }
}
