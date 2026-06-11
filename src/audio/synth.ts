/**
 * src/audio/synth.ts
 * Reusable Web Audio synthesis primitives (pads, plucks, FM bells, noise,
 * sweeps, ADSR) plus the designed one-shot for every SfxId in
 * shared/constants. No npm deps, no audio files: everything is synthesized.
 *
 * Conventions:
 *  - Every one-shot takes (ctx, dest, when, opts) and schedules itself on the
 *    AudioContext clock, then frees its nodes via `onended`.
 *  - `detune` options are in cents; SFX callers pass a small random jitter so
 *    repeated sounds feel organic.
 *  - Gains are conservative by design: SFX must never drown the music.
 */

import type { SfxId } from '../../shared/constants';

/** Smallest value exponential ramps may target (they cannot reach 0). */
const FLOOR = 0.0001;

// ── Tuning helpers ───────────────────────────────────────────────────────────

/** MIDI note number → frequency in Hz (A4 = 69 = 440Hz). */
export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Cents offset → playback-rate multiplier (for noise/buffer sources). */
export function centsToRate(cents: number): number {
  return 2 ** (cents / 1200);
}

// ── ADSR helper ──────────────────────────────────────────────────────────────

export interface AdsrOpts {
  /** Seconds to reach `peak`. */
  attack?: number;
  /** Seconds from peak down to the sustain level. */
  decay?: number;
  /** Sustain level as a fraction of `peak` (0..1). */
  sustain?: number;
  /** Seconds from gate-off to silence. */
  release?: number;
  peak?: number;
}

/**
 * Schedule a full ADSR envelope on a gain-like AudioParam. `gate` is the time
 * in seconds the note is held (measured from `when`); release begins after it.
 * Returns the absolute time at which the envelope reaches silence.
 */
export function applyAdsr(param: AudioParam, when: number, gate: number, opts: AdsrOpts = {}): number {
  const { attack = 0.01, decay = 0.05, sustain = 1, release = 0.1, peak = 1 } = opts;
  param.cancelScheduledValues(when);
  param.setValueAtTime(FLOOR, when);
  param.linearRampToValueAtTime(Math.max(peak, FLOOR), when + attack);
  const sus = Math.max(peak * sustain, FLOOR);
  param.exponentialRampToValueAtTime(sus, when + attack + decay);
  const off = when + Math.max(gate, attack + decay);
  param.setValueAtTime(sus, off);
  param.exponentialRampToValueAtTime(FLOOR, off + release);
  return off + release;
}

// ── Noise buffer factory ─────────────────────────────────────────────────────

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Cached 2-second white-noise buffer (one per AudioContext). */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

// ── One-shot: pluck ──────────────────────────────────────────────────────────

export interface PluckOpts {
  freq: number;
  type?: OscillatorType;
  gain?: number;
  /** Seconds to decay to silence. */
  decay?: number;
  detune?: number;
}

/** Short-decay tonal pluck (music-box / harp / pickup notes). */
export function pluck(ctx: BaseAudioContext, dest: AudioNode, when: number, opts: PluckOpts): void {
  const { freq, type = 'triangle', gain = 0.1, decay = 0.3, detune = 0 } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.005); // tiny attack avoids clicks
  g.gain.exponentialRampToValueAtTime(FLOOR, when + decay);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + decay + 0.05);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

// ── One-shot: FM bell ────────────────────────────────────────────────────────

export interface FmBellOpts {
  freq: number;
  /** Modulator/carrier frequency ratio. ~2 = warm bell, ~3.01 = glassy. */
  ratio?: number;
  /** Modulation index (depth) as a multiple of `freq`. */
  index?: number;
  gain?: number;
  decay?: number;
  detune?: number;
}

/** Two-operator FM bell with exponential decay; the timbre softens as it rings. */
export function fmBell(ctx: BaseAudioContext, dest: AudioNode, when: number, opts: FmBellOpts): void {
  const { freq, ratio = 2.0, index = 1.4, gain = 0.12, decay = 1.0, detune = 0 } = opts;
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = freq;
  carrier.detune.value = detune;
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = freq * ratio;
  const modGain = ctx.createGain();
  // Modulation depth decays faster than the amplitude → bright strike, pure tail.
  modGain.gain.setValueAtTime(freq * index, when);
  modGain.gain.exponentialRampToValueAtTime(1, when + decay * 0.55);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, when);
  amp.gain.linearRampToValueAtTime(gain, when + 0.008);
  amp.gain.exponentialRampToValueAtTime(FLOOR, when + decay);
  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(amp).connect(dest);
  mod.start(when);
  carrier.start(when);
  mod.stop(when + decay + 0.05);
  carrier.stop(when + decay + 0.05);
  carrier.onended = () => {
    carrier.disconnect();
    mod.disconnect();
    modGain.disconnect();
    amp.disconnect();
  };
}

