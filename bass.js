/**
 * Bass Player - sampled acoustic bass (FluidR3 GM, CC BY 3.0, vendored in samples/bass)
 *
 * Two feels:
 *   'two'  – roots on beats 1 and 3
 *   'walk' – a quarter-note walking line that aims for the next chord's root
 *
 * Samples are stored every minor third; notes in between are pitch-shifted
 * by at most a semitone.
 */

const BASS_SAMPLE_NOTES = { E1: 28, G1: 31, Bb1: 34, Db2: 37, E2: 40, G2: 43, Bb2: 46, Db3: 49, E3: 52, G3: 55 };
const BASS_LOCAL_URL = 'samples/bass/';
const BASS_REMOTE_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_bass-mp3/';

const BASS_LOW = 28;       // E1, the open E string
const BASS_HIGH = 55;      // G3
const BASS_ROOT_HIGH = 47; // keep roots down where they sound like roots

class BassPlayer {
    constructor() {
        this.samples = {};   // midi → AudioBuffer
        this.style = 'off';  // 'off' | 'two' | 'walk'
        this.loaded = false;
        this.loading = null;
        this.volume = 0.85;
        this.voices = [];
        this.lastNote = null;
    }

    get enabled() {
        return this.style !== 'off';
    }

    /** Must be called from a user gesture the first time (creates audio). */
    async setStyle(style) {
        this.style = style;
        if (style === 'off') {
            this.stopAll();
            return;
        }
        if (!audioCore.ensure()) return;
        await this.loadSamples();
    }

    loadSamples() {
        if (this.loaded) return Promise.resolve();
        if (this.loading) return this.loading;

        const ctx = audioCore.ctx;
        const fetchSample = async (name) => {
            // Local first; the remote copy covers opening index.html from disk,
            // where fetch() of a relative file is blocked.
            for (const base of [BASS_LOCAL_URL, BASS_REMOTE_URL]) {
                try {
                    const response = await fetch(`${base}${name}.mp3`);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return await ctx.decodeAudioData(await response.arrayBuffer());
                } catch (e) {
                    // try the next source
                }
            }
            console.warn(`BassPlayer: failed to load ${name}`);
            return null;
        };

        this.loading = Promise.all(
            Object.entries(BASS_SAMPLE_NOTES).map(async ([name, midi]) => {
                const buffer = await fetchSample(name);
                if (buffer) this.samples[midi] = buffer;
            })
        ).then(() => {
            this.loaded = Object.keys(this.samples).length > 0;
            this.loading = null;
        });

        return this.loading;
    }

    // ── Playback ────────────────────────────────────────────────────────────

    /**
     * Schedule one note on the audio clock. It rings until `duration`, then
     * fades quickly so consecutive notes don't smear.
     */
    playNote(midi, time, duration) {
        if (!this.enabled || !this.loaded) return;
        const ctx = audioCore.ctx;

        // Nearest stored sample, shifted by playback rate
        let sampleMidi = null;
        for (const m of Object.keys(this.samples).map(Number)) {
            if (sampleMidi === null || Math.abs(m - midi) < Math.abs(sampleMidi - midi)) sampleMidi = m;
        }
        if (sampleMidi === null) return;

        const source = ctx.createBufferSource();
        source.buffer = this.samples[sampleMidi];
        source.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12);

        const gain = ctx.createGain();
        const end = time + duration;
        gain.gain.setValueAtTime(this.volume, time);
        gain.gain.setValueAtTime(this.volume, Math.max(time, end - 0.04));
        gain.gain.linearRampToValueAtTime(0, end);

        source.connect(gain);
        gain.connect(audioCore.master);
        source.start(time);
        source.stop(end + 0.02);

