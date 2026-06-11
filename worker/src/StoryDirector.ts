/**
 * worker/src/StoryDirector.ts
 * The authoritative interpreter of the data-driven campaign declared in
 * shared/storyData.ts (schema: shared/story.ts). The director decides which
 * story beats fire, runs group choices/votes, reveals focus addenda and rolls
 * random ambient events. The client never decides anything narrative; it only
 * renders what this module broadcasts.
 *
 * State-ownership model (one of the two allowed approaches, chosen here):
 * the VeilRoom Durable Object OWNS loading/saving of the CampaignState object,
 * and hands the director a `getCampaign()` accessor to that same live object.
 * The director mutates campaign sub-state (flags, firedBeats, activeChoice,
 * allInteractProgress, mood, act, unlocked, relationships, ...) directly and
 * calls `host.persist()` to schedule a debounced storage write. Everything
 * socket- or player-record-related (broadcast, inventories, journal, stats)
 * goes through narrow host callbacks so player data stays owned by VeilRoom.
 */

import type { LocationId, MusicMood } from '../../shared/constants';
import { STARTING_LOCATION } from '../../shared/constants';
import type {
  ActiveChoiceState,
  EndingPayload,
  ItemStack,
  JournalEntry,
  PlayerId,
  RandomEventPayload,
  ServerMsg,
  StoryBeatPayload,
  StoryChoicePayload,
} from '../../shared/protocol';
import { choiceFlag, evaluateFlagExpr, findBeat } from '../../shared/story';
import type {
  BeatEffect,
  ItemDef,
  StoryBeatDef,
  StoryChoiceDef,
  StoryData,
} from '../../shared/story';
// shared/storyData.ts is authored by the story agent; until it lands, tsc
// reports TS2307 here — expected and ignorable per the build contract.
import { STORY } from '../../shared/storyData';

/** Typed view of the campaign content (keeps us honest even while the module
 * resolves to `any` before storyData.ts exists). */
const data: StoryData = STORY;

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Co-op ritual window: all listed objects must be touched within this span. */
const DEFAULT_ALL_INTERACT_WINDOW_MS = 30_000;
/** Random ambient events roll every 75–120 s. */
const EVENT_ROLL_MIN_MS = 75_000;
const EVENT_ROLL_JITTER_MS = 45_000;
/** Relationship scores are clamped to this range. */
const REL_MIN = -10;
const REL_MAX = 10;
/** Defensive cap on flag-cascade recursion (setFlag -> beat -> setFlag ...). */
const MAX_FLAG_CASCADE_DEPTH = 16;

/** Short collision-unlikely id for journal entries / player ids. */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Persistent campaign state (stored under the "campaign" key by VeilRoom) ──

export interface ActiveChoiceRecord {
  choice: StoryChoicePayload;
  /** Epoch ms deadline; the room tick resolves the vote at/after this time. */
  endsAt: number;
  /** playerId -> optionId. Re-votes overwrite until resolution. */
  votes: Record<PlayerId, string>;
}

export interface CampaignState {
  flags: string[];
  unlocked: LocationId[];
  act: number;
  firedBeats: string[];
  /** npcId -> score in [-10, 10]. */
  relationships: Record<string, number>;
  mood: MusicMood;
  endingId: string | null;
  activeChoice: ActiveChoiceRecord | null;
  /** Beat ids whose focusText has already been revealed via anchoring. */
  revealedFocusBeats: string[];
  /** Most recently fired beat — the target of a focus-mode reveal. */
  lastBeatId: string | null;
  /** beatId -> objectId -> epoch ms of the latest touch (allInteract rituals). */
  allInteractProgress: Record<string, Record<string, number>>;
  /** Resolved group choices, oldest first. */
  choiceLog: Array<{ choiceId: string; optionId: string; at: number }>;
  /**
   * Choice-bearing beats that triggered while another vote was running.
   * Firing them immediately would consume the once-beat and silently drop its
   * vote (potentially stranding the campaign), so they wait here and fire one
   * at a time as votes resolve.
   */
  pendingChoiceBeats: Array<{ beatId: string; interactorId: PlayerId | null }>;
  /**
   * Durable replacement for setTimeout-delayed triggerBeat effects: drained
   * by the room tick, survives DO restarts and empty rooms (the Act 1 oath
   * rides on a 6s delay — it must not be lossable).
   */
  pendingDelayedBeats: Array<{ beatId: string; dueAt: number; interactorId: PlayerId | null }>;
}

