/**
 * AudioCore - the one AudioContext everything plays through
 *
 * Every sound is scheduled against this context's clock, which is what keeps
 * the band in time: JS timers only decide *what* to schedule, never *when*
 * it sounds.
 */

class AudioCore {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.reverb = null;
    }

    /** Create/resume the context. Must first be called from a user gesture. */
    ensure() {
        if (!this.ctx) {
            try {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('Web Audio API not supported', e);
                return null;
            }

            // Gentle glue so bass + drums + keys don't clip when they pile up
            const limiter = this.ctx.createDynamicsCompressor();
            limiter.threshold.value = -10;
            limiter.ratio.value = 6;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.15;

            this.master = this.ctx.createGain();
            this.master.gain.value = 0.9;
            this.master.connect(limiter);
            limiter.connect(this.ctx.destination);

            // A small dark room. Instruments send to `reverb` as well as `master`;
            // without it the synthesised percussion sounds pasted-on and clicky.
            const convolver = this.ctx.createConvolver();
            convolver.buffer = this.buildRoom(1.0);
            this.reverb = this.ctx.createGain();
            this.reverb.gain.value = 2.1;
            this.reverb.connect(convolver);
            convolver.connect(this.master);
        }

        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
    }

    /** Impulse response: decaying noise that gets darker as it fades. */
    buildRoom(seconds) {
        const rate = this.ctx.sampleRate;
        const length = Math.floor(rate * seconds);
        const impulse = this.ctx.createBuffer(2, length, rate);

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            let smoothed = 0;
            for (let i = 0; i < length; i++) {
                const t = i / length;
                // One-pole lowpass whose cutoff falls over time
                const damping = 0.1 + 0.75 * t;
                smoothed = smoothed * damping + (Math.random() * 2 - 1) * (1 - damping);
                data[i] = smoothed * Math.pow(1 - t, 2.5);
            }
        }
        return impulse;
    }

    /** Connect a node to the dry mix and, by `wet` (0-1), to the room. */
    output(node, wet = 0) {
        node.connect(this.master);
        if (wet > 0) {
            const send = this.ctx.createGain();
            send.gain.value = wet;
            node.connect(send);
            send.connect(this.reverb);
        }
    }

    get now() {
        return this.ctx ? this.ctx.currentTime : 0;
    }
}

window.audioCore = new AudioCore();
