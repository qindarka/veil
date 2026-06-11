/**
 * src/types.ts
 * Contracts between all client subsystems. Game.ts wires concrete
 * implementations together through GameContext; subsystems talk to each other
 * only via these interfaces and the typed EventBus. Do not widen a contract
 * from an implementation file — change it here first.
 */

import type * as THREE from 'three';
import type { ArchetypeId } from '../shared/archetypes';
import type {
  AnimState,
  EmoteId,
  LocationId,
  MusicMood,
  SfxId,
} from '../shared/constants';
import type {
  ActiveChoiceState,
  EndingPayload,
  ItemStack,
  JournalEntry,
  PlayerId,
  PlayerInfo,
  PlayerStats,
  PlayerTick,
  RandomEventPayload,
  ServerMsg,
  Snapshot,
  StoryBeatPayload,
  StoryChoicePayload,
  Vec3,
} from '../shared/protocol';
import type { EventBus } from './core/events';
import type { ClientState } from './state';

export type { Vec3 };

// ── Game context and subsystem lifecycle ─────────────────────────────────────

export interface GameContext {
  events: EventBus<EventMap>;
  state: ClientState;
  scene: ISceneManager;
  world: IWorldManager;
  player: IPlayerController;
  remotes: IRemotePlayers;
  net: INetworkClient;
  story: IStoryEngine;
  audio: IAudioManager;
  ui: IUIManager;
}

export interface Subsystem {
  /** Called once, after every subsystem is constructed. Safe to use ctx peers. */
  init(ctx: GameContext): void | Promise<void>;
  /** Called every frame. dt is clamped delta time in seconds; elapsed is seconds since start. */
  update(dt: number, elapsed: number): void;
  dispose?(): void;
}

export interface Updatable {
  update(dt: number, elapsed: number): void;
}

// ── Typed events ─────────────────────────────────────────────────────────────

export interface InteractableInfo {
  id: string;
  prompt: string;
  kind: InteractableKind;
  requiresArchetype?: ArchetypeId;
}

export interface EventMap {
  // Loading / lifecycle
  'loading:progress': { progress: number; label: string };
  'loading:done': {};
  /** First travel finished; HUD can fade in. */
  'game:ready': {};

  // Networking
  'net:status': { status: NetStatus; detail?: string };
  'net:welcome': { playerId: PlayerId; snapshot: Snapshot };
  /** 10Hz position batch, after ClientState has been updated. */
  'net:tick': { players: PlayerTick[] };
  /** Every server message, after state mirroring — for niche listeners. */
  'net:server-msg': { msg: ServerMsg };
  'net:denied': { reason: string; objectId?: string };

  // Party
  'party:player-joined': { player: PlayerInfo };
  'party:player-left': { playerId: PlayerId; name: string };
  'party:player-location': { playerId: PlayerId; location: LocationId };
  'party:stats': { playerId: PlayerId; stats: PlayerStats };
  /** A crew ping (G): a temporary "come here" marker everyone sees. */
  'party:marker': { from: PlayerId; name: string; p: Vec3; location: LocationId };

  // Chat
  'chat:message': { from: PlayerId; name: string; text: string; self: boolean };
  'chat:emote': { from: PlayerId; name: string; emote: EmoteId; self: boolean };

  // Story (server-driven)
  'story:beat': { beat: StoryBeatPayload };
  'story:choice-open': { choice: StoryChoicePayload; endsAt: number };
  'story:vote-tally': { choiceId: string; tally: Record<string, number>; votedIds: PlayerId[] };
  'story:choice-result': { choiceId: string; optionId: string; optionLabel: string };
  'story:flags': { flags: string[]; act: number };
  'story:ending': { ending: EndingPayload };
  'journal:entry': { entry: JournalEntry };
  'locations:unlocked': { unlocked: LocationId[] };
  'inventory:changed': { playerId: PlayerId; items: ItemStack[] };
  'relationships:changed': { relationships: Record<string, number> };
  'focus:changed': { holderId: PlayerId | null; holderName: string | null; self: boolean };
  'event:random': { event: RandomEventPayload };

  // World / locations
  'world:travel-begin': { to: LocationId };
  'world:travel-end': { location: LocationId };

