/**
 * src/audio/AudioManager.ts
 * Implements IAudioManager: the adaptive WebAudio soundtrack (mood crossfades
 * via music.ts), synthesized one-shot SFX (synth.ts), volume channels, the
 * focus-mode "underwater" lowpass sweep, and the objective-guidance layer —
 * a proximity shimmer that swells near the current objective's targets plus
 * a short sting when the resolved objective advances.
 *
 * Signal graph:
 *   musicGain ─┐
 *              ├─► lowpass (focus filter) ─► masterGain ─► compressor ─► out
 *   sfxGain  ──┘   (the shimmer loop and the sting feed sfxGain, so they
 *                   inherit the focus filter and the sfx/master channels)
 *
 * The AudioContext is created suspended (browser autoplay policy) and resumed
 * by unlock(), which Game calls from the main-menu submit gesture.
 */

import * as THREE from 'three';
import type { MusicMood, SfxId } from '../../shared/constants';
import { localTargets, resolveObjective } from '../story/objectives';
import type { GameContext, IAudioManager, Interactable } from '../types';
import type { MoodPlayer } from './music';
import { createMoodPlayer } from './music';
import type { ShimmerHandle } from './synth';
import { objectiveSting, playSfx, startShimmerLoop } from './synth';

type VolumeChannel = 'master' | 'music' | 'sfx';

/** "Open" cutoff — effectively bypassed (kept below Nyquist for any rate). */
const FILTER_OPEN_HZ = 19500;
/** Underwater cutoff while a player anchors the scene in focus mode. */
const FILTER_FOCUS_HZ = 900;
/** Per-call SFX detune jitter (± cents) so repeats feel organic. */
const SFX_JITTER_CENTS = 14;

/** Proximity shimmer is silent at/beyond this distance to the nearest target. */
const SHIMMER_FAR_M = 28;
/** ...and at full presence at/inside this distance. */
const SHIMMER_NEAR_M = 5;
/** Shimmer ceiling — a modest slice of the sfx channel; the music stays on top. */
const SHIMMER_LEVEL = 0.25;
/** setTargetAtTime time constant for the shimmer level (no zipper, no clicks). */
const SHIMMER_SMOOTH_S = 0.25;
/** Objective/target re-resolve cadence; the distance itself runs every frame. */
const OBJECTIVE_REFRESH_S = 1;

const SFX_FILE_BASE = (): string => `${import.meta.env.BASE_URL}audio/sfx/`;

export class AudioManager implements IAudioManager {
  private ctx!: GameContext;

  private readonly ac: AudioContext;
  private readonly masterGain: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly musicGain: GainNode;
  private readonly sfxGain: GainNode;

  /** Raw 0..1 slider values (the applied gain uses a squared taper). */
  private readonly volumes: Record<VolumeChannel, number> = { master: 0.8, music: 0.7, sfx: 0.8 };

  private unlocked = false;
  private currentMood: MusicMood = 'menu';
  private active: MoodPlayer | null = null;
  private focusHeld = false;
  private unsubs: Array<() => void> = [];

  // Objective-guidance layer (proximity shimmer + advance sting).
  /** Lazily-created proximity loop (after unlock, on first audible use). */
  private shimmer: ShimmerHandle | null = null;
  /** Last driven shimmer level, to skip redundant automation events. */
  private shimmerLevel = 0;
  /** AudioContext time of the next scheduled sparkle bell. */
  private nextSparkleAt = 0;
  /** Resolved objective id from the previous re-resolve (null = none yet). */
  private lastObjectiveId: string | null = null;
  /** Current-objective targets in the current location (refreshed at ~1Hz). */
  private targets: Interactable[] = [];
  private nextObjectiveRefresh = 0;
  private objectiveDirty = false;
  private readonly tmpTargetPos = new THREE.Vector3();

  /** Decoded replacement SFX files (null = probed, none found). */
  private readonly sfxFiles = new Map<SfxId, AudioBuffer | null>();
  private readonly sfxProbes = new Set<SfxId>();

  constructor() {
    // Created up-front (likely in the "suspended" state until unlock()).
    this.ac = new AudioContext();

    this.compressor = this.ac.createDynamicsCompressor();
    // Gentle glue: tame stacked pads + SFX peaks without audible pumping.
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 2.5;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.3;
    this.compressor.connect(this.ac.destination);

    this.masterGain = this.ac.createGain();
    this.masterGain.connect(this.compressor);

    this.lowpass = this.ac.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = FILTER_OPEN_HZ;
    this.lowpass.Q.value = 0.7;
    this.lowpass.connect(this.masterGain);

    this.musicGain = this.ac.createGain();
    this.musicGain.connect(this.lowpass);
    this.sfxGain = this.ac.createGain();
    this.sfxGain.connect(this.lowpass);

    for (const ch of ['master', 'music', 'sfx'] as const) this.applyVolume(ch);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;

    const s = ctx.state.settings;
    this.setVolume('master', s.masterVolume);
    this.setVolume('music', s.musicVolume);
    this.setVolume('sfx', s.sfxVolume);

    this.unsubs.push(
      ctx.events.on('audio:mood', ({ mood }) => this.setMood(mood)),
      ctx.events.on('settings:changed', ({ settings }) => {
        this.setVolume('master', settings.masterVolume);
        this.setVolume('music', settings.musicVolume);
        this.setVolume('sfx', settings.sfxVolume);
      }),
      // Focus mode is a shared dramatic moment: every player in the room gets
      // the underwater filter while anyone holds the anchor.
      ctx.events.on('focus:changed', ({ holderId }) => {
        const on = holderId !== null;
        if (on === this.focusHeld) return;
        this.focusHeld = on;
        this.sweepFocusFilter(on);
        this.sfx(on ? 'focus-on' : 'focus-off');
      }),
      // The objective can move when flags land, locations unlock or we arrive
      // somewhere new — fold an immediate re-resolve into the next update tick.
      ctx.events.on('story:flags', () => {
        this.objectiveDirty = true;
      }),
      ctx.events.on('locations:unlocked', () => {
        this.objectiveDirty = true;
      }),
      ctx.events.on('world:travel-end', () => {
        this.objectiveDirty = true;
      }),
    );
  }