export function createDefaultCampaign(): CampaignState {
  return {
    flags: [],
    unlocked: [STARTING_LOCATION],
    act: 1,
    firedBeats: [],
    relationships: {},
    mood: 'ambient',
    endingId: null,
    activeChoice: null,
    revealedFocusBeats: [],
    lastBeatId: null,
    allInteractProgress: {},
    choiceLog: [],
    pendingChoiceBeats: [],
    pendingDelayedBeats: [],
  };
}

// ── Host callback interface (implemented by VeilRoom) ────────────────────────

export interface DirectorHost {
  /** The live campaign object. The director mutates it; the host persists it. */
  getCampaign(): CampaignState;
  broadcast(msg: ServerMsg): void;
  sendTo(playerId: PlayerId, msg: ServerMsg): void;
  getOnlinePlayerIds(): PlayerId[];
  /** Every persisted member of the campaign, online or not. */
  getAllPlayerIds(): PlayerId[];
  getPlayerName(playerId: PlayerId): string;
  getPlayerLocation(playerId: PlayerId): LocationId | null;
  /** Append to the shared journal (host persists; the director broadcasts). */
  addJournal(entry: JournalEntry): void;
  /** Add one `item` to the player's inventory; returns the updated stacks. */
  giveItem(playerId: PlayerId, item: ItemDef): ItemStack[];
  /** stats.beatsWitnessed++ for each id; the host broadcasts their stats. */
  bumpBeatsWitnessed(playerIds: PlayerId[]): void;
  /** Schedule a debounced storage write of campaign + players + journal. */
  persist(): void;
}

// ── The director ─────────────────────────────────────────────────────────────

export class StoryDirector {
  private readonly host: DirectorHost;
  /** Epoch ms of the next random-event roll; 0 = not scheduled yet. */
  private nextEventRollAt = 0;
  /** Re-entrancy depth guard for flag-triggered beat cascades. */
  private cascadeDepth = 0;
  /** Set by setFlag/clearFlag effects; drained at the end of fireBeat. */
  private flagRecheckQueued = false;

  constructor(host: DirectorHost) {
    this.host = host;
  }

  private get campaign(): CampaignState {
    return this.host.getCampaign();
  }

  // ── Trigger entry points (called by VeilRoom) ──────────────────────────────

  /** A player arrived somewhere: fire all eligible enterLocation beats. */
  onEnterLocation(playerId: PlayerId, location: LocationId): void {
    for (const beat of data.beats) {
      if (beat.trigger.type !== 'enterLocation' || beat.trigger.location !== location) continue;
      if (!this.isEligible(beat)) continue;
      this.fireBeat(beat, playerId);
    }
  }

