/**
 * shared/story.ts
 * The data-driven story schema. The entire campaign — beats, triggers,
 * branches, choices, effects, random events, endings — is declared as data in
 * shared/storyData.ts conforming to these types, and *interpreted* by the
 * authoritative StoryDirector in the Durable Object. The client only renders
 * what the server broadcasts.
 *
 * Key conventions (the StoryDirector implements these):
 *  - Beats are `once: true` by default: they fire one time per campaign and
 *    are recorded in `firedBeats`. Re-interacting with the source object
 *    re-sends the beat text to that player only, with no effects re-applied.
 *  - When a group choice resolves, the director automatically sets the flag
 *    `choice:<choiceId>:<winningOptionId>`. Branches hang off those flags via
 *    `when` conditions.
 *  - `trigger.type === 'flags'` beats are re-evaluated after every flag
 *    change and fire as soon as their `when` expression is satisfied.
 *  - Effects are applied in array order.
 */

import type { LocationId, MusicMood } from './constants';
import type { RandomEventFx } from './protocol';

// ── Flag expressions ─────────────────────────────────────────────────────────

export interface FlagExpr {
  /** All of these flags must be set. */
  all?: string[];
  /** At least one of these flags must be set. */
  any?: string[];
  /** None of these flags may be set. */
  none?: string[];
}

export function evaluateFlagExpr(expr: FlagExpr | undefined, flags: ReadonlySet<string>): boolean {
  if (!expr) return true;
  if (expr.all && !expr.all.every((f) => flags.has(f))) return false;
  if (expr.any && expr.any.length > 0 && !expr.any.some((f) => flags.has(f))) return false;
  if (expr.none && expr.none.some((f) => flags.has(f))) return false;
  return true;
}

/** Flag the director sets automatically when a choice resolves. */
export function choiceFlag(choiceId: string, optionId: string): string {
  return `choice:${choiceId}:${optionId}`;
}

// ── Triggers ─────────────────────────────────────────────────────────────────

export type BeatTrigger =
  /** Fires when any player enters the location (after `when` passes). */
  | { type: 'enterLocation'; location: LocationId }
  /** Fires when any player interacts with the object. */
  | { type: 'interact'; objectId: string }
  /**
   * Co-op puzzle: fires once all listed objects have been interacted with
   * within `windowMs` of each other (default 30000). Interactions may come
   * from one player or many — spreading the objects apart makes it co-op.
   */
  | { type: 'allInteract'; objectIds: string[]; windowMs?: number }
  /** Fires as soon as the beat's `when` expression becomes true. */
  | { type: 'flags' }
  /** Fires when the given choice resolves (optionally to a specific option). */
  | { type: 'choiceResolved'; choiceId: string; optionId?: string }
  /** Only fired explicitly via a `triggerBeat` effect. */
  | { type: 'manual' };

// ── Effects ──────────────────────────────────────────────────────────────────

export type BeatEffect =
  | { type: 'setFlag'; flag: string }
  | { type: 'clearFlag'; flag: string }
  | { type: 'unlockLocation'; location: LocationId }
  | { type: 'journal'; category: 'story' | 'lore' | 'clue' | 'system'; title: string; text: string }
  | { type: 'mood'; mood: MusicMood }
  /** Grant an item; `interactor` = the triggering player, `all` = whole party. */
  | { type: 'giveItem'; itemId: string; to: 'interactor' | 'all' }
  | { type: 'relationship'; npcId: string; delta: number }
  /** Fire another (usually `manual`) beat, optionally after a delay. */
  | { type: 'triggerBeat'; beatId: string; delayMs?: number }
  | { type: 'setAct'; act: 1 | 2 | 3 }
  /** Resolve the campaign to an ending (epilogue mode; play continues). */
  | { type: 'ending'; endingId: string };

// ── Beats and choices ────────────────────────────────────────────────────────

export interface StoryChoiceDef {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string; description: string }>;
  /** Voting window; the director resolves early if every online player votes. */
  durationMs: number;
}

export interface StoryBeatDef {
  id: string;
  act: 1 | 2 | 3;
  title: string;
  /** Narrative prose. Shown in the story overlay and logged to the journal's story log. */
  text: string;
  /** Npc id from StoryData.npcs; resolved to display name/color on the wire. */
  speaker?: string;
  /** Location this beat belongs to (used for journal entries and filtering). */
  location?: LocationId;
  trigger: BeatTrigger;
  /** Additional flag conditions gating the trigger. */
  when?: FlagExpr;
  /** Default true. Non-once beats can fire repeatedly. */
  once?: boolean;
  /**
   * Bonus prose revealed if any player anchors the scene (focus mode) while
   * this is the most recent beat. Broadcast once as an addendum beat.
   */
  focusText?: string;
  /** Opens a group vote when the beat fires. */
  choice?: StoryChoiceDef;
  effects?: BeatEffect[];
}

// ── Supporting content ───────────────────────────────────────────────────────

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  /** CSS hex color for dialogue attribution, e.g. '#ffd27a'. */
  color: string;
  description: string;
}

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  /** Emoji icon (swap-friendly placeholder for real icon art). */
  icon: string;
}

export interface RandomEventDef {
  id: string;
  title: string;
  text: string;
  /** Restrict to these locations; omit for anywhere. */
  locations?: LocationId[];
  /** Temporarily shift the soundtrack for durationMs. */
  mood?: MusicMood;
  durationMs: number;
  /** Relative likelihood when rolling (>= 1). */
  weight: number;
  fx?: RandomEventFx;
  /** Only roll this event at or after this act. */
  minAct?: 1 | 2 | 3;
}

export interface EndingDef {
  id: string;
  title: string;
  text: string;
  /** Epilogue fragments; each is included when its `when` expression passes. */
  epilogue: Array<{ when?: FlagExpr; text: string }>;
}

// ── The whole campaign ───────────────────────────────────────────────────────

export interface StoryData {
  npcs: Record<string, NpcDef>;
  items: Record<string, ItemDef>;
  beats: StoryBeatDef[];
  randomEvents: RandomEventDef[];
  endings: Record<string, EndingDef>;
  /** Flavor lines shown on loading screens. */
  loreTips: string[];
}

export function findBeat(data: StoryData, beatId: string): StoryBeatDef | undefined {
  return data.beats.find((b) => b.id === beatId);
}
