/**
 * src/ui/UIManager.ts
 * The DOM overlay subsystem. Composes every UI component (menu, HUD, minimap,
 * chat, journal, story overlay, panels, toasts...), owns the input-capture
 * flag and the Esc-closes-topmost stack, and routes global events to toasts.
 * Also exports the small createElement helpers shared by all ui/ modules.
 */

import './styles.css';

import { LOCATION_NAMES } from '../../shared/constants';
import type { LocationId, SfxId } from '../../shared/constants';
import type {
  GameContext,
  IUIManager,
  MenuResult,
  ToastKind,
  UIPanel,
} from '../types';
import { ActTitleCard } from './ActTitleCard';
import { CharacterSheet } from './CharacterSheet';
import { Chat } from './Chat';
import { ChoicePanel } from './ChoicePanel';
import { EndingScreen } from './EndingScreen';
import { FocusMode } from './FocusMode';
import { HelpOverlay } from './HelpOverlay';
import { HUD } from './HUD';
import { Journal } from './Journal';
import { LoadingVeil } from './LoadingVeil';
import { MainMenu } from './MainMenu';
import { OnboardingHints } from './OnboardingHints';
import { Minimap } from './Minimap';
import { ObjectiveMarker } from './ObjectiveMarker';
import { SettingsPanel } from './SettingsPanel';
import { StoryOverlay } from './StoryOverlay';
import { Toasts } from './Toasts';

// ── Shared DOM helpers (function declarations: safe under circular imports) ──

/** createElement shorthand. Text always goes through textContent (XSS-safe). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Ghost gold-outline button (fills on hover, see styles.css). */
export function ghostButton(label: string, className = ''): HTMLButtonElement {
  const b = el('button', `btn ${className}`.trim(), label);
  b.type = 'button';
  return b;
}

/** Small keycap hint, e.g. J / Esc. */
export function kbdHint(key: string): HTMLElement {
  return el('kbd', 'kbd', key);
}

/** 0xRRGGBB -> '#rrggbb' for canvas / inline styles. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** 1 -> 'I', 2 -> 'II', 3 -> 'III'. */
export function actRoman(act: number): string {
  return ['I', 'II', 'III'][act - 1] ?? String(act);
}

export interface PanelChrome {
  root: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
}

/**
 * Standard chrome for the four center panels: glass panel, serif title with
 * hotkey hint, close button, scrollable body. Returned root starts hidden.
 */
export function panelChrome(
  title: string,
  hotkey: string | null,
  onClose: () => void,
  narrow = false,
): PanelChrome {
  const root = el('div', `panel ui-panel hidden${narrow ? ' panel-narrow' : ''}`);
  const header = el('div', 'ui-panel-header');
  header.appendChild(el('h2', 'ui-panel-title', title));
  if (hotkey) header.appendChild(kbdHint(hotkey));
  header.appendChild(el('div', 'ui-panel-spacer'));
  const close = el('button', 'ui-panel-close', '✕');
  close.type = 'button';
  close.title = 'Close (Esc)';
  close.addEventListener('click', onClose);
  header.appendChild(close);
  const body = el('div', 'ui-panel-body scrolly');
  root.appendChild(header);
  root.appendChild(body);
  return { root, header, body };
}

// ── The manager ──────────────────────────────────────────────────────────────

export class UIManager implements IUIManager {
  private ctx: GameContext | null = null;

  // Layer containers, back-to-front (z-index in styles.css).
  private readonly layerHud: HTMLDivElement;
  private readonly layerOverlay: HTMLDivElement;
  private readonly layerPanels: HTMLDivElement;
  private readonly layerVeil: HTMLDivElement;
  private readonly layerMenu: HTMLDivElement;
  private readonly layerToasts: HTMLDivElement;
  private readonly layerModal: HTMLDivElement;

