/**
 * src/story/StoryEngine.ts
 * Thin client-side mirror of the authoritative StoryDirector that lives in
 * the Durable Object. It never decides anything: act/flags/active choice are
 * read straight from ClientState (which NetworkClient keeps mirrored), and
 * vote/focus are just intents sent to the server, which echoes the results
 * back as ServerMsgs. The only state it keeps is the most recent story beat,
 * for UI components that want to re-show it.
 */

import type { ActiveChoiceState, StoryBeatPayload } from '../../shared/protocol';
import type { GameContext, IStoryEngine } from '../types';

export class StoryEngine implements IStoryEngine {
  private ctx!: GameContext;

  private _lastBeat: StoryBeatPayload | null = null;

  /** The most recent beat payload (including focus addendums), for UI use. */
  get lastBeat(): StoryBeatPayload | null {
    return this._lastBeat;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('story:beat', ({ beat }) => {
      this._lastBeat = beat;
    });
  }

  /** Pure mirror — nothing to advance per frame. */
  update(_dt: number, _elapsed: number): void {}

  get act(): number {
    return this.ctx.state.act;
  }

  hasFlag(flag: string): boolean {
    return this.ctx.state.flags.has(flag);
  }

  get activeChoice(): (ActiveChoiceState & { endsAt: number }) | null {
    return this.ctx.state.activeChoice;
  }

  /** Cast/replace this player's vote; the server echoes the new tally. */
  vote(choiceId: string, optionId: string): void {
    this.ctx.net.send({ t: 'vote', choiceId, optionId });
  }

  /**
   * Toggle focus mode (anchoring). The server grants a single holder at a
   * time; if someone else already holds it we just tell the player who.
   */
  toggleFocus(): void {
    const { state, ui, net } = this.ctx;
    const holder = state.focusHolder;
    if (holder !== null && holder !== state.playerId) {
      const name = state.getPlayer(holder)?.name ?? 'Another Veilwalker';
      ui.toast(`${name} is anchoring the scene right now.`, 'gold');
      return;
    }
    // holder === null  → request focus (on: true)
    // holder === self  → release focus (on: false)
    net.send({ t: 'focus', on: holder !== state.playerId });
  }
}