  /**
   * A player used an interactable. Returns true if anything stirred (a beat
   * fired, ritual progress was made, or fired prose was re-sent); false means
   * VeilRoom should answer with the generic "nothing stirs" whisper.
   */
  onInteract(playerId: PlayerId, objectId: string): boolean {
    const c = this.campaign;
    const now = Date.now();
    let stirred = false;

    // Co-op rituals: record this touch on every eligible allInteract beat
    // that lists the object, expiring touches older than the ritual window.
    for (const beat of data.beats) {
      const trig = beat.trigger;
      if (trig.type !== 'allInteract' || !trig.objectIds.includes(objectId)) continue;
      if (!this.isEligible(beat)) continue;
      const windowMs = trig.windowMs ?? DEFAULT_ALL_INTERACT_WINDOW_MS;
      const progress = (c.allInteractProgress[beat.id] ??= {});
      for (const [oid, at] of Object.entries(progress)) {
        if (now - at > windowMs) delete progress[oid];
      }
      progress[objectId] = now;
      // Partial progress is still a meaningful response — no "nothing stirs".
      stirred = true;
      if (trig.objectIds.every((oid) => progress[oid] !== undefined)) {
        delete c.allInteractProgress[beat.id];
        this.fireBeat(beat, playerId);
      }
      this.host.persist();
    }

    // Plain interact triggers: the first eligible beat (data order) wins.
    // Content gates alternatives on flags, so at most one should be eligible.
    for (const beat of data.beats) {
      if (beat.trigger.type !== 'interact' || beat.trigger.objectId !== objectId) continue;
      if (!this.isEligible(beat)) continue;
      this.fireBeat(beat, playerId);
      stirred = true;
      break;
    }

    // Re-interacting with an already-fired once-beat re-sends its prose to
    // that player only — no effects re-applied. We pick the LAST matching
    // fired beat in data order (the furthest point the story reached here).
    if (!stirred) {
      const fired = new Set(c.firedBeats);
      for (let i = data.beats.length - 1; i >= 0; i--) {
        const beat = data.beats[i];
        if (!fired.has(beat.id)) continue;
        const trig = beat.trigger;
        const matches =
          (trig.type === 'interact' && trig.objectId === objectId) ||
          (trig.type === 'allInteract' && trig.objectIds.includes(objectId));
        if (!matches) continue;
        this.host.sendTo(playerId, { t: 'story', beat: this.beatPayload(beat) });
        stirred = true;
        break;
      }
    }

    return stirred;
  }

  /**
   * A vote arrived. Returns 'first' when this is the player's first vote of
   * the active choice (VeilRoom bumps stats.votesCast), 'revote' for changes,
   * 'ignored' for stale/invalid votes.
   */
  onVote(playerId: PlayerId, choiceId: string, optionId: string): 'first' | 'revote' | 'ignored' {
    const ac = this.campaign.activeChoice;
    if (!ac || ac.choice.id !== choiceId) return 'ignored';
    if (!ac.choice.options.some((o) => o.id === optionId)) return 'ignored';
    const first = !(playerId in ac.votes);
    ac.votes[playerId] = optionId;
    this.host.broadcast({
      t: 'voteTally',
      choiceId: ac.choice.id,
      tally: this.computeTally(ac),
      votedIds: Object.keys(ac.votes),
    });
    this.host.persist();
    // Resolve early once every online player has spoken.
    const online = this.host.getOnlinePlayerIds();
    if (online.length > 0 && online.every((id) => ac.votes[id] !== undefined)) {
      this.resolveChoice();
    }
    return first ? 'first' : 'revote';
  }

  /** Focus mode was granted: reveal the latest beat's focusText (once). */
  onFocusGranted(_playerId: PlayerId): void {
    const c = this.campaign;
    if (!c.lastBeatId || c.revealedFocusBeats.includes(c.lastBeatId)) return;
    const beat = findBeat(data, c.lastBeatId);
    if (!beat || !beat.focusText) return;
    c.revealedFocusBeats.push(c.lastBeatId);
    const addendum: StoryBeatPayload = {
      ...this.beatPayload(beat),
      id: `${beat.id}:anchored`,
      title: `Anchored: ${beat.title}`,
      text: beat.focusText,
      isAddendum: true,
    };
    this.host.broadcast({ t: 'story', beat: addendum });
    this.host.persist();
  }

