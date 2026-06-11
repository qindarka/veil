# Echoes of the Veil — Architecture

This document is the binding contract for how the codebase fits together.
If you add or change a subsystem, update this file and `src/types.ts` first.

## System overview

```
┌────────────────────────── Browser (one per player) ──────────────────────────┐
│  main.ts → Game.ts (game loop, wiring)                                       │
│   ├─ SceneManager   three.js renderer + EffectComposer (bloom, vignette)     │
│   ├─ WorldManager   current Location (6 procedural dreamscapes), travel      │
│   ├─ PlayerController / Avatar    WASD + orbit camera, local avatar          │
│   ├─ RemotePlayers  interpolated avatars of the rest of the party            │
│   ├─ StoryEngine    client mirror of story state, votes, focus mode          │
│   ├─ AudioManager   WebAudio adaptive soundtrack + synthesized SFX           │
│   ├─ UIManager      DOM overlay: menu, HUD, minimap, journal, chat...        │
│   └─ NetworkClient  WebSocket ⇄ Durable Object, mirrors into ClientState     │
└────────────────────────────────────┬──────────────────────────────────────────┘
                                     │ JSON over WebSocket (shared/protocol.ts)
┌────────────────────────────────────┴──────────────────────────────────────────┐
│  Cloudflare Worker (worker/src/index.ts)  routes /api/room/:code/* to a       │
│  VeilRoom Durable Object — one DO instance per campaign (room code):          │
│   ├─ live WebSocket sessions, 10Hz position broadcast                         │
│   ├─ StoryDirector: interprets shared/storyData.ts (authoritative)            │
│   └─ persistence: campaign + players in DO storage (survives restarts)        │
└────────────────────────────────────────────────────────────────────────────────┘
```

The client renders; the server decides. Player position is the only
client-authoritative state. Everything narrative (flags, beats, votes,
journal, inventory, relationships, unlocks, focus holder, mood) lives in the
Durable Object and is mirrored into `ClientState` by `NetworkClient`, which
then emits typed events on the `EventBus` (see `EventMap` in `src/types.ts`).

## File map

```
shared/            Types + content shared by client and worker (relative imports only)
  constants.ts     Location/mood/emote/sfx ids, net cadence, room codes   [done]
  archetypes.ts    The 8 playable archetypes                              [done]
  protocol.ts      WebSocket message types, Snapshot, PlayerInfo          [done]
  story.ts         Story schema: beats, triggers, effects, endings        [done]
  storyData.ts     THE campaign content (beats, npcs, items, events)      [story]

src/
  main.ts          Boot: WebGL check, construct Game, error handling      [core]
  types.ts         All subsystem contracts + EventMap                     [done]
  state.ts         ClientState mirror + settings + identity token         [done]
  core/
    events.ts      Typed EventBus                                         [done]
    Game.ts        Subsystem construction, init order, rAF loop           [core]
    SceneManager.ts renderer, camera, lights, fog, post-fx hookup         [core]
    postfx.ts      EffectComposer chain: bloom + vignette/grade           [core]
    AssetLoader.ts optional GLB swap-in (tryLoadModel)                    [core]
  world/
    LocationBase.ts abstract location                                     [done]
    WorldManager.ts location registry, travel, interactable queries       [world-infra]
    builders.ts    procedural geometry library (islands, crystals...)     [world-infra]
    Particles.ts   GPU particle systems (motes, fireflies, bubbles...)    [world-infra]
    Sky.ts         gradient sky dome, stars, aurora                       [world-infra]
    Interactables.ts factories for standard interactables                 [world-infra]
    locations/
      Skyharbor.ts WanderingWood.ts Mirrormere.ts                         [locations-a]
      Caelis.ts SunkenArchive.ts HeartOfVeil.ts                           [locations-b]
  player/
    PlayerController.ts WASD + orbit/pointer-lock camera + ground follow  [player]
    Avatar.ts      procedural glowing Veilwalker avatar + nametag/emotes  [player]
    RemotePlayers.ts interpolation of party avatars                       [player]
  net/
    NetworkClient.ts connect/reconnect, state mirroring, offline mode     [net]
  story/
    StoryEngine.ts client story mirror: votes, focus toggling             [story-engine → net agent]
  audio/
    AudioManager.ts adaptive moods, crossfades, sfx, volume channels      [audio]
    synth.ts       WebAudio synthesis helpers (pads, chimes, noise)       [audio]
    music.ts       per-mood procedural arrangements + file-swap support   [audio]
  ui/
    UIManager.ts + MainMenu HUD Minimap Journal Chat CharacterSheet
    FocusMode StoryOverlay ChoicePanel SettingsPanel HelpOverlay Toasts
    styles.css                                                            [ui]

worker/src/
  index.ts         fetch router: /api/health, /api/room/:code/{ws,info}   [net]
  VeilRoom.ts      Durable Object: sessions, ticks, persistence           [net]
  StoryDirector.ts interpreter for shared/storyData.ts                    [net]

scripts/test-sync.mjs  two-headless-client DO sync test                   [net]
docs/  PROMPT.md ARCHITECTURE.md STORY_BIBLE.md ASSETS.md DEPLOYMENT.md
.github/workflows/deploy.yml
```

