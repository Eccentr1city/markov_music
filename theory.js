/**
 * Theory - note spelling, chord tones, voicings and match rules
 *
 * Shared by the engine (spelling), the rhythm section (bass lines, comping
 * voicings) and the MIDI listener (deciding whether you played the chord).
 */

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// How each key centre is conventionally written
const KEY_NAMES = {
    major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],
    minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']
};

// Letter steps above the key note for each (major-referenced) degree
const DEGREE_STEPS = {
    'I': 0, 'bII': 1, 'II': 1, 'bIII': 2, 'III': 2, 'IV': 3, '#IV': 3,
    'bV': 4, 'V': 4, 'bVI': 5, 'VI': 5, 'bVII': 6, 'VII': 6
};

// Spellings nobody wants to read on a chart
const AWKWARD = { 'B#': 'C', 'E#': 'F', 'Cb': 'B', 'Fb': 'E' };

// ─── Chord qualities ────────────────────────────────────────────────────────
// All intervals are semitones above the root.
//   guide    – the tones that define the sound (3rd & 7th, or their stand-ins)
//   tones    – everything the chord symbol actually names
//   core     – the plain four-note chord
//   allowed  – chord tones plus the tensions a comping pianist might add
//   voicing  – rootless "type A" voicing, ascending from the 3rd
//   scale    – passing tones for the walking bass

const MAJ_ALLOWED = [0, 2, 4, 6, 7, 9, 11];
const DOM_ALLOWED = [0, 2, 4, 6, 7, 9, 10];
const ALT_ALLOWED = [0, 1, 3, 4, 6, 8, 10];
const MIN_ALLOWED = [0, 2, 3, 5, 7, 9, 10];

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const LYDIAN_DOM = [0, 2, 4, 6, 7, 9, 10];
const ALTERED = [0, 1, 3, 4, 6, 8, 10];
const PHRYGIAN_DOM = [0, 1, 4, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];
const DIMINISHED = [0, 2, 3, 5, 6, 8, 9, 11];

const QUALITIES = {
    'maj7':    { family: 'maj', tones: [0, 4, 7, 11], guide: [4, 11], core: [0, 4, 7, 11], allowed: MAJ_ALLOWED, voicing: [4, 7, 11, 14], scale: IONIAN },
    'maj9':    { family: 'maj', tones: [0, 2, 4, 7, 11], guide: [4, 11], core: [0, 4, 7, 11], allowed: MAJ_ALLOWED, voicing: [4, 7, 11, 14], scale: IONIAN },
    '6':       { family: 'maj', tones: [0, 4, 7, 9], guide: [4, 9],  core: [0, 4, 7, 9],  allowed: MAJ_ALLOWED, voicing: [4, 7, 9, 14],  scale: IONIAN },
    '69':      { family: 'maj', tones: [0, 2, 4, 7, 9], guide: [4, 9],  core: [0, 4, 7, 9],  allowed: MAJ_ALLOWED, voicing: [4, 7, 9, 14],  scale: IONIAN },
    'maj7#11': { family: 'maj', tones: [0, 4, 6, 7, 11], guide: [4, 11], core: [0, 4, 7, 11], allowed: MAJ_ALLOWED, voicing: [4, 6, 11, 14], scale: LYDIAN },

    '7':       { family: 'dom', tones: [0, 4, 7, 10], guide: [4, 10], core: [0, 4, 7, 10], allowed: DOM_ALLOWED, voicing: [4, 7, 10, 14], scale: MIXOLYDIAN },
    '9':       { family: 'dom', tones: [0, 2, 4, 7, 10], guide: [4, 10], core: [0, 4, 7, 10], allowed: DOM_ALLOWED, voicing: [4, 7, 10, 14], scale: MIXOLYDIAN },
    '13':      { family: 'dom', tones: [0, 2, 4, 7, 9, 10], guide: [4, 10], core: [0, 4, 7, 10], allowed: DOM_ALLOWED, voicing: [4, 9, 10, 14], scale: MIXOLYDIAN },
    '7#11':    { family: 'dom', tones: [0, 4, 6, 7, 10], guide: [4, 10], core: [0, 4, 7, 10], allowed: DOM_ALLOWED, voicing: [4, 6, 10, 14], scale: LYDIAN_DOM },
    'sus4':    { family: 'dom', tones: [0, 5, 7, 10], guide: [5, 10], core: [0, 5, 7, 10], allowed: [0, 2, 5, 7, 9, 10], voicing: [5, 9, 10, 14], scale: MIXOLYDIAN },
    '7b9':     { family: 'dom', tones: [0, 1, 4, 7, 10], guide: [4, 10], core: [0, 4, 7, 10], allowed: [0, 1, 3, 4, 6, 7, 8, 9, 10], voicing: [4, 9, 10, 13], scale: PHRYGIAN_DOM },
    '7#9':     { family: 'dom', tones: [0, 3, 4, 7, 10], guide: [4, 10], core: [0, 4, 7, 10], allowed: [0, 1, 3, 4, 6, 7, 8, 10], voicing: [4, 8, 10, 15], scale: ALTERED },
    '7alt':    { family: 'dom', tones: [0, 1, 3, 4, 6, 8, 10], guide: [4, 10], core: [0, 4, 10],    allowed: ALT_ALLOWED, voicing: [4, 8, 10, 15], scale: ALTERED },

    'm7':      { family: 'min', tones: [0, 3, 7, 10], guide: [3, 10], core: [0, 3, 7, 10], allowed: MIN_ALLOWED, voicing: [3, 7, 10, 14], scale: DORIAN },
    'm9':      { family: 'min', tones: [0, 2, 3, 7, 10], guide: [3, 10], core: [0, 3, 7, 10], allowed: MIN_ALLOWED, voicing: [3, 7, 10, 14], scale: DORIAN },
    'm11':     { family: 'min', tones: [0, 2, 3, 5, 7, 10], guide: [3, 10], core: [0, 3, 7, 10], allowed: MIN_ALLOWED, voicing: [3, 5, 10, 14], scale: DORIAN },
    'm6':      { family: 'min', tones: [0, 3, 7, 9], guide: [3, 9],  core: [0, 3, 7, 9],  allowed: [0, 2, 3, 5, 7, 9, 11], voicing: [3, 7, 9, 14], scale: DORIAN },
    'm69':     { family: 'min', tones: [0, 2, 3, 7, 9], guide: [3, 9],  core: [0, 3, 7, 9],  allowed: [0, 2, 3, 5, 7, 9, 11], voicing: [3, 7, 9, 14], scale: DORIAN },

    'm7b5':    { family: 'hdim', tones: [0, 3, 6, 10], guide: [3, 10], core: [0, 3, 6, 10], allowed: [0, 2, 3, 5, 6, 8, 10], voicing: [3, 6, 10, 12], scale: LOCRIAN },
    'dim7':    { family: 'dim', tones: [0, 3, 6, 9], guide: [3, 9],  core: [0, 3, 6, 9],  allowed: DIMINISHED, voicing: [3, 6, 9, 12], scale: DIMINISHED }
};