  /**
   * Called from the 10Hz room tick. Resolves the active choice when its
   * deadline passes, or early when everyone still online has voted (covers a
   * voter disconnecting after the last remaining ballot was cast).
   */
  checkDeadlines(now: number): void {
    // Durable delayed beats (triggerBeat with delayMs) that have come due.
    const c = this.campaign;
    if (c.pendingDelayedBeats.length > 0 && c.pendingDelayedBeats.some((p) => now >= p.dueAt)) {
      const due = c.pendingDelayedBeats.filter((p) => now >= p.dueAt);
      c.pendingDelayedBeats = c.pendingDelayedBeats.filter((p) => now < p.dueAt);
      for (const p of due) {
        const beat = findBeat(data, p.beatId);
        if (beat && this.isEligible(beat)) this.fireBeat(beat, p.interactorId);
      }
      this.host.persist();
    }

    const ac = this.campaign.activeChoice;
    if (!ac) return;
    if (now >= ac.endsAt) {
      this.resolveChoice();
      return;
    }
    const online = this.host.getOnlinePlayerIds();
    if (online.length > 0 && online.every((id) => ac.votes[id] !== undefined)) {
      this.resolveChoice();
    }
  }

  /** Snapshot view of the active choice (tally derived from raw votes). */
  getActiveChoiceState(): ActiveChoiceState | null {
    const ac = this.campaign.activeChoice;
    if (!ac) return null;
    return {
      choice: ac.choice,
      endsAt: ac.endsAt,
      tally: this.computeTally(ac),
      votedIds: Object.keys(ac.votes),
    };
  }

  // ── Random ambient events ──────────────────────────────────────────────────

  /**
   * Called from the room tick. Rolls a weighted random event every 75–120 s
   * (the delay between rolls is itself randomized). Location-bound events
   * only fire when an online player is at one of their locations.
   */
  maybeRollRandomEvent(now: number): void {
    if (this.nextEventRollAt === 0) {
      // First tick after construction/wake: schedule, don't fire immediately.
      this.nextEventRollAt = now + this.nextRollDelay();
      return;
    }
    if (now < this.nextEventRollAt) return;
    this.nextEventRollAt = now + this.nextRollDelay();

    const c = this.campaign;
    const online = this.host.getOnlinePlayerIds();
    if (online.length === 0) return;
    const occupied = new Set<LocationId>();
    for (const id of online) {
      const loc = this.host.getPlayerLocation(id);
      if (loc) occupied.add(loc);
    }

    const candidates = data.randomEvents.filter(
      (ev) =>
        (ev.minAct ?? 1) <= c.act &&
        (!ev.locations || ev.locations.some((l) => occupied.has(l))),
    );
    if (candidates.length === 0) return;

    // Weighted pick (weights are "relative likelihood >= 1").
    const total = candidates.reduce((sum, ev) => sum + Math.max(1, ev.weight), 0);
    let roll = Math.random() * total;
    let picked = candidates[candidates.length - 1];
    for (const ev of candidates) {
      roll -= Math.max(1, ev.weight);
      if (roll <= 0) {
        picked = ev;
        break;
      }
    }

    // Pin location-bound events to an occupied location; roaming events get null.
    let location: LocationId | null = null;
    if (picked.locations) {
      const options = picked.locations.filter((l) => occupied.has(l));
      location = options[Math.floor(Math.random() * options.length)] ?? null;
    }

    const payload: RandomEventPayload = {
      id: picked.id,
      title: picked.title,
      text: picked.text,
      location,
      mood: picked.mood,
      durationMs: picked.durationMs,
      fx: picked.fx,
    };
    this.host.broadcast({ t: 'event', event: payload });

    if (picked.mood) {
      // Temporary mood shift: broadcast but do NOT persist, then restore the
      // persisted campaign mood after the event ends. The setTimeout is safe
      // because the room's tick interval pins the DO in memory while anyone
      // is connected. (Overlapping mood-events simply restore last-wins.)
      this.host.broadcast({ t: 'mood', mood: picked.mood });
      setTimeout(() => {
        this.host.broadcast({ t: 'mood', mood: this.campaign.mood });
      }, picked.durationMs);
    }
  }

  private nextRollDelay(): number {
    return EVENT_ROLL_MIN_MS + Math.random() * EVENT_ROLL_JITTER_MS;
  }

  // ── Beat firing & effects ──────────────────────────────────────────────────

  /** Once-gate + `when` flag-expression gate. */
  private isEligible(beat: StoryBeatDef): boolean {
    const c = this.campaign;
    if (beat.once !== false && c.firedBeats.includes(beat.id)) return false;
    return evaluateFlagExpr(beat.when, new Set(c.flags));
  }