  // Player & interaction
  'player:teleported': { pos: Vec3 };
  /** Nearest usable interactable changed (null = none in range). */
  'interact:prompt': { info: InteractableInfo | null };
  /** Local player pressed the interact key on this object. */
  'interact:request': { objectId: string };

  // Audio & UI
  'audio:mood': { mood: MusicMood };
  'ui:input-capture': { captured: boolean };
  'ui:toast': { text: string; kind?: ToastKind };
  'settings:changed': { settings: GameSettings };
}

export type ToastKind = 'info' | 'warn' | 'gold' | 'whisper';

// ── Scene manager ────────────────────────────────────────────────────────────

export type QualityLevel = 'low' | 'medium' | 'high';

/** Per-location atmosphere, applied on travel. */
export interface EnvironmentSettings {
  /** Scene background / clear color behind the sky dome. */
  background: number;
  fogColor: number;
  /** FogExp2 density; typical range 0.002 (clear) .. 0.03 (thick). */
  fogDensity: number;
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Direction TO the sun (normalized-ish), used for the key light. */
  sunPosition: Vec3;
  /** Optional cool fill light for stylized contrast. */
  fillColor?: number;
  fillIntensity?: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** ACES tone-mapping exposure. */
  exposure: number;
}

export interface ISceneManager extends Subsystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Swap fog, lights, bloom and exposure to the given environment. */
  applyEnvironment(env: EnvironmentSettings): void;
  /** Render one frame through the post-processing chain. */
  render(dt: number): void;
  setQuality(quality: QualityLevel): void;
}

// ── World, locations, interactables ──────────────────────────────────────────

export type InteractableKind = 'glyph' | 'crystal' | 'lore' | 'npc' | 'portal' | 'shrine';

export interface Interactable {
  /** Must match the canonical ids used by shared/storyData.ts (see docs/ARCHITECTURE.md). */
  id: string;
  kind: InteractableKind;
  /** Root object; world-space position is read from this for proximity checks. */
  object: THREE.Object3D;
  /** Action phrase shown in the prompt, e.g. "Commune with the Lantern Echo". */
  prompt: string;
  /** Interaction range in meters. */
  radius: number;
  /** Only this archetype can see/use it. */
  requiresArchetype?: ArchetypeId;
  /** Portal destination for kind === 'portal'. */
  portalTo?: LocationId;
  setHighlight(on: boolean): void;
  update?(dt: number, elapsed: number): void;
}

export interface ILocation {
  readonly id: LocationId;
  readonly group: THREE.Group;
  readonly environment: EnvironmentSettings;
  readonly spawn: { position: Vec3; yaw: number };
  /** Soft circular bound; the world manager clamps players inside it. */
  readonly boundsRadius: number;
  readonly defaultMood: MusicMood;
  readonly interactables: Interactable[];
  /** Build all meshes/particles. Idempotent. Reports rough progress 0..1. */
  build(ctx: GameContext, onProgress: (p: number) => void): Promise<void>;
  update(dt: number, elapsed: number): void;
  /** Analytic ground height used to keep avatars on the terrain. */
  getGroundHeight(x: number, z: number): number;
  /**
   * Optional walkable-surface containment: mutate `pos` back onto valid
   * ground. Locations with voids (floating islands, bridges) implement this
   * so players cannot stroll onto thin air; continuous terrains skip it.
   */
  constrainPosition?(pos: THREE.Vector3): void;
  onEnter?(ctx: GameContext): void;
  onExit?(ctx: GameContext): void;
  dispose(): void;
}

export interface IWorldManager extends Subsystem {
  readonly currentId: LocationId | null;
  readonly current: ILocation | null;
  /**
   * Travel the local player to a location: shows loading, swaps scene
   * content, applies environment, teleports the player to spawn and notifies
   * the server. Resolves when the new location is live.
   */
  travelTo(id: LocationId): Promise<void>;
  /** Nearest interactable within its radius of `pos`, respecting archetype gates. */
  findNearestInteractable(pos: THREE.Vector3): Interactable | null;
  getInteractable(id: string): Interactable | null;
  getGroundHeight(x: number, z: number): number;
  /** Clamp a position to the current location's walkable bounds (mutates). */
  clampToBounds(pos: THREE.Vector3): void;
}

// ── Player ───────────────────────────────────────────────────────────────────

