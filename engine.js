/**
 * Markov Jazz Chord Engine
 * 
 * Layered approach:
 * 1. Key center (persists, occasionally modulates)
 * 2. Scale degree transitions (ii → V → I patterns)
 * 3. Chord realization (quality, extensions, alterations)
 */

const NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ENHARMONIC = {
    'C#': 'Db', 'D#': 'Eb', 'E#': 'F', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb', 'B#': 'C',
    'Cb': 'B', 'Fb': 'E'
};

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

// Transition probabilities between scale degrees
// Using lowercase for minor chords in naming, but we'll normalize
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

// Key modulation targets (relative probability weights)
const KEY_MODULATIONS = {
    'fifth_up': 0.25,      // C → G
    'fifth_down': 0.25,    // C → F  
    'relative': 0.20,      // C → Am
    'parallel': 0.15,      // C → Cm
    'tritone': 0.08,       // C → Gb
    'step_up': 0.04,       // C → D
    'step_down': 0.03      // C → Bb
};

// Chord quality modifiers based on function and settings
const QUALITY_OPTIONS = {
    tonic: ['maj7', 'maj9', '6', '69', 'maj7#11'],
    subdominant: ['maj7', 'maj9', '7', 'm7', '6'],
    dominant: ['7', '9', '13', '7#11', '7alt', '7b9', '7#9', 'sus4'],
    minor: ['m7', 'm9', 'm11', 'm6', 'm69'],
    halfDim: ['m7b5', 'ø7'],
    diminished: ['dim7', '°7']
};

class MarkovJazzEngine {
    constructor(settings = {}) {
        this.settings = {
            keyStability: settings.keyStability ?? 0.85,
            adventurousness: settings.adventurousness ?? 0.30,
            complexity: settings.complexity ?? 0.50,
            twoChordProbability: settings.twoChordProbability ?? 0.15
        };

        this.reset();
    }

    reset(startingKey = null) {
        this.currentKey = startingKey || this.randomKey();
        this.currentDegree = 'I';
        this.barCount = 0;
        this.history = [];
    }

    randomKey() {
        const roots = ['C', 'F', 'Bb', 'Eb', 'Ab', 'G', 'D', 'A'];
        const modes = ['major', 'major', 'major', 'minor']; // Bias toward major
        return {
            root: roots[Math.floor(Math.random() * roots.length)],
            mode: modes[Math.floor(Math.random() * modes.length)]
        };
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
    }

