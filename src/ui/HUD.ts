/**
 * src/ui/HUD.ts
 * In-game heads-up display: location/act/room-code/connection (top-left),
 * party list (top-right), button bar + mic stub + emote bar (bottom-right)
 * and the pulsing gold interact prompt (center-bottom). Hidden until
 * game:ready via the layer container owned by UIManager.
 */

import { ARCHETYPES } from '../../shared/archetypes';
import { EMOTES, LOCATION_NAMES } from '../../shared/constants';
import { resolveObjective } from '../story/objectives';
import type { NetStatus, GameContext, UIPanel } from '../types';
import { actRoman, el, kbdHint } from './UIManager';
import type { UIManager } from './UIManager';

const PILL_TEXT: Record<NetStatus, string> = {
  idle: 'idle',
  connecting: 'connecting…',
  connected: 'connected',
  reconnecting: 'reconnecting…',
  offline: 'solo dream',
};

const PILL_CLASS: Record<NetStatus, string> = {
  idle: 'pill-idle',
  connecting: 'pill-reconnecting', // amber, same as reconnecting
  connected: 'pill-connected',
  reconnecting: 'pill-reconnecting',
  offline: 'pill-offline',
};

export class HUD {
  private ctx: GameContext | null = null;

  private readonly locationEl: HTMLDivElement;
  private readonly actEl: HTMLDivElement;
  /** The "what do I do now" line (src/story/objectives.ts). */
  private readonly objectiveEl: HTMLDivElement;
  private lastObjectiveText = '';
  private readonly roomChip: HTMLButtonElement;
  private readonly connPill: HTMLSpanElement;
  private readonly partyList: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly promptText: HTMLSpanElement;

  constructor(
    private readonly ui: UIManager,
    parent: HTMLElement,
  ) {
    // ── Top-left: location, act, room code, connection ───────────────────────
    const topLeft = el('div', 'hud-topleft');
    this.locationEl = el('div', 'hud-location', '');
    this.actEl = el('div', 'hud-act', 'Act I');
    this.objectiveEl = el('div', 'hud-objective', '');
    const chips = el('div', 'hud-chips');
    this.roomChip = el('button', 'hud-chip hidden', '');
    this.roomChip.type = 'button';
    this.roomChip.title = 'Click to copy the room code';
    this.roomChip.addEventListener('click', () => this.copyRoomCode());
    this.connPill = el('span', 'hud-pill pill-idle', PILL_TEXT.idle);
    chips.appendChild(this.roomChip);
    chips.appendChild(this.connPill);
    topLeft.appendChild(this.locationEl);
    topLeft.appendChild(this.actEl);
    topLeft.appendChild(this.objectiveEl);
    topLeft.appendChild(chips);
    parent.appendChild(topLeft);

    // ── Top-right: party list ────────────────────────────────────────────────
    this.partyList = el('div', 'party-list');
    parent.appendChild(this.partyList);

    // ── Bottom-right: panel buttons, mic stub, emote bar ─────────────────────
    const bottomRight = el('div', 'hud-bottomright');
    const buttons = el('div', 'hud-buttons');
    const panelButtons: Array<[string, string, UIPanel]> = [
      ['Journal', 'J', 'journal'],
      ['Character', 'C', 'character'],
      ['Settings', 'O', 'settings'],
      ['Help', 'H', 'help'],
    ];
    for (const [label, key, panel] of panelButtons) {
      const b = el('button', 'hud-btn');
      b.type = 'button';
      b.appendChild(document.createTextNode(label));
      b.appendChild(kbdHint(key));
      b.addEventListener('click', () => this.ui.togglePanel(panel));
      buttons.appendChild(b);
    }
    // Voice chat stub. TODO: real voice chat (WebRTC SFU) is out of MVP scope.
    const mic = el('button', 'hud-btn', '🎙');
    mic.type = 'button';
    mic.title = 'Voice chat (coming soon)';
    mic.addEventListener('click', () =>
      this.ui.toast('Voice chat is coming to the Veil — use text and emotes for now', 'whisper'),
    );
    buttons.appendChild(mic);
    bottomRight.appendChild(buttons);

    const emoteBar = el('div', 'emote-bar');
    EMOTES.forEach((emote, i) => {
      const b = el('button', 'emote-btn');
      b.type = 'button';
      b.title = `${emote.label} (${i + 1})`;
      b.appendChild(document.createTextNode(emote.icon));
      b.appendChild(el('span', 'emote-hint', String(i + 1)));
      b.addEventListener('click', () => this.sendEmote(emote.id));
      emoteBar.appendChild(b);
    });
    bottomRight.appendChild(emoteBar);
    parent.appendChild(bottomRight);

    // ── Center-bottom: interact prompt ───────────────────────────────────────
    this.prompt = el('div', 'interact-prompt hidden');
    this.prompt.appendChild(kbdHint('E'));
    this.promptText = el('span', '', '');
    this.prompt.appendChild(this.promptText);
    parent.appendChild(this.prompt);

    // Emote hotkeys 1-8 (only when the game is live and keys aren't captured).
    window.addEventListener('keydown', this.onKeyDown);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;

    ev.on('net:status', ({ status }) => this.setNetStatus(status));

    ev.on('net:welcome', () => {
      this.setRoomCode(ctx.state.roomCode);
      this.setAct(ctx.state.act);
      this.refreshParty();
      this.refreshObjective();
    });

    ev.on('world:travel-end', ({ location }) => {
      this.locationEl.textContent = LOCATION_NAMES[location];
      this.refreshParty(); // elsewhere-glyphs are relative to where *you* are
      this.refreshObjective(); // objectives are phrased relative to where you stand
    });

    ev.on('story:flags', ({ act }) => {
      this.setAct(act);
      this.refreshObjective();
    });
    ev.on('story:ending', () => this.refreshObjective());

    ev.on('party:player-joined', () => {
      this.refreshParty();
      this.refreshObjective(); // solo vs co-op phrasing
    });
    ev.on('party:player-left', () => {
      this.refreshParty();
      this.refreshObjective();
    });
    ev.on('party:player-location', () => this.refreshParty());
    ev.on('focus:changed', () => this.refreshParty());
  }