  private readonly toasts: Toasts;
  private readonly hud: HUD;
  private readonly minimap: Minimap;
  private readonly objectiveMarker: ObjectiveMarker;
  private readonly chat: Chat;
  private readonly storyOverlay: StoryOverlay;
  private readonly choicePanel: ChoicePanel;
  private readonly focusMode: FocusMode;
  private readonly actTitleCard: ActTitleCard;
  private readonly journal: Journal;
  private readonly characterSheet: CharacterSheet;
  private readonly settingsPanel: SettingsPanel;
  private readonly helpOverlay: HelpOverlay;
  private readonly loadingVeil: LoadingVeil;
  private readonly endingScreen: EndingScreen;
  private readonly mainMenu: MainMenu;
  private readonly onboarding: OnboardingHints;

  /** Reasons the keyboard is currently captured ('menu', 'chat', 'panel'...). */
  private captureReasons = new Set<string>();
  private capturedFlag = false;

  /** Esc stack: last entry is the topmost closeable layer. */
  private closables: Array<{ id: string; close: () => void }> = [];

  private openPanelId: UIPanel | null = null;
  private readyFlag = false;
  private menuVisible = false;

  /** Unlocked locations we have already announced (diff source for the gold toast). */
  private knownUnlocked: Set<LocationId> | null = null;

  private minimapAccum = 0;

  constructor(root: HTMLElement) {
    const layer = (name: string): HTMLDivElement => {
      const d = el('div', `ui-layer layer-${name}`);
      root.appendChild(d);
      return d;
    };
    // Append order is irrelevant for stacking (explicit z-index), but keep it
    // back-to-front anyway for sane devtools reading.
    this.layerHud = layer('hud');
    this.layerOverlay = layer('overlay');
    this.layerPanels = layer('panels');
    this.layerVeil = layer('veil');
    this.layerMenu = layer('menu');
    this.layerToasts = layer('toasts');
    this.layerModal = layer('modal');

    this.layerHud.classList.add('hidden'); // HUD stays hidden until game:ready

    this.toasts = new Toasts(this.layerToasts);
    this.hud = new HUD(this, this.layerHud);
    this.minimap = new Minimap(this.layerHud);
    this.objectiveMarker = new ObjectiveMarker(this.layerHud);
    this.chat = new Chat(this, this.layerHud);
    this.storyOverlay = new StoryOverlay(this.layerOverlay);
    this.choicePanel = new ChoicePanel(this, this.layerOverlay);
    this.focusMode = new FocusMode(this.layerOverlay);
    this.actTitleCard = new ActTitleCard(this.layerOverlay);
    this.journal = new Journal(this, this.layerPanels);
    this.characterSheet = new CharacterSheet(this, this.layerPanels);
    this.settingsPanel = new SettingsPanel(this, this.layerPanels);
    this.helpOverlay = new HelpOverlay(this, this.layerPanels);
    this.loadingVeil = new LoadingVeil(this.layerVeil);
    this.endingScreen = new EndingScreen(this, this.layerVeil);
    this.mainMenu = new MainMenu(this, this.layerMenu);
    this.onboarding = new OnboardingHints(this.layerHud);

    window.addEventListener('keydown', this.onKeyDown);
  }

  // ── Subsystem lifecycle ────────────────────────────────────────────────────

