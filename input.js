/**
 * Note input - Web MIDI plus a clickable on-screen keyboard
 *
 * NoteInput tracks which keys are physically down (the sustain pedal is
 * deliberately ignored: what counts as "playing the chord" is what your
 * fingers are on). Keyboard draws the strip and doubles as a fallback input.
 */

class NoteInput {
    constructor() {
        this.held = new Map();   // midi → velocity (0-1)
        this.midiAccess = null;
        this.listeners = [];
        this.statusListeners = [];
        this.status = { state: 'idle', text: 'MIDI off' };
    }

    onChange(fn) { this.listeners.push(fn); }
    onStatus(fn) { this.statusListeners.push(fn); }

    setStatus(state, text) {
        this.status = { state, text };
        this.statusListeners.forEach(fn => fn(this.status));
    }

    /** Ask for MIDI access. Safe to call more than once. */
    async connect() {
        if (this.midiAccess) return;

        if (!navigator.requestMIDIAccess) {
            this.setStatus('unavailable', 'No Web MIDI here — click the keys');
            return;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            this.midiAccess.onstatechange = () => this.attachInputs();
            this.attachInputs();
        } catch (e) {
            this.setStatus('unavailable', 'MIDI blocked — click the keys');
        }
    }

    attachInputs() {
        const names = [];
        for (const input of this.midiAccess.inputs.values()) {
            if (input.state === 'disconnected') continue;
            input.onmidimessage = (e) => this.handleMessage(e);
            names.push(input.name);
        }

        if (names.length) {
            this.setStatus('connected', names.length === 1 ? names[0] : `${names.length} MIDI devices`);
        } else {
            this.setStatus('waiting', 'No MIDI device — plug one in or click the keys');
        }
    }

    handleMessage(event) {
        const [status, note, velocity] = event.data;
        const command = status & 0xf0;

        if (command === 0x90 && velocity > 0) {
            this.noteOn(note, velocity / 127);
        } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            this.noteOff(note);
        }
    }

    noteOn(midi, velocity = 0.7) {
        this.held.set(midi, velocity);
        this.listeners.forEach(fn => fn({ type: 'on', midi, velocity }));
    }

    noteOff(midi) {
        if (!this.held.has(midi)) return;
        this.held.delete(midi);
        this.listeners.forEach(fn => fn({ type: 'off', midi }));
    }

    releaseAll() {
        for (const midi of [...this.held.keys()]) this.noteOff(midi);
    }

    get notes() {
        return [...this.held.keys()];
    }
}

// ─── On-screen keyboard ─────────────────────────────────────────────────────

const BLACK_PCS = [1, 3, 6, 8, 10];

class Keyboard {
    /**
     * @param {HTMLElement} el     container
     * @param {NoteInput}   input  receives clicks as notes
     */
    constructor(el, input) {
        this.el = el;
        this.input = input;
        this.low = 36;   // C2
        this.high = 84;  // C6
        this.keys = new Map();
        this.latched = new Set();
        this.build();
    }

    setRange(low, high) {
        if (low === this.low && high === this.high) return;
        this.low = low;
        this.high = high;
        this.build();
    }

    build() {
        this.el.innerHTML = '';
        this.keys.clear();

        const whites = [];
        for (let m = this.low; m <= this.high; m++) {
            if (!BLACK_PCS.includes(m % 12)) whites.push(m);
        }
        const whiteWidth = 100 / whites.length;

        for (let m = this.low; m <= this.high; m++) {
            const black = BLACK_PCS.includes(m % 12);
            const key = document.createElement('div');
            key.className = black ? 'key black' : 'key white';

            // Everything is a percentage of the strip, so it scales with the page
            const whitesBefore = whites.filter(w => w < m).length;
            if (black) {
                key.style.left = `${whitesBefore * whiteWidth - whiteWidth * 0.3}%`;
                key.style.width = `${whiteWidth * 0.6}%`;
            } else {
                key.style.left = `${whitesBefore * whiteWidth}%`;
                key.style.width = `${whiteWidth}%`;
                if (m % 12 === 0) {
                    const label = document.createElement('span');
                    label.className = 'key-label';
                    label.textContent = `C${Math.floor(m / 12) - 1}`;
                    key.appendChild(label);
                }
            }

            this.attachPointer(key, m);
            this.el.appendChild(key);
            this.keys.set(m, key);
        }
    }

    attachPointer(key, midi) {
        key.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (e.pointerType === 'mouse') {
                // A mouse can't hold a chord, so clicks latch
                if (this.latched.has(midi)) {
                    this.latched.delete(midi);
                    this.input.noteOff(midi);
                } else {
                    this.latched.add(midi);
                    this.input.noteOn(midi, 0.7);
                }
            } else {
                key.setPointerCapture(e.pointerId);
                this.input.noteOn(midi, 0.7);
            }
        });

        const release = (e) => {
            if (e.pointerType !== 'mouse') this.input.noteOff(midi);
        };
        key.addEventListener('pointerup', release);
        key.addEventListener('pointercancel', release);
    }

    clearLatched() {
        for (const midi of this.latched) this.input.noteOff(midi);
        this.latched.clear();
    }

    /**
     * @param {number[]} held   MIDI notes currently down
     * @param {Set}      wrong  held MIDI notes to show as clashing
     * @param {number[]} hints  MIDI notes to suggest
     */
    update(held, wrong, hints) {
        const heldSet = new Set(held);
        const hintSet = new Set(hints);

        for (const [midi, key] of this.keys) {
            const down = heldSet.has(midi);
            key.classList.toggle('down', down);
            key.classList.toggle('wrong', down && wrong.has(midi));
            key.classList.toggle('hint', hintSet.has(midi) && !down);
        }
    }
}

window.NoteInput = NoteInput;
window.Keyboard = Keyboard;
