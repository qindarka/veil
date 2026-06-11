/**
 * src/audio/music.ts
 * The adaptive soundtrack: one procedural arrangement per MusicMood, all on a
 * shared ~72bpm transport, each playing through its own gain so AudioManager
 * can crossfade between moods.
 *
 * ╔══════════════════════ FILE-SWAP CONTRACT (read me) ═══════════════════════╗
 * ║ Drop real music into  public/audio/music/<mood>.ogg  and it REPLACES the  ║
 * ║ procedural arrangement for that mood — no code changes needed.            ║
 * ║                                                                            ║
 * ║   Moods / filenames:  menu.ogg  ambient.ogg  exploration.ogg              ║
 * ║                       tension.ogg  climax.ogg  hopeful.ogg                ║
 * ║                                                                            ║
 * ║ How it works: on the FIRST use of a mood we fetch HEAD                    ║
 * ║ "/audio/music/<mood>.ogg". If the file exists, it is looped via an        ║
 * ║ HTMLAudioElement → MediaElementAudioSourceNode into the same mood gain    ║
 * ║ (so crossfades, the focus lowpass and volume channels all still apply).   ║
 * ║ If it 404s, the procedural Web Audio arrangement plays instead. The probe ║
 * ║ result is cached for the session. Tracks should be seamless loops; see    ║
 * ║ public/audio/README.md for mastering guidance.                            ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */

import type { MusicMood } from '../../shared/constants';
import type { PadHandle } from './synth';
import { fmBell, midiHz, pluck, startPad, sweepTone } from './synth';

// ── Transport (standard Web Audio lookahead scheduler) ───────────────────────

const BPM = 72;
const STEPS_PER_BEAT = 4; // 16th notes
export const SECONDS_PER_STEP = 60 / BPM / STEPS_PER_BEAT; // ≈ 0.208s
const STEPS_PER_BAR = 16; // 4/4
const LOOKAHEAD_S = 0.3; // schedule this far ahead of the audio clock
const TICK_MS = 100; // scheduler wakeup cadence

/**
 * setInterval wakes ~every 100ms and schedules every 16th-note step that
 * falls within the next 300ms on the AudioContext clock — timing stays
 * sample-accurate even though JS timers jitter.
 */