  init(ctx: GameContext): void {
    this.ctx = ctx;

    this.hud.init(ctx);
    this.minimap.init(ctx);
    this.objectiveMarker.init(ctx);
    this.chat.init(ctx);
    this.storyOverlay.init(ctx);
    this.choicePanel.init(ctx);
    this.focusMode.init(ctx);
    this.actTitleCard.init(ctx);
    this.journal.init(ctx);
    this.characterSheet.init(ctx);
    this.settingsPanel.init(ctx);
    this.helpOverlay.init(ctx);
    this.loadingVeil.init(ctx);
    this.endingScreen.init(ctx);
    this.mainMenu.init(ctx);
    this.onboarding.init(ctx);

    const ev = ctx.events;

    ev.on('game:ready', () => {
      this.readyFlag = true;
      this.layerHud.classList.remove('hidden');
    });

    // Seed the unlock diff from the welcome snapshot so we only announce
    // genuinely new ways, not everything already open on (re)join.
    ev.on('net:welcome', ({ snapshot }) => {
      this.knownUnlocked = new Set(snapshot.unlocked);
    });

    ev.on('locations:unlocked', ({ unlocked }) => {
      if (!this.knownUnlocked) this.knownUnlocked = new Set();
      const fresh = unlocked.filter((l) => !this.knownUnlocked!.has(l));
      for (const l of fresh) this.knownUnlocked.add(l);
      if (fresh.length > 0) {
        this.toast(`A way opens: ${fresh.map((l) => LOCATION_NAMES[l]).join(', ')}`, 'gold');
      }
    });

    ev.on('event:random', ({ event }) => {
      this.toast(event.title, 'gold');
      window.setTimeout(() => this.toast(event.text, 'whisper'), 1000);
    });

    ev.on('party:player-joined', ({ player }) => {
      if (player.id !== ctx.state.playerId) this.toast(`${player.name} enters the dream`, 'info');
    });

    ev.on('party:player-left', ({ name }) => this.toast(`${name} drifts beyond the Veil`, 'info'));

    ev.on('ui:toast', ({ text, kind }) => this.toast(text, kind ?? 'info'));

    // net:denied → nothing extra here; the network client already toasts it.

    ev.on('interact:prompt', ({ info }) => this.setInteractPrompt(info ? info.prompt : null));

    // First travel: the loading veil takes over from the main menu, and any
    // open panel would just sit on top of the veil — clean both up.
    ev.on('world:travel-begin', () => {
      this.dismissMenu();
      this.hideAllPanels();
    });
  }

  update(dt: number, _elapsed: number): void {
    this.storyOverlay.update(dt);
    this.choicePanel.update(dt);
    this.onboarding.update(dt);
    // Full rate: the marker is projected through the camera every frame.
    this.objectiveMarker.update(dt);

    // Minimap redraw at ~10Hz; full-rate redraws are wasted work for a map.
    this.minimapAccum += dt;
    if (this.minimapAccum >= 0.1) {
      this.minimapAccum %= 0.1;
      if (this.readyFlag) this.minimap.redraw();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // ── IUIManager surface ─────────────────────────────────────────────────────

  get inputCaptured(): boolean {
    return this.capturedFlag;
  }

  showMainMenu(): Promise<MenuResult> {
    this.menuVisible = true;
    this.setCapture('menu', true);
    // The menu stays visible (in a "drifting in..." pending state) after it
    // resolves; world:travel-begin dismisses it once the loading veil covers.
    return this.mainMenu.show();
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.toasts.push(text, kind);
  }

  setInteractPrompt(text: string | null): void {
    this.hud.setInteractPrompt(text);
  }

  showPanel(panel: UIPanel): void {
    if (this.openPanelId === panel) return;
    this.closeOpenPanel(false);
    this.panelFor(panel).show();
    this.openPanelId = panel;
    this.setCapture('panel', true);
    this.pushClosable('panel', () => this.closeOpenPanel(true));
    this.sfx('ui-open');
  }

  togglePanel(panel: UIPanel): void {
    if (this.openPanelId === panel) this.closeOpenPanel(false);
    else this.showPanel(panel);
  }

  hideAllPanels(): void {
    this.closeOpenPanel(false);
  }

  confirm(
    title: string,
    message: string,
    confirmLabel = 'Continue',
    cancelLabel = 'Cancel',
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const backdrop = el('div', 'modal-backdrop');
      const modal = el('div', 'panel modal');
      modal.appendChild(el('h2', 'modal-title', title));
      modal.appendChild(el('p', 'modal-message', message));
      const row = el('div', 'modal-buttons');
      const noBtn = ghostButton(cancelLabel, 'btn-quiet');
      const yesBtn = ghostButton(confirmLabel, 'btn-primary');
      row.appendChild(noBtn);
      row.appendChild(yesBtn);
      modal.appendChild(row);
      backdrop.appendChild(modal);
      this.layerModal.appendChild(backdrop);

      const closableId = `modal-${Date.now()}-${Math.random()}`;
      let settled = false;
      const settle = (value: boolean, viaEsc: boolean): void => {
        if (settled) return;
        settled = true;
        backdrop.remove();
        if (!viaEsc) this.removeClosable(closableId);
        this.setCapture('modal', false);
        resolve(value);
      };
      this.setCapture('modal', true);
      this.pushClosable(closableId, () => settle(false, true));
      noBtn.addEventListener('click', () => settle(false, false));
      yesBtn.addEventListener('click', () => settle(true, false));
      yesBtn.focus();
    });
  }

