/**
 * src/ui/Journal.ts
 * The shared journal panel (hotkey J): three tabs — Story (story + system
 * entries with act dividers, auto-scrolled), Lore & Clues (cards), and Party
 * (players, their items, and the campaign's relationships with the Echoes).
 * Reads everything from ClientState and re-renders on the relevant events.
 */

import { ARCHETYPES } from '../../shared/archetypes';
import { LOCATION_NAMES } from '../../shared/constants';
import type { JournalEntry } from '../../shared/protocol';
import { STORY } from '../../shared/storyData';
import type { GameContext } from '../types';
import { actRoman, el, panelChrome } from './UIManager';
import type { UIManager } from './UIManager';

type TabId = 'story' | 'lore' | 'party';

export class Journal {
  private ctx: GameContext | null = null;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private activeTab: TabId = 'story';
  private open = false;

  /**
   * When each act began (client clock), so the story tab can place "Act N"
   * dividers between entries. Entries that predate this session (snapshot
   * restore) all land under the earliest known act — a cosmetic approximation,
   * since JournalEntry carries no act of its own.
   */
  private actMarks: Array<{ act: number; at: number }> = [];

  constructor(ui: UIManager, parent: HTMLElement) {
    const chrome = panelChrome('Journal', 'J', () => ui.hideAllPanels());
    this.root = chrome.root;
    this.body = chrome.body;

    const tabs = el('div', 'tab-bar');
    const defs: Array<[TabId, string]> = [
      ['story', 'Story'],
      ['lore', 'Lore & Clues'],
      ['party', 'Party'],
    ];
    for (const [id, label] of defs) {
      const b = el('button', 'tab-btn', label);
      b.type = 'button';
      b.addEventListener('click', () => this.setTab(id));
      this.tabButtons.set(id, b);
      tabs.appendChild(b);
    }
    chrome.header.insertBefore(tabs, chrome.header.querySelector('.ui-panel-spacer'));

    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;

    ev.on('net:welcome', ({ snapshot }) => {
      this.actMarks = [{ act: snapshot.act, at: 0 }];
      this.refreshIfOpen();
    });

    ev.on('story:flags', ({ act }) => {
      const last = this.actMarks[this.actMarks.length - 1];
      if (!last || act > last.act) this.actMarks.push({ act, at: Date.now() });
      this.refreshIfOpen();
    });

    ev.on('journal:entry', () => this.refreshIfOpen('story', 'lore'));
    ev.on('inventory:changed', () => this.refreshIfOpen('party'));
    ev.on('relationships:changed', () => this.refreshIfOpen('party'));
    ev.on('party:player-joined', () => this.refreshIfOpen('party'));
    ev.on('party:player-left', () => this.refreshIfOpen('party'));
    ev.on('party:stats', () => this.refreshIfOpen('party'));
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.setTab(this.activeTab);
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private refreshIfOpen(...tabs: TabId[]): void {
    if (!this.open) return;
    if (tabs.length === 0 || tabs.includes(this.activeTab)) this.render();
  }

  private setTab(tab: TabId): void {
    this.activeTab = tab;
    for (const [id, b] of this.tabButtons) b.classList.toggle('tab-active', id === tab);
    this.render();
  }

  private render(): void {
    if (!this.ctx) return;
    this.body.replaceChildren();
    switch (this.activeTab) {
      case 'story':
        this.renderStory();
        break;
      case 'lore':
        this.renderLore();
        break;
      case 'party':
        this.renderParty();
        break;
    }
  }

  private renderStory(): void {
    const state = this.ctx!.state;
    const entries = state.journal
      .filter((e) => e.category === 'story' || e.category === 'system')
      .sort((a, b) => a.at - b.at);

    if (entries.length === 0) {
      this.body.appendChild(
        el('div', 'journal-empty', 'The first page is still blank. Step into the dream.'),
      );
      return;
    }

    const marks = this.actMarks.length > 0 ? this.actMarks : [{ act: state.act, at: 0 }];
    let markIdx = -1;
    for (const entry of entries) {
      // Advance through act marks; emit a divider whenever we cross one.
      while (markIdx + 1 < marks.length && entry.at >= marks[markIdx + 1].at) {
        markIdx++;
        this.body.appendChild(el('div', 'journal-divider', `Act ${actRoman(marks[markIdx].act)}`));
      }
      this.body.appendChild(this.entryEl(entry));
    }

    this.body.scrollTop = this.body.scrollHeight; // newest in view
  }

  private renderLore(): void {
    const entries = this.ctx!.state.journal
      .filter((e) => e.category === 'lore' || e.category === 'clue')
      .sort((a, b) => a.at - b.at);

    if (entries.length === 0) {
      this.body.appendChild(
        el('div', 'journal-empty', 'No lore gathered yet — touch the old things and listen.'),
      );
      return;
    }

    const grid = el('div', 'lore-grid');
    for (const entry of entries) {
      const card = el('div', 'lore-card');
      card.appendChild(
        el('span', `lore-badge badge-${entry.category}`, entry.category === 'clue' ? 'Clue' : 'Lore'),
      );
      card.appendChild(el('div', 'journal-entry-title', entry.title));
      card.appendChild(el('div', 'journal-entry-text', entry.text));
      if (entry.location) {
        card.appendChild(el('div', 'journal-entry-meta', LOCATION_NAMES[entry.location]));
      }
      grid.appendChild(card);
    }
    this.body.appendChild(grid);
  }

  private renderParty(): void {
    const state = this.ctx!.state;
    const players = [...state.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);

    for (const p of players) {
      const arch = ARCHETYPES[p.archetype];
      const card = el('div', 'party-card');

      const head = el('div', 'party-card-head');
      const dot = el('span', 'party-dot');
      dot.style.background = arch.colorCss;
      dot.style.color = arch.colorCss;
      head.appendChild(dot);
      head.appendChild(el('span', 'party-card-name', p.name));
      head.appendChild(el('span', 'party-card-arch', `${arch.name} — ${arch.title}`));
      head.appendChild(
        el('span', `party-card-state ${p.online ? 'state-online' : 'state-offline'}`,
          p.online ? 'present' : 'away'),
      );
      card.appendChild(head);

      const items = state.inventories.get(p.id) ?? [];
      if (items.length === 0) {
        card.appendChild(el('div', 'party-items-none', 'carries nothing yet'));
      } else {
        const row = el('div', 'party-items');
        for (const item of items) {
          const chip = el('span', 'party-item', `${item.icon} ${item.name}${item.count > 1 ? ` ×${item.count}` : ''}`);
          chip.title = item.description;
          row.appendChild(chip);
        }
        card.appendChild(row);
      }
      this.body.appendChild(card);
    }

    // ── Relationships with the Echoes ────────────────────────────────────────
    this.body.appendChild(el('div', 'section-title', 'Relationships'));
    const rels = Object.entries(state.relationships);
    if (rels.length === 0) {
      this.body.appendChild(
        el('div', 'journal-empty', 'The Echoes do not know you yet.'),
      );
      return;
    }
    for (const [npcId, raw] of rels) {
      const score = Math.max(-10, Math.min(10, raw));
      const npc = STORY.npcs[npcId];
      const row = el('div', 'rel-row');
      const name = el('div', 'rel-name', npc?.name ?? npcId);
      if (npc) name.style.color = npc.color;
      row.appendChild(name);

      // -10..10 mapped onto a centered bar: positive grows right (teal),
      // negative grows left (magenta).
      const track = el('div', 'rel-track');
      const fill = el('div', `rel-fill ${score >= 0 ? 'rel-pos' : 'rel-neg'}`);
      fill.style.width = `${(Math.abs(score) / 10) * 50}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'rel-score', score > 0 ? `+${score}` : `${score}`));
      this.body.appendChild(row);
    }
  }

  private entryEl(entry: JournalEntry): HTMLElement {
    const wrap = el('div', `journal-entry${entry.category === 'system' ? ' entry-system' : ''}`);
    wrap.appendChild(el('div', 'journal-entry-title', entry.title));
    wrap.appendChild(el('div', 'journal-entry-text', entry.text));
    const when = new Date(entry.at);
    const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
    const meta = entry.location ? `${time} · ${LOCATION_NAMES[entry.location]}` : time;
    wrap.appendChild(el('div', 'journal-entry-meta', meta));
    return wrap;
  }
}