  private fireBeat(beat: StoryBeatDef, interactorId: PlayerId | null): void {
    const c = this.campaign;
    if (beat.choice && c.activeChoice) {
      // A group vote is already running. Consuming this once-beat now would
      // silently destroy its choice forever (re-interacts only re-send prose),
      // which can strand the campaign — e.g. losing two Act-2 echo choices
      // makes Act 3 unreachable. Defer the whole beat; it fires when the
      // current vote resolves.
      if (!c.pendingChoiceBeats.some((p) => p.beatId === beat.id)) {
        c.pendingChoiceBeats.push({ beatId: beat.id, interactorId });
        this.host.persist();
      }
      if (interactorId) {
        this.host.sendTo(interactorId, {
          t: 'denied',
          objectId: undefined,
          reason:
            'The Veil holds one question at a time — when the current choice settles, this moment will wake.',
        });
      }
      return;
    }
    if (beat.once !== false) {
      // Mark fired BEFORE broadcasting/effects so recursive cascades
      // (setFlag -> recheck -> this beat) can never double-fire it.
      if (c.firedBeats.includes(beat.id)) return;
      c.firedBeats.push(beat.id);
    }
    c.lastBeatId = beat.id;
    this.host.bumpBeatsWitnessed(this.host.getOnlinePlayerIds());
    this.host.broadcast({ t: 'story', beat: this.beatPayload(beat) });
    // Effects apply strictly in array order (shared/story.ts contract).
    for (const effect of beat.effects ?? []) {
      this.applyEffect(effect, beat, interactorId);
    }
    if (beat.choice) this.openChoice(beat.choice);
    // Flag-triggered beats fire only after THIS beat's effects are complete,
    // so a dependent beat can never interleave with the remaining effects.
    if (this.flagRecheckQueued) {
      this.flagRecheckQueued = false;
      this.recheckFlagBeats();
    }
    this.host.persist();
  }

  /** Resolve npc speaker id -> display name + color for the wire payload. */
  private beatPayload(beat: StoryBeatDef): StoryBeatPayload {
    const payload: StoryBeatPayload = {
      id: beat.id,
      act: beat.act,
      title: beat.title,
      text: beat.text,
    };
    if (beat.location) payload.location = beat.location;
    if (beat.speaker) {
      const npc = data.npcs[beat.speaker];
      payload.speaker = npc ? npc.name : beat.speaker;
      if (npc) payload.speakerColor = npc.color;
    }
    return payload;
  }

