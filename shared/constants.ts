/**
 * shared/constants.ts
 * Canonical IDs and tuning constants shared by the client (src/) and the
 * Workers backend (worker/). This file is the single source of truth for
 * location ids, music moods, emotes, SFX ids and net cadence. Add new ids
 * here first; both sides import from this module.
 */

export const PROTOCOL_VERSION = 1;

// ── Networking cadence ───────────────────────────────────────────────────────
/** How often the server broadcasts the position batch (ms). */
export const NET_TICK_MS = 100;
/** How often the client sends its own position (ms). */
export const CLIENT_MOVE_MS = 100;
/** Remote players are rendered this far in the past for smooth interpolation (ms). */
export const INTERP_DELAY_MS = 150;
/** Client keepalive ping cadence (ms). */
export const PING_INTERVAL_MS = 20_000;

export const MAX_PLAYERS = 10;
export const MAX_CHAT_LEN = 240;
export const MAX_NAME_LEN = 20;

// ── Locations ────────────────────────────────────────────────────────────────
export const LOCATION_IDS = [
  'skyharbor',
  'caelis',
  'sunken-archive',
  'wandering-wood',
  'mirrormere',
  'heart-of-the-veil',
] as const;

export type LocationId = (typeof LOCATION_IDS)[number];

export const LOCATION_NAMES: Record<LocationId, string> = {
  'skyharbor': 'The Skyharbor',
  'caelis': 'Caelis, the Crystal City',
  'sunken-archive': 'The Sunken Archive',
  'wandering-wood': 'The Wandering Wood',
  'mirrormere': 'The Mirrormere',
  'heart-of-the-veil': 'The Heart of the Veil',
};

/** Where new players and new campaigns begin. */
export const STARTING_LOCATION: LocationId = 'skyharbor';

export function isLocationId(value: unknown): value is LocationId {
  return typeof value === 'string' && (LOCATION_IDS as readonly string[]).includes(value);
}

// ── Music moods (adaptive soundtrack states) ─────────────────────────────────
export const MUSIC_MOODS = [
  'menu',
  'ambient',
  'exploration',
  'tension',
  'climax',
  'hopeful',
] as const;

export type MusicMood = (typeof MUSIC_MOODS)[number];

export function isMusicMood(value: unknown): value is MusicMood {
  return typeof value === 'string' && (MUSIC_MOODS as readonly string[]).includes(value);
}

// ── Emotes ───────────────────────────────────────────────────────────────────
export const EMOTES = [
  { id: 'wave', icon: '👋', label: 'Wave' },
  { id: 'dance', icon: '💃', label: 'Dance' },
  { id: 'point', icon: '👉', label: 'Point' },
  { id: 'laugh', icon: '😄', label: 'Laugh' },
  { id: 'heart', icon: '💖', label: 'Heart' },
  { id: 'sparkle', icon: '✨', label: 'Sparkle' },
  { id: 'ponder', icon: '🤔', label: 'Ponder' },
  { id: 'cheer', icon: '🎉', label: 'Cheer' },
] as const;

export type EmoteId = (typeof EMOTES)[number]['id'];

export function isEmoteId(value: unknown): value is EmoteId {
  return typeof value === 'string' && EMOTES.some((e) => e.id === value);
}

// ── Sound effects ────────────────────────────────────────────────────────────
export const SFX_IDS = [
  'ui-click',
  'ui-open',
  'ui-close',
  'chime',
  'interact',
  'denied',
  'portal',
  'chat',
  'emote',
  'journal',
  'choice-open',
  'choice-result',
  'item',
  'beat',
  'focus-on',
  'focus-off',
  'success',
  'hush',
  'player-join',
  'player-leave',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

// ── Player animation state (sent over the wire, drives avatar motion) ───────
export type AnimState = 'idle' | 'walk' | 'run';

// ── Room codes (one code = one campaign = one Durable Object) ────────────────
export const ROOM_CODE_LEN = 6;
/** Unambiguous alphabet: no 0/O/1/I. */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LEN) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