// ── One-shot: filtered noise burst ───────────────────────────────────────────

export interface NoiseBurstOpts {
  duration?: number;
  filterType?: BiquadFilterType;
  /** Filter start frequency (Hz). */
  freq?: number;
  /** Optional filter end frequency — sweeps over `duration` (whoosh/swish). */
  freqEnd?: number;
  q?: number;
  gain?: number;
  attack?: number;
  /** Playback-rate multiplier (use centsToRate for detune jitter). */
  rate?: number;
}

/** White noise through a swept biquad — whooshes, swishes, breaths, air. */
export function noiseBurst(ctx: BaseAudioContext, dest: AudioNode, when: number, opts: NoiseBurstOpts = {}): void {
  const {
    duration = 0.25, filterType = 'bandpass', freq = 1000, freqEnd,
    q = 1, gain = 0.08, attack = 0.01, rate = 1,
  } = opts;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true; // loop so long swells never run off the buffer end
  src.playbackRate.value = rate;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(Math.max(freq, 10), when);
  if (freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 10), when + duration);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, when);
  g.gain.linearRampToValueAtTime(gain, when + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, when + duration);
  src.connect(filter).connect(g).connect(dest);
  src.start(when, Math.random() * 1.5); // random buffer offset for variety
  src.stop(when + duration + 0.05);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    g.disconnect();
  };
}

// ── One-shot: pitch sweep ────────────────────────────────────────────────────

export interface SweepOpts {
  from: number;
  to: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  detune?: number;
}

/** Single oscillator gliding `from` → `to` Hz with an attack/decay envelope. */
export function sweepTone(ctx: BaseAudioContext, dest: AudioNode, when: number, opts: SweepOpts): void {
  const { from, to, duration, type = 'sine', gain = 0.12, attack = 0.01, detune = 0 } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(Math.max(from, 1), when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), when + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, when);
  g.gain.linearRampToValueAtTime(gain, when + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, when + duration);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + duration + 0.05);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

// ── Sustained pad ────────────────────────────────────────────────────────────

export interface PadHandle {
  /**
   * Glide the pad to a new chord (array of frequencies in Hz). The voice
   * count is fixed at creation; pass chords of the same length for clean
   * voice-leading (extra notes wrap, missing notes double).
   */
  setChord(freqs: number[], when?: number, glideSeconds?: number): void;
  /** Release the pad; nodes self-dispose after the release tail. */
  stop(when?: number, releaseSeconds?: number): void;
}

export interface PadOpts {
  /** Chord as raw frequencies (use midiHz). One "note" = `voicesPerNote` oscillators. */
  freqs: number[];
  type?: OscillatorType;
  /** Detune spread between unison voices, in cents. */
  detuneCents?: number;
  voicesPerNote?: number;
  /** Lowpass cutoff shaping the pad's warmth. */
  filterHz?: number;
  filterQ?: number;
  gain?: number;
  /** Slow fade-in seconds. */
  attack?: number;
  when?: number;
  /** Optional gentle pitch LFO for life/shimmer. */
  vibratoHz?: number;
  vibratoCents?: number;
}

