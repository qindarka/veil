/**
 * shared/protocol.ts
 * The complete WebSocket wire protocol between the client and the VeilRoom
 * Durable Object, plus the data shapes that cross the wire (player info,
 * journal entries, snapshots...). All messages are JSON with a short `t` tag.
 *
 * Rules of the road:
 *  - The server is authoritative for story state, flags, unlocks, journal,
 *    inventory, relationships, focus and votes.
 *  - The client is authoritative only for its own avatar position (trusted
 *    co-op; no anti-cheat needed for a friends game).
 *  - Never repurpose a message tag; add a new one and bump PROTOCOL_VERSION
 *    when changing shapes incompatibly.
 */

import type { ArchetypeId } from './archetypes';
import type {
  AnimState,
  EmoteId,
  LocationId,
  MusicMood,
} from './constants';

export type PlayerId = string;
export type Vec3 = [number, number, number];

// ── Persistent per-player data ───────────────────────────────────────────────

export interface PlayerStats {
  /** Interactions performed (glyphs, echoes, lore...). */
  interactions: number;
  /** Votes cast in group choices. */
  votesCast: number;
  /** Story beats this player was online to witness. */
  beatsWitnessed: number;
}

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  archetype: ArchetypeId;
  location: LocationId;
  pos: Vec3;
  yaw: number;
  online: boolean;
  stats: PlayerStats;
  joinedAt: number;
}

export interface ItemStack {
  id: string;
  name: string;
  description: string;
  /** Emoji used as the inventory icon (asset-swap friendly). */
  icon: string;
  count: number;
}

export interface JournalEntry {
  id: string;
  /** Epoch ms when the entry was written. */
  at: number;
  category: 'story' | 'lore' | 'clue' | 'system';
  title: string;
  text: string;
  location?: LocationId;
}

// ── Story payloads (rendered by the client, produced by the server) ─────────

export interface StoryChoicePayload {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string; description: string }>;
  /** Voting window in ms; the server resolves at the deadline or when all online players voted. */
  durationMs: number;
}

export interface StoryBeatPayload {
  id: string;
  act: number;
  title: string;
  text: string;
  /** Display name of the speaking Echo, if any. */
  speaker?: string;
  /** CSS color for the speaker name. */
  speakerColor?: string;
  location?: LocationId;
  /** True when this is bonus prose revealed through focus mode (anchoring). */
  isAddendum?: boolean;
}

export type RandomEventFx = 'motes' | 'aurora' | 'hush' | 'sparkfall' | 'none';

export interface RandomEventPayload {
  id: string;
  title: string;
  text: string;
  /** null = happens wherever you are. */
  location: LocationId | null;
  mood?: MusicMood;
  durationMs: number;
  fx?: RandomEventFx;
}

export interface EndingPayload {
  id: string;
  title: string;
  text: string;
  /** Extra epilogue paragraphs, already filtered for this campaign's flags. */
  epilogue: string[];
}

export interface ActiveChoiceState {
  choice: StoryChoicePayload;
  endsAt: number;
  tally: Record<string, number>;
  votedIds: PlayerId[];
}

// ── Snapshot (full state, sent on welcome/reconnect) ─────────────────────────

export interface Snapshot {
  protocolVersion: number;
  roomCode: string;
  you: PlayerInfo;
  players: PlayerInfo[];
  flags: string[];
  unlocked: LocationId[];
  journal: JournalEntry[];
  /** Campaign-level relationships with the Echoes, npcId -> score. */
  relationships: Record<string, number>;
  inventories: Record<PlayerId, ItemStack[]>;
  mood: MusicMood;
  act: number;
  firedBeats: string[];
  focusHolder: PlayerId | null;
  activeChoice: ActiveChoiceState | null;
  /** Set once a final choice has resolved; campaign continues in epilogue mode. */
  endingId: string | null;
  /**
   * Full ending payload when endingId is set, so a player who was offline at
   * the moment the finale fired can still see it on (re)join.
   */
  ending: EndingPayload | null;
}

/** One player's entry in the 10Hz position broadcast. */
export interface PlayerTick {
  id: PlayerId;
  p: Vec3;
  ry: number;
  a: AnimState;
  loc: LocationId;
}

// ── Client → Server ──────────────────────────────────────────────────────────

export type ClientMsg =
  | { t: 'join'; name: string; archetype: ArchetypeId; token: string; protocolVersion: number }
  | { t: 'move'; p: Vec3; ry: number; a: AnimState }
  | { t: 'chat'; text: string }
  | { t: 'emote'; emote: EmoteId }
  | { t: 'interact'; objectId: string }
  | { t: 'enterLocation'; location: LocationId }
  | { t: 'vote'; choiceId: string; optionId: string }
  | { t: 'focus'; on: boolean }
  | { t: 'ping'; ts: number };

// ── Server → Client ──────────────────────────────────────────────────────────

export type ServerErrorCode = 'room-full' | 'bad-message' | 'protocol-mismatch' | 'unknown';

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; snapshot: Snapshot }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; playerId: PlayerId; name: string }
  | { t: 'state'; players: PlayerTick[] }
  | { t: 'chat'; from: PlayerId; name: string; text: string }
  | { t: 'emote'; from: PlayerId; name: string; emote: EmoteId }
  | { t: 'story'; beat: StoryBeatPayload }
  | { t: 'choiceOpen'; choice: StoryChoicePayload; endsAt: number }
  | { t: 'voteTally'; choiceId: string; tally: Record<string, number>; votedIds: PlayerId[] }
  | { t: 'choiceResult'; choiceId: string; optionId: string; optionLabel: string }
  | { t: 'flags'; flags: string[]; act: number }
  | { t: 'locations'; unlocked: LocationId[] }
  | { t: 'journal'; entry: JournalEntry }
  | { t: 'inventory'; playerId: PlayerId; items: ItemStack[] }
  | { t: 'relationships'; relationships: Record<string, number> }
  | { t: 'playerLoc'; playerId: PlayerId; location: LocationId }
  | { t: 'stats'; playerId: PlayerId; stats: PlayerStats }
  | { t: 'focus'; holderId: PlayerId | null; holderName: string | null }
  | { t: 'mood'; mood: MusicMood }
  | { t: 'event'; event: RandomEventPayload }
  | { t: 'denied'; objectId?: string; reason: string }
  | { t: 'travelDenied'; location: LocationId; reason: string }
  | { t: 'ending'; ending: EndingPayload }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: ServerErrorCode; message: string };

// ── Light validation helpers (used by the Worker on untrusted input) ─────────

const CLIENT_MSG_TAGS = [
  'join',
  'move',
  'chat',
  'emote',
  'interact',
  'enterLocation',
  'vote',
  'focus',
  'ping',
] as const;

/**
 * Cheap structural check that a parsed JSON value looks like a ClientMsg.
 * Field-level validation (name length, location ids...) is done per-handler
 * in the Durable Object.
 */
export function isClientMsgShape(value: unknown): value is ClientMsg {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' && (CLIENT_MSG_TAGS as readonly string[]).includes(t);
}
