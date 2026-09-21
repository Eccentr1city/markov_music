/**
 * Markov Jazz Chord Engine
 * 
 * Layered approach:
 * 1. Key center (persists, occasionally modulates)
 * 2. Scale degree transitions with second-order awareness and approach patterns
 * 3. Chord realization with context-aware voicing
 */

// Spelling and chord contents live in theory.js
const _T = typeof Theory !== 'undefined' ? Theory : require('./theory.js');

// Scale degree intervals from root (in semitones) for major
const MAJOR_DEGREES = {
    'I': 0, 'bII': 1, 'II': 2, 'bIII': 3, 'III': 4, 'IV': 5,
    'bV': 6, 'V': 7, 'bVI': 8, 'VI': 9, 'bVII': 10, 'VII': 11
};

// Default qualities for diatonic chords in major
const DIATONIC_QUALITIES = {
    'I': 'maj7', 'ii': 'm7', 'iii': 'm7', 'IV': 'maj7',
    'V': '7', 'vi': 'm7', 'vii': 'm7b5'
};

// ─── First-order transition probabilities (major keys) ───────────────────────

const DEGREE_TRANSITIONS = {
    'I': {
        'ii': 0.22, 'IV': 0.18, 'V': 0.12, 'vi': 0.15, 'iii': 0.10,
        'bVII': 0.05, 'bIII': 0.04, 'bVI': 0.04, 'II': 0.05, 'I': 0.05
    },
    'ii': {
        'V': 0.50, 'bII': 0.10, 'bVII': 0.08, 'vi': 0.08,
        'iii': 0.06, 'IV': 0.06, 'I': 0.07, 'ii': 0.05
    },
    'iii': {
        'vi': 0.35, 'IV': 0.20, 'ii': 0.15, 'bIII': 0.08,
        'V': 0.10, 'I': 0.07, 'iii': 0.05
    },
    'IV': {
        'V': 0.25, 'I': 0.15, 'ii': 0.15, 'iv': 0.10,
        'bVII': 0.10, 'iii': 0.08, 'vi': 0.08, 'IV': 0.04, 'bII': 0.05
    },
    'V': {
        'I': 0.50, 'vi': 0.15, 'IV': 0.08, 'bVI': 0.08,
        'iii': 0.06, 'V': 0.05, 'bVII': 0.04, 'ii': 0.04
    },
    'vi': {
        'ii': 0.30, 'IV': 0.20, 'V': 0.15, 'iii': 0.10,
        'bVI': 0.08, 'I': 0.08, 'vi': 0.04, 'bVII': 0.05
    },
    'vii': {
        'I': 0.30, 'iii': 0.25, 'V': 0.15, 'vi': 0.10,
        'ii': 0.10, 'IV': 0.10
    },
    // Borrowed/chromatic chords
    'bII': {
        'I': 0.60, 'V': 0.15, 'bVII': 0.10, 'ii': 0.10, 'vi': 0.05
    },
    'bIII': {
        'IV': 0.30, 'bVII': 0.25, 'ii': 0.15, 'vi': 0.10,
        'I': 0.10, 'V': 0.10
    },
    'bVI': {
        'bVII': 0.30, 'V': 0.25, 'ii': 0.15, 'IV': 0.15,
        'I': 0.10, 'bII': 0.05
    },
    'bVII': {
        'I': 0.35, 'IV': 0.20, 'bVI': 0.15, 'V': 0.10,
        'ii': 0.10, 'bIII': 0.10
    },
    'iv': {
        'I': 0.25, 'V': 0.25, 'bVII': 0.15, 'ii': 0.15,
        'bVI': 0.10, 'IV': 0.10
    },
    // Secondary dominants (as degrees)
    'II': {  // V/V
        'V': 0.70, 'ii': 0.10, 'bII': 0.10, 'I': 0.10
    },
    'III': { // V/vi
        'vi': 0.70, 'IV': 0.10, 'ii': 0.10, 'I': 0.10
    },
    'VI': {  // V/ii
        'ii': 0.70, 'V': 0.10, 'IV': 0.10, 'I': 0.10
    },
    '#IV': { // V/V approached differently
        'V': 0.60, 'I': 0.20, 'ii': 0.20
    }
};

