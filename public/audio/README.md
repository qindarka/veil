<!-- public/audio/README.md — how to swap real audio files in for the procedural soundtrack/SFX. -->

# Audio swap guide — Echoes of the Veil

Everything you hear in the game is **synthesized at runtime** with the Web
Audio API — no audio files ship with the build. Drop files into the folders
below and they replace the procedural versions automatically. No code changes,
no rebuild configuration: the game probes for each file on first use and falls
back to synthesis when a file is missing.

## Music (one seamless loop per mood)

Place files at exactly these paths (all six are independent — swap any subset):

```
public/audio/music/menu.ogg          warm, slow, inviting (title screen)
public/audio/music/ambient.ogg       airy, weightless, sparse
public/audio/music/exploration.ogg   gentle forward motion, curious
public/audio/music/tension.ogg       minor, uneasy, restrained
public/audio/music/climax.ogg        full arrangement, driving, awe
public/audio/music/hopeful.ogg       major, luminous, resolving
```

How it works (`src/audio/music.ts`): on the first use of a mood the client
sends a `HEAD` request for `/audio/music/<mood>.ogg`. If it exists, the track
is looped through the same mood gain as the synth arrangement — so the 3-second
mood crossfades, the focus-mode lowpass and the volume sliders all still apply.
The probe result is cached for the session (hard-refresh after adding files).

### Mastering / loop guidance

- **Loudness**: target ≈ **-16 LUFS integrated**, true peak ≤ **-1 dBTP**.
  The game applies its own music gain (~0.5) and a gentle bus compressor, so
  do not pre-crush the tracks.
- **Seamless loops**: export on an exact bar boundary with **no leading or
  trailing silence**, and crossfade the tail of the file into its head in your
  DAW before exporting. `HTMLAudioElement` looping can introduce a tiny gap in
  some browsers, so favor pad/drone material at the loop point and avoid a hard
  transient on beat 1.
- **Tempo**: the procedural score runs at **72 bpm in D major / B minor**.
  Matching the key keeps the synthesized SFX (which use the same palette)
  consonant with your tracks; matching the tempo is optional.
- **Format**: Ogg Vorbis, quality ~5 (≈160 kbps), 44.1 or 48 kHz, stereo.
  Keep loops in the 1–3 MB range; they stream, but smaller starts faster.

## SFX (one short one-shot per id)

SFX file swap **is implemented**. Place files at:

```
public/audio/sfx/<id>.ogg
```

with `<id>` being any of (see `SFX_IDS` in `shared/constants.ts`):

```
ui-click  ui-open  ui-close  chime  interact  denied  portal  chat  emote
journal  choice-open  choice-result  item  beat  focus-on  focus-off
success  hush  player-join  player-leave
```

Notes:

- Files are fetched and decoded on the **first trigger** of that sound — that
  first trigger still plays the synthesized version while the file loads;
  every trigger after that uses your file.
- The engine applies a random ±14-cent detune to every playback (files
  included) so rapid repeats feel organic — bake no detune into the file.
- Keep one-shots **under ~2 seconds**, peak ≤ -1 dBTP, loudness around
  **-18 LUFS short-term**. SFX are mixed conservatively under the music; if a
  file feels quiet in-game, raise the source, not the in-game slider.

## Licensing reminder

Only ship audio you have the rights to distribute: your own work, properly
licensed commercial libraries, or tracks under CC0 / CC-BY (with attribution
in the credits — add it to the README and the in-game help panel). "Free
download" does not mean free to redistribute in a deployed game.
