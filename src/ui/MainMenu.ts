/**
 * src/ui/MainMenu.ts
 * Full-screen main menu over a pure-CSS dreamscape (layered gradients,
 * floating star motes, drifting fog blobs). Collects player name, archetype
 * and a room code (create or join), persists name/archetype to localStorage,
 * and resolves show() with a MenuResult. After submit it stays visible in a
 * "drifting in" state until UIManager dismisses it on world:travel-begin.
 */

import { ARCHETYPE_IDS, ARCHETYPES, isArchetypeId } from '../../shared/archetypes';
import type { ArchetypeId } from '../../shared/archetypes';
import {
  isValidRoomCode,
  MAX_NAME_LEN,
  normalizeRoomCode,
  randomRoomCode,
  ROOM_CODE_LEN,
} from '../../shared/constants';
import { STORY } from '../../shared/storyData';
import type { GameContext, MenuResult } from '../types';
import { el, ghostButton } from './UIManager';
import type { UIManager } from './UIManager';

const NAME_KEY = 'veil:name';
const ARCHETYPE_KEY = 'veil:archetype';
const STAR_COUNT = 36;
const TIP_CYCLE_MS = 6000;

export class MainMenu {
  private ctx: GameContext | null = null;

  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly archCards = new Map<ArchetypeId, HTMLButtonElement>();
  private readonly createTab: HTMLButtonElement;
  private readonly joinTab: HTMLButtonElement;
  private readonly createBody: HTMLDivElement;
  private readonly joinBody: HTMLDivElement;
  private readonly codeBig: HTMLDivElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly joinInput: HTMLInputElement;
  private readonly errorLine: HTMLDivElement;
  private readonly submitBtn: HTMLButtonElement;
  private readonly statusLine: HTMLDivElement;
  private readonly loreLine: HTMLDivElement;

  private selectedArchetype: ArchetypeId | null = null;
  private mode: 'create' | 'join' = 'create';
  private createdCode = randomRoomCode();
  private pending = false;
  private resolver: ((result: MenuResult) => void) | null = null;
  private tipTimer = 0;
  private tipIndex = 0;

