# Markov Jazz Changes

A practice tool that generates jazz chord progressions using Markov chains. Chords flow naturally through common jazz patterns (ii-V-I, tritone subs, modal interchange) while occasionally surprising you with unexpected changes.

## Run

Open `index.html` in your browser. That's it.

## Controls

- **Space** — Play/Pause
- **→** — Next bar (when paused)
- **R** — Reset

## Settings

- **Tempo** — 40-200 BPM
- **Key Stability** — How long before modulating
- **Adventurousness** — Probability of unexpected chord choices
- **Extension Complexity** — Simple 7ths vs. rich alterations
- **Two-Chord Bars** — Probability of 2 chords per bar
- **Metronome** — Toggle click track

## How It Works

Instead of random chord transitions, the engine tracks:
1. **Key center** — Persists for several bars, modulates via circle of fifths, relative/parallel keys, or tritone
2. **Scale degrees** — Movement between Roman numerals with jazz-informed probabilities
3. **Chord realization** — Quality and extensions based on harmonic function