// ─── First-order transition probabilities (minor keys) ──────────────────────

const MINOR_DEGREE_TRANSITIONS = {
    'I': {  // i (minor tonic)
        'iv': 0.22, 'V': 0.15, 'bVII': 0.12, 'bVI': 0.12, 'ii': 0.15,
        'bIII': 0.08, 'v': 0.04, 'II': 0.05, 'I': 0.07
    },
    'ii': {  // iiø (half-diminished)
        'V': 0.55, 'bII': 0.08, 'bVII': 0.08, 'iv': 0.08,
        'I': 0.08, 'bVI': 0.07, 'ii': 0.06
    },
    'bIII': {  // bIII (major mediant)
        'bVI': 0.25, 'bVII': 0.25, 'iv': 0.15, 'V': 0.10,
        'ii': 0.10, 'I': 0.10, 'bIII': 0.05
    },
    'iv': {  // iv (minor subdominant)
        'V': 0.30, 'bVII': 0.15, 'I': 0.20, 'bVI': 0.10,
        'ii': 0.10, 'bIII': 0.08, 'iv': 0.04, 'bII': 0.03
    },
    'v': {  // v (minor dominant, natural minor)
        'bVI': 0.25, 'bVII': 0.25, 'I': 0.20, 'iv': 0.15,
        'bIII': 0.10, 'v': 0.05
    },
    'V': {  // V (major dominant, harmonic minor)
        'I': 0.50, 'bVI': 0.15, 'iv': 0.10, 'bVII': 0.06,
        'bIII': 0.06, 'V': 0.05, 'ii': 0.04, 'bII': 0.04
    },
    'vi': {  // vi (rare in minor — Dorian borrow)
        'ii': 0.30, 'IV': 0.20, 'V': 0.15, 'I': 0.15,
        'iv': 0.10, 'bVII': 0.10
    },
    'bVI': {  // bVI (major submediant)
        'bVII': 0.30, 'V': 0.20, 'iv': 0.15, 'ii': 0.12,
        'I': 0.10, 'bII': 0.05, 'bIII': 0.08
    },
    'bVII': {  // bVII (major subtonic)
        'I': 0.30, 'bIII': 0.20, 'bVI': 0.15, 'V': 0.10,
        'iv': 0.10, 'ii': 0.10, 'bVII': 0.05
    },
    // Chromatic/borrowed in minor context
    'bII': {
        'I': 0.55, 'V': 0.15, 'bVII': 0.10, 'iv': 0.10, 'ii': 0.10
    },
    'II': {  // V/V in minor
        'V': 0.70, 'ii': 0.10, 'bII': 0.10, 'I': 0.10
    },
    'III': {  // V/bVI
        'bVI': 0.40, 'iv': 0.20, 'bVII': 0.15, 'I': 0.10,
        'V': 0.10, 'ii': 0.05
    },
    'VI': {  // V/ii in minor
        'ii': 0.70, 'V': 0.10, 'iv': 0.10, 'I': 0.10
    },
    'IV': {  // Dorian IV (major subdominant borrowed)
        'V': 0.25, 'I': 0.20, 'ii': 0.15, 'bVII': 0.15,
        'iv': 0.10, 'bVI': 0.10, 'IV': 0.05
    }
};

// ─── Second-order overrides ─────────────────────────────────────────────────
// When we know the previous two degrees, override the first-order probabilities.
// Key: "prev→current" → distribution for NEXT degree.