  /**
   * Musical timing is scheduled on the AudioContext clock by music.ts's
   * lookahead transport, not the game loop — update() only drives the
   * objective-guidance layer (proximity shimmer level + advance sting).
   */
  update(_dt: number, elapsed: number): void {
    this.updateGuidance(elapsed);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.active?.stop(0.1);
    this.active = null;
    this.shimmer?.stop(0.2);
    this.shimmer = null;
    void this.ac.close().catch(() => {});
  }

  // ── IAudioManager ──────────────────────────────────────────────────────────

  /** Resume the AudioContext from a user gesture. Idempotent / retryable. */
  async unlock(): Promise<void> {
    if (this.ac.state !== 'running') {
      try {
        await this.ac.resume();
      } catch {
        // No valid gesture yet — the next unlock() call will retry.
      }
    }
    if (this.unlocked || this.ac.state !== 'running') return;
    this.unlocked = true;
    // Start whatever mood was requested while we were still locked.
    if (!this.active) this.crossfadeTo(this.currentMood, 2.5);
  }

  get mood(): MusicMood {
    return this.currentMood;
  }

  setMood(mood: MusicMood, fadeSeconds = 3): void {
    // No-op when the requested mood is already sounding.
    if (mood === this.currentMood && this.active) return;
    this.currentMood = mood;
    if (!this.unlocked) return; // deferred: unlock() starts the current mood
    this.crossfadeTo(mood, fadeSeconds);
  }

  sfx(id: SfxId): void {
    // While suspended, scheduled one-shots would pile up and fire all at once
    // on resume — skip instead.
    if (this.ac.state !== 'running') return;
    const jitter = (Math.random() * 2 - 1) * SFX_JITTER_CENTS;

    // FILE SWAP: a decoded public/audio/sfx/<id>.ogg replaces the synth
    // version. The first trigger plays the synth while the probe is in
    // flight; subsequent triggers use the file.
    const buf = this.sfxFiles.get(id);
    if (buf) {
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      src.detune.value = jitter;
      const g = this.ac.createGain();
      g.gain.value = 0.9; // headroom so files mix like the synth one-shots
      src.connect(g).connect(this.sfxGain);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      src.start();
      return;
    }
    this.probeSfxFile(id);
    playSfx(this.ac, this.sfxGain, id, jitter);
  }

  setVolume(channel: VolumeChannel, value: number): void {
    this.volumes[channel] = Math.min(1, Math.max(0, value));
    this.applyVolume(channel);
  }

