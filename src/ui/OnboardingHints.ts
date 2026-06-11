/**
 * src/ui/OnboardingHints.ts
 * First-session control hints: a small non-blocking pill above the interact
 * prompt that teaches movement → camera → "follow the light" → panel keys,
 * each step advancing when the player actually does the thing (with a
 * generous timeout so nobody gets stuck being taught). Runs once per browser
 * (localStorage veil:onboarded); veterans never see it.
 */

import type { GameContext } from '../types';
import { el } from './UIManager';

const DONE_KEY = 'veil:onboarded';

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
    text: 'You’re a Veilwalker now — J journal · C character · O settings · H everything else',
    timeoutS: 10,
    done: () => false, // timeout-only farewell
  },
];

export class OnboardingHints {
  private ctx: GameContext | null = null;
  private readonly root: HTMLDivElement;
  private active = false;
  private stepIndex = -1;
  private stepElapsed = 0;

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
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    let alreadyOnboarded = false;
    try {
      alreadyOnboarded = localStorage.getItem(DONE_KEY) !== null;
    } catch {
      // storage unavailable: show hints, they just repeat next session
    }
    if (alreadyOnboarded) return;

    ctx.events.on('interact:request', () => {
      this.interacted = true;
    });
    // Mouse-look counts via pointer lock too (yaw tracking covers drag).
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) this.lookedAround = true;
    });

    ctx.events.once('game:ready', () => {
      this.active = true;
      this.advance();
    });
  }

  update(dt: number): void {
    if (!this.active || !this.ctx) return;

    // Track movement distance and camera-look from the live controller.
    const p = this.ctx.player.position;
    if (this.lastX !== null && this.lastZ !== null) {
      const dx = p.x - this.lastX;
      const dz = p.z - this.lastZ;
      const moved = Math.hypot(dx, dz);
      if (moved < 2) this.distanceMoved += moved; // ignore teleports
    }
    this.lastX = p.x;
    this.lastZ = p.z;

    const yaw = this.ctx.player.yaw;
    if (this.lastYaw !== null) {
      let d = Math.abs(yaw - this.lastYaw);
      if (d > Math.PI) d = 2 * Math.PI - d;
      this.yawAccum += d;
      if (this.yawAccum > 1.2) this.lookedAround = true;
    }
    this.lastYaw = yaw;

    const step = STEPS[this.stepIndex];
    if (!step) return;
    this.stepElapsed += dt;
    if (step.done(this.ctx, this) || this.stepElapsed >= step.timeoutS) {
      this.advance();
    }
  }

  private advance(): void {
    this.stepIndex += 1;
    this.stepElapsed = 0;
    const step = STEPS[this.stepIndex];
    if (!step) {
      this.finish();
      return;
    }
    this.root.textContent = step.text;
    this.root.classList.remove('hidden');
    // Restart the entrance animation per step.
    this.root.classList.remove('onboarding-hint-in');
    void this.root.offsetWidth;
    this.root.classList.add('onboarding-hint-in');
  }

  private finish(): void {
    this.active = false;
    this.root.classList.add('hidden');
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // fine — hints will show again next session
    }
  }
}
