/**
 * src/ui/SettingsPanel.ts
 * Settings (hotkey O): render quality, live master/music/sfx volume sliders,
 * name-tag and invert-Y toggles. Writes ctx.state.settings, persists via
 * saveSettings and emits settings:changed so the scene/audio/avatar systems
 * can react. Volume changes also hit the audio manager directly for
 * immediate feedback while dragging.
 */

import { saveSettings } from '../state';
import type { GameContext, GameSettings, QualityLevel } from '../types';
import { el, panelChrome } from './UIManager';
import type { UIManager } from './UIManager';

type VolumeKey = 'masterVolume' | 'musicVolume' | 'sfxVolume';

const VOLUME_ROWS: Array<{ key: VolumeKey; channel: 'master' | 'music' | 'sfx'; label: string }> = [
  { key: 'masterVolume', channel: 'master', label: 'Master volume' },
  { key: 'musicVolume', channel: 'music', label: 'Music' },
  { key: 'sfxVolume', channel: 'sfx', label: 'Effects' },
];

const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

export class SettingsPanel {
  private ctx: GameContext | null = null;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  private readonly sliders = new Map<VolumeKey, { input: HTMLInputElement; value: HTMLSpanElement }>();
  private nameTagsToggle!: HTMLInputElement;
  private invertYToggle!: HTMLInputElement;

  constructor(ui: UIManager, parent: HTMLElement) {
    const chrome = panelChrome('Settings', 'O', () => ui.hideAllPanels(), true);
    this.root = chrome.root;
    this.body = chrome.body;

    // ── Quality ──────────────────────────────────────────────────────────────
    const qualityRow = el('div', 'set-row');
    qualityRow.appendChild(el('span', 'set-label', 'Render quality'));
    const segs = el('div', 'seg-group');
    for (const level of QUALITY_LEVELS) {
      const b = el('button', 'seg-btn', level);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.mutate((s) => {
          s.quality = level;
        });
        this.syncFromState();
      });
      this.qualityButtons.set(level, b);
      segs.appendChild(b);
    }
    qualityRow.appendChild(segs);
    this.body.appendChild(qualityRow);

    // ── Volumes (live) ───────────────────────────────────────────────────────
    for (const def of VOLUME_ROWS) {
      const row = el('div', 'set-row');
      row.appendChild(el('span', 'set-label', def.label));
      const input = el('input', 'slider');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      const value = el('span', 'set-value', '');
      input.addEventListener('input', () => {
        const v = Number(input.value) / 100;
        value.textContent = `${input.value}%`;
        this.ctx?.audio.setVolume(def.channel, v); // immediate, while dragging
        this.mutate((s) => {
          s[def.key] = v;
        });
      });
      row.appendChild(input);
      row.appendChild(value);
      this.sliders.set(def.key, { input, value });
      this.body.appendChild(row);
    }

    // ── Toggles ──────────────────────────────────────────────────────────────
    this.nameTagsToggle = this.toggleRow('Name tags above Veilwalkers', (on) =>
      this.mutate((s) => {
        s.showNameTags = on;
      }),
    );
    this.invertYToggle = this.toggleRow('Invert camera Y', (on) =>
      this.mutate((s) => {
        s.invertY = on;
      }),
    );

    parent.appendChild(this.root);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.syncFromState();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private toggleRow(label: string, onChange: (on: boolean) => void): HTMLInputElement {
    const row = el('div', 'set-row');
    row.appendChild(el('span', 'set-label', label));
    const input = el('input', 'toggle');
    input.type = 'checkbox';
    input.addEventListener('change', () => onChange(input.checked));
    row.appendChild(input);
    this.body.appendChild(row);
    return input;
  }

  /** Apply a mutation to the live settings, persist, and broadcast. */
  private mutate(fn: (s: GameSettings) => void): void {
    const ctx = this.ctx;
    if (!ctx) return;
    fn(ctx.state.settings);
    saveSettings(ctx.state.settings);
    ctx.events.emit('settings:changed', { settings: ctx.state.settings });
  }

  /** Push current state values into the controls (on open / quality click). */
  private syncFromState(): void {
    const s = this.ctx?.state.settings;
    if (!s) return;
    for (const [level, b] of this.qualityButtons) {
      b.classList.toggle('seg-active', s.quality === level);
    }
    for (const def of VOLUME_ROWS) {
      const parts = this.sliders.get(def.key)!;
      const pct = Math.round(s[def.key] * 100);
      parts.input.value = String(pct);
      parts.value.textContent = `${pct}%`;
    }
    this.nameTagsToggle.checked = s.showNameTags;
    this.invertYToggle.checked = s.invertY;
  }
}