const SECOND_ORDER_OVERRIDES = {
    // ii-V strongly resolves to I
    'ii→V':     { 'I': 0.75, 'vi': 0.10, 'bVI': 0.05, 'IV': 0.04, 'iii': 0.03, 'bVII': 0.03 },
    // iii-vi continues the cycle toward ii
    'iii→vi':   { 'ii': 0.45, 'IV': 0.20, 'V': 0.10, 'I': 0.08, 'bVI': 0.07, 'iii': 0.05, 'bVII': 0.05 },
    // vi-ii continues toward V
    'vi→ii':    { 'V': 0.55, 'bII': 0.10, 'bVII': 0.07, 'IV': 0.08, 'I': 0.08, 'iii': 0.06, 'II': 0.06 },
    // Secondary dominant V/V resolved — strong pull to I
    'II→V':     { 'I': 0.70, 'vi': 0.12, 'bVI': 0.06, 'IV': 0.05, 'iii': 0.04, 'bVII': 0.03 },
    // V/ii resolved to ii — continue chain
    'VI→ii':    { 'V': 0.55, 'bII': 0.10, 'bVII': 0.07, 'IV': 0.08, 'I': 0.08, 'iii': 0.06, 'ii': 0.06 },
    // V/vi resolved to vi — continue toward ii
    'III→vi':   { 'ii': 0.40, 'IV': 0.20, 'V': 0.15, 'I': 0.08, 'bVI': 0.07, 'iii': 0.05, 'bVII': 0.05 },
    // Plagal approach to dominant — strong resolution
    'IV→V':     { 'I': 0.55, 'vi': 0.15, 'bVI': 0.10, 'ii': 0.08, 'iii': 0.06, 'bVII': 0.03, 'V': 0.03 },
    // Borrowed chord resolution
    'bVI→bVII': { 'I': 0.50, 'iv': 0.15, 'ii': 0.15, 'V': 0.10, 'bVI': 0.05, 'bIII': 0.05 },
    // iv-V in minor — strong resolution to i
    'iv→V':     { 'I': 0.70, 'bVI': 0.10, 'iv': 0.06, 'bVII': 0.06, 'ii': 0.04, 'bIII': 0.04 },
};

// ─── ii-V approach patterns ─────────────────────────────────────────────────
// Occasionally, instead of a single transition, queue a ii-V approach to a target.
// Each sequence includes the approach chords AND the target.

const APPROACH_SEQUENCES = {
    'I':  { chords: ['ii', 'V', 'I'],      weight: 0.30 },   // ii-V-I
    'ii': { chords: ['iii', 'VI', 'ii'],    weight: 0.20 },   // iii-VI7-ii
    'V':  { chords: ['vi', 'II', 'V'],      weight: 0.30 },   // vi-II7-V
    'vi': { chords: ['vii', 'III', 'vi'],   weight: 0.20 },   // viiø-III7-vi
};

const APPROACH_PROBABILITY = 0.12;

// ─── Entering a new key ─────────────────────────────────────────────────────
// A modulation is prepared by a cadence in the NEW key rather than a bare jump.

const MODULATION_ENTRIES = {
    'ii-V-I': 0.70,
    'V-I': 0.20,
    'direct': 0.10
};

// Key Stability sets how long a key lasts, on an exponential scale so the whole
// slider is useful: 0 → ~3 chords per key, 0.5 → ~10, 0.9 → ~27, 1 → never leaves.
const KEY_LENGTH_MIN = 3;        // a ii-V-I in the new key, then straight out again
const KEY_LENGTH_DOUBLINGS = 3.5;
const TONIC_EXIT_BIAS = 1.4;
const OFF_TONIC_EXIT_BIAS = 0.85;

// ─── Key modulation targets ─────────────────────────────────────────────────

const KEY_MODULATIONS = {
    'fifth_up': 0.25,      // C → G
    'fifth_down': 0.25,    // C → F  
    'relative': 0.20,      // C → Am
    'parallel': 0.15,      // C → Cm
    'tritone': 0.08,       // C → Gb
    'step_up': 0.04,       // C → D
    'step_down': 0.03      // C → Bb
};

// ─── Chord quality options by function ──────────────────────────────────────

const QUALITY_OPTIONS = {
    tonic: ['maj7', 'maj9', '6', '69', 'maj7#11'],
    subdominant: ['maj7', 'maj9', '7', 'm7', '6'],
    dominant: ['7', '9', '13', '7#11', '7alt', '7b9', '7#9', 'sus4'],
    // Context-aware: dominant resolving to minor target
    dominantToMinor: ['7', '7b9', '7#9', '7alt'],
    // Context-aware: dominant resolving to major target
    dominantToMajor: ['7', '9', '13', '7#11', 'sus4'],
    minor: ['m7', 'm9', 'm11', 'm6', 'm69'],
    halfDim: ['m7b5'],
    diminished: ['dim7']
};

