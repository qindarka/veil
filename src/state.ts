/**
 * src/state.ts
 * ClientState is the client's mirror of the authoritative campaign state held
 * by the Durable Object. It is a plain data holder: the NetworkClient mutates
 * it as server messages arrive and then emits the corresponding typed events;
 * everything else reads from it.
 */

import { STARTING_LOCATION } from '../shared/constants';
import type { LocationId, MusicMood } from '../shared/constants';
import type {
  ActiveChoiceState,
  ItemStack,
  JournalEntry,
  PlayerId,
  PlayerInfo,
  Snapshot,
} from '../shared/protocol';
import type { GameSettings } from './types';

export class ClientState {
  playerId: PlayerId | null = null;
  roomCode = '';

  /** The local player's PlayerInfo (also present in `players`). */
  you: PlayerInfo | null = null;
  players = new Map<PlayerId, PlayerInfo>();

  flags = new Set<string>();
  unlocked: LocationId[] = [STARTING_LOCATION];
  journal: JournalEntry[] = [];
  relationships: Record<string, number> = {};
  inventories = new Map<PlayerId, ItemStack[]>();
  mood: MusicMood = 'menu';
  act = 1;
  firedBeats = new Set<string>();
  focusHolder: PlayerId | null = null;
  activeChoice: ActiveChoiceState | null = null;
  endingId: string | null = null;

  settings: GameSettings = loadSettings();

  applySnapshot(snapshot: Snapshot, playerId: PlayerId): void {
    this.playerId = playerId;
    this.roomCode = snapshot.roomCode;
    this.you = snapshot.you;
    this.players = new Map(snapshot.players.map((p) => [p.id, p]));
    this.players.set(snapshot.you.id, snapshot.you);
    this.flags = new Set(snapshot.flags);
    this.unlocked = [...snapshot.unlocked];
    this.journal = [...snapshot.journal];
    this.relationships = { ...snapshot.relationships };
    this.inventories = new Map(
      Object.entries(snapshot.inventories).map(([id, items]) => [id, [...items]]),
    );
    this.mood = snapshot.mood;
    this.act = snapshot.act;
    this.firedBeats = new Set(snapshot.firedBeats);
    this.focusHolder = snapshot.focusHolder;
    this.activeChoice = snapshot.activeChoice;
    this.endingId = snapshot.endingId;
  }

  upsertPlayer(player: PlayerInfo): void {
    this.players.set(player.id, player);
    if (player.id === this.playerId) this.you = player;
  }

  getPlayer(id: PlayerId): PlayerInfo | undefined {
    return this.players.get(id);
  }

  myInventory(): ItemStack[] {
    return this.playerId ? (this.inventories.get(this.playerId) ?? []) : [];
  }

  isUnlocked(location: LocationId): boolean {
    return this.unlocked.includes(location);
  }
}

// ── Settings persistence ─────────────────────────────────────────────────────

const SETTINGS_KEY = 'veil:settings';

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  showNameTags: true,
  invertY: false,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings just won't persist.
  }
}

// ── Player identity ──────────────────────────────────────────────────────────

/**
 * A stable random token per (tab, room) lets the server recognize a returning
 * player and restore their name, archetype, stats and inventory across
 * sessions of the same campaign.
 *
 * Ownership dance: the token is *claimed* into sessionStorage (per-tab) and
 * removed from localStorage while the tab lives, then returned on pagehide.
 * This way a second tab in the same browser gets a fresh identity instead of
 * stealing the first tab's session (the server kicks duplicate tokens), while
 * the common single-tab case still resumes the same identity days later.
 * If the browser is killed hard, the token is lost and the next session gets
 * a fresh identity — campaign progress is room-scoped and unaffected.
 */
export function getOrCreatePlayerToken(roomCode: string): string {
  const key = `veil:token:${roomCode}`;
  try {
    const claimed = sessionStorage.getItem(key);
    if (claimed) return claimed;
    let token = localStorage.getItem(key);
    if (token) {
      localStorage.removeItem(key); // claim it for this tab
    } else {
      token = crypto.randomUUID();
    }
    sessionStorage.setItem(key, token);
    const release = () => {
      try {
        localStorage.setItem(key, token);
      } catch {
        // Nothing to do: identity simply won't persist to the next session.
      }
    };
    window.addEventListener('pagehide', release);
    return token;
  } catch {
    return crypto.randomUUID();
  }
}
