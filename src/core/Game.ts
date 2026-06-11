/**
 * src/core/Game.ts
 * The conductor. Constructs every subsystem, wires them together through a
 * single GameContext, runs the boot/join flow (menu → audio unlock → connect
 * or offline fallback → first travel) and then drives the requestAnimationFrame
 * loop with a fixed update order.
 */

import { STARTING_LOCATION } from '../../shared/constants';
import { EventBus } from './events';
import { ClientState, getOrCreatePlayerToken } from '../state';
import type { EventMap, GameContext, IUIManager, Subsystem } from '../types';

// Concrete subsystem classes (each file exports a class named after the file).
import { SceneManager } from './SceneManager';
import { AudioManager } from '../audio/AudioManager';
import { UIManager } from '../ui/UIManager';
import { WorldManager } from '../world/WorldManager';
import { PlayerController } from '../player/PlayerController';
import { RemotePlayers } from '../player/RemotePlayers';
import { StoryEngine } from '../story/StoryEngine';
import { NetworkClient } from '../net/NetworkClient';

/** Hard cap on frame delta: a backgrounded tab must not produce a 5s "step". */
const MAX_DT = 0.1;

export class Game {
  private readonly ctx: GameContext;
  /** init/update order is part of the architecture contract — do not reorder. */
  private readonly initOrder: Subsystem[];
  private readonly updateOrder: Subsystem[];

  private running = false;
  private elapsed = 0;
  private lastTime: number | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const events = new EventBus<EventMap>();
    const state = new ClientState();
    const scene = new SceneManager(canvas);
    const audio = new AudioManager();
    const ui = new UIManager(uiRoot);
    const world = new WorldManager();
    const player = new PlayerController();
    const remotes = new RemotePlayers();
    const story = new StoryEngine();
    const net = new NetworkClient();

    this.ctx = { events, state, scene, world, player, remotes, net, story, audio, ui };

    this.initOrder = [scene, audio, ui, world, player, remotes, story, net];
    // Sim updates first, presentation last; scene.render(dt) closes the frame.
    this.updateOrder = [player, remotes, world, story, net, audio, ui];
  }

  /** Exposed so main.ts can route fatal boot errors to the error screen. */
  get ui(): IUIManager {
    return this.ctx.ui;
  }

  async run(): Promise<void> {
    const ctx = this.ctx;

    // 1. Bring every subsystem up. Order matters: ui depends on scene/audio
    //    existing, world on scene, net mirrors into state last.
    for (const sub of this.initOrder) {
      await sub.init(ctx);
    }

    // 2. Main menu (name, archetype, room code). Blocks until the player commits.
    const menu = await ctx.ui.showMainMenu();

    // 3. The menu submit click is our user gesture — unlock WebAudio now.
    await ctx.audio.unlock();

    // 4. Join the campaign room (or fall back to offline solo exploration).
    const workerUrl =
      (import.meta.env.VITE_WORKER_URL as string | undefined) ||
      (import.meta.env.DEV ? 'http://127.0.0.1:8787' : window.location.origin);

    try {
      await ctx.net.connect({
        workerUrl,
        roomCode: menu.roomCode,
        name: menu.name,
        archetype: menu.archetype,
        token: getOrCreatePlayerToken(menu.roomCode),
      });
    } catch (err) {
      console.warn('[game] connect failed, offering offline mode', err);
      // 5. Offline fallback: same world, no party / story authority.
      const ok = await ctx.ui.confirm(
        'The Veil is quiet',
        'The dream-server could not be reached, so the rest of your party is beyond hearing. ' +
          'You can still cross the threshold alone and wander every location offline — ' +
          'the story, votes and shared journal will wait until the connection returns.',
        'Explore offline',
        'Stay at the threshold',
      );
      if (ok) {
        ctx.net.startOffline({ name: menu.name, archetype: menu.archetype });
      } else {
        ctx.ui.showFatalError(
          'The Veil is quiet',
          `No answer from ${workerUrl}. If you are developing locally, start the worker ` +
            '(npx wrangler dev, default http://127.0.0.1:8787) or point VITE_WORKER_URL ' +
            'at a deployed worker — then refresh this page to knock again.',
        );
        return;
      }
    }

    // Reconnect handling: a *later* welcome snapshot (after a dropped socket)
    // may place us elsewhere — e.g. the server restored a persisted location.
    // Registered after the initial join so the first welcome isn't re-handled.
    ctx.events.on('net:welcome', ({ snapshot }) => {
      if (snapshot.you.location !== ctx.world.currentId) {
        void ctx.world.travelTo(snapshot.you.location);
      }
      // State was re-mirrored from the snapshot; re-align the soundtrack.
      ctx.audio.setMood(ctx.state.mood);
    });

    // Endings: we deliberately do NOT freeze the player here. The ending
    // screen is a UI modal that captures input (ui.inputCaptured), so movement
    // keys are swallowed while it is open — and once dismissed the party keeps
    // wandering the dream in epilogue mode. Freezing would fight reconnects
    // and the "play continues after the ending" persistence model.

    // 6. First travel into wherever the campaign last left us. WorldManager
    //    emits loading:progress events, so the UI shows the loading veil.
    await ctx.world.travelTo(ctx.state.you?.location ?? STARTING_LOCATION);

    // 7. Match the soundtrack to the campaign mood and let the HUD fade in.
    ctx.audio.setMood(ctx.state.mood);
    ctx.events.emit('game:ready', {});

    // Dev-only debug handle for the browser console / automated smoke tests.
    if (import.meta.env.DEV) {
      (window as unknown as { __veil?: GameContext }).__veil = ctx;
    }

    // 8. The frame loop.
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    if (this.lastTime === null) this.lastTime = now;
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), MAX_DT);
    this.lastTime = now;
    this.elapsed += dt;

    for (const sub of this.updateOrder) {
      sub.update(dt, this.elapsed);
    }
    this.ctx.scene.render(dt);
  };

  /** Stop the loop and tear subsystems down (tests / hot-reload hygiene). */
  dispose(): void {
    this.running = false;
    for (const sub of [...this.initOrder].reverse()) {
      sub.dispose?.();
    }
    this.ctx.events.clear();
  }
}