class Transport {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly onStep: (time: number, step: number) => void,
  ) {}

  start(): void {
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    const tick = (): void => {
      // Background tabs throttle timers to ~1s; widen the lookahead so the
      // music doesn't gap while the player is alt-tabbed.
      const lookahead = typeof document !== 'undefined' && document.hidden ? 1.6 : LOOKAHEAD_S;
      while (this.nextTime < this.ctx.currentTime + lookahead) {
        try {
          this.onStep(this.nextTime, this.step);
        } catch (err) {
          console.error('[music] arrangement step threw', err);
        }
        this.nextTime += SECONDS_PER_STEP;
        this.step++;
      }
    };
    tick();
    this.timer = window.setInterval(tick, TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ── Mood player ──────────────────────────────────────────────────────────────

export interface MoodPlayer {
  /** Begin playback, fading the mood's own gain in over `fadeSeconds`. */
  start(fadeSeconds?: number): void;
  /** Fade out over `fadeSeconds`, then tear the arrangement down. */
  stop(fadeSeconds?: number): void;
}

/** Arrangement = sustained layers (pads/drones) + per-16th-step events. */
interface ArrangementSpec {
  startSustained?(ctx: BaseAudioContext, out: AudioNode): PadHandle[];
  onStep?(ctx: BaseAudioContext, out: AudioNode, time: number, step: number): void;
}

// ── File-swap probing & media element cache ──────────────────────────────────

const musicUrl = (mood: MusicMood): string => `${import.meta.env.BASE_URL}audio/music/${mood}.ogg`;

/** HEAD-probe results, cached per mood for the whole session. */
const probeCache = new Map<MusicMood, Promise<boolean>>();

function probeMusicFile(mood: MusicMood): Promise<boolean> {
  let p = probeCache.get(mood);
  if (!p) {
    p = fetch(musicUrl(mood), { method: 'HEAD' })
      .then((res) => {
        // Guard against SPA-style HTML fallbacks answering 200 for missing files.
        const type = res.headers.get('content-type') ?? '';
        return res.ok && !type.includes('text/html');
      })
      .catch(() => false);
    probeCache.set(mood, p);
  }
  return p;
}

interface MediaBundle {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  /** The MoodPlayer currently driving this element (re-entry guard). */
  owner: unknown;
}

// A media element may only be wrapped by ONE MediaElementAudioSourceNode per
// AudioContext, so we cache the element+node pair and reconnect it.
const mediaCache = new WeakMap<AudioContext, Map<MusicMood, MediaBundle>>();

function acquireMedia(ctx: AudioContext, mood: MusicMood): MediaBundle {
  let perCtx = mediaCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    mediaCache.set(ctx, perCtx);
  }
  let bundle = perCtx.get(mood);
  if (!bundle) {
    const el = new Audio(musicUrl(mood));
    el.loop = true;
    el.preload = 'auto';
    bundle = { el, src: ctx.createMediaElementSource(el), owner: null };
    perCtx.set(mood, bundle);
  }
  return bundle;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a (not yet started) player for one mood, routed through its own
 * GainNode into `destination` so AudioManager can crossfade between moods.
 */
export function createMoodPlayer(ctx: AudioContext, mood: MusicMood, destination: AudioNode): MoodPlayer {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(destination);

  let stopped = false;
  let pads: PadHandle[] = [];
  let transport: Transport | null = null;
  let media: MediaBundle | null = null;

  const player: MoodPlayer = {
    start(fadeSeconds = 0): void {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(1, t + Math.max(fadeSeconds, 0.02));
      // The file probe is async; the first ~instant of a brand-new mood is
      // silent either way because of the fade-in, so nothing is lost.
      void probeMusicFile(mood).then((hasFile) => {
        if (stopped) return;
        if (hasFile) {
          media = acquireMedia(ctx, mood);
          media.owner = player;
          media.src.connect(out);
          media.el.currentTime = 0;
          media.el.play().catch((err) => {
            // Autoplay rejection should be impossible post-unlock(); fall back.
            console.warn(`[music] file playback for "${mood}" failed, using synth`, err);
            media = null;
            if (!stopped) startProcedural();
          });
        } else {
          startProcedural();
        }
      });
    },

    stop(fadeSeconds = 1): void {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      const fade = Math.max(fadeSeconds, 0.05);
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + fade);
      for (const pad of pads) pad.stop(t + fade, 0.5);
      const mediaRef = media;
      window.setTimeout(() => {
        transport?.stop(); // keep scheduling through the crossfade tail
        if (mediaRef && mediaRef.owner === player) {
          mediaRef.el.pause();
          mediaRef.src.disconnect();
        }
        out.disconnect();
      }, (fade + 0.3) * 1000);
    },
  };

  function startProcedural(): void {
    const spec = ARRANGEMENTS[mood]();
    pads = spec.startSustained?.(ctx, out) ?? [];
    const onStep = spec.onStep;
    if (onStep) {
      transport = new Transport(ctx, (time, step) => onStep(ctx, out, time, step));
      transport.start();
    }
  }

  return player;
}

// ── Musical material ─────────────────────────────────────────────────────────
// Home key: D major / B minor — the same palette synth.ts uses for SFX, so
// stingers always land inside the score. Notes below are MIDI numbers.

const hz = midiHz;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Soft sub-bass "boom" used as the heartbeat pulse in several moods. */
function lowPulse(ctx: BaseAudioContext, out: AudioNode, t: number, midi: number, gain = 0.16): void {
  sweepTone(ctx, out, t, { from: hz(midi), to: hz(midi) * 0.55, duration: 0.6, type: 'sine', gain, attack: 0.015 });
}

const barOf = (step: number): number => Math.floor(step / STEPS_PER_BAR);
const stepInBar = (step: number): number => step % STEPS_PER_BAR;

// menu: warm slow Dmaj7 pad + sparse music-box plucks high above it.
function menuArrangement(): ArrangementSpec {
  const musicBox = [74, 76, 78, 81, 83, 86]; // D major pentatonic, two octaves up
  return {
    startSustained: (ctx, out) => [
      startPad(ctx, out, {
        freqs: [50, 54, 57, 61].map(hz), // D3 F#3 A3 C#4 — Imaj7 warmth
        type: 'triangle', filterHz: 1200, gain: 0.09, attack: 4,
        detuneCents: 6, vibratoHz: 0.12, vibratoCents: 4,
      }),
      startPad(ctx, out, {
        freqs: [hz(74), hz(81)], type: 'sine', filterHz: 5000,
        gain: 0.016, attack: 7, detuneCents: 10,
      }),
    ],
    onStep: (ctx, out, t, step) => {
      // Sparse plucks on 8th positions only — a music box winding down.
      if (step % 2 === 0 && Math.random() < 0.13) {
        fmBell(ctx, out, t, { freq: hz(pick(musicBox)), ratio: 4.0, index: 0.9, decay: 1.4, gain: 0.05 });
      }
    },
  };
}

// ambient: airy quintal pad + occasional harp arpeggio + soft high shimmer.
function ambientArrangement(): ArrangementSpec {
  const pent = [62, 64, 66, 69, 71, 74, 76, 78, 81];
  return {
    startSustained: (ctx, out) => [
      startPad(ctx, out, {
        freqs: [50, 57, 64].map(hz), // D3 A3 E4 — open fifths, no third: airy
        type: 'sawtooth', filterHz: 700, gain: 0.06, attack: 6,
        detuneCents: 9, vibratoHz: 0.09, vibratoCents: 5,
      }),
      // Two sines a few cents apart beat slowly against each other: shimmer.
      startPad(ctx, out, { freqs: [hz(86), hz(86) * 1.004], type: 'sine', filterHz: 8000, gain: 0.012, attack: 9, detuneCents: 0, voicesPerNote: 1 }),
    ],
    onStep: (ctx, out, t, step) => {
      // A harp run drifts by every few bars.
      if (stepInBar(step) === 0 && barOf(step) % 2 === 1 && Math.random() < 0.4) {
        const start = Math.floor(Math.random() * 3);
        for (let i = 0; i < 6; i++) {
          pluck(ctx, out, t + i * SECONDS_PER_STEP, { freq: hz(pent[start + i]), type: 'triangle', gain: 0.055, decay: 1.0 });
        }
      }
    },
  };
}

// exploration: pad + gently pulsing 8th-note plucks + low pulse every other bar.
function explorationArrangement(): ArrangementSpec {
  const tones = [62, 66, 69, 74, 76]; // D4 F#4 A4 D5 E5
  const pattern = [0, 2, 1, 3, 2, 4, 1, 2]; // indexes into tones, per 8th note
  return {
    startSustained: (ctx, out) => [
      startPad(ctx, out, {
        freqs: [50, 54, 57, 64].map(hz), // Dmaj add9
        type: 'sawtooth', filterHz: 850, gain: 0.06, attack: 4,
        detuneCents: 8, vibratoHz: 0.1, vibratoCents: 4,
      }),
    ],
    onStep: (ctx, out, t, step) => {
      if (step % 2 === 0) {
        const idx = (step / 2) % pattern.length;
        // Slow sine over the bar makes the pattern breathe instead of tick.
        const vel = 0.7 + 0.3 * Math.sin((step % (STEPS_PER_BAR * 2)) * (Math.PI / STEPS_PER_BAR));
        pluck(ctx, out, t, { freq: hz(tones[pattern[idx]]), type: 'triangle', gain: 0.05 * vel, decay: 0.4 });
      }
      if (stepInBar(step) === 0 && barOf(step) % 2 === 0) lowPulse(ctx, out, t, 38, 0.14); // D2
    },
  };
}

// tension: minor drones + slow dissonant shimmer + sparse, irregular low pulse.
function tensionArrangement(): ArrangementSpec {
  return {
    startSustained: (ctx, out) => [
      startPad(ctx, out, {
        freqs: [47, 50, 54].map(hz), // B2 D3 F#3 — B minor, filtered dark
        type: 'sawtooth', filterHz: 420, filterQ: 1.2, gain: 0.07, attack: 5,
        detuneCents: 11, vibratoHz: 0.07, vibratoCents: 6,
      }),
      // Minor-second cluster (B5 + C6) very faint: the dissonant shimmer.
      startPad(ctx, out, {
        freqs: [83, 84].map(hz), type: 'sine', filterHz: 6000,
        gain: 0.018, attack: 10, detuneCents: 5, vibratoHz: 0.05, vibratoCents: 9,
      }),
    ],
    onStep: (ctx, out, t, step) => {
      // Pulse only *most* of the time — the missing beats are the unease.
      if (stepInBar(step) === 0 && barOf(step) % 2 === 0 && Math.random() < 0.7) {
        lowPulse(ctx, out, t, 35, 0.17); // B1
      }
      // Rare inharmonic toll far away.
      if (stepInBar(step) === 8 && Math.random() < 0.08) {
        fmBell(ctx, out, t, { freq: hz(78) * 1.02, ratio: 2.37, index: 1.6, decay: 1.9, gain: 0.028 });
      }
    },
  };
}

// climax: low drone + 16th arpeggio + detuned choir-saws + heartbeat pulse,
// cycling Bm → G → D → A, one chord per bar.
function climaxArrangement(): ArrangementSpec {
  const chords = [
    [47, 50, 54], // Bm
    [43, 47, 50], // G
    [50, 54, 57], // D
    [45, 49, 52], // A
  ];
  const roots = [35, 31, 38, 33]; // B1 G1 D2 A1
  const arpPattern = [0, 1, 2, 3, 4, 5, 3, 4]; // up-and-crest over 8 steps
  let chordPad: PadHandle | null = null;
  let choirPad: PadHandle | null = null;
  let dronePad: PadHandle | null = null;
  let chord = chords[0];
  return {
    startSustained: (ctx, out) => {
      chordPad = startPad(ctx, out, {
        freqs: chord.map(hz), type: 'sawtooth', filterHz: 1300, gain: 0.065,
        attack: 1.5, detuneCents: 10, voicesPerNote: 3,
      });
      // Choir-ish layer: heavily detuned saws an octave up, lowpassed soft.
      choirPad = startPad(ctx, out, {
        freqs: chord.map((m) => hz(m + 12)), type: 'sawtooth', filterHz: 1900,
        gain: 0.045, attack: 2.5, detuneCents: 16, voicesPerNote: 3,
        vibratoHz: 0.15, vibratoCents: 6,
      });
      dronePad = startPad(ctx, out, {
        freqs: [hz(roots[0])], type: 'sine', filterHz: 300, gain: 0.09,
        attack: 1.5, detuneCents: 5,
      });
      return [chordPad, choirPad, dronePad];
    },
    onStep: (ctx, out, t, step) => {
      const sib = stepInBar(step);
      if (sib === 0) {
        chord = chords[barOf(step) % chords.length];
        chordPad?.setChord(chord.map(hz), t, 0.1);
        choirPad?.setChord(chord.map((m) => hz(m + 12)), t, 0.15);
        dronePad?.setChord([hz(roots[barOf(step) % roots.length])], t, 0.2);
      }
      // Relentless 16th arpeggio over two octaves of the current chord.
      const arpNotes = [...chord.map((m) => m + 12), ...chord.map((m) => m + 24)];
      pluck(ctx, out, t, { freq: hz(arpNotes[arpPattern[sib % arpPattern.length]]), type: 'triangle', gain: 0.055, decay: 0.22 });
      // Heartbeat on beats 1 and 3.
      if (sib === 0 || sib === 8) lowPulse(ctx, out, t, roots[barOf(step) % roots.length], 0.16);
    },
  };
}

// hopeful: major pads cycling D → G → A → D + bell melody fragments.
function hopefulArrangement(): ArrangementSpec {
  const chords = [
    [50, 54, 57], // D
    [50, 55, 59], // G (2nd inversion, smooth voice-leading)
    [49, 52, 57], // A (1st inversion)
    [50, 54, 57], // D
  ];
  const roots = [38, 43, 45, 38];
  const fragments = [
    [74, 76, 78],
    [78, 81, 86],
    [81, 78, 76, 74],
    [76, 74, 71],
    [78, 76, 81],
  ];
  let chordPad: PadHandle | null = null;
  let subPad: PadHandle | null = null;
  return {
    startSustained: (ctx, out) => {
      chordPad = startPad(ctx, out, {
        freqs: chords[0].map(hz), type: 'sawtooth', filterHz: 1000, gain: 0.07,
        attack: 3, detuneCents: 8, vibratoHz: 0.12, vibratoCents: 4,
      });
      subPad = startPad(ctx, out, { freqs: [hz(roots[0])], type: 'sine', filterHz: 300, gain: 0.06, attack: 3, detuneCents: 4 });
      const shimmer = startPad(ctx, out, { freqs: [hz(86), hz(86) * 1.003], type: 'sine', filterHz: 8000, gain: 0.012, attack: 8, detuneCents: 0, voicesPerNote: 1 });
      return [chordPad, subPad, shimmer];
    },
    onStep: (ctx, out, t, step) => {
      const sib = stepInBar(step);
      const bar = barOf(step);
      if (sib === 0) {
        chordPad?.setChord(chords[bar % chords.length].map(hz), t, 0.25);
        subPad?.setChord([hz(roots[bar % roots.length])], t, 0.25);
        if (bar % 2 === 0) lowPulse(ctx, out, t, roots[bar % roots.length], 0.1);
        // A bell melody fragment sings out on some bars, on 8th notes.
        if (Math.random() < 0.45) {
          const frag = pick(fragments);
          for (let i = 0; i < frag.length; i++) {
            fmBell(ctx, out, t + i * SECONDS_PER_STEP * 2, { freq: hz(frag[i]), ratio: 2.0, index: 1.1, decay: 1.6, gain: 0.055 });
          }
        }
      }
    },
  };
}

const ARRANGEMENTS: Record<MusicMood, () => ArrangementSpec> = {
  menu: menuArrangement,
  ambient: ambientArrangement,
  exploration: explorationArrangement,
  tension: tensionArrangement,
  climax: climaxArrangement,
  hopeful: hopefulArrangement,
};
