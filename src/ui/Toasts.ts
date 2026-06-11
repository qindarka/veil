/**
 * src/ui/Toasts.ts
 * Top-center toast stack. Four kinds: info (teal), warn (amber), gold
 * (story/unlocks) and whisper (italic, dim). Toasts slide in, hold for 4s,
 * fade out; at most 4 are stacked (oldest is evicted).
 */

import type { ToastKind } from '../types';
import { el } from './UIManager';

const TOAST_LIFETIME_MS = 4000;
const TOAST_FADE_MS = 300;
const MAX_STACKED = 4;

export class Toasts {
  private readonly stack: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.stack = el('div', 'toast-stack');
    parent.appendChild(this.stack);
  }

  push(text: string, kind: ToastKind = 'info'): void {
    // Evict the oldest when the stack is full.
    while (this.stack.children.length >= MAX_STACKED) {
      this.stack.firstElementChild?.remove();
    }

    const toast = el('div', `toast toast-${kind}`, text);
    this.stack.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('toast-out');
      window.setTimeout(() => toast.remove(), TOAST_FADE_MS);
    }, TOAST_LIFETIME_MS);
  }
}