// ─── Engine ─────────────────────────────────────────────────────────────────

class MarkovJazzEngine {
    constructor(settings = {}) {
        this.settings = {
            keyStability: settings.keyStability ?? 0.40,
            adventurousness: settings.adventurousness ?? 0.15,
            complexity: settings.complexity ?? 0.20,
            twoChordProbability: settings.twoChordProbability ?? 0.08
        };

        this.reset();
    }

    /**
     * @param {object}  startingKey  { root, mode }, or null for a random key
     * @param {boolean} lockKey      stay in that key: no modulations
     */
    reset(startingKey = null, lockKey = false) {
        this.currentKey = startingKey || this.randomKey();
        this.keyLocked = !!startingKey && lockKey;
        this.currentDegree = 'I';
        this.previousDegree = null;
        this.barCount = 0;
        this.history = [];
        this.recentDegrees = [];
        // A key you asked for opens on its tonic, to orient the ear
        this.approachQueue = startingKey ? ['I'] : [];
        this.chordsSinceModulation = 0;
    }

    randomKey() {
        const roots = ['C', 'F', 'Bb', 'Eb', 'Ab', 'G', 'D', 'A'];
        const modes = ['major', 'major', 'major', 'minor']; // Bias toward major
        const root = roots[Math.floor(Math.random() * roots.length)];
        const mode = modes[Math.floor(Math.random() * modes.length)];
        return { root: _T.keyName(_T.pitchClass(root), mode), mode };
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
    }

    // ── Bar generation ──────────────────────────────────────────────────────

    generateBar() {
        this.barCount++;

        const previousKey = { ...this.currentKey };
        const hasTwoChords = Math.random() < this.settings.twoChordProbability;
        const count = hasTwoChords ? 2 : 1;

        // Phase 1: Generate degree sequence, remembering the key each chord belongs to
        const steps = [];
        for (let i = 0; i < count; i++) {
            this.maybeModulate();
            this.chordsSinceModulation++;

            const nextDegree = this.getNextDegree();
            this.previousDegree = this.currentDegree;
            this.currentDegree = nextDegree;

            // Track recent degrees for anti-repetition
            this.recentDegrees.push(nextDegree);
            if (this.recentDegrees.length > 8) this.recentDegrees.shift();

            // The same chord twice in a bar is just a one-chord bar
            const first = steps[0];
            if (first && first.degree === nextDegree &&
                first.key.root === this.currentKey.root && first.key.mode === this.currentKey.mode) {
                continue;
            }

            steps.push({ degree: nextDegree, key: { ...this.currentKey } });
        }

        // Phase 2: Realize chords with context (knowing what follows), each in
        // its own key – a modulation can fall between the two chords of a bar
        const barKey = this.currentKey;
        const chords = steps.map((step, idx) => {
            const nextHint = idx < steps.length - 1
                ? steps[idx + 1].degree
                : this.peekLikelyNextDegree();
            this.currentKey = step.key;
            return this.realizeChord(step.degree, nextHint);
        });
        this.currentKey = barKey;

        const keyChanged = previousKey.root !== this.currentKey.root ||
            previousKey.mode !== this.currentKey.mode;

        const bar = {
            barNumber: this.barCount,
            chords: chords,
            key: { ...this.currentKey },
            keyChanged: keyChanged
        };

        this.history.push(bar);
        return bar;
    }

    // ── Key modulation ──────────────────────────────────────────────────────

    /** Average number of chords a key should last at the current stability. */
    targetKeyLength() {
        const stability = this.settings.keyStability;
        if (stability >= 0.995) return Infinity;
        return KEY_LENGTH_MIN * Math.pow(2, KEY_LENGTH_DOUBLINGS * stability);
    }