  private applyEffect(effect: BeatEffect, beat: StoryBeatDef, interactorId: PlayerId | null): void {
    const c = this.campaign;
    switch (effect.type) {
      case 'setFlag': {
        if (!c.flags.includes(effect.flag)) {
          c.flags.push(effect.flag);
          this.broadcastFlags();
          // Deferred: fireBeat() rechecks flag-triggered beats AFTER this
          // beat's remaining effects. Rechecking inline would fire dependent
          // beats mid-effect-list (e.g. the Act-3 gate firing inside an
          // echo-recovery beat, whose later 'hopeful' mood would then stomp
          // the gate's 'tension' and invert the journal order).
          this.flagRecheckQueued = true;
        }
        break;
      }
      case 'clearFlag': {
        const idx = c.flags.indexOf(effect.flag);
        if (idx >= 0) {
          c.flags.splice(idx, 1);
          this.broadcastFlags();
          // `none` conditions can become true when a flag clears, so recheck
          // (deferred, same as setFlag).
          this.flagRecheckQueued = true;
        }
        break;
      }
      case 'unlockLocation': {
        if (!c.unlocked.includes(effect.location)) {
          c.unlocked.push(effect.location);
          this.host.broadcast({ t: 'locations', unlocked: [...c.unlocked] });
        }
        break;
      }
      case 'journal': {
        const entry: JournalEntry = {
          id: shortId(),
          at: Date.now(),
          category: effect.category,
          title: effect.title,
          text: effect.text,
        };
        if (beat.location) entry.location = beat.location;
        this.host.addJournal(entry);
        this.host.broadcast({ t: 'journal', entry });
        break;
      }
      case 'mood': {
        c.mood = effect.mood; // persisted mood (random events only shift temporarily)
        this.host.persist();
        this.host.broadcast({ t: 'mood', mood: effect.mood });
        break;
      }
      case 'giveItem': {
        const item = data.items[effect.itemId];
        if (!item) break; // content error: unknown item id — skip silently
        // 'all' means every persisted member of the campaign — a player who is
        // briefly disconnected when an echo choice resolves must not lose the
        // memento forever. 'interactor' falls back to the online party when
        // the beat had no single actor (flags/choice-triggered beats).
        const targets =
          effect.to === 'all'
            ? this.host.getAllPlayerIds()
            : interactorId === null
              ? this.host.getOnlinePlayerIds()
              : [interactorId];
        for (const pid of targets) {
          const items = this.host.giveItem(pid, item);
          this.host.broadcast({ t: 'inventory', playerId: pid, items });
        }
        break;
      }
      case 'relationship': {
        const current = c.relationships[effect.npcId] ?? 0;
        c.relationships[effect.npcId] = Math.max(
          REL_MIN,
          Math.min(REL_MAX, current + effect.delta),
        );
        this.host.broadcast({ t: 'relationships', relationships: { ...c.relationships } });
        break;
      }
      case 'triggerBeat': {
        const target = findBeat(data, effect.beatId);
        if (!target) break; // content error: unknown beat id
        if (effect.delayMs && effect.delayMs > 0) {
          // Persisted, not setTimeout: the room tick drains these, so a DO
          // restart or an empty room can't lose a story-critical beat (the
          // Act 1 oath rides on a 6s delay). Eligibility is re-checked at
          // fire time (state may have moved on).
          c.pendingDelayedBeats.push({
            beatId: target.id,
            dueAt: Date.now() + effect.delayMs,
            interactorId,
          });
          this.host.persist();
        } else if (this.isEligible(target)) {
          this.fireBeat(target, interactorId);
        }
        break;
      }
      case 'setAct': {
        c.act = effect.act;
        this.host.persist();
        this.broadcastFlags(); // act rides on the flags message
        break;
      }
      case 'ending': {
        const ending = this.buildEndingPayload(effect.endingId);
        if (!ending) break; // content error: unknown ending id
        c.endingId = ending.id;
        this.host.broadcast({ t: 'ending', ending });
        // Endings resolve toward hope: settle the persisted mood afterwards.
        c.mood = 'hopeful';
        this.host.persist();
        this.host.broadcast({ t: 'mood', mood: 'hopeful' });
        break;
      }
    }
  }

  /**
   * Resolve an ending id to its wire payload with the epilogue pre-filtered
   * for this campaign's flags. Also used to rebuild the finale for snapshots,
   * so a player who was offline when it fired still gets the payoff.
   */
  buildEndingPayload(endingId: string): EndingPayload | null {
    const def = data.endings[endingId];
    if (!def) return null;
    const flagSet = new Set(this.campaign.flags);
    return {
      id: def.id,
      title: def.title,
      text: def.text,
      epilogue: def.epilogue
        .filter((frag) => evaluateFlagExpr(frag.when, flagSet))
        .map((frag) => frag.text),
    };
  }

  private broadcastFlags(): void {
    const c = this.campaign;
    this.host.broadcast({ t: 'flags', flags: [...c.flags], act: c.act });
  }

  /**
   * Re-evaluate every flags-triggered beat after a flag change. Firing one
   * may set further flags and recurse back in here; the depth guard caps
   * pathological content cycles. Eligibility is re-read per beat so beats
   * disqualified mid-cascade do not fire on stale flag state.
   */
  private recheckFlagBeats(): void {
    if (this.cascadeDepth >= MAX_FLAG_CASCADE_DEPTH) {
      console.warn('[StoryDirector] flag cascade depth cap hit — content cycle?');
      return;
    }
    this.cascadeDepth++;
    try {
      for (const beat of data.beats) {
        if (beat.trigger.type !== 'flags') continue;
        if (!this.isEligible(beat)) continue;
        this.fireBeat(beat, null);
      }
    } finally {
      this.cascadeDepth--;
    }
  }

