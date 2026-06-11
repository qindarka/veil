/**
 * src/ui/FocusMode.ts
 * Cinematic dressing while a player anchors the scene (focus mode): 60px
 * letterbox bars slide in top/bottom, a soft gold vignette breathes over the
 * frame, and a banner names the anchor ("You anchor this moment — press F to
 * release" for yourself). Everything slides back out cleanly on release.
 */

import type { GameContext } from '../types';
import { el } from './UIManager';

export class FocusMode {
  private readonly barTop: HTMLDivElement;
  private readonly barBottom: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.barTop = el('div', 'letterbox-top');
    this.barBottom = el('div', 'letterbox-bottom');
    this.vignette = el('div', 'focus-vignette');
    this.banner = el('div', 'focus-banner', '');
    parent.appendChild(this.vignette);
    parent.appendChild(this.barTop);
    parent.appendChild(this.barBottom);
    parent.appendChild(this.banner);
  }

  init(ctx: GameContext): void {
    ctx.events.on('focus:changed', ({ holderId, holderName, self }) => {
      const active = holderId !== null;
      this.barTop.classList.toggle('lb-active', active);
      this.barBottom.classList.toggle('lb-active', active);
      this.vignette.classList.toggle('fv-active', active);
      this.banner.classList.toggle('fb-active', active);
      if (active) {
        this.banner.textContent = self
          ? 'You anchor this moment — press F to release'
          : `${holderName ?? 'Someone'} anchors this moment`;
      }
    });
  }
}