export interface IPlayerController extends Subsystem {
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly anim: AnimState;
  /** The local avatar's root object (already added to the scene). */
  readonly avatarObject: THREE.Object3D;
  teleport(pos: Vec3, yaw?: number): void;
  /** Freeze movement input (used during endings / modal moments). */
  setFrozen(frozen: boolean): void;
  /** True while the arrival camera sweep owns the camera (UI may hide chrome). */
  readonly cinematicActive: boolean;
  /**
   * Play the first-arrival camera sweep: descend from above the spawn down
   * into the third-person rig, ending faced toward `lookTarget` when given.
   * Skippable by any input. No-op when one is already playing.
   */
  playArrivalCinematic(lookTarget: THREE.Vector3 | null): void;
}

export interface IRemotePlayers extends Subsystem {
  /** Remote players currently visible (same location), for the minimap. */
  getVisible(): Array<{
    id: PlayerId;
    name: string;
    color: number;
    position: THREE.Vector3;
  }>;
}

// ── Networking ───────────────────────────────────────────────────────────────

export type NetStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ConnectOptions {
  /** Base http(s) URL of the worker, e.g. http://127.0.0.1:8787 */
  workerUrl: string;
  roomCode: string;
  name: string;
  archetype: ArchetypeId;
  /** Persistent per-room identity token (localStorage) for rejoin/restore. */
  token: string;
}

export interface INetworkClient extends Subsystem {
  /**
   * Open the WebSocket, join the room and resolve with the welcome snapshot
   * (after ClientState has been populated). Rejects if the room is full or
   * the worker is unreachable.
   */
  connect(opts: ConnectOptions): Promise<Snapshot>;
  /** Fire-and-forget send; silently drops when offline. */
  send(msg: import('../shared/protocol').ClientMsg): void;
  readonly status: NetStatus;
  /**
   * True when running without a backend (solo exploration fallback).
   * Story/state features are inert; movement and locations still work.
   */
  readonly offlineMode: boolean;
  /** Switch into offline solo mode with a synthetic local snapshot. */
  startOffline(opts: Pick<ConnectOptions, 'name' | 'archetype'>): Snapshot;
}

// ── Story (client mirror) ────────────────────────────────────────────────────

export interface IStoryEngine extends Subsystem {
  readonly act: number;
  hasFlag(flag: string): boolean;
  readonly activeChoice: ActiveChoiceState & { endsAt: number } | null;
  /** Cast/replace this player's vote in the active choice. */
  vote(choiceId: string, optionId: string): void;
  /** Toggle focus mode (anchoring) for the local player. */
  toggleFocus(): void;
}

// ── Audio ────────────────────────────────────────────────────────────────────

export interface IAudioManager extends Subsystem {
  /** Must be called from a user gesture (menu click) before audio can start. */
  unlock(): Promise<void>;
  setMood(mood: MusicMood, fadeSeconds?: number): void;
  readonly mood: MusicMood;
  sfx(id: SfxId): void;
  setVolume(channel: 'master' | 'music' | 'sfx', value: number): void;
  getVolume(channel: 'master' | 'music' | 'sfx'): number;
}

// ── UI ───────────────────────────────────────────────────────────────────────

export interface MenuResult {
  name: string;
  archetype: ArchetypeId;
  roomCode: string;
  mode: 'create' | 'join';
}

export interface IUIManager extends Subsystem {
  /** True while a text input / modal is capturing the keyboard. */
  readonly inputCaptured: boolean;
  /** Full-screen main menu; resolves when the player commits. */
  showMainMenu(): Promise<MenuResult>;
  toast(text: string, kind?: ToastKind): void;
  /** Bottom-center interact prompt; null hides it. */
  setInteractPrompt(text: string | null): void;
  showPanel(panel: UIPanel): void;
  togglePanel(panel: UIPanel): void;
  hideAllPanels(): void;
  /** Modal confirm dialog (e.g. offline-mode fallback). */
  confirm(title: string, message: string, confirmLabel?: string, cancelLabel?: string): Promise<boolean>;
  /** Fatal, unrecoverable error screen (WebGL missing etc.). */
  showFatalError(title: string, message: string): void;
}

export type UIPanel = 'journal' | 'character' | 'settings' | 'help';

// ── Settings ─────────────────────────────────────────────────────────────────

export interface GameSettings {
  quality: QualityLevel;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  showNameTags: boolean;
  invertY: boolean;
}