## Conventions

- **Imports**: relative paths only (`../../shared/protocol`). Client may import
  `three` and `three/addons/*`. No new npm dependencies.
- **TypeScript**: strict; `isolatedModules` — use `import type` for type-only
  imports. No `any` unless interfacing with untyped JSON (justify in a comment).
- **Units**: meters, +Y up. Player eye height ~1.6m, walk 4 m/s, run 8 m/s.
  Interact radius default 3.5m. Locations are roughly 80–140m across.
- **Frame budget**: target 60fps on a mid desktop GPU. Use `InstancedMesh` for
  repeated geometry (trees, crystals, columns). Keep each location under
  ~300 draw calls. Particles are `THREE.Points` with custom shaders.
- **Look**: vibrant high fantasy. Saturated emissive accents + bloom do the
  heavy lifting. Fog colors match the sky horizon. Vertex-color gradients on
  terrain. `MeshStandardMaterial` with `flatShading` for stylized geometry.
- **Palette anchors**: deep indigo `#0b0716` (void), teal `#4be3c3`, gold
  `#ffd27a`, violet `#8d7bff`, magenta `#ff6ec7`, spring `#9fe060`.
- **UI**: vanilla DOM in `#ui-root`, styled by `src/ui/styles.css`. Translucent
  indigo panels, gold hairline borders, serif display font (Georgia stack).
  `pointer-events: none` on the root; re-enable per element.
- **Randomness in worldgen**: use `seededRandom(seed)` from builders so
  locations look identical for every player.

### Controls (implemented by PlayerController + UIManager)

| Input | Action |
|---|---|
| WASD / arrows | Move (camera-relative) |
| Shift | Run |
| Mouse drag / pointer lock (click canvas) | Look; Esc releases |
| Wheel | Camera zoom 3–12m |
| E | Interact with nearest highlighted object |
| F | Toggle focus mode (anchor the scene) |
| J / C / O / H | Journal / Character sheet / Settings / Help |
| Enter | Focus chat; Esc blurs |
| 1–8 | Emotes |

When `ui.inputCaptured` is true (chat/menu open), the controller ignores keys.

## Key flows

**Boot/join**: `main.ts` → `new Game(canvas)` → `game.run()`:
constructs all subsystems → `init(ctx)` each (order: scene, audio, ui, world,
player, remotes, story, net) → `ui.showMainMenu()` → `audio.unlock()` on menu
submit → `net.connect()` → welcome snapshot mirrored → `world.travelTo
(snapshot.you.location)` → emit `game:ready` → rAF loop (`update` all, then
`scene.render(dt)`).
If `net.connect()` rejects, `ui.confirm()` offers "Explore offline"; on accept
`net.startOffline()` produces a synthetic snapshot and play continues solo
(story features inert — the HUD shows an offline pill).

