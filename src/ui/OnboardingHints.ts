/**
 * src/ui/OnboardingHints.ts
 * First-session guidance, two layers sharing one non-blocking pill:
 *
 *  1. A tutorial sequence (move → look → follow the light → panel keys),
 *     each step advancing when the player actually does the thing, with a
 *     generous timeout. Starts after the arrival cinematic ends; runs once
 *     per browser (localStorage veil:onboarded).
 *  2. Contextual one-shot tips fired by gameplay moments (first group vote,
 *     first journal entry, first crew ping...), each shown once ever
 *     (localStorage veil:tips). These queue behind the tutorial and drain
 *     whenever the pill is free.
 */

import type { GameContext } from '../types';
import { el } from './UIManager';

const DONE_KEY = 'veil:onboarded';
const TIPS_KEY = 'veil:tips';
const TIP_SECONDS = 7;

interface Step {
  text: string;
  /** Seconds after which the step auto-advances even if not performed. */
  timeoutS: number;
  /** Returns true once the player has demonstrated the skill. */
  done: (ctx: GameContext, self: OnboardingHints) => boolean;
}

const STEPS: Step[] = [
  {
    text: 'Walk with W A S D — hold Shift to run',
    timeoutS: 30,
    done: (_ctx, self) => self.distanceMoved > 4,
  },
  {
    text: 'Drag the mouse to look around — or click the world once for full mouse-look (Esc frees the cursor)',
    timeoutS: 25,
    done: (_ctx, self) => self.lookedAround,
  },
  {
    text: 'Follow the tall golden light — when something glows, walk close and press E',
    timeoutS: 45,
    done: (_ctx, self) => self.interacted,
  },
  {
    text: 'You’re a Veilwalker now — G pings your crew · J journal · H everything else',
    timeoutS: 10,
    done: () => false, // timeout-only farewell
  },
];

export class OnboardingHints {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;

  // Tutorial sequence state.
  private stepsActive = false;
  private pendingStart = false;
  private stepIndex = -1;
  private stepElapsed = 0;

  // Contextual tips state.
  private shownTips = new Set<string>();
  private tipQueue: string[] = [];
  private tipShowing = false;
  private tipElapsed = 0;

  // Skill trackers (read by step predicates).
  distanceMoved = 0;
  lookedAround = false;
  interacted = false;
  private lastX: number | null = null;
  private lastZ: number | null = null;
  private yawAccum = 0;
  private lastYaw: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'onboarding-hint hidden');
    parent.appendChild(this.root);
    try {
      const raw = localStorage.getItem(TIPS_KEY);
      if (raw) this.shownTips = new Set(JSON.parse(raw) as string[]);
    } catch {
      // storage unavailable — tips just repeat
    }
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;

    // ── Contextual one-shot tips ───────────────────────────────────────────
    ev.on('story:choice-open', () =>
      this.queueTip('vote', 'A crew choice! Everyone votes — pick an option on the right (you can change it until time runs out)'),
    );
    ev.on('journal:entry', () =>
      this.queueTip('journal', 'Recorded in the shared journal — press J anytime to re-read the story so far'),
    );
    ev.on('locations:unlocked', () =>
      this.queueTip('ways', 'New waygates are open — the golden pillars always mark your next step'),
    );
    ev.on('party:marker', () =>
      this.queueTip('ping', 'That teal pillar is a crew ping — press G to drop your own "over here!"'),
    );
    ev.on('focus:changed', ({ holderId, holderName, self }) => {
      if (holderId && !self) {
        this.queueTip('focus', `${holderName ?? 'Someone'} anchored the moment — anchored scenes tell deeper stories (F)`);
      }
    });

    // ── Tutorial sequence (first session only) ─────────────────────────────
    let alreadyOnboarded = false;
    try {
      alreadyOnboarded = localStorage.getItem(DONE_KEY) !== null;
    } catch {
      // storage unavailable: show the tutorial, it just repeats next session
    }
    if (alreadyOnboarded) return;

    ev.on('interact:request', () => {
      this.interacted = true;
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) this.lookedAround = true;
    });
    ev.once('game:ready', () => {
      this.pendingStart = true; // actual start waits out the arrival cinematic
    });
  }

  update(dt: number): void {
    if (!this.ctx) return;

    if (this.pendingStart && !this.ctx.player.cinematicActive) {
      this.pendingStart = false;
      this.stepsActive = true;
      this.advance();
    }

    if (this.stepsActive) {
      this.trackSkills();
      const step = STEPS[this.stepIndex];
      if (step) {
        this.stepElapsed += dt;
        if (step.done(this.ctx, this) || this.stepElapsed >= step.timeoutS) {
          this.advance();
        }
      }
      return; // tutorial owns the pill while it runs
    }

    // Drain queued tips when the pill is free.
    if (this.tipShowing) {
      this.tipElapsed += dt;
      if (this.tipElapsed >= TIP_SECONDS) {
        this.tipShowing = false;
        this.root.classList.add('hidden');
      }
      return;
    }
    const next = this.tipQueue.shift();
    if (next !== undefined) this.show(next);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private trackSkills(): void {
    const ctx = this.ctx!;
    const p = ctx.player.position;
    if (this.lastX !== null && this.lastZ !== null) {
      const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
      if (moved < 2) this.distanceMoved += moved; // ignore teleports
    }
    this.lastX = p.x;
    this.lastZ = p.z;

    const yaw = ctx.player.yaw;
    if (this.lastYaw !== null) {
      let d = Math.abs(yaw - this.lastYaw);
      if (d > Math.PI) d = 2 * Math.PI - d;
      this.yawAccum += d;
      if (this.yawAccum > 1.2) this.lookedAround = true;
    }
    this.lastYaw = yaw;
  }

  private queueTip(id: string, text: string): void {
    if (this.shownTips.has(id)) return;
    this.shownTips.add(id);
    try {
      localStorage.setItem(TIPS_KEY, JSON.stringify([...this.shownTips]));
    } catch {
      // fine — the tip may repeat next session
    }
    this.tipQueue.push(text);
  }

  private show(text: string): void {
    this.root.textContent = text;
    this.root.classList.remove('hidden');
    this.root.classList.remove('onboarding-hint-in');
    void this.root.offsetWidth; // restart the entrance animation
    this.root.classList.add('onboarding-hint-in');
    this.tipShowing = true;
    this.tipElapsed = 0;
  }

  private advance(): void {
    this.stepIndex += 1;
    this.stepElapsed = 0;
    const step = STEPS[this.stepIndex];
    if (!step) {
      this.finishSteps();
      return;
    }
    this.root.textContent = step.text;
    this.root.classList.remove('hidden');
    this.root.classList.remove('onboarding-hint-in');
    void this.root.offsetWidth;
    this.root.classList.add('onboarding-hint-in');
  }

  private finishSteps(): void {
    this.stepsActive = false;
    this.root.classList.add('hidden');
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // fine — the tutorial will show again next session
    }
  }
}