    // Generate the next bar (1 or 2 chords)
    generateBar() {
        this.barCount++;

        // Track if key changed this bar
        const previousKey = { ...this.currentKey };

        // Decide if this bar has 2 chords
        const hasTwoChords = Math.random() < this.settings.twoChordProbability;

        const chords = [];
        const count = hasTwoChords ? 2 : 1;

        for (let i = 0; i < count; i++) {
            // Maybe modulate key
            this.maybeModulate();

            // Get next degree
            const nextDegree = this.getNextDegree();
            this.currentDegree = nextDegree;

            // Realize the chord
            const chord = this.realizeChord(nextDegree);
            chords.push(chord);
        }

        // Check if key changed
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

    maybeModulate() {
        // Higher key stability = less likely to modulate
        const modulationChance = 1 - this.settings.keyStability;

        // More likely to modulate after a cadence (landing on I)
        const postCadence = this.currentDegree === 'I' || this.currentDegree === 'i';
        const effectiveChance = postCadence ? modulationChance * 2 : modulationChance;

        if (Math.random() < effectiveChance) {
            this.modulate();
        }
    }

    modulate() {
        const type = this.weightedRandom(KEY_MODULATIONS);
        const currentRoot = NOTES.indexOf(this.normalizeNote(this.currentKey.root));
        let newRoot, newMode;

        switch (type) {
            case 'fifth_up':
                newRoot = NOTES[(currentRoot + 7) % 12];
                newMode = this.currentKey.mode;
                break;
            case 'fifth_down':
                newRoot = NOTES[(currentRoot + 5) % 12];
                newMode = this.currentKey.mode;
                break;
            case 'relative':
                if (this.currentKey.mode === 'major') {
                    newRoot = NOTES[(currentRoot + 9) % 12];
                    newMode = 'minor';
                } else {
                    newRoot = NOTES[(currentRoot + 3) % 12];
                    newMode = 'major';
                }
                break;
            case 'parallel':
                newRoot = this.currentKey.root;
                newMode = this.currentKey.mode === 'major' ? 'minor' : 'major';
                break;
            case 'tritone':
                newRoot = NOTES[(currentRoot + 6) % 12];
                newMode = this.currentKey.mode;
                break;
            case 'step_up':
                newRoot = NOTES[(currentRoot + 2) % 12];
                newMode = this.currentKey.mode;
                break;
            case 'step_down':
                newRoot = NOTES[(currentRoot + 10) % 12];
                newMode = this.currentKey.mode;
                break;
            default:
                return;
        }

        this.currentKey = { root: newRoot, mode: newMode };
        // After modulation, we often land on I of the new key
        if (Math.random() < 0.6) {
            this.currentDegree = 'I';
        }
    }

    getNextDegree() {
        const transitions = DEGREE_TRANSITIONS[this.currentDegree] || DEGREE_TRANSITIONS['I'];

        // Apply adventurousness - flatten probabilities somewhat
        const adjusted = this.adjustForAdventurousness(transitions);

        return this.weightedRandom(adjusted);
    }

    adjustForAdventurousness(transitions) {
        const adventure = this.settings.adventurousness;
        const adjusted = {};
        const entries = Object.entries(transitions);
        const uniform = 1 / entries.length;

        for (const [degree, prob] of entries) {
            // Blend between original probability and uniform distribution
            adjusted[degree] = prob * (1 - adventure) + uniform * adventure;
        }

        return adjusted;
    }

    realizeChord(degree) {
        const rootInterval = this.getDegreeInterval(degree);
        const keyRoot = NOTES.indexOf(this.normalizeNote(this.currentKey.root));
        const chordRoot = NOTES[(keyRoot + rootInterval) % 12];

        const quality = this.getChordQuality(degree);
        const displayDegree = this.formatDegree(degree);

        return {
            root: chordRoot,
            quality: quality,
            degree: displayDegree,
            fullName: this.formatChordName(chordRoot, quality)
        };
    }

    getDegreeInterval(degree) {
        // Normalize degree to get interval
        const normalized = degree.replace(/[iv]/g, c => c.toUpperCase());

        if (normalized.startsWith('#')) {
            const base = MAJOR_DEGREES[normalized.slice(1)] || 0;
            return (base + 1) % 12;
        }

        return MAJOR_DEGREES[normalized] ?? MAJOR_DEGREES[degree.toUpperCase()] ?? 0;
    }

    getChordQuality(degree) {
        const complexity = this.settings.complexity;
        const isMinorKey = this.currentKey.mode === 'minor';

        // Determine chord function
        const upperDegree = degree.toUpperCase();
        const isLower = degree === degree.toLowerCase() && degree !== degree.toUpperCase();

        let options;

        // Secondary dominants (uppercase II, III, VI, VII)
        if (['II', 'III', 'VI', '#IV'].includes(degree)) {
            options = QUALITY_OPTIONS.dominant;
        }
        // Tritone sub
        else if (degree === 'bII') {
            options = ['7', '7#11', '9', '13'];
        }
        // Borrowed chords from minor
        else if (['bIII', 'bVI', 'bVII'].includes(degree)) {
            options = ['maj7', '7', 'maj9'];
        }
        // Minor subdominant
        else if (degree === 'iv') {
            options = QUALITY_OPTIONS.minor;
        }
        // Half diminished
        else if (degree === 'vii' || degree === 'ii' && isMinorKey) {
            options = QUALITY_OPTIONS.halfDim;
        }
        // Dominant
        else if (upperDegree === 'V') {
            options = QUALITY_OPTIONS.dominant;
        }
        // Minor chords
        else if (['ii', 'iii', 'vi'].includes(degree) ||
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

        // Higher complexity = more likely to pick extended/altered options
        // Lower complexity = stick to simpler options (first in list)
        const maxIndex = Math.floor(1 + (options.length - 1) * complexity);
        const index = Math.floor(Math.random() * maxIndex);

        return options[Math.min(index, options.length - 1)];
    }

    formatDegree(degree) {
        // Make it look nice for display
        const replacements = {
            'bII': '♭II', 'bIII': '♭III', 'bVI': '♭VI', 'bVII': '♭VII',
            'bV': '♭V', '#IV': '♯IV'
        };
        return replacements[degree] || degree;
    }

    formatChordName(root, quality) {
        // Format for display with proper typography
        let q = quality;

        // Convert to display format
        q = q.replace('maj7', 'Δ7')
            .replace('maj9', 'Δ9')
            .replace('m7b5', 'ø7')
            .replace('dim7', '°7')
            .replace('7alt', '7alt')
            .replace('7#11', '7♯11')
            .replace('7b9', '7♭9')
            .replace('7#9', '7♯9')
            .replace('m7', '-7')
            .replace('m9', '-9')
            .replace('m11', '-11')
            .replace('m6', '-6')
            .replace('m69', '-6/9')
            .replace('69', '6/9');

        return { root, quality: q };
    }

    normalizeNote(note) {
        return ENHARMONIC[note] || note;
    }

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

    // Get current state for display
    getState() {
        return {
            key: this.currentKey,
            degree: this.currentDegree,
            barCount: this.barCount
        };
    }
}

// Export for use in app.js
window.MarkovJazzEngine = MarkovJazzEngine;