**Travel** (`WorldManager.travelTo`): emit `world:travel-begin` → `audio.sfx
('portal')` → exit old location → build new (emits `loading:progress`; UI
shows the loading veil) → `scene.applyEnvironment` → teleport player to
`spawn` + small deterministic ring-offset by playerId hash → `net.send
({t:'enterLocation'})` → emit `world:travel-end` + `loading:done` → if the
server mood is `ambient`/`exploration`, emit `audio:mood` with the location's
`defaultMood`. Portals are client-gated by `state.unlocked` (locked → gold
"sealed" toast + `denied` sfx); the server independently validates
`enterLocation` and replies `travelDenied` if abused.

**Interact**: controller finds `world.findNearestInteractable(position)`
(each frame; respects `requiresArchetype` vs `state.you.archetype`) →
highlights it + emits `interact:prompt` → on E: portals are handled locally
(travel); everything else sends `{t:'interact', objectId}`. The StoryDirector
matches beats by trigger; on a hit it broadcasts `story` (+ effects: flags,
journal, mood, items...). On no match it replies `denied` with the generic
whisper line; the client shows it as a whisper toast.

**Choice/vote**: a beat with `choice` broadcasts `choiceOpen` → ChoicePanel
shows options + live `voteTally` bars + countdown → players `vote` (re-votes
allowed until resolution) → director resolves at deadline or all-online-voted:
majority wins, ties resolve to the earliest-listed option → `choiceResult`
broadcast, flag `choice:<id>:<option>` set, dependent beats fire.

**Focus mode**: F sends `{t:'focus', on}`. The server grants one holder at a
time and broadcasts `focus`. While held: letterbox + gold vignette, the story
overlay lingers, and if the most recent beat has unrevealed `focusText` the
director broadcasts it as an addendum beat (`isAddendum: true`) — anchoring is
how the party digs deeper into a scene.

## Canonical interactable ids

Location agents MUST create these (ids, kinds, archetype gates exactly as
listed); storyData MUST reference only these. Locations may add extra
decorative `lore` interactables with the same prefix.

| Location | Id | Kind | Notes |
|---|---|---|---|
| skyharbor | `sky_echo_serai` | npc | Serai, the Lantern-Bearer |
| | `sky_loom` | shrine | The Loom of Echoes (campaign status) |
| | `sky_glyph_1` `sky_glyph_2` `sky_glyph_3` | glyph | awakening ritual (allInteract) |
| | `sky_lore_mural` `sky_lore_bell` | lore | |
| | `sky_portal_caelis` | portal | → caelis |
| | `sky_portal_archive` | portal | → sunken-archive |
| | `sky_portal_wood` | portal | → wandering-wood |
| | `sky_portal_mirrormere` | portal | → mirrormere |
| | `sky_portal_heart` | portal | → heart-of-the-veil |
| | `sky_hidden_lumen` | shrine | requiresArchetype: lumen |
| caelis | `cae_echo_aurel` | npc | Aurel, the Crystalwright |
| | `cae_resonance_1` `_2` `_3` | crystal | co-op resonance (allInteract) |
| | `cae_hush_shard` | shrine | moral choice: cleanse vs shatter |
| | `cae_lore_throne` `cae_lore_fountain` | lore | |
| | `cae_portal_sky` | portal | → skyharbor |
| | `cae_hidden_songweaver` | shrine | requiresArchetype: songweaver |
| | `cae_hidden_embersmith` | shrine | requiresArchetype: embersmith |
| sunken-archive | `arc_echo_thessaly` | npc | Thessaly, the Archivist |
| | `arc_glyph_1` `_2` `_3` | glyph | co-op (allInteract) |
| | `arc_memory_pool` | shrine | moral choice: read vs seal |
| | `arc_lore_tablet` `arc_lore_orrery` | lore | |
| | `arc_portal_sky` | portal | → skyharbor |
| | `arc_hidden_chronicler` | shrine | requiresArchetype: chronicler |
| | `arc_hidden_tidecaller` | shrine | requiresArchetype: tidecaller |
| wandering-wood | `wood_echo_rowan` | npc | Rowan, Warden of the Wood |
| | `wood_waystone_1` `_2` `_3` | crystal | co-op (allInteract) |
| | `wood_heartwood` | shrine | moral choice: prune vs nurture |
| | `wood_lore_stump` | lore | |
| | `wood_portal_sky` | portal | → skyharbor |
| | `wood_hidden_thornwalker` | shrine | requiresArchetype: thornwalker |
| | `wood_hidden_warden` | shrine | requiresArchetype: warden |
| mirrormere | `mir_echo_reflection` | npc | the Dreamer's Reflection |
| | `mir_still_pool` | shrine | choice/relationship boon |
| | `mir_lore_shore` | lore | |
| | `mir_portal_sky` | portal | → skyharbor |
| | `mir_hidden_veilseer` | shrine | requiresArchetype: veilseer |
| heart-of-the-veil | `heart_dreamer` | npc | The First Dreamer |
| | `heart_glyph_1`..`heart_glyph_5` | glyph | final ritual (allInteract) |
| | `heart_loom` | shrine | ending choice trigger |
| | `heart_portal_sky` | portal | → skyharbor |

