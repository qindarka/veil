/**
 * src/ui/HelpOverlay.ts
 * Help panel (hotkey H): a four-line how-to-play and the full controls table
 * from docs/ARCHITECTURE.md. Static content, built once.
 */

import type { GameContext } from '../types';
import { el, panelChrome } from './UIManager';
import type { UIManager } from './UIManager';

const HOW_TO_PLAY: Array<[string, string]> = [
  ['Explore together. ', 'Six dream-realms drift beyond the Skyharbor — wander them with your crew.'],
  ['Interact with E. ', 'Stand close to glowing Echoes, glyphs and shrines to commune with them.'],
  ['Vote when choices appear. ', 'The party decides as one, and the story remembers.'],
  ['Anchor with F. ', 'Holding a moment steady reveals the deeper memories inside it.'],
];

const CONTROLS: Array<[string, string]> = [
  ['W A S D / arrows', 'Move (camera-relative)'],
  ['Shift', 'Run'],
  ['Mouse drag / click canvas', 'Look around (Esc releases the pointer)'],
  ['Mouse wheel', 'Camera zoom (3–12m)'],
  ['E', 'Interact with the nearest highlighted object'],
  ['F', 'Toggle focus mode (anchor the scene)'],
  ['J / C / O / H', 'Journal / Character sheet / Settings / Help'],
  ['Enter', 'Focus chat (Esc blurs)'],
  ['1 – 8', 'Emotes'],
  ['Esc', 'Close the topmost panel'],
];

export class HelpOverlay {
  private readonly root: HTMLElement;

  constructor(ui: UIManager, parent: HTMLElement) {
    const chrome = panelChrome('How to Walk the Veil', 'H', () => ui.hideAllPanels());
    this.root = chrome.root;

    const lines = el('div', 'help-lines');
    for (const [lead, rest] of HOW_TO_PLAY) {
      const line = el('div', 'help-line');
      line.appendChild(el('strong', '', lead));
      line.appendChild(document.createTextNode(rest));
      lines.appendChild(line);
    }
    chrome.body.appendChild(lines);

    const table = el('table', 'help-table');
    const tbody = el('tbody');
    for (const [keys, action] of CONTROLS) {
      const tr = el('tr');
      tr.appendChild(el('td', '', keys));
      tr.appendChild(el('td', '', action));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    chrome.body.appendChild(table);

    parent.appendChild(this.root);
  }

  init(_ctx: GameContext): void {
    // Static panel: nothing to wire.
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