/** Detuned oscillator stack → lowpass → slow envelope. The backbone of every mood. */
export function startPad(ctx: BaseAudioContext, dest: AudioNode, opts: PadOpts): PadHandle {
  const {
    freqs, type = 'sawtooth', detuneCents = 7, voicesPerNote = 2,
    filterHz = 900, filterQ = 0.6, gain = 0.08, attack = 3,
    when = ctx.currentTime, vibratoHz, vibratoCents,
  } = opts;

  const out = ctx.createGain();
  out.gain.setValueAtTime(FLOOR, when);
  out.gain.linearRampToValueAtTime(gain, when + attack);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterHz;
  filter.Q.value = filterQ;
  filter.connect(out).connect(dest);

  // Optional vibrato LFO feeding every voice's detune param.
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  if (vibratoHz && vibratoCents) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = vibratoHz;
    lfoGain = ctx.createGain();
    lfoGain.gain.value = vibratoCents;
    lfo.connect(lfoGain);
    lfo.start(when);
  }

  const voices: Array<{ osc: OscillatorNode; noteIndex: number }> = [];
  for (let i = 0; i < freqs.length; i++) {
    for (let v = 0; v < voicesPerNote; v++) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freqs[i];
      // Symmetric unison spread, e.g. [-3.5, +3.5] cents for 2 voices.
      osc.detune.value = (v - (voicesPerNote - 1) / 2) * detuneCents;
      if (lfoGain) lfoGain.connect(osc.detune);
      osc.connect(filter);
      osc.start(when);
      voices.push({ osc, noteIndex: i });
    }
  }

  let stopped = false;
  return {
    setChord(newFreqs: number[], at = ctx.currentTime, glideSeconds = 0.1): void {
      if (stopped || newFreqs.length === 0) return;
      for (const { osc, noteIndex } of voices) {
        const target = Math.max(newFreqs[noteIndex % newFreqs.length], 1);
        if (glideSeconds <= 0) osc.frequency.setValueAtTime(target, at);
        else osc.frequency.setTargetAtTime(target, at, glideSeconds / 3);
      }
    },
    stop(at = ctx.currentTime, releaseSeconds = 2): void {
      if (stopped) return;
      stopped = true;
      out.gain.cancelScheduledValues(at);
      out.gain.setValueAtTime(Math.max(out.gain.value, FLOOR), at);
      out.gain.exponentialRampToValueAtTime(FLOOR, at + releaseSeconds);
      const end = at + releaseSeconds + 0.1;
      for (const { osc } of voices) osc.stop(end);
      lfo?.stop(end);
      // One voice's onended tears down the shared graph.
      voices[0].osc.onended = () => {
        for (const { osc } of voices) osc.disconnect();
        lfo?.disconnect();
        lfoGain?.disconnect();
        filter.disconnect();
        out.disconnect();
      };
    },
  };
}

// ── SFX registry: a designed one-shot per SfxId ──────────────────────────────
// All sounds < 2s, mixed conservatively (they sit *under* the music).
// `detune` is the per-call cents jitter supplied by AudioManager.sfx().

type SfxFn = (ctx: BaseAudioContext, dest: AudioNode, when: number, detune: number) => void;

/** D-major palette shared with music.ts so SFX always sit inside the score. */
const D5 = midiHz(74), E5 = midiHz(76), FS5 = midiHz(78), A5 = midiHz(81), D6 = midiHz(86);