        const voice = { source, gain };
        this.voices.push(voice);
        source.onended = () => {
            this.voices = this.voices.filter(v => v !== voice);
        };
    }

    /** Play a root right now (wait mode: you land on a chord, the bass answers). */
    playRootNow(chord) {
        if (!this.enabled || !this.loaded) return;
        const midi = this.nearest(chord.rootPc, this.lastNote ?? 40, BASS_LOW, BASS_ROOT_HIGH);
        this.lastNote = midi;
        this.stopAll();
        this.playNote(midi, audioCore.now + 0.01, 1.8);
    }

    stopAll() {
        if (!audioCore.ctx) return;
        const now = audioCore.now;
        for (const { source, gain } of this.voices) {
            try {
                gain.gain.cancelScheduledValues(now);
                gain.gain.setValueAtTime(gain.gain.value, now);
                gain.gain.linearRampToValueAtTime(0, now + 0.05);
                source.stop(now + 0.06);
            } catch (e) {
                // already ended
            }
        }
        this.voices = [];
    }

    reset() {
        this.stopAll();
        this.lastNote = null;
    }

    // ── Line writing ────────────────────────────────────────────────────────

    /**
     * Decide the bass notes for one bar.
     * Returns [{ beat: 0-3, midi }]. `nextChord` is the first chord of the
     * following bar, which the line walks towards.
     */
    planBar(bar, nextChord) {
        const chords = bar.chords;
        const notes = this.style === 'two'
            ? this.planTwoFeel(chords)
            : this.planWalk(chords, nextChord);

        this.lastNote = notes[notes.length - 1].midi;
        return notes;
    }

    planTwoFeel(chords) {
        const first = this.rootNote(chords[0], this.lastNote);
        const second = chords.length === 2 ? this.rootNote(chords[1], first) : first;
        return [{ beat: 0, midi: first }, { beat: 2, midi: second }];
    }

    planWalk(chords, nextChord) {
        const nextPc = nextChord ? nextChord.rootPc : chords[0].rootPc;

        if (chords.length === 2) {
            const r1 = this.rootNote(chords[0], this.lastNote);
            const r2 = this.targetRoot(chords[1].rootPc, r1);
            const a1 = this.approach(r2, r1, chords[0]);
            const a2 = this.approach(this.targetRoot(nextPc, r2), r2, chords[1]);
            return [r1, a1, r2, a2].map((midi, beat) => ({ beat, midi }));
        }

        const chord = chords[0];
        const root = this.rootNote(chord, this.lastNote);
        const target = this.targetRoot(nextPc, root);
        const last = this.approach(target, root, chord);
        const [second, third] = this.connect(root, last, chord);
        return [root, second, third, last].map((midi, beat) => ({ beat, midi }));
    }

    /** Beats 2 and 3: a chord-tone shape that ends near the approach note. */
    connect(root, approach, chord) {
        const q = Theory.quality(chord.quality);
        const third = q.guide[0] === 5 ? 5 : q.core[1];
        const fifth = q.scale.includes(7) ? 7 : 6;
        const seventh = q.core[q.core.length - 1];
        const second = q.scale[1];

        const shapes = [
            [second, third],            // R 2 3
            [third, fifth],             // R 3 5
            [fifth, third],             // R 5 3
            [fifth, seventh],           // R 5 7
            [third, second],            // R 3 2
            [seventh - 12, fifth - 12], // R 7 5 descending
            [fifth - 12, seventh - 12], // R 5 7 from below
            [12, seventh],              // R 8 7
        ].map(([a, b]) => [root + a, root + b]);

        const usable = shapes.filter(([a, b]) =>
            a >= BASS_LOW && b >= BASS_LOW && a <= BASS_HIGH && b <= BASS_HIGH &&
            b !== approach && a !== root);

        if (!usable.length) return [root + fifth, root + third];

        // Prefer shapes that leave a small step into the approach note
        const scored = usable
            .map(shape => ({ shape, leap: Math.abs(shape[1] - approach) }))
            .sort((x, y) => x.leap - y.leap);
        const best = scored.filter(s => s.leap <= scored[0].leap + 2);
        return best[Math.floor(Math.random() * best.length)].shape;
    }

    /** Beat 4: lean into the next root from a half-step, a fifth, or a scale step. */
    approach(target, from, chord) {
        const scale = Theory.quality(chord.quality).scale.map(i => (chord.rootPc + i) % 12);
        const fromBelow = from <= target;

        const options = [
            { midi: target + (fromBelow ? -1 : 1), weight: 0.45 },
            { midi: target + (fromBelow ? 1 : -1), weight: 0.20 },
            { midi: target + 7, weight: 0.10 },
            { midi: target - 5, weight: 0.10 },
        ];
        for (const step of [-2, 2]) {
            if (scale.includes((((target + step) % 12) + 12) % 12)) {
                options.push({ midi: target + step, weight: 0.15 });
            }
        }

        const usable = options.filter(o => o.midi >= BASS_LOW && o.midi <= BASS_HIGH && o.midi !== from);
        if (!usable.length) return target + 1;

        let pick = Math.random() * usable.reduce((s, o) => s + o.weight, 0);
        for (const o of usable) {
            pick -= o.weight;
            if (pick <= 0) return o.midi;
        }
        return usable[0].midi;
    }

    rootNote(chord, reference) {
        return this.nearest(chord.rootPc, reference ?? 38, BASS_LOW, BASS_ROOT_HIGH);
    }

    /** Where the next root will land, so the approach aims at the right octave. */
    targetRoot(pc, reference) {
        return this.nearest(pc, reference, BASS_LOW, BASS_ROOT_HIGH);
    }

    nearest(pc, reference, low, high) {
        let best = null;
        for (let midi = low; midi <= high; midi++) {
            if (midi % 12 !== pc) continue;
            if (best === null || Math.abs(midi - reference) < Math.abs(best - reference)) best = midi;
        }
        return best;
    }
}

window.BassPlayer = BassPlayer;