  /** Bottom-center gold prompt; null hides it. */
  setInteractPrompt(text: string | null): void {
    if (text === null) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.promptText.textContent = ` ${text}`;
    this.prompt.classList.remove('hidden');
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.ui.gameReady || this.ui.inputCaptured || e.repeat) return;
    // Digit1..Digit8 → emotes (layout-independent via e.code).
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= EMOTES.length) this.sendEmote(EMOTES[n - 1].id);
    }
  };

  private sendEmote(emote: (typeof EMOTES)[number]['id']): void {
    this.ctx?.net.send({ t: 'emote', emote });
  }

  private setNetStatus(status: NetStatus): void {
    this.connPill.textContent = PILL_TEXT[status];
    this.connPill.className = `hud-pill ${PILL_CLASS[status]}`;
  }

  /** Re-derive the objective line from mirrored campaign state. */
  private refreshObjective(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.net.offlineMode) {
      this.objectiveEl.textContent = 'Explore freely — the story sleeps without the Veil server';
      return;
    }
    // Keyed on the rendered text, not the id: the phrasing also shifts with
    // party size (solo vs co-op ritual wording).
    const objective = resolveObjective(ctx.state);
    if (objective.text === this.lastObjectiveText) return;
    this.lastObjectiveText = objective.text;
    this.objectiveEl.textContent = objective.text;
    // Re-trigger the settle-in animation so a new goal catches the eye.
    this.objectiveEl.classList.remove('hud-objective-new');
    void this.objectiveEl.offsetWidth; // restart the CSS animation
    this.objectiveEl.classList.add('hud-objective-new');
  }

  private setAct(act: number): void {
    this.actEl.textContent = `Act ${actRoman(act)}`;
  }

  private setRoomCode(code: string): void {
    if (!code) {
      this.roomChip.classList.add('hidden');
      return;
    }
    this.roomChip.textContent = code;
    this.roomChip.classList.remove('hidden');
  }

  private copyRoomCode(): void {
    const code = this.ctx?.state.roomCode;
    if (!code) return;
    void navigator.clipboard?.writeText(code).then(
      () => this.ui.toast('Room code copied — share it with your crew', 'info'),
      () => this.ui.toast(`Room code: ${code}`, 'info'),
    );
  }

  /** Rebuild the party list from ClientState (≤10 rows; cheap). */
  private refreshParty(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.partyList.replaceChildren();

    const you = ctx.state.you;
    const players = [...ctx.state.players.values()].sort((a, b) => {
      // You first, then join order.
      if (a.id === ctx.state.playerId) return -1;
      if (b.id === ctx.state.playerId) return 1;
      return a.joinedAt - b.joinedAt;
    });

    for (const p of players) {
      const row = el('div', `party-row${p.online ? '' : ' party-offline'}`);
      const dot = el('span', 'party-dot');
      const color = ARCHETYPES[p.archetype].colorCss;
      dot.style.background = color;
      dot.style.color = color; // currentColor drives the glow
      row.appendChild(dot);
      row.appendChild(el('span', 'party-name', p.id === ctx.state.playerId ? `${p.name} (you)` : p.name));
      if (ctx.state.focusHolder === p.id) {
        const anchor = el('span', 'party-glyph party-anchor', '◈');
        anchor.title = 'anchoring this moment';
        row.appendChild(anchor);
      }
      if (you && p.location !== you.location) {
        const glyph = el('span', 'party-glyph', '↗');
        glyph.title = `in ${LOCATION_NAMES[p.location]}`;
        row.appendChild(glyph);
      }
      this.partyList.appendChild(row);
    }
  }
}
