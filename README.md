# Markov Jazz Changes

A practice tool that generates an endless jazz lead sheet using Markov chains, plays a rhythm section under it, and — if you plug in a MIDI keyboard — listens to whether you're making the changes.

Chords flow through common jazz patterns (ii-V-I, tritone subs, modal interchange) while occasionally surprising you.

**Live:** https://eccentr1city.github.io/markov_music/

## Run

Open `index.html` in your browser, or serve the folder (`python3 -m http.server`). No build step.

MIDI input needs a browser with Web MIDI (Chrome, Edge, Firefox) and a secure context — `localhost` or the hosted site. Without MIDI, everything else works and you can click the on-screen keys.

## Controls

- **Space** — Play/Pause (Skip, in wait mode)
- **→** — Next bar when paused; next chord in wait mode
- **R** — Reset

## The band

- **Click** — plain metronome
- **Drums** — swung ride pattern with hi-hat on 2 and 4
- **Bass** — cycles off → two-feel (roots on 1 and 3) → walking (quarter notes that approach the next root by half-step, fifth or scale step)
- **Keys** — electric-piano comping in voice-led rootless voicings; turn it off when you're the one comping

Playback starts with a one-bar count-in. Everything is scheduled on the Web Audio clock, so the time doesn't drift or jitter.

## Listening

- **In time** — play each chord somewhere in its slot (up to an eighth early counts, so you can push). Chords turn green or red as they go by.
- **Wait** — no tempo. The sheet advances when you play the current chord.

What counts as "playing the chord" is set in Settings: **guide tones** (3rd & 7th — the default, since the bass has the root), **shell** (root, 3rd, 7th) or the **full chord**. The keyboard colours each note as you strike it: **green** for a tone the chord symbol names, **amber** for a tension or a note from the chord's scale, **red** for a note with no plausible excuse. Green and amber notes are fine to add; a red note stops the chord from counting. The sustain pedal is ignored — it's about what your fingers are on.

**Keyboard hints** can show the guide tones or a rootless voicing for the current chord.

## Settings

- **Tempo** — 40-240 BPM
- **Key Stability** — How long before modulating
- **Adventurousness** — Probability of unexpected chord choices
- **Extension Complexity** — Simple 7ths vs. rich alterations
- **Two-Chord Bars** — Probability of 2 chords per bar
- **Analysis marks** — brackets under ii–Vs, solid arrows for dominants resolving down a fifth, dashed arrows for tritone-sub resolutions down a half-step
- **Hear my notes** — sound your MIDI input through the browser (turn off if your keyboard makes its own sound)

## How It Works

Instead of random chord transitions, the engine tracks:
1. **Key center** — Persists for several bars, modulates via circle of fifths, relative/parallel keys, or tritone. A new key is set up by a cadence in that key (usually ii–V–I) rather than a bare jump.
2. **Scale degrees** — Movement between Roman numerals with jazz-informed probabilities, with second-order overrides for common three-chord patterns
3. **Chord realization** — Quality and extensions based on harmonic function, spelled for the key (F♯‑7 in D major, not G♭‑7)

## Files

- `theory.js` — spelling, chord tones, match rules, voicings
- `engine.js` — the Markov chord generator
- `audio.js`, `bass.js`, `rhythm.js` — audio context, sampled bass, synthesised drums and keys
- `input.js` — Web MIDI and the on-screen keyboard
- `analysis.js` — the ii–V / resolution overlay
- `app.js` — transport, display and listening modes

## Credits

Bass samples (`samples/bass`) are rendered from the FluidR3 GM soundfont by Frank Wen, released under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/), via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts).