export const SFX_REGISTRY: Record<SfxId, SfxFn> = {
  // Soft fingertip tick.
  'ui-click': (ctx, dest, t, d) => {
    pluck(ctx, dest, t, { freq: 1500, type: 'triangle', gain: 0.1, decay: 0.07, detune: d });
    noiseBurst(ctx, dest, t, { duration: 0.03, filterType: 'highpass', freq: 5000, gain: 0.03, rate: centsToRate(d) });
  },
  // Whoosh up — a panel breathing open.
  'ui-open': (ctx, dest, t, d) => {
    noiseBurst(ctx, dest, t, { duration: 0.22, freq: 500, freqEnd: 2800, q: 1.4, gain: 0.07, attack: 0.03, rate: centsToRate(d) });
    sweepTone(ctx, dest, t, { from: 420, to: 840, duration: 0.18, gain: 0.04, detune: d });
  },
  // Whoosh down — the inverse of ui-open.
  'ui-close': (ctx, dest, t, d) => {
    noiseBurst(ctx, dest, t, { duration: 0.2, freq: 2400, freqEnd: 500, q: 1.4, gain: 0.06, attack: 0.02, rate: centsToRate(d) });
    sweepTone(ctx, dest, t, { from: 760, to: 380, duration: 0.16, gain: 0.04, detune: d });
  },
  // Single clear bell.
  'chime': (ctx, dest, t, d) => {
    fmBell(ctx, dest, t, { freq: midiHz(88), ratio: 2.0, index: 1.2, decay: 1.2, gain: 0.13, detune: d });
  },
  // Two-note glass arpeggio — touching something alive.
  'interact': (ctx, dest, t, d) => {
    fmBell(ctx, dest, t, { freq: D5, ratio: 3.01, index: 1.1, decay: 0.5, gain: 0.12, detune: d });
    fmBell(ctx, dest, t + 0.09, { freq: A5, ratio: 3.01, index: 1.1, decay: 0.8, gain: 0.1, detune: d });
  },
  // Low muted thud — "not yet".
  'denied': (ctx, dest, t, d) => {
    sweepTone(ctx, dest, t, { from: 130, to: 62, duration: 0.22, gain: 0.18, detune: d });
    noiseBurst(ctx, dest, t, { duration: 0.12, filterType: 'lowpass', freq: 240, gain: 0.08, rate: centsToRate(d) });
  },
  // Rising shimmer ~1.2s — stepping through the Veil.
  'portal': (ctx, dest, t, d) => {
    sweepTone(ctx, dest, t, { from: 196, to: 784, duration: 1.1, gain: 0.07, attack: 0.15, detune: d });
    noiseBurst(ctx, dest, t, { duration: 1.2, freq: 400, freqEnd: 4500, q: 1.6, gain: 0.06, attack: 0.25, rate: centsToRate(d) });
    fmBell(ctx, dest, t + 0.7, { freq: midiHz(86), ratio: 3.01, index: 0.9, decay: 0.6, gain: 0.05, detune: d });
    fmBell(ctx, dest, t + 0.9, { freq: midiHz(90), ratio: 3.01, index: 0.9, decay: 0.6, gain: 0.05, detune: d });
    fmBell(ctx, dest, t + 1.05, { freq: midiHz(93), ratio: 3.01, index: 0.9, decay: 0.7, gain: 0.045, detune: d });
  },
  // Tiny pop for chat messages.
  'chat': (ctx, dest, t, d) => {
    sweepTone(ctx, dest, t, { from: 950, to: 620, duration: 0.06, gain: 0.09, detune: d });
  },
  // Sparkle arp for emotes.
  'emote': (ctx, dest, t, d) => {
    fmBell(ctx, dest, t, { freq: D6, ratio: 3.5, index: 0.8, decay: 0.35, gain: 0.07, detune: d });
    fmBell(ctx, dest, t + 0.06, { freq: midiHz(90), ratio: 3.5, index: 0.8, decay: 0.35, gain: 0.06, detune: d });
    fmBell(ctx, dest, t + 0.12, { freq: midiHz(93), ratio: 3.5, index: 0.8, decay: 0.45, gain: 0.06, detune: d });
  },
  // Page swish — filtered noise up then settling down.
  'journal': (ctx, dest, t, d) => {
    noiseBurst(ctx, dest, t, { duration: 0.18, freq: 900, freqEnd: 2800, q: 1.1, gain: 0.07, attack: 0.03, rate: centsToRate(d) });
    noiseBurst(ctx, dest, t + 0.12, { duration: 0.2, freq: 2400, freqEnd: 1000, q: 1.1, gain: 0.06, attack: 0.02, rate: centsToRate(d) });
  },
  // Inviting bell triad — a question opens.
  'choice-open': (ctx, dest, t, d) => {
    fmBell(ctx, dest, t, { freq: D5, ratio: 2.0, index: 1.2, decay: 1.1, gain: 0.09, detune: d });
    fmBell(ctx, dest, t + 0.05, { freq: FS5, ratio: 2.0, index: 1.2, decay: 1.1, gain: 0.08, detune: d });
    fmBell(ctx, dest, t + 0.1, { freq: A5, ratio: 2.0, index: 1.2, decay: 1.3, gain: 0.08, detune: d });
  },
  // Resolving V→I cadence — the party has spoken.
  'choice-result': (ctx, dest, t, d) => {
    fmBell(ctx, dest, t, { freq: midiHz(69), ratio: 2.0, index: 1.1, decay: 0.5, gain: 0.1, detune: d });
    fmBell(ctx, dest, t + 0.22, { freq: D5, ratio: 2.0, index: 1.1, decay: 1.3, gain: 0.12, detune: d });
    pluck(ctx, dest, t + 0.22, { freq: midiHz(50), type: 'sine', gain: 0.1, decay: 0.7, detune: d });
  },
  // Bright pickup arp.
  'item': (ctx, dest, t, d) => {
    pluck(ctx, dest, t, { freq: D5, gain: 0.09, decay: 0.22, detune: d });
    pluck(ctx, dest, t + 0.05, { freq: E5, gain: 0.09, decay: 0.22, detune: d });
    pluck(ctx, dest, t + 0.1, { freq: FS5, gain: 0.09, decay: 0.25, detune: d });
    pluck(ctx, dest, t + 0.15, { freq: A5, gain: 0.09, decay: 0.3, detune: d });
    fmBell(ctx, dest, t + 0.22, { freq: D6, ratio: 3.01, index: 0.8, decay: 0.5, gain: 0.06, detune: d });
  },
  // Low soft boom + air — a story beat lands.
  'beat': (ctx, dest, t, d) => {
    sweepTone(ctx, dest, t, { from: 90, to: 44, duration: 0.7, gain: 0.22, attack: 0.02, detune: d });
    noiseBurst(ctx, dest, t, { duration: 0.9, filterType: 'highpass', freq: 3000, gain: 0.02, attack: 0.25, rate: centsToRate(d) });
  },
  // Descending dreamy sweep — the world holds its breath.
  'focus-on': (ctx, dest, t, d) => {
    sweepTone(ctx, dest, t, { from: 880, to: 220, duration: 0.7, type: 'triangle', gain: 0.07, attack: 0.05, detune: d });
    noiseBurst(ctx, dest, t, { duration: 0.8, filterType: 'lowpass', freq: 2200, freqEnd: 500, gain: 0.04, attack: 0.1, rate: centsToRate(d) });
  },
  // ...and it exhales.
  'focus-off': (ctx, dest, t, d) => {
    sweepTone(ctx, dest, t, { from: 220, to: 880, duration: 0.55, type: 'triangle', gain: 0.06, attack: 0.03, detune: d });
    noiseBurst(ctx, dest, t, { duration: 0.6, filterType: 'lowpass', freq: 500, freqEnd: 2400, gain: 0.035, attack: 0.05, rate: centsToRate(d) });
  },
  // Major flourish — the ritual succeeds.
  'success': (ctx, dest, t, d) => {
    fmBell(ctx, dest, t, { freq: D5, ratio: 2.0, index: 1.2, decay: 0.9, gain: 0.09, detune: d });
    fmBell(ctx, dest, t + 0.08, { freq: FS5, ratio: 2.0, index: 1.2, decay: 0.9, gain: 0.08, detune: d });
    fmBell(ctx, dest, t + 0.16, { freq: A5, ratio: 2.0, index: 1.2, decay: 1.0, gain: 0.08, detune: d });
    fmBell(ctx, dest, t + 0.24, { freq: D6, ratio: 2.0, index: 1.2, decay: 1.4, gain: 0.09, detune: d });
    pluck(ctx, dest, t, { freq: midiHz(50), type: 'sine', gain: 0.09, decay: 0.9, detune: d });
  },
  // Breathy dark swell — something old stirs.
  'hush': (ctx, dest, t, d) => {
    noiseBurst(ctx, dest, t, { duration: 1.5, filterType: 'lowpass', freq: 800, freqEnd: 300, gain: 0.06, attack: 0.5, rate: centsToRate(d) });
    sweepTone(ctx, dest, t, { from: midiHz(47), to: midiHz(47), duration: 1.5, gain: 0.05, attack: 0.6, detune: d });
    sweepTone(ctx, dest, t, { from: midiHz(50), to: midiHz(50), duration: 1.5, gain: 0.04, attack: 0.7, detune: d - 6 });
  },
  // Warm two-note rise — a Veilwalker arrives.
  'player-join': (ctx, dest, t, d) => {
    pluck(ctx, dest, t, { freq: midiHz(69), gain: 0.1, decay: 0.3, detune: d });
    pluck(ctx, dest, t + 0.12, { freq: D5, gain: 0.1, decay: 0.5, detune: d });
  },
  // ...and departs.
  'player-leave': (ctx, dest, t, d) => {
    pluck(ctx, dest, t, { freq: D5, gain: 0.1, decay: 0.3, detune: d });
    pluck(ctx, dest, t + 0.12, { freq: midiHz(69), gain: 0.1, decay: 0.5, detune: d });
  },
};

/** Fire one designed SFX. `detuneCents` adds the organic per-call jitter. */
export function playSfx(ctx: BaseAudioContext, dest: AudioNode, id: SfxId, detuneCents = 0): void {
  // Schedule a hair into the future so all sub-events share one clean origin.
  SFX_REGISTRY[id](ctx, dest, ctx.currentTime + 0.01, detuneCents);
}
