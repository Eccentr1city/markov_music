# Markov Jazz Changes

A practice tool that generates an endless jazz lead sheet using Markov chains, plays a rhythm section under it, and — if you plug in a MIDI keyboard — listens to whether you're making the changes. A second tab drills single chord types on random roots and tracks which roots slow you down.

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
- **Wait** — no tempo. The sheet advances when you play the current chord, and (if the bass is on) the bass answers with that chord's root.

What counts as "playing the chord" is set in Settings: **guide tones** (3rd & 7th — the default, since the bass has the root), **guide tones + extensions** (also the 9 of a Δ9, the 13 of a 13…), **shell** (root, 3rd, 7th) or the **full chord**. The keyboard colours each note as you strike it: **green** for a tone the chord symbol names, **amber** for a tension or a note from the chord's scale, **red** for a note with no plausible excuse. Green and amber notes are fine to add; a red note stops the chord from counting. Context matters: on a dominant resolving down a fifth to a minor chord, the ♭9 and ♭13 are amber even if the symbol just says "7". The sustain pedal is ignored — it's about what your fingers are on.

**Keyboard hints** can show the guide tones or a rootless voicing for the current chord.

## Drill

The **Drill** tab is for practising one kind of chord in every key. Pick one or more chord types; a symbol appears on a random root; play it in any voicing you like. It counts when the 3rd, the 7th and the extensions the symbol names are down (a Δ9 needs its 9, a 13 its 13, a 7alt any alteration, a ø7 its ♭5) with no red notes. The next chord appears immediately, and the bass answers with the root if it's on.

- Every session opens with one shuffled pass through all 12 roots; after that, roots you're slow or sloppy on come up more often (never the same root twice running).
- Correctness outweighs speed: an attempt with a wrong note, a hint or a skip counts as at least 2.5× a typical one, however fast. Among clean attempts, faster is better.
- The first chord of a session, and any chord where you obviously stepped away (15s+ and 5× your norm), don't count and are asked again.
- History never crosses chord types: trouble with C‑7 says nothing about C13. Within a chord type, past sessions are a weak prior that fades (two-week half-life) and that a few attempts today override. **Ignore history this session** (Settings) turns it off.
- **Progress** shows a chord type × root heatmap for the last 60 days: colour is difficulty relative to your own norm for that chord type, the number is your typical clean time.

Every attempt is stored raw in your browser (chord, root, time, clean or not, the notes you played), so how history is used can change later without losing anything. **→** skips, **H** shows a hint.

## Choosing a key

Click the key in the header to pick one. **Switch and reset** starts a new progression from bar 1 on that key's tonic. With **Stay in this key** ticked (the default) it never modulates, and Reset gives you another chorus in the same key; pick **Random** to go back to wandering.

## Settings

- **Tempo** — 40-240 BPM
- **Key Stability** — How long a key lasts, on an exponential scale: about 3 bars per key at 0, 8 at the default of 40, 18 at 75, and no modulation at all at 100
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
- `drill.js` — the Drill tab: prompt selection, scoring, attempt log, heatmap
- `app.js` — transport, display and listening modes

## Credits

Bass samples (`samples/bass`) are rendered from the FluidR3 GM soundfont by Frank Wen, released under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/), via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts).
