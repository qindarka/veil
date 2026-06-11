/**
 * src/ui/CharacterSheet.ts
 * Your Veilwalker (hotkey C): archetype card with color, title, backstory and
 * attunement; live stats (interactions, votes cast, beats witnessed);
 * inventory grid with emoji icons and hover descriptions; and a footer with
 * the current location and room code.
 */

import { ARCHETYPES } from '../../shared/archetypes';
import { LOCATION_NAMES } from '../../shared/constants';
import type { GameContext } from '../types';
import { el, panelChrome } from './UIManager';
import type { UIManager } from './UIManager';

export class CharacterSheet {
  private ctx: GameContext | null = null;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private open = false;

  constructor(ui: UIManager, parent: HTMLElement) {
    const chrome = panelChrome('Veilwalker', 'C', () => ui.hideAllPanels(), true);
    this.root = chrome.root;
    this.body = chrome.body;
    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;
    // Live refreshes while open; state is already updated by the net mirror.
    ev.on('party:stats', ({ playerId }) => {
      if (this.open && playerId === ctx.state.playerId) this.render();
    });
    ev.on('inventory:changed', ({ playerId }) => {
      if (this.open && playerId === ctx.state.playerId) this.render();
    });
    ev.on('world:travel-end', () => {
      if (this.open) this.render();
    });
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private render(): void {
    const state = this.ctx?.state;
    this.body.replaceChildren();
    const you = state?.you;
    if (!state || !you) {
      this.body.appendChild(el('div', 'journal-empty', 'You have not yet entered the dream.'));
      return;
    }

    const arch = ARCHETYPES[you.archetype];

    // Archetype card.
    const card = el('div', 'cs-arch-card');
    const swatch = el('div', 'cs-swatch');
    swatch.style.background = arch.colorCss;
    swatch.style.color = arch.colorCss; // currentColor drives the glow
    card.appendChild(swatch);
    const info = el('div');
    info.appendChild(el('div', 'cs-arch-name', `${you.name} the ${arch.name}`));
    info.appendChild(el('div', 'cs-arch-title', arch.title));
    info.appendChild(el('div', 'cs-arch-desc', arch.description));
    info.appendChild(el('div', 'cs-arch-ability', `Attunement: ${arch.ability}`));
    card.appendChild(info);
    this.body.appendChild(card);

    // Live stats.
    const stats = el('div', 'cs-stats');
    const statDefs: Array<[number, string]> = [
      [you.stats.interactions, 'Interactions'],
      [you.stats.votesCast, 'Votes cast'],
      [you.stats.beatsWitnessed, 'Beats witnessed'],
    ];
    for (const [value, label] of statDefs) {
      const tile = el('div', 'cs-stat');
      tile.appendChild(el('div', 'cs-stat-value', String(value)));
      tile.appendChild(el('div', 'cs-stat-label', label));
      stats.appendChild(tile);
    }
    this.body.appendChild(stats);

    // Inventory grid.
    this.body.appendChild(el('div', 'section-title', 'Satchel'));
    const items = state.myInventory();
    if (items.length === 0) {
      this.body.appendChild(el('div', 'cs-empty', 'Empty — the dream has given you nothing yet.'));
    } else {
      const grid = el('div', 'cs-inventory');
      for (const item of items) {
        const tile = el('div', 'cs-item');
        tile.title = item.description;
        tile.appendChild(el('div', 'cs-item-icon', item.icon));
        tile.appendChild(el('div', 'cs-item-name', item.name));
        if (item.count > 1) tile.appendChild(el('div', 'cs-item-count', `×${item.count}`));
        grid.appendChild(tile);
      }
      this.body.appendChild(grid);
    }

    // Footer: where you stand, and the campaign's code.
    const footer = el('div', 'cs-footer');
    footer.appendChild(el('span', '', LOCATION_NAMES[you.location]));
    if (state.roomCode) {
      footer.appendChild(el('span', '', '·'));
      footer.appendChild(el('span', '', `campaign ${state.roomCode}`));
    }
    this.body.appendChild(footer);
  }
}