const QUALITY_DISPLAY = {
    'maj7': 'Δ7', 'maj9': 'Δ9', '6': '6', '69': '6/9', 'maj7#11': 'Δ7♯11',
    '7': '7', '9': '9', '13': '13', '7#11': '7♯11', 'sus4': '7sus4',
    '7b9': '7♭9', '7#9': '7♯9', '7alt': '7alt',
    'm7': '-7', 'm9': '-9', 'm11': '-11', 'm6': '-6', 'm69': '-6/9',
    'm7b5': 'ø7', 'dim7': '°7'
};

const MATCH_LEVELS = ['guide', 'shell', 'full'];

const Theory = {
    QUALITIES,
    MATCH_LEVELS,

    // ── Spelling ────────────────────────────────────────────────────────────

    parseNote(name) {
        const letter = name[0];
        let acc = 0;
        for (const c of name.slice(1)) acc += c === '#' ? 1 : c === 'b' ? -1 : 0;
        return { letter, acc, pc: (LETTER_PC[letter] + acc + 12) % 12 };
    },

    pitchClass(name) {
        return this.parseNote(name).pc;
    },

    keyName(pc, mode) {
        return KEY_NAMES[mode === 'minor' ? 'minor' : 'major'][((pc % 12) + 12) % 12];
    },

    /**
     * Spell the root of a scale degree in a key, e.g. ('D', 'III', 4) → 'F#',
     * where a flats-only table would have said 'Gb'.
     */
    spellDegree(keyRoot, degree, semitones) {
        const key = this.parseNote(keyRoot);
        const normalized = degree.replace(/[iv]+/g, s => s.toUpperCase());
        const steps = DEGREE_STEPS[normalized] ?? 0;

        const letter = LETTERS[(LETTERS.indexOf(key.letter) + steps) % 7];
        const pc = (key.pc + semitones) % 12;
        const acc = ((pc - LETTER_PC[letter] + 18) % 12) - 6;

        if (Math.abs(acc) >= 2) return acc > 0 ? SHARP_NAMES[pc] : FLAT_NAMES[pc];

        const name = letter + (acc > 0 ? '#' : acc < 0 ? 'b' : '');
        return AWKWARD[name] || name;
    },

    /** 'Bb' → 'B♭' */
    pretty(name) {
        return name.replace(/b/g, '♭').replace(/#/g, '♯');
    },

    displayQuality(quality) {
        return QUALITY_DISPLAY[quality] ?? quality;
    },

    // ── Chord contents ──────────────────────────────────────────────────────

    quality(id) {
        return QUALITIES[id] || QUALITIES['7'];
    },

    family(id) {
        return this.quality(id).family;
    },

    /** Pitch classes you must be holding for the chord to count. */
    requiredPcs(chord, level = 'guide') {
        const q = this.quality(chord.quality);
        const intervals = level === 'full' ? q.core
            : level === 'shell' ? [0, ...q.guide]
            : q.guide;
        return intervals.map(i => (chord.rootPc + i) % 12);
    },

    /**
     * Tensions a chord earns from where it's going. A dominant resolving down a
     * fifth to a minor chord borrows that key's harmonic minor, so the b9 and
     * b13 are fair game even when the symbol just says "7".
     */
    contextTensions(chord, next) {
        if (!next || this.family(chord.quality) !== 'dom') return [];

        const nextFamily = this.family(next.quality);
        const upAFourth = (next.rootPc - chord.rootPc + 12) % 12 === 5;
        return upAFourth && (nextFamily === 'min' || nextFamily === 'hdim') ? [1, 8] : [];
    },

    /**
     * Everything with a plausible excuse: chord tones, tensions and the chord's
     * scale. `next` is the chord that follows, if known (see contextTensions).
     */
    allowedPcs(chord, next = null) {
        const q = this.quality(chord.quality);
        const intervals = new Set([...q.tones, ...q.allowed, ...q.scale, ...this.contextTensions(chord, next)]);
        return [...intervals].map(i => (chord.rootPc + i) % 12);
    },

    /**
     * How a note sits against a chord:
     *   'chord'   – named by the chord symbol
     *   'scale'   – a tension or scale tone; colourful, but not what was asked for
     *   'outside' – no plausible excuse
     */
    classify(chord, midi, next = null) {
        const q = this.quality(chord.quality);
        const interval = (((midi - chord.rootPc) % 12) + 12) % 12;
        if (q.tones.includes(interval)) return 'chord';
        if (q.allowed.includes(interval) || q.scale.includes(interval)) return 'scale';
        if (this.contextTensions(chord, next).includes(interval)) return 'scale';
        return 'outside';
    },

    /**
     * Does this set of held MIDI notes count as the chord? Every required
     * tone must be down, and nothing 'outside' (see classify).
     */
    matches(chord, heldMidi, level = 'guide', next = null) {
        const held = new Set([...heldMidi].map(m => m % 12));
        if (held.size === 0) return false;

        const allowed = new Set(this.allowedPcs(chord, next));
        for (const pc of held) if (!allowed.has(pc)) return false;

        return this.requiredPcs(chord, level).every(pc => held.has(pc));
    },

    // ── Voicings ────────────────────────────────────────────────────────────

    /**
     * Rootless left-hand voicing (type A from the 3rd, or type B from the
     * 7th), whichever sits closest to the previous voicing.
     */
    rootlessVoicing(chord, previous = null) {
        const a = this.quality(chord.quality).voicing;
        const b = [a[2], a[3], a[0] + 12, a[1] + 12];

        const candidates = [a, b].map(shape => {
            let notes = shape.map(i => chord.rootPc + i);
            // Sit the bottom note between D3 and C#4
            while (notes[0] < 50) notes = notes.map(n => n + 12);
            while (notes[0] >= 62) notes = notes.map(n => n - 12);
            return notes;
        });

        if (!previous || !previous.length) {
            return candidates[Math.random() < 0.5 ? 0 : 1];
        }

        const centre = ns => ns.reduce((s, n) => s + n, 0) / ns.length;
        const target = centre(previous);
        return candidates.sort((x, y) =>
            Math.abs(centre(x) - target) - Math.abs(centre(y) - target))[0];
    },

    /** The 3rd and 7th, placed around middle C. */
    guideToneVoicing(chord) {
        return this.quality(chord.quality).guide.map(i => {
            let n = chord.rootPc + i + 48;
            while (n < 52) n += 12;
            while (n >= 64) n -= 12;
            return n;
        }).sort((x, y) => x - y);
    }
};

if (typeof window !== 'undefined') window.Theory = Theory;
if (typeof module !== 'undefined') module.exports = Theory;