  // ── Choices ────────────────────────────────────────────────────────────────

  private openChoice(def: StoryChoiceDef): void {
    const c = this.campaign;
    // Only one group vote may run at a time. Well-formed content never
    // overlaps choices; if it does, the later one is dropped rather than
    // clobbering an in-progress vote.
    if (c.activeChoice) return;
    if (def.options.length === 0) return; // defensive: unvotable choice
    const payload: StoryChoicePayload = {
      id: def.id,
      prompt: def.prompt,
      options: def.options.map((o) => ({ ...o })),
      durationMs: def.durationMs,
    };
    c.activeChoice = {
      choice: payload,
      endsAt: Date.now() + def.durationMs,
      votes: {},
    };
    this.host.broadcast({ t: 'choiceOpen', choice: payload, endsAt: c.activeChoice.endsAt });
    this.host.persist();
  }

  private computeTally(ac: ActiveChoiceRecord): Record<string, number> {
    const tally: Record<string, number> = {};
    for (const opt of ac.choice.options) tally[opt.id] = 0;
    for (const optionId of Object.values(ac.votes)) {
      tally[optionId] = (tally[optionId] ?? 0) + 1;
    }
    return tally;
  }

  /**
   * Majority wins; ties resolve to the earliest-listed option among the tied;
   * zero votes resolve to the earliest-listed option. Sets the canonical
   * `choice:<id>:<option>` flag, broadcasts the result, then fires dependent
   * choiceResolved beats and any flags-triggered beats the new flag enables.
   */
  private resolveChoice(): void {
    const c = this.campaign;
    const ac = c.activeChoice;
    if (!ac) return;
    // Clear first so a dependent beat may legally open the next choice.
    c.activeChoice = null;

    const tally = this.computeTally(ac);
    let winner = ac.choice.options[0];
    let best = tally[winner.id] ?? 0;
    for (const opt of ac.choice.options) {
      const count = tally[opt.id] ?? 0;
      if (count > best) {
        // strictly greater: equal counts keep the earlier-listed option
        winner = opt;
        best = count;
      }
    }

    c.choiceLog.push({ choiceId: ac.choice.id, optionId: winner.id, at: Date.now() });
    const flag = choiceFlag(ac.choice.id, winner.id);
    if (!c.flags.includes(flag)) c.flags.push(flag);
    this.broadcastFlags();
    this.host.broadcast({
      t: 'choiceResult',
      choiceId: ac.choice.id,
      optionId: winner.id,
      optionLabel: winner.label,
    });

    // Beats waiting on this exact resolution...
    for (const beat of data.beats) {
      const trig = beat.trigger;
      if (trig.type !== 'choiceResolved' || trig.choiceId !== ac.choice.id) continue;
      if (trig.optionId !== undefined && trig.optionId !== winner.id) continue;
      if (!this.isEligible(beat)) continue;
      this.fireBeat(beat, null);
    }
    // ...and beats whose `when` the new choice flag may satisfy.
    this.recheckFlagBeats();
    // A choice-bearing beat may have been deferred while this vote ran (or a
    // choiceResolved beat above may have opened the next vote, in which case
    // the drained beat simply re-defers — nothing is ever lost).
    this.drainPendingChoiceBeat();
    this.host.persist();
  }

  /** Fire the oldest still-eligible deferred choice beat, if any. */
  private drainPendingChoiceBeat(): void {
    const c = this.campaign;
    while (c.pendingChoiceBeats.length > 0) {
      const next = c.pendingChoiceBeats.shift()!;
      const beat = findBeat(data, next.beatId);
      if (!beat || !this.isEligible(beat)) continue; // stale entry — drop it
      this.fireBeat(beat, next.interactorId);
      return;
    }
  }
}