    maybeModulate() {
        if (this.keyLocked) return;

        // Never interrupt a queued cadence
        if (this.approachQueue.length > 0) return;

        const target = this.targetKeyLength();
        if (!isFinite(target)) return;

        // A key settles for about half its expected life, then each chord has a
        // chance of leaving that makes the other half average out.
        const settle = Math.max(KEY_LENGTH_MIN, Math.round(target / 2));
        if (this.chordsSinceModulation < settle) return;

        // Leaving is likelier from the tonic: modulating after a cadence sounds
        // deliberate, mid-phrase sounds like a wrong turn.
        const onTonic = this.currentDegree === 'I';
        const chance = Math.min(1, (2 / target) * (onTonic ? TONIC_EXIT_BIAS : OFF_TONIC_EXIT_BIAS));

        if (Math.random() < chance) {
            this.modulate();
        }
    }

    modulate() {
        const type = this.weightedRandom(KEY_MODULATIONS);
        const currentRoot = _T.pitchClass(this.currentKey.root);
        let newRoot, newMode;

        switch (type) {
            case 'fifth_up':
                newRoot = (currentRoot + 7) % 12;
                newMode = this.currentKey.mode;
                break;
            case 'fifth_down':
                newRoot = (currentRoot + 5) % 12;
                newMode = this.currentKey.mode;
                break;
            case 'relative':
                if (this.currentKey.mode === 'major') {
                    newRoot = (currentRoot + 9) % 12;
                    newMode = 'minor';
                } else {
                    newRoot = (currentRoot + 3) % 12;
                    newMode = 'major';
                }
                break;
            case 'parallel':
                newRoot = currentRoot;
                newMode = this.currentKey.mode === 'major' ? 'minor' : 'major';
                break;
            case 'tritone':
                newRoot = (currentRoot + 6) % 12;
                newMode = this.currentKey.mode;
                break;
            case 'step_up':
                newRoot = (currentRoot + 2) % 12;
                newMode = this.currentKey.mode;
                break;
            case 'step_down':
                newRoot = (currentRoot + 10) % 12;
                newMode = this.currentKey.mode;
                break;
            default:
                return;
        }

        this.currentKey = { root: _T.keyName(newRoot, newMode), mode: newMode };
        this.chordsSinceModulation = 0;

        // Establish the new key with a cadence in it
        const entry = this.weightedRandom(MODULATION_ENTRIES);
        if (entry === 'ii-V-I') {
            this.approachQueue = ['ii', 'V', 'I'];
        } else if (entry === 'V-I') {
            this.approachQueue = ['V', 'I'];
        } else {
            this.approachQueue = ['I'];
        }
    }

    // ── Degree transitions ──────────────────────────────────────────────────

    getNextDegree() {
        // 1. If we have queued approach chords, consume the next one
        if (this.approachQueue.length > 0) {
            return this.approachQueue.shift();
        }

        // 2. Maybe start a new approach sequence
        if (Math.random() < APPROACH_PROBABILITY) {
            if (this.tryStartApproach()) {
                return this.approachQueue.shift();
            }
        }

        // 3. Check second-order overrides (previous→current → next)
        let transitions;
        if (this.previousDegree) {
            const key = `${this.previousDegree}→${this.currentDegree}`;
            if (SECOND_ORDER_OVERRIDES[key]) {
                transitions = { ...SECOND_ORDER_OVERRIDES[key] };
            }
        }

        // 4. Fall back to first-order table (mode-aware)
        if (!transitions) {
            const isMinor = this.currentKey.mode === 'minor';
            const table = isMinor ? MINOR_DEGREE_TRANSITIONS : DEGREE_TRANSITIONS;
            transitions = table[this.currentDegree]
                || DEGREE_TRANSITIONS[this.currentDegree]
                || DEGREE_TRANSITIONS['I'];
            transitions = { ...transitions };
        }

        // 5. Apply adventurousness
        transitions = this.adjustForAdventurousness(transitions);

        // 6. Apply anti-repetition
        transitions = this.applyAntiRepetition(transitions);

        return this.weightedRandom(transitions);
    }