## Canonical story flags & arc skeleton

storyData implements this skeleton (prose and extra beats are the story
author's craft; ids and flags below are fixed):

- **Act 1 — The Skyharbor** (~20 min): arrival beats; meet `serai`; ritual
  `sky_glyph_1..3` (allInteract) → beat sets flag **`awakened`**, unlocks
  caelis, sunken-archive, wandering-wood, mirrormere, `setAct 2`. One early
  group choice (tone-setter, e.g. what the party swears to the Loom).
- **Act 2 — The three Echoes** (~45 min, any order): each Echo location has a
  co-op puzzle + a moral choice + an Echo to recover, setting
  **`echo-caelis`**, **`echo-archive`**, **`echo-wood`** respectively.
  Mirrormere is optional relationship/lore content. When two of the three
  echo flags are set, a `flags`-triggered beat sets **`act3-open`**, unlocks
  heart-of-the-veil, `setAct 3` (collecting the third is encouraged via prose
  and changes the ending epilogue).
- **Act 3 — The Heart** (~20 min): the Dreamer; final ritual
  `heart_glyph_1..5`; `heart_loom` opens the **ending choice** with options
  `wake` (free the Dreamer, let the Veil fade), `mend` (reweave the dream),
  `become` (the party joins the dream as its new keepers). Resolution fires
  an `ending` effect; epilogue text varies with echo flags, moral-choice
  flags and relationship scores.
- Moral choice flags use the automatic `choice:<choiceId>:<optionId>` form.
- Endings: `ending-wake`, `ending-mend`, `ending-become`.

## world-infra public APIs (exact signatures)

`src/world/builders.ts` — every function returns objects already positioned
relative to origin; callers position/add them. All use options objects:

```ts
export function seededRandom(seed: number): () => number;                  // mulberry32
export function applyVerticalGradient(geo: THREE.BufferGeometry, bottom: number, top: number): void;
export function standardMat(opts: { color?: number; vertexColors?: boolean; emissive?: number;
  emissiveIntensity?: number; roughness?: number; metalness?: number; flatShading?: boolean;
  transparent?: boolean; opacity?: number }): THREE.MeshStandardMaterial;
export function createFloatingIsland(opts: { radius: number; height?: number; topColor: number;
  cliffColor: number; bottomColor: number; noiseAmp?: number; seed?: number }):
  { group: THREE.Group; getHeight: (x: number, z: number) => number };
export function createCrystalCluster(opts: { count: number; color: number; emissiveIntensity?: number;
  minHeight: number; maxHeight: number; spread: number; corrupted?: boolean; seed?: number }): THREE.Group;
export function createStylizedTree(opts: { height: number; trunkColor: number; canopyColor: number;
  canopyEmissive?: number; layers?: number; seed?: number }): THREE.Group;
export function createTreeField(opts: { count: number; areaRadius: number; minHeight: number;
  maxHeight: number; trunkColor: number; canopyColor: number; canopyEmissive?: number; seed?: number;
  getHeight?: (x: number, z: number) => number; exclusionRadius?: number }): THREE.Group; // InstancedMesh
export function createRuinColumn(opts: { height: number; radius: number; color: number;
  broken?: boolean; seed?: number }): THREE.Group;
export function createRuinArch(opts: { width: number; height: number; color: number;
  seed?: number }): THREE.Group;
export function createLantern(opts: { color: number; height?: number }): THREE.Group;
export function createWaterPlane(opts: { size: number; color: number; deepColor: number;
  opacity?: number; flowSpeed?: number }): { mesh: THREE.Mesh; update: (dt: number, elapsed: number) => void };
export function createLightShaft(opts: { color: number; height: number; radiusTop: number;
  radiusBottom: number; opacity?: number }): THREE.Mesh;  // additive god-ray cone
export function createBridge(opts: { from: THREE.Vector3; to: THREE.Vector3; width?: number;
  color: number; arc?: number }): THREE.Group;
export function createRock(opts: { size: number; color: number; seed?: number }): THREE.Mesh;
export function createEchoFigure(opts: { color: number; height?: number }):
  { group: THREE.Group; update: (dt: number, elapsed: number) => void };  // glowing spirit figure
```

`src/world/Particles.ts`:

```ts
export type ParticleKind = 'motes' | 'fireflies' | 'bubbles' | 'embers' | 'petals' | 'snow' | 'sparkfall';
export interface ParticleSystem { object: THREE.Points; update(dt: number, elapsed: number): void;
  setIntensity(v: number): void; dispose(): void; }
export function createParticles(opts: { kind: ParticleKind; count: number; areaRadius: number;
  height?: number; yBase?: number; color?: number; size?: number; opacity?: number }): ParticleSystem;
```

`src/world/Sky.ts`:

```ts
export interface SkyDome { group: THREE.Group; update(dt: number, elapsed: number): void; dispose(): void; }
export function createSky(opts: { topColor: number; horizonColor: number; bottomColor: number;
  stars?: boolean; aurora?: boolean; auroraColor?: number;
  sunGlow?: { position: [number, number, number]; color: number; size?: number } }): SkyDome;
```

`src/world/Interactables.ts` — factories return fully-wired `Interactable`s
(`object`, pulse/highlight behavior, idle animation via optional `update`):

```ts
import type { Interactable } from '../types';
export interface InteractableOpts { id: string; prompt: string;
  position: THREE.Vector3 | [number, number, number]; radius?: number; requiresArchetype?: ArchetypeId; }
export function makePortal(opts: InteractableOpts & { to: LocationId; color?: number; label?: string }): Interactable;
export function makeGlyphPlate(opts: InteractableOpts & { color?: number }): Interactable;
export function makeResonanceCrystal(opts: InteractableOpts & { color?: number; corrupted?: boolean }): Interactable;
export function makeEchoNpc(opts: InteractableOpts & { color: number; name: string }): Interactable;
export function makeLoreObject(opts: InteractableOpts & { loreKind?: 'tablet' | 'mural' | 'bell' | 'stump'
  | 'orrery' | 'fountain' | 'generic'; color?: number }): Interactable;
export function makeShrine(opts: InteractableOpts & { color?: number }): Interactable;
```

Location agents use these factories for all canonical interactables (visual
consistency), and builders/raw three.js for scenery. Locations may build
bespoke geometry inline when no builder fits.

## Persistence model (Durable Object storage)

- `campaign`: { flags, unlocked, act, firedBeats, relationships, mood,
  endingId, activeChoice (with votes), revealedFocusBeats, choiceLog }
- `players`: token → { id, name, archetype, location, stats, inventory }
- `journal`: JournalEntry[]
- Writes are debounced (~2s) and flushed on disconnect/last-socket-close.
- One campaign = one room code = one DO (`idFromName(code)`). Multiple
  campaigns coexist trivially; rejoining a code resumes that campaign.

## Asset swap points (procedural placeholders → real assets)

- `core/AssetLoader.ts`: `tryLoadModel(id)` loads `public/models/<id>.glb`
  if present (returns null on 404) — locations call it for hero set-pieces
  and fall back to procedural geometry. See docs/ASSETS.md for the id list.
- `audio/music.ts`: drops-in `public/audio/music/<mood>.ogg` per mood if
  present; otherwise the procedural arrangement plays. SFX likewise via
  `public/audio/sfx/<id>.ogg`.