  constructor(
    private readonly ui: UIManager,
    parent: HTMLElement,
  ) {
    this.root = el('div', 'menu hidden');

    // ── Dreamscape backdrop: fog blobs + floating star motes ────────────────
    this.root.appendChild(el('div', 'menu-fog fog-a'));
    this.root.appendChild(el('div', 'menu-fog fog-b'));
    this.root.appendChild(el('div', 'menu-fog fog-c'));
    for (let i = 0; i < STAR_COUNT; i++) {
      const star = el('span', 'menu-star');
      const size = 1 + Math.random() * 2.5;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}vw`;
      star.style.top = `${20 + Math.random() * 90}vh`;
      // Two animations (float, twinkle) declared in CSS; randomize both.
      star.style.animationDuration = `${30 + Math.random() * 50}s, ${2 + Math.random() * 4}s`;
      star.style.animationDelay = `${-Math.random() * 60}s, ${-Math.random() * 4}s`;
      this.root.appendChild(star);
    }

    const inner = el('div', 'menu-inner');
    inner.appendChild(el('h1', 'menu-title', 'Echoes of the Veil'));
    inner.appendChild(el('div', 'menu-subtitle', 'a cooperative mystery for 6–10 veilwalkers'));

    const card = el('div', 'panel menu-card');

    // ── Name ─────────────────────────────────────────────────────────────────
    card.appendChild(el('label', 'menu-label', 'Your name'));
    this.nameInput = el('input', 'text-input menu-name-input');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = MAX_NAME_LEN;
    this.nameInput.placeholder = 'What the dream will call you…';
    this.nameInput.autocomplete = 'off';
    card.appendChild(this.nameInput);

    // ── Archetype picker ─────────────────────────────────────────────────────
    card.appendChild(el('label', 'menu-label', 'Your calling'));
    const grid = el('div', 'arch-grid');
    for (const id of ARCHETYPE_IDS) {
      const def = ARCHETYPES[id];
      const cardBtn = el('button', 'arch-card');
      cardBtn.type = 'button';
      cardBtn.style.setProperty('--ac', def.colorCss);
      cardBtn.appendChild(el('div', 'arch-swatch'));
      cardBtn.appendChild(el('div', 'arch-name', def.name));
      cardBtn.appendChild(el('div', 'arch-title', def.title));
      cardBtn.appendChild(el('div', 'arch-ability', def.ability));
      cardBtn.addEventListener('click', () => this.selectArchetype(id));
      this.archCards.set(id, cardBtn);
      grid.appendChild(cardBtn);
    }
    card.appendChild(grid);

    // ── Create / join mode tabs ──────────────────────────────────────────────
    card.appendChild(el('label', 'menu-label', 'Your campaign'));
    const tabs = el('div', 'mode-tabs');
    this.createTab = el('button', 'mode-tab', 'Create Campaign');
    this.createTab.type = 'button';
    this.joinTab = el('button', 'mode-tab', 'Join Campaign');
    this.joinTab.type = 'button';
    this.createTab.addEventListener('click', () => this.setMode('create'));
    this.joinTab.addEventListener('click', () => this.setMode('join'));
    tabs.appendChild(this.createTab);
    tabs.appendChild(this.joinTab);
    card.appendChild(tabs);

    // Create body: a freshly woven room code + copy button.
    this.createBody = el('div', 'mode-body');
    const codeRow = el('div', 'room-code-display');
    this.codeBig = el('div', 'room-code-big', this.createdCode);
    this.copyBtn = ghostButton('Copy');
    this.copyBtn.addEventListener('click', () => this.copyCode());
    codeRow.appendChild(this.codeBig);
    codeRow.appendChild(this.copyBtn);
    this.createBody.appendChild(codeRow);
    this.createBody.appendChild(
      el('div', 'room-code-note', 'Share this code with your crew — it names your campaign.'),
    );
    card.appendChild(this.createBody);

    // Join body: code input.
    this.joinBody = el('div', 'mode-body hidden');
    this.joinInput = el('input', 'text-input code-input');
    this.joinInput.type = 'text';
    this.joinInput.maxLength = ROOM_CODE_LEN;
    this.joinInput.placeholder = '······';
    this.joinInput.autocomplete = 'off';
    this.joinInput.spellcheck = false;
    this.joinInput.addEventListener('input', () => {
      // Normalize as the player types (uppercase, strip punctuation).
      const cleaned = normalizeRoomCode(this.joinInput.value).slice(0, ROOM_CODE_LEN);
      if (this.joinInput.value !== cleaned) this.joinInput.value = cleaned;
    });
    this.joinBody.appendChild(this.joinInput);
    this.joinBody.appendChild(
      el('div', 'room-code-note', 'Enter the 6-letter code from whoever wove the campaign.'),
    );
    card.appendChild(this.joinBody);

    // ── Errors, submit, voice note ───────────────────────────────────────────
    this.errorLine = el('div', 'menu-error', '');
    card.appendChild(this.errorLine);

    const submitRow = el('div', 'menu-submit-row');
    this.submitBtn = ghostButton('Enter the Veil', 'btn-primary');
    this.submitBtn.addEventListener('click', () => this.submit());
    this.statusLine = el('div', 'menu-status', '');
    submitRow.appendChild(this.submitBtn);
    submitRow.appendChild(this.statusLine);
    card.appendChild(submitRow);

    card.appendChild(
      el('div', 'menu-voice-note', 'Voice chat is text & emotes for now — speak through the Veil.'),
    );

    inner.appendChild(card);

    // ── Cycling lore tip ─────────────────────────────────────────────────────
    this.loreLine = el('div', 'menu-lore', '');
    inner.appendChild(this.loreLine);

    this.root.appendChild(inner);
    parent.appendChild(this.root);

    // Enter submits from either text input.
    const submitOnEnter = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && !this.pending) this.submit();
    };
    this.nameInput.addEventListener('keydown', submitOnEnter);
    this.joinInput.addEventListener('keydown', submitOnEnter);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    // While the post-submit "drifting in" state shows, reflect connection
    // progress in the status line so the player sees something happening.
    ctx.events.on('net:status', ({ status }) => {
      if (!this.pending) return;
      switch (status) {
        case 'connecting':
          this.statusLine.textContent = 'reaching through the Veil…';
          break;
        case 'connected':
          this.statusLine.textContent = 'the dream answers — entering…';
          break;
        case 'reconnecting':
          this.statusLine.textContent = 'the thread frays — reweaving…';
          break;
        case 'offline':
          this.statusLine.textContent = 'the Veil is quiet — drifting alone…';
          break;
        default:
          break;
      }
    });
  }

  /** Show the menu and resolve once the player commits a valid form. */
  show(): Promise<MenuResult> {
    this.pending = false;
    this.submitBtn.disabled = false;
    this.submitBtn.textContent = 'Enter the Veil';
    this.statusLine.textContent = '';
    this.errorLine.textContent = '';
    this.root.classList.remove('hidden', 'menu-fading');

    // Restore persisted identity.
    this.nameInput.value = readStorage(NAME_KEY) ?? '';
    const storedArch = readStorage(ARCHETYPE_KEY);
    if (storedArch && isArchetypeId(storedArch)) this.selectArchetype(storedArch);

    this.startTipCycle();
    this.nameInput.focus();

    return new Promise<MenuResult>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Fade out and remove from flow. Called by UIManager on world:travel-begin. */
  hide(): void {
    this.stopTipCycle();
    this.root.classList.add('menu-fading');
    window.setTimeout(() => this.root.classList.add('hidden'), 620);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private selectArchetype(id: ArchetypeId): void {
    this.selectedArchetype = id;
    for (const [archId, cardBtn] of this.archCards) {
      cardBtn.classList.toggle('arch-selected', archId === id);
    }
    writeStorage(ARCHETYPE_KEY, id);
    this.ui.sfx('ui-click');
  }

  private setMode(mode: 'create' | 'join'): void {
    this.mode = mode;
    this.createTab.classList.toggle('mode-active', mode === 'create');
    this.joinTab.classList.toggle('mode-active', mode === 'join');
    this.createBody.classList.toggle('hidden', mode !== 'create');
    this.joinBody.classList.toggle('hidden', mode !== 'join');
    this.errorLine.textContent = '';
    if (mode === 'join') this.joinInput.focus();
    this.ui.sfx('ui-click');
  }

  private copyCode(): void {
    void navigator.clipboard?.writeText(this.createdCode).then(
      () => this.ui.toast('Room code copied — share it with your crew', 'info'),
      () => this.ui.toast(`Room code: ${this.createdCode}`, 'info'),
    );
  }

  private submit(): void {
    if (this.pending || !this.resolver) return;

    const name = this.nameInput.value.trim().slice(0, MAX_NAME_LEN);
    if (!name) {
      this.errorLine.textContent = 'Choose a name to be remembered by.';
      this.nameInput.focus();
      return;
    }
    if (!this.selectedArchetype) {
      this.errorLine.textContent = 'Choose your calling — the dream must know you.';
      return;
    }

    let roomCode: string;
    if (this.mode === 'create') {
      roomCode = this.createdCode;
    } else {
      roomCode = normalizeRoomCode(this.joinInput.value);
      if (!isValidRoomCode(roomCode)) {
        this.errorLine.textContent = 'That code is not woven right — six letters, no zeroes or ones.';
        this.joinInput.focus();
        return;
      }
    }

    writeStorage(NAME_KEY, name);
    this.errorLine.textContent = '';

    // Lock the form into the pending state; the menu stays up (over the raw
    // scene) until the first travel's loading veil takes over.
    this.pending = true;
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = 'Drifting into the dream…';
    this.statusLine.textContent = 'reaching through the Veil…';
    this.ui.sfx('ui-click');

    const resolve = this.resolver;
    this.resolver = null;
    resolve({ name, archetype: this.selectedArchetype, roomCode, mode: this.mode });
  }

  private startTipCycle(): void {
    this.stopTipCycle();
    const tips = STORY.loreTips;
    if (!tips || tips.length === 0) return;
    this.tipIndex = Math.floor(Math.random() * tips.length);
    this.loreLine.textContent = tips[this.tipIndex];
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % tips.length;
      this.loreLine.classList.add('tip-swap');
      window.setTimeout(() => {
        this.loreLine.textContent = tips[this.tipIndex];
        this.loreLine.classList.remove('tip-swap');
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

// localStorage can throw in private/locked-down modes; treat it as optional.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-fatal: identity just won't persist.
  }
}