  getVolume(channel: VolumeChannel): number {
    return this.volumes[channel];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private crossfadeTo(mood: MusicMood, fadeSeconds: number): void {
    const fade = Math.max(0.05, fadeSeconds);
    this.active?.stop(fade);
    this.active = createMoodPlayer(this.ac, mood, this.musicGain);
    this.active.start(fade);
  }

  private applyVolume(channel: VolumeChannel): void {
    const node =
      channel === 'master' ? this.masterGain : channel === 'music' ? this.musicGain : this.sfxGain;
    const raw = this.volumes[channel];
    // Squared taper ≈ perceptual loudness; setTargetAtTime avoids zipper noise.
    node.gain.setTargetAtTime(raw * raw, this.ac.currentTime, 0.05);
  }

  /** The focus-mode "underwater" feel: sweep the master lowpass down/up. */
  private sweepFocusFilter(on: boolean): void {
    const t = this.ac.currentTime;
    const freq = this.lowpass.frequency;
    freq.cancelScheduledValues(t);
    freq.setValueAtTime(Math.max(freq.value, 40), t);
    freq.exponentialRampToValueAtTime(on ? FILTER_FOCUS_HZ : FILTER_OPEN_HZ, t + (on ? 1.0 : 0.7));
    // A touch of resonance while submerged makes it watery, not just muffled.
    this.lowpass.Q.setTargetAtTime(on ? 1.3 : 0.7, t, 0.3);
  }

  // ── Objective guidance: proximity shimmer + advance sting ──────────────────

  /**
   * Per-frame driver. Re-resolves the objective + local targets at ~1Hz (or
   * immediately when an event marked them dirty), measures the distance to
   * the nearest target every tick, and eases the shimmer level toward it.
   */
  private updateGuidance(elapsed: number): void {
    const ctx = this.ctx;
    // Pre-init/pre-welcome there is nothing to resolve yet; offline solo has
    // no story director, so the guidance layer stays silent (like Beacons).
    if (!ctx || ctx.state.you === null || ctx.net.offlineMode) {
      this.driveShimmer(0);
      return;
    }
    // The arrival sweep owns the camera: hold the shimmer and defer any
    // pending re-resolve so an advance sting lands as control returns.
    if (ctx.player.cinematicActive) {
      this.driveShimmer(0);
      return;
    }

    if (this.objectiveDirty || elapsed >= this.nextObjectiveRefresh) {
      this.objectiveDirty = false;
      this.nextObjectiveRefresh = elapsed + OBJECTIVE_REFRESH_S;
      this.refreshObjective();
    }

    // Mute outright when the context is silent anyway, while a focus anchor
    // holds the lowpass moment, after the ending, or with nothing to find.
    if (
      this.ac.state !== 'running' ||
      this.focusHeld ||
      ctx.state.endingId !== null ||
      this.targets.length === 0
    ) {
      this.driveShimmer(0);
      return;
    }

    // Distance to the nearest target, measured every tick.
    let nearest = Infinity;
    for (const target of this.targets) {
      target.object.getWorldPosition(this.tmpTargetPos);
      nearest = Math.min(nearest, this.tmpTargetPos.distanceTo(ctx.player.position));
    }
    // Smoothstep far → near so the swell eases in and out at both edges.
    const x = Math.min(1, Math.max(0, (SHIMMER_FAR_M - nearest) / (SHIMMER_FAR_M - SHIMMER_NEAR_M)));
    this.driveShimmer(SHIMMER_LEVEL * x * x * (3 - 2 * x));
  }

  /** Re-derive the objective and its local targets — the same way the HUD does. */
  private refreshObjective(): void {
    const ctx = this.ctx;
    const objective = resolveObjective(ctx.state);

    // Advance sting: the resolved id moved after game start. The very first
    // resolution (join/rejoin) and the ending's own moment stay silent.
    if (
      this.lastObjectiveId !== null &&
      objective.id !== this.lastObjectiveId &&
      ctx.state.endingId === null &&
      this.ac.state === 'running'
    ) {
      const jitter = (Math.random() * 2 - 1) * SFX_JITTER_CENTS;
      objectiveSting(this.ac, this.sfxGain, this.ac.currentTime + 0.01, jitter);
    }
    this.lastObjectiveId = objective.id;

    const location = ctx.world.current;
    if (!location) {
      this.targets = [];
      return;
    }
    // When the targets live elsewhere, shimmer toward the local waygate.
    const portals = location.interactables
      .filter((it) => it.kind === 'portal' && it.portalTo)
      .map((it) => ({ id: it.id, to: it.portalTo! }));
    this.targets = localTargets(objective, location.id, portals)
      .map((id) => ctx.world.getInteractable(id))
      .filter((it): it is Interactable => it !== null);
  }

  /**
   * Ease the proximity loop toward `level` (0..SHIMMER_LEVEL), lazily creating
   * it on first audible use, and keep its sparse sparkle bells scheduled.
   */
  private driveShimmer(level: number): void {
    if (!this.shimmer) {
      if (level <= 0 || !this.unlocked || this.ac.state !== 'running') return;
      this.shimmer = startShimmerLoop(this.ac, this.sfxGain);
      this.nextSparkleAt = this.ac.currentTime + 1.2;
    }
    const t = this.ac.currentTime;
    if (Math.abs(level - this.shimmerLevel) > 0.001) {
      this.shimmerLevel = level;
      this.shimmer.level.setTargetAtTime(level, t, SHIMMER_SMOOTH_S);
    }
    if (level > 0.02) {
      // Keep one sparkle queued just ahead of the clock while audible.
      if (this.nextSparkleAt < t + 0.15) {
        const when = Math.max(this.nextSparkleAt, t + 0.02);
        this.shimmer.sparkle(when, (Math.random() * 2 - 1) * SFX_JITTER_CENTS);
        this.nextSparkleAt = when + 0.7 + Math.random() * 1.6;
      }
    } else {
      // While silent, keep the next sparkle off the immediate horizon.
      this.nextSparkleAt = Math.max(this.nextSparkleAt, t + 0.8);
    }
  }

  private probeSfxFile(id: SfxId): void {
    if (this.sfxProbes.has(id)) return;
    this.sfxProbes.add(id);
    void fetch(`${SFX_FILE_BASE()}${id}.ogg`)
      .then(async (res) => {
        // Guard against SPA-style HTML fallbacks answering 200 for missing files.
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || type.includes('text/html')) return null;
        return this.ac.decodeAudioData(await res.arrayBuffer());
      })
      .then((buffer) => this.sfxFiles.set(id, buffer))
      .catch(() => this.sfxFiles.set(id, null));
  }
}
