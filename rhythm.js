/**
 * Rhythm section - drums and comping keys
 *
 * Everything here is synthesised (no samples) and scheduled on the audio
 * clock by the transport in app.js.
 */

const SWING = 2 / 3; // where the off-beat eighth sits within the beat

// ─── Drums ──────────────────────────────────────────────────────────────────

class Drums {
    constructor() {
        this.clickEnabled = false;
        this.rideEnabled = false;
        this.noiseBuffer = null;
    }

    getNoise() {
        const ctx = audioCore.ctx;
        if (!this.noiseBuffer) {
            const length = ctx.sampleRate;
            this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        }
        return this.noiseBuffer;
    }

    /** One shaped burst of filtered noise – the basis of every drum sound here. */
    noiseHit(time, { type, freq, q, volume, attack = 0.002, decay, wet = 0.3, ceiling = 0 }) {
        const ctx = audioCore.ctx;

        const noise = ctx.createBufferSource();
        noise.buffer = this.getNoise();
        // Start somewhere random so repeated hits don't sound identical
        const offset = Math.random() * 0.5;

        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.setValueAtTime(freq, time);
        filter.Q.setValueAtTime(q, time);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume, time + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);

        noise.connect(filter);
        if (ceiling) {
            // Roll off the fizz above `ceiling` Hz – the main source of harshness
            const lowpass = ctx.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.setValueAtTime(ceiling, time);
            lowpass.Q.setValueAtTime(0.5, time);
            filter.connect(lowpass);
            lowpass.connect(gain);
        } else {
            filter.connect(gain);
        }
        audioCore.output(gain, wet);

        noise.start(time, offset);
        noise.stop(time + attack + decay + 0.02);
    }

    /** Stick click, used for the count-in and the plain metronome. */
    click(time, accent = false) {
        this.noiseHit(time, {
            type: 'bandpass',
            freq: accent ? 2800 : 3400,
            q: accent ? 1.0 : 0.7,
            volume: accent ? 0.23 : 0.11,
            attack: 0.003,
            decay: accent ? 0.05 : 0.06,
            wet: 0.3
        });
    }

    ride(time, volume) {
        // Wash: a slow-ish bloom rather than an instant spike, with the top rolled off
        this.noiseHit(time, {
            type: 'highpass', freq: 5000, q: 0.4, volume: volume,
            attack: 0.006, decay: 0.42, wet: 0.35, ceiling: 9500
        });
        // Stick: just enough to place the beat, wide and soft so it doesn't ping
        this.noiseHit(time, {
            type: 'bandpass', freq: 3800, q: 0.9, volume: volume * 0.45,
            attack: 0.004, decay: 0.07, wet: 0.35, ceiling: 8000
        });
    }

    hatChick(time) {
        this.noiseHit(time, {
            type: 'bandpass', freq: 5200, q: 0.8, volume: 0.045,
            attack: 0.004, decay: 0.08, wet: 0.4, ceiling: 9000
        });
    }

    /** Schedule everything the drums do within one beat (1-4). */
    scheduleBeat(beat, time, beatDuration) {
        if (this.clickEnabled) {
            this.click(time, beat === 1);
        }

        if (this.rideEnabled) {
            // ding, ding-a, ding, ding-a
            const backbeat = beat === 2 || beat === 4;
            this.ride(time, backbeat ? 0.075 : 0.06);
            if (backbeat) {
                this.hatChick(time);
                this.ride(time + beatDuration * SWING, 0.04);
            }
        }
    }
}

// ─── Keys ───────────────────────────────────────────────────────────────────
// A small FM electric piano. Used for comping, and to sound what you play.

const COMP_PATTERNS = [
    // [offset in beats, length in beats, which chord]
    { weight: 3, hits: [[0, 1.4, 'cur'], [1 + SWING, 1.0, 'cur']] },            // Charleston
    { weight: 2, hits: [[SWING, 1.2, 'cur'], [2 + SWING, 0.9, 'cur']] },        // off-beats
    { weight: 2, hits: [[0, 2.6, 'cur']] },                                     // long pad
    { weight: 2, hits: [[1, 0.5, 'cur'], [3, 0.5, 'cur']] },                    // two and four
    { weight: 2, hits: [[0, 1.0, 'cur'], [3 + SWING, 1.3, 'next']] },           // push into the next bar
    { weight: 1, hits: [] },                                                    // leave space
];

const COMP_PATTERNS_TWO_CHORDS = [
    { weight: 3, hits: [[0, 1.3, 'first'], [2, 1.3, 'second']] },
    { weight: 2, hits: [[0, 1.0, 'first'], [1 + SWING, 1.5, 'second']] },
    { weight: 1, hits: [[SWING, 0.9, 'first'], [2 + SWING, 0.9, 'second']] },
];