    /**
     * Try to start a ii-V approach sequence toward a target chord.
     * Returns true if a sequence was queued.
     */
    tryStartApproach() {
        const targets = Object.entries(APPROACH_SEQUENCES);
        const weights = {};

        // The other targets are major-key degrees; in minor they'd drag in
        // chords like a major-key vi. iiø-V-i is the one that belongs.
        const minorKey = this.currentKey.mode === 'minor';

        for (const [target, { weight }] of targets) {
            if (minorKey && target !== 'I') continue;
            // Don't approach the degree we're already on
            if (target !== this.currentDegree) {
                weights[target] = weight;
            }
        }

        if (Object.keys(weights).length === 0) return false;

        const target = this.weightedRandom(weights);
        this.approachQueue = [...APPROACH_SEQUENCES[target].chords];
        return true;
    }

    /**
     * Peek at the most likely next degree without consuming it.
     * Used to give context-aware chord quality hints.
     */
    peekLikelyNextDegree() {
        // A queued cadence tells us exactly what's coming
        if (this.approachQueue.length > 0) return this.approachQueue[0];

        // Check second-order first
        if (this.previousDegree) {
            const key = `${this.previousDegree}→${this.currentDegree}`;
            if (SECOND_ORDER_OVERRIDES[key]) {
                return this.getMostProbable(SECOND_ORDER_OVERRIDES[key]);
            }
        }

        // Fall back to first-order
        const isMinor = this.currentKey.mode === 'minor';
        const table = isMinor ? MINOR_DEGREE_TRANSITIONS : DEGREE_TRANSITIONS;
        const transitions = table[this.currentDegree]
            || DEGREE_TRANSITIONS[this.currentDegree]
            || DEGREE_TRANSITIONS['I'];

        return this.getMostProbable(transitions);
    }

    getMostProbable(transitions) {
        let maxProb = 0;
        let maxDegree = 'I';
        for (const [degree, prob] of Object.entries(transitions)) {
            if (prob > maxProb) {
                maxProb = prob;
                maxDegree = degree;
            }
        }
        return maxDegree;
    }

    adjustForAdventurousness(transitions) {
        const adventure = this.settings.adventurousness;
        const adjusted = {};
        const entries = Object.entries(transitions);
        const uniform = 1 / entries.length;

        for (const [degree, prob] of entries) {
            adjusted[degree] = prob * (1 - adventure) + uniform * adventure;
        }

        return adjusted;
    }

    /**
     * Penalize degrees that have appeared too frequently in recent history.
     * Reduces staleness without forcing specific patterns.
     */
    applyAntiRepetition(transitions) {
        if (this.recentDegrees.length < 3) return transitions;

        const adjusted = { ...transitions };

        // Count recent degree occurrences
        const counts = {};
        for (const d of this.recentDegrees) {
            counts[d] = (counts[d] || 0) + 1;
        }

        // Penalize degrees that appeared 3+ times in the last 8 chords
        for (const [degree, count] of Object.entries(counts)) {
            if (count >= 3 && adjusted[degree]) {
                adjusted[degree] *= 0.3;
            } else if (count >= 2 && adjusted[degree]) {
                adjusted[degree] *= 0.7;
            }
        }

        return adjusted;
    }

    // ── Chord realization ───────────────────────────────────────────────────

    realizeChord(degree, nextDegreeHint = null) {
        const rootInterval = this.getDegreeInterval(degree);
        const chordRoot = _T.spellDegree(this.currentKey.root, degree, rootInterval);

        const quality = this.getChordQuality(degree, nextDegreeHint);
        const displayDegree = this.formatDegree(degree, quality);

        return {
            root: chordRoot,
            rootPc: _T.pitchClass(chordRoot),
            quality: quality,
            family: _T.family(quality),
            degree: displayDegree,
            fullName: this.formatChordName(chordRoot, quality)
        };
    }

    getDegreeInterval(degree) {
        const normalized = degree.replace(/[iv]/g, c => c.toUpperCase());

        if (normalized.startsWith('#')) {
            const base = MAJOR_DEGREES[normalized.slice(1)] || 0;
            return (base + 1) % 12;
        }

        return MAJOR_DEGREES[normalized] ?? MAJOR_DEGREES[degree.toUpperCase()] ?? 0;
    }

