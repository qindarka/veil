/**
 * src/ui/Chat.ts
 * Bottom-left text chat: a fading message log (last 50 lines) and an input
 * row. Enter focuses the input (when not captured elsewhere), Esc blurs,
 * Enter sends. Renders chat messages with archetype-colored names, emote
 * lines, party join/leave/travel system lines and choice-result
 * announcements. All user text goes through textContent.
 */

import { ARCHETYPES } from '../../shared/archetypes';
import { EMOTES, LOCATION_NAMES, MAX_CHAT_LEN } from '../../shared/constants';
import type { EmoteId } from '../../shared/constants';
import type { PlayerId } from '../../shared/protocol';
import type { GameContext } from '../types';
import { el } from './UIManager';
import type { UIManager } from './UIManager';

const MAX_LINES = 50;
const IDLE_FADE_MS = 6000;
const GLOW_MS = 2400;

/** Third-person verb per emote for the italic emote lines. */
const EMOTE_VERBS: Record<EmoteId, string> = {
  wave: 'waves',
  dance: 'dances',
  point: 'points at something',
  laugh: 'laughs',
  heart: 'sends warmth',
  sparkle: 'sparkles',
  ponder: 'ponders',
  cheer: 'cheers',
};

export class Chat {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private fadeTimer = 0;
  private glowTimer = 0;

  constructor(
    private readonly ui: UIManager,
    parent: HTMLElement,
  ) {
    this.root = el('div', 'chat');
    this.log = el('div', 'chat-log scrolly');
    const inputRow = el('div', 'chat-input-row');
    this.input = el('input', 'chat-input');
    this.input.type = 'text';
    this.input.maxLength = MAX_CHAT_LEN;
    this.input.placeholder = 'Press Enter to speak through the Veil…';
    this.input.autocomplete = 'off';
    inputRow.appendChild(this.input);
    this.root.appendChild(this.log);
    this.root.appendChild(inputRow);
    parent.appendChild(this.root);

    // Focus/blur drive both the capture flag and the faded state.
    this.input.addEventListener('focus', () => {
      this.ui.setCapture('chat', true);
      this.root.classList.add('chat-focused');
    });
    this.input.addEventListener('blur', () => {
      this.ui.setCapture('chat', false);
      this.root.classList.remove('chat-focused');
    });

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must never reach game hotkeys
      if (e.key === 'Enter') {
        this.send();
      } else if (e.key === 'Escape') {
        this.input.blur();
        e.preventDefault();
      }
    });

    // Global Enter → focus chat (when nothing else captures the keyboard).
    window.addEventListener('keydown', this.onGlobalKeyDown);

    this.scheduleFade();
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;

    ev.on('chat:message', ({ from, name, text }) => {
      const line = el('div', 'chat-line');
      const nameSpan = el('span', 'chat-name', name);
      nameSpan.style.color = this.colorFor(from);
      line.appendChild(nameSpan);
      line.appendChild(document.createTextNode(text));
      this.append(line);
    });

    ev.on('chat:emote', ({ from, name, emote }) => {
      const def = EMOTES.find((e) => e.id === emote);
      const line = el('div', 'chat-line chat-emote-line');
      const nameSpan = el('span', 'chat-name', name);
      nameSpan.style.color = this.colorFor(from);
      line.appendChild(nameSpan);
      line.appendChild(
        document.createTextNode(`${EMOTE_VERBS[emote] ?? 'gestures'} ${def?.icon ?? ''}`),
      );
      this.append(line);
    });

    ev.on('party:player-joined', ({ player }) => {
      if (player.id === ctx.state.playerId) return;
      this.system(`${player.name} enters the dream.`);
    });

    ev.on('party:player-left', ({ name }) => this.system(`${name} fades from the dream.`));

    ev.on('party:player-location', ({ playerId, location }) => {
      if (playerId === ctx.state.playerId) return;
      const who = ctx.state.getPlayer(playerId)?.name;
      if (who) this.system(`${who} drifts to ${LOCATION_NAMES[location]}.`);
    });

    ev.on('story:choice-result', ({ optionLabel }) => {
      this.system(`The party chose: ${optionLabel}`, true);
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private onGlobalKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || this.ui.inputCaptured || !this.ui.gameReady) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    this.input.focus();
    e.preventDefault();
  };

  private send(): void {
    const text = this.input.value.trim().slice(0, MAX_CHAT_LEN);
    this.input.value = '';
    if (!text) {
      this.input.blur();
      return;
    }
    this.ctx?.net.send({ t: 'chat', text });
  }

  private colorFor(playerId: PlayerId): string {
    const player = this.ctx?.state.getPlayer(playerId);
    return player ? ARCHETYPES[player.archetype].colorCss : '#e8e2f4';
  }

  private system(text: string, gold = false): void {
    this.append(el('div', `chat-line ${gold ? 'chat-system-gold' : 'chat-system'}`, text));
  }

  private append(line: HTMLElement): void {
    const wasFaded = this.root.classList.contains('chat-faded');
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;

    // New activity restores the log and (if it was dozing) pulses a soft
    // glow on the frame to catch the eye, then it refades after 6s idle.
    this.root.classList.remove('chat-faded');
    if (wasFaded) {
      this.root.classList.add('chat-glow');
      window.clearTimeout(this.glowTimer);
      this.glowTimer = window.setTimeout(() => this.root.classList.remove('chat-glow'), GLOW_MS);
    }
    this.scheduleFade();
  }

  private scheduleFade(): void {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.root.classList.add('chat-faded');
    }, IDLE_FADE_MS);
  }
}
