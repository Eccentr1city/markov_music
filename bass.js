/**
 * Bass Player - Sampled acoustic bass using FluidR3 SoundFont
 * Loads real acoustic bass samples and plays chord roots
 */

const BASS_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const BASS_OCTAVE = 2; // Jazz bass register (~65-130 Hz)
const SAMPLE_BASE_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_bass-mp3/';

class BassPlayer {
    constructor() {
        this.audioContext = null;
        this.samples = {};       // note name → AudioBuffer
        this.enabled = false;
        this.loaded = false;
        this.loading = false;
        this.volume = 0.8;
        this.currentSource = null;
        this.currentGain = null;
    }

    /**
     * Initialize audio context and begin loading samples.
     * Must be called from a user gesture (click/tap) on mobile.
     */
    async init() {
        if (this.audioContext) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('BassPlayer: Web Audio API not supported', e);
            return;
        }

        await this.loadSamples();
    }

    /**
     * Load all 12 bass samples for the target octave.
     * Each sample is ~20-40KB, so ~300KB total — fast even on mobile.
     */
    async loadSamples() {
        if (this.loading || this.loaded) return;
        this.loading = true;

        const loadPromises = BASS_NOTES.map(async (note) => {
            const url = `${SAMPLE_BASE_URL}${note}${BASS_OCTAVE}.mp3`;
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.samples[note] = audioBuffer;
            } catch (e) {
                console.warn(`BassPlayer: Failed to load ${note}${BASS_OCTAVE}`, e);
            }
        });

        await Promise.all(loadPromises);

        const loadedCount = Object.keys(this.samples).length;
        console.log(`BassPlayer: Loaded ${loadedCount}/${BASS_NOTES.length} samples`);

        this.loaded = loadedCount > 0;
        this.loading = false;
    }

    /**
     * Play a bass note by name (e.g. "C", "Eb", "Gb").
     * Fades out the previous note smoothly before starting the new one.
     */
    play(noteName) {
        if (!this.enabled || !this.loaded || !this.audioContext) return;

        const buffer = this.samples[noteName];
        if (!buffer) return;

        // Fade out previous note
        this.stopCurrent();

        // Create new source
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // Gain node for volume + fade-out control
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(this.volume, this.audioContext.currentTime);

        source.connect(gain);
        gain.connect(this.audioContext.destination);

        source.start(0);

        this.currentSource = source;
        this.currentGain = gain;

        // Clean up reference when sample ends naturally
        source.onended = () => {
            if (this.currentSource === source) {
                this.currentSource = null;
                this.currentGain = null;
            }
        };
    }

    /**
     * Smoothly fade out the current note (short ~50ms fade to avoid clicks).
     */
    stopCurrent() {
        if (this.currentGain && this.currentSource) {
            const now = this.audioContext.currentTime;
            try {
                this.currentGain.gain.cancelScheduledValues(now);
                this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, now);
                this.currentGain.gain.linearRampToValueAtTime(0, now + 0.05);
                this.currentSource.stop(now + 0.06);
            } catch (e) {
                // Source may have already ended
            }
        }
        this.currentSource = null;
        this.currentGain = null;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled && this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        if (!enabled) {
            this.stopCurrent();
        }
    }

    /**
     * Toggle bass on/off. Lazy-loads samples on first enable.
     * Returns a Promise that resolves to the new enabled state.
     */
    async toggle() {
        const willEnable = !this.enabled;

        if (willEnable && !this.loaded && !this.loading) {
            await this.init();
        }

        this.setEnabled(willEnable);
        return this.enabled;
    }
}

window.BassPlayer = BassPlayer;