// Comping sits behind the bass; your own playing (monitoring) stays at full level
const COMP_MIX = 0.42;

class Keys {
    constructor() {
        this.compEnabled = false;
        this.monitorEnabled = true;
        this.voices = new Set();
        this.held = new Map();      // midi → voice, for live input
        this.lastVoicing = null;
        this.anticipated = false;   // the previous bar already played this bar's chord
    }

    // ── Synth ───────────────────────────────────────────────────────────────

    startVoice(midi, time, velocity = 0.7, mix = 1) {
        const ctx = audioCore.ctx;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        // Higher notes get quieter and less bright, like the real thing
        const level = 0.11 * mix * velocity * Math.min(1, 1.3 - (midi - 48) / 60);

        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(freq, time);

        const modulator = ctx.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.setValueAtTime(freq, time);

        // Bright bark at the attack that mellows quickly
        const modDepth = ctx.createGain();
        modDepth.gain.setValueAtTime(freq * (0.6 + 1.6 * velocity), time);
        modDepth.gain.exponentialRampToValueAtTime(freq * 0.25, time + 0.45);

        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, time);
        amp.gain.linearRampToValueAtTime(level, time + 0.005);
        amp.gain.exponentialRampToValueAtTime(level * 0.4, time + 0.9);

        modulator.connect(modDepth);
        modDepth.connect(carrier.frequency);
        carrier.connect(amp);
        audioCore.output(amp, 0.08);

        carrier.start(time);
        modulator.start(time);

        const voice = { carrier, modulator, amp };
        this.voices.add(voice);
        carrier.onended = () => this.voices.delete(voice);
        return voice;
    }

    releaseVoice(voice, time, release = 0.12) {
        const t = Math.max(time, audioCore.now);
        try {
            voice.amp.gain.cancelScheduledValues(t);
            voice.amp.gain.setTargetAtTime(0, t, release / 3);
            voice.carrier.stop(t + release * 2);
            voice.modulator.stop(t + release * 2);
        } catch (e) {
            // already stopped
        }
    }

    playChord(notes, time, duration, velocity = 0.6) {
        notes.forEach((midi, i) => {
            // A touch of spread so the chord isn't a machine-gun block
            const voice = this.startVoice(midi, time + i * 0.004, velocity, COMP_MIX);
            this.releaseVoice(voice, time + duration);
        });
    }

    stopAll() {
        if (!audioCore.ctx) return;
        for (const voice of this.voices) this.releaseVoice(voice, audioCore.now, 0.05);
        this.held.clear();
    }

    reset() {
        this.stopAll();
        this.lastVoicing = null;
        this.anticipated = false;
    }

    // ── Live input monitoring ───────────────────────────────────────────────

    noteOn(midi, velocity = 0.7) {
        if (!this.monitorEnabled || !audioCore.ensure()) return;
        this.noteOff(midi);
        this.held.set(midi, this.startVoice(midi, audioCore.now, velocity));
    }

    noteOff(midi) {
        const voice = this.held.get(midi);
        if (!voice) return;
        this.releaseVoice(voice, audioCore.now, 0.2);
        this.held.delete(midi);
    }

    // ── Comping ─────────────────────────────────────────────────────────────

    /**
     * Decide this bar's comping. Returns [{ offset, length, notes, velocity }]
     * with offsets in beats from the barline.
     */
    planBar(bar, nextChord) {
        if (!this.compEnabled) return [];

        const two = bar.chords.length === 2;
        const patterns = two ? COMP_PATTERNS_TWO_CHORDS : COMP_PATTERNS;

        let pick = Math.random() * patterns.reduce((s, p) => s + p.weight, 0);
        let pattern = patterns[0];
        for (const p of patterns) {
            pick -= p.weight;
            if (pick <= 0) { pattern = p; break; }
        }

        const wasAnticipated = this.anticipated;
        this.anticipated = false;

        const voicings = new Map();
        const voicingFor = (chord) => {
            if (!voicings.has(chord)) {
                this.lastVoicing = Theory.rootlessVoicing(chord, this.lastVoicing);
                voicings.set(chord, this.lastVoicing);
            }
            return voicings.get(chord);
        };

        const events = [];
        for (const [offset, length, which] of pattern.hits) {
            // Already pushed into this bar from the last one: let it ring
            if (wasAnticipated && offset === 0) continue;

            let chord;
            if (which === 'next') {
                if (!nextChord) continue;
                chord = nextChord;
                this.anticipated = true;
            } else {
                chord = which === 'second' ? bar.chords[1] : bar.chords[0];
            }

            events.push({
                offset,
                length,
                notes: voicingFor(chord),
                velocity: 0.45 + Math.random() * 0.3
            });
        }
        return events;
    }
}

window.Drums = Drums;
window.Keys = Keys;
