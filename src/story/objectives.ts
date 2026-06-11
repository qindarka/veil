/**
 * src/story/objectives.ts
 * The "what do I do now?" layer. Resolves the campaign's mirrored flag state
 * into one current party objective: a short HUD line plus the interactable
 * ids the world should mark with guidance beacons. Pure derivation from
 * ClientState — works identically for late joiners and after reconnects.
 *
 * This intentionally tracks only the golden path (the 90-minute spine).
 * Side content (lore, archetype gifts, Mirrormere) stays discoverable, not
 * directed.
 */

import type { LocationId } from '../../shared/constants';
import type { ClientState } from '../state';

export interface Objective {
  /** Stable id — consumers re-render only when this changes. */
  id: string;
  /** Short imperative HUD line, e.g. "Wake the three sky-glyphs". */
  text: string;
  /** Interactable ids to beacon. May live in another location (see `location`). */
  targetIds: string[];
  /** Where those targets are; when the player is elsewhere, beacon the portal. */
  location: LocationId | null;
}

/** Echo-location spines: ritual targets, shrine, portal-from-skyharbor. */
const ECHO_ARCS: Array<{
  location: LocationId;
  echoFlag: string;
  attunedFlag: string;
  ritualIds: string[];
  ritualText: string;
  shrineId: string;
  shrineText: string;
}> = [
  {
    location: 'caelis',
    echoFlag: 'echo-caelis',
    attunedFlag: 'caelis-attuned',
    ritualIds: ['cae_resonance_1', 'cae_resonance_2', 'cae_resonance_3'],
    ritualText: 'Attune the three resonance crystals — spread out and sound them together',
    shrineId: 'cae_hush_shard',
    shrineText: 'Gather at the Hush Shard — the party must decide its fate',
  },
  {
    location: 'sunken-archive',
    echoFlag: 'echo-archive',
    attunedFlag: 'archive-attuned',
    ritualIds: ['arc_glyph_1', 'arc_glyph_2', 'arc_glyph_3'],
    ritualText: 'Light the three archive glyphs — spread out and wake them together',
    shrineId: 'arc_memory_pool',
    shrineText: 'Gather at the Memory Pool — the party must decide what it holds',
  },
  {
    location: 'wandering-wood',
    echoFlag: 'echo-wood',
    attunedFlag: 'wood-attuned',
    ritualIds: ['wood_waystone_1', 'wood_waystone_2', 'wood_waystone_3'],
    ritualText: 'Wake the three waystones — spread out and touch them together',
    shrineId: 'wood_heartwood',
    shrineText: 'Gather at the Heartwood — the party must decide how it grows',
  },
];

/** Portal id (in skyharbor) for each act-2/3 destination. */
const SKY_PORTALS: Partial<Record<LocationId, string>> = {
  'caelis': 'sky_portal_caelis',
  'sunken-archive': 'sky_portal_archive',
  'wandering-wood': 'sky_portal_wood',
  'mirrormere': 'sky_portal_mirrormere',
  'heart-of-the-veil': 'sky_portal_heart',
};

export function resolveObjective(state: ClientState): Objective {
  const has = (f: string) => state.flags.has(f);
  const here = state.you?.location ?? null;

  // ── Epilogue ───────────────────────────────────────────────────────────────
  if (state.endingId) {
    return {
      id: 'epilogue',
      text: 'Linger as long as you like — the Veil remembers you',
      targetIds: [],
      location: null,
    };
  }

  // ── Act 1: the Skyharbor ───────────────────────────────────────────────────
  if (!has('serai-met')) {
    return {
      id: 'meet-serai',
      text: 'Seek the keeper of the lanterns',
      targetIds: ['sky_echo_serai'],
      location: 'skyharbor',
    };
  }
  if (!has('awakened')) {
    return {
      id: 'awakening',
      text: 'Wake the three sky-glyphs — together, within a breath',
      targetIds: ['sky_glyph_1', 'sky_glyph_2', 'sky_glyph_3'],
      location: 'skyharbor',
    };
  }

  // ── Act 3: the Heart ───────────────────────────────────────────────────────
  if (has('act3-open')) {
    if (!has('heart-ritual')) {
      return {
        id: 'heart-ritual',
        text: 'Descend to the Heart — light the five glyphs around the Loom',
        targetIds: ['heart_glyph_1', 'heart_glyph_2', 'heart_glyph_3', 'heart_glyph_4', 'heart_glyph_5'],
        location: 'heart-of-the-veil',
      };
    }
    return {
      id: 'final-choice',
      text: 'The Loom awaits the party’s final choice',
      targetIds: ['heart_loom'],
      location: 'heart-of-the-veil',
    };
  }

  // ── Act 2: the Echoes ──────────────────────────────────────────────────────
  // If we're standing in an unfinished echo location, direct its local spine.
  const localArc = ECHO_ARCS.find((a) => a.location === here && !has(a.echoFlag));
  if (localArc) {
    if (!has(localArc.attunedFlag)) {
      return {
        id: `${localArc.location}-ritual`,
        text: localArc.ritualText,
        targetIds: localArc.ritualIds,
        location: localArc.location,
      };
    }
    return {
      id: `${localArc.location}-shrine`,
      text: localArc.shrineText,
      targetIds: [localArc.shrineId],
      location: localArc.location,
    };
  }

  // Otherwise point at the remaining waygates (two echoes open Act 3).
  const remaining = ECHO_ARCS.filter((a) => !has(a.echoFlag));
  if (remaining.length > 0) {
    return {
      id: 'recover-echoes',
      text:
        remaining.length === 3
          ? 'Take a waygate — three Echoes wait beyond the sky'
          : `Recover the missing Echo${remaining.length > 1 ? 'es' : ''} beyond the waygates`,
      targetIds: remaining
        .map((a) => SKY_PORTALS[a.location])
        .filter((id): id is string => id !== undefined),
      location: 'skyharbor',
    };
  }

  // All echoes home but the act-3 gate beat hasn't landed yet (it fires
  // within a moment of the second echo) — breathe.
  return {
    id: 'act3-pending',
    text: 'The Loom is weaving — return to the Skyharbor',
    targetIds: ['sky_loom'],
    location: 'skyharbor',
  };
}

/**
 * Re-target an objective for the player's current location: if its targets
 * are elsewhere, beacon the local portal that leads toward them (any portal
 * to the target location, else any portal home to the Skyharbor hub).
 */
export function localTargets(
  objective: Objective,
  here: LocationId | null,
  portals: Array<{ id: string; to: LocationId }>,
): string[] {
  if (objective.location === null || objective.location === here) return objective.targetIds;
  const direct = portals.filter((p) => p.to === objective.location).map((p) => p.id);
  if (direct.length > 0) return direct;
  return portals.filter((p) => p.to === 'skyharbor').map((p) => p.id);
}