    getChordQuality(degree, nextDegreeHint = null) {
        const complexity = this.settings.complexity;
        const isMinorKey = this.currentKey.mode === 'minor';
        const upperDegree = degree.toUpperCase();

        let options;
        let isDominantFunction = false;

        // Secondary dominants (uppercase II, III, VI, VII)
        if (['II', 'III', 'VI', '#IV'].includes(degree)) {
            options = QUALITY_OPTIONS.dominant;
            isDominantFunction = true;
        }
        // Tritone sub
        else if (degree === 'bII') {
            options = ['7', '7#11', '9', '13'];
        }
        // In a minor key bVII is diatonic and its 7th is minor: G7 in A minor
        else if (degree === 'bVII' && isMinorKey) {
            options = ['7', '9', '13'];
        }
        // Borrowed chords from minor
        else if (['bIII', 'bVI', 'bVII'].includes(degree)) {
            options = ['maj7', '7', 'maj9'];
        }
        // Minor subdominant
        else if (degree === 'iv') {
            options = QUALITY_OPTIONS.minor;
        }
        // Half diminished (vii always, ii in minor key)
        else if (degree === 'vii' || (degree === 'ii' && isMinorKey)) {
            options = QUALITY_OPTIONS.halfDim;
        }
        // Dominant
        else if (upperDegree === 'V') {
            options = QUALITY_OPTIONS.dominant;
            isDominantFunction = true;
        }
        // Minor chords (including v — natural minor dominant)
        else if (['ii', 'iii', 'vi', 'v'].includes(degree) ||
            (isMinorKey && ['i', 'iv'].includes(degree.toLowerCase()))) {
            options = QUALITY_OPTIONS.minor;
        }
        // Tonic
        else if (upperDegree === 'I') {
            options = isMinorKey ? QUALITY_OPTIONS.minor : QUALITY_OPTIONS.tonic;
        }
        // Subdominant
        else if (upperDegree === 'IV') {
            options = QUALITY_OPTIONS.subdominant;
        }
        // Default
        else {
            options = ['7', 'maj7', 'm7'];
        }

        // ── Context-aware quality for dominant-function chords ──
        if (isDominantFunction && nextDegreeHint) {
            const minorTargets = ['ii', 'iii', 'vi', 'i', 'iv', 'v'];
            const resolvesToMinor = minorTargets.includes(nextDegreeHint) ||
                (isMinorKey && nextDegreeHint === 'I');

            if (resolvesToMinor) {
                // Dark/altered voicings for minor resolution
                options = QUALITY_OPTIONS.dominantToMinor;
            } else {
                // Bright extensions for major resolution
                options = QUALITY_OPTIONS.dominantToMajor;
            }
        }

        // Higher complexity = more likely to pick extended/altered options
        // Lower complexity = stick to simpler options (first in list)
        const maxIndex = Math.floor(1 + (options.length - 1) * complexity);
        const index = Math.floor(Math.random() * maxIndex);

        return options[Math.min(index, options.length - 1)];
    }

    // ── Formatting ──────────────────────────────────────────────────────────

    formatDegree(degree, quality = null) {
        const replacements = {
            'bII': '♭II', 'bIII': '♭III', 'bVI': '♭VI', 'bVII': '♭VII',
            'bV': '♭V', '#IV': '♯IV'
        };
        let display = replacements[degree] || degree;

        // The tables key the tonic as 'I' in both modes; show a minor tonic as 'i'
        const family = quality ? _T.family(quality) : null;
        if (degree === 'I' && family === 'min') display = 'i';
        if (family === 'hdim') display += 'ø';

        return display;
    }

    formatChordName(root, quality) {
        return { root: _T.pretty(root), quality: _T.displayQuality(quality) };
    }

    // ── Utilities ───────────────────────────────────────────────────────────

    weightedRandom(weights) {
        const entries = Object.entries(weights);
        const total = entries.reduce((sum, [, w]) => sum + w, 0);
        let random = Math.random() * total;

        for (const [key, weight] of entries) {
            random -= weight;
            if (random <= 0) return key;
        }

        return entries[0][0];
    }

    getState() {
        return {
            key: this.currentKey,
            degree: this.currentDegree,
            barCount: this.barCount
        };
    }
}

if (typeof window !== 'undefined') window.MarkovJazzEngine = MarkovJazzEngine;
if (typeof module !== 'undefined') module.exports = MarkovJazzEngine;