  showFatalError(title: string, message: string): void {
    // Must work standalone (main.ts may call this before init(ctx)).
    this.layerModal.replaceChildren();
    const screen = el('div', 'fatal');
    screen.appendChild(el('div', 'fatal-rune', '✦'));
    screen.appendChild(el('h1', 'fatal-title', title));
    screen.appendChild(el('p', 'fatal-message', message));
    screen.appendChild(
      el('p', 'fatal-message', 'The Veil could not hold this dream. Refresh to try again.'),
    );
    this.layerModal.appendChild(screen);
    this.setCapture('fatal', true);
  }

  // ── Internal API used by the components ────────────────────────────────────

  /** True once game:ready fired (HUD visible, hotkeys live). */
  get gameReady(): boolean {
    return this.readyFlag;
  }

  /** Add/remove a keyboard-capture reason; emits ui:input-capture on change. */
  setCapture(reason: string, on: boolean): void {
    const had = this.captureReasons.has(reason);
    if (on === had) return;
    if (on) this.captureReasons.add(reason);
    else this.captureReasons.delete(reason);
    const captured = this.captureReasons.size > 0;
    if (captured !== this.capturedFlag) {
      this.capturedFlag = captured;
      this.ctx?.events.emit('ui:input-capture', { captured });
    }
  }

  /** Register a layer Esc can close. Re-pushing an id moves it to the top. */
  pushClosable(id: string, close: () => void): void {
    this.closables = this.closables.filter((c) => c.id !== id);
    this.closables.push({ id, close });
  }

  removeClosable(id: string): void {
    this.closables = this.closables.filter((c) => c.id !== id);
  }

  /** Guarded sfx helper for components (no-op before init). */
  sfx(id: SfxId): void {
    this.ctx?.audio.sfx(id);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private panelFor(panel: UIPanel): { show(): void; hide(): void } {
    switch (panel) {
      case 'journal':
        return this.journal;
      case 'character':
        return this.characterSheet;
      case 'settings':
        return this.settingsPanel;
      case 'help':
        return this.helpOverlay;
    }
  }

  /** @param viaEsc true when invoked from the Esc stack (entry already popped). */
  private closeOpenPanel(viaEsc: boolean): void {
    if (!this.openPanelId) return;
    this.panelFor(this.openPanelId).hide();
    this.openPanelId = null;
    this.setCapture('panel', false);
    if (!viaEsc) this.removeClosable('panel');
    this.sfx('ui-close');
  }

  private dismissMenu(): void {
    if (!this.menuVisible) return;
    this.menuVisible = false;
    this.mainMenu.hide();
    this.setCapture('menu', false);
  }

  private closeTopmost(): boolean {
    const top = this.closables.pop();
    if (!top) return false;
    top.close();
    return true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const typing =
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    // Text fields (chat, menu inputs) own their keys, including Esc-to-blur.
    if (typing) return;

    if (e.key === 'Escape') {
      if (this.closeTopmost()) e.preventDefault();
      return;
    }

    // Panel hotkeys still work while a panel is open (so J closes the
    // journal), but not under the menu / a modal / the ending screen.
    if (
      this.captureReasons.has('menu') ||
      this.captureReasons.has('modal') ||
      this.captureReasons.has('fatal') ||
      this.captureReasons.has('ending')
    ) {
      return;
    }
    if (!this.readyFlag) return;

    switch (e.code) {
      case 'KeyJ':
        this.togglePanel('journal');
        break;
      case 'KeyC':
        this.togglePanel('character');
        break;
      case 'KeyO':
        this.togglePanel('settings');
        break;
      case 'KeyH':
        this.togglePanel('help');
        break;
      default:
        break;
    }
  };
}
