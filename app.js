/**
 * Markov Jazz Changes - App Controller
 *
 * Ties together the chord engine, the transport, the rhythm section, the
 * lead-sheet display and (optionally) a listener that checks what you play.
 */

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_S = 0.15;       // how far ahead audio is committed
const WAIT_HOLD_MS = 120;       // a chord must be held this long in wait mode
const EARLY_BEATS = 0.5;        // in-time mode accepts a chord pushed this early
const SETTINGS_KEY = 'markov-jazz-settings';

const BASS_STYLES = ['off', 'two', 'walk'];
const BASS_LABELS = { off: 'Bass', two: 'Bass: two-feel', walk: 'Bass: walking' };

class MarkovJazzApp {
    constructor() {
        this.engine = new MarkovJazzEngine();
        this.drums = new Drums();
        this.bass = new BassPlayer();
        this.keys = new Keys();
        this.input = new NoteInput();

        // Lead sheet
        this.bars = [];                 // every bar generated so far
        this.barsPerRow = this.getResponsiveBarsPerRow();
        this.visibleRows = 3;
        this.currentBarIndex = 0;
        this.currentChordIndex = 0;
        this.displayedRowStart = 0;
        this.scrolling = false;

        // Transport
        this.isPlaying = false;
        this.tempo = 60;
        this.currentBeat = 0;
        this.schedulerId = null;
        this.uiTimers = new Set();
        this.nextBeatTime = 0;
        this.schedBar = 0;
        this.schedBeat = 0;
        this.countInLeft = 0;
        this.bassPlan = [];
        this.compPlan = [];

        // Listening
        this.listenMode = 'off';        // 'off' | 'time' | 'wait'
        this.matchLevel = 'guide';      // 'guide' | 'shell' | 'full'
        this.hintMode = 'none';         // 'none' | 'guide' | 'voicing'
        this.showAnalysis = true;
        this.results = new Map();       // "bar:chord" → 'hit' | 'miss'
        this.windows = [];              // chord time-windows for in-time mode
        this.hintCache = new Map();
        this.lastHint = null;
        this.waitTimer = null;
        this.freshAttack = false;
        this.verdicts = new Map();      // held note → 'chord' | 'scale' | 'outside', as struck

        this.initUI();
        this.loadSettings();
        this.render();

        this.input.onChange((e) => this.handleInput(e));
        this.input.onStatus((s) => this.renderMidiStatus(s));

        // Re-layout on resize (with debounce)
        this._resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.handleResize(), 250);
        });

        // Chord widths change once the display font arrives
        document.fonts?.ready.then(() => this.drawAnalysis());
    }

    // ── Bars and rows ───────────────────────────────────────────────────────

    getBar(index) {
        while (this.bars.length <= index) {
            this.bars.push(this.engine.generateBar());
        }
        return this.bars[index];
    }

    /** Chord at (bar, chord), stepping into following bars as needed. */
    chordAfter(barIndex, chordIndex) {
        const bar = this.getBar(barIndex);
        if (chordIndex + 1 < bar.chords.length) {
            return { bar: barIndex, chord: chordIndex + 1 };
        }
        return { bar: barIndex + 1, chord: 0 };
    }

    getCurrentBar() {
        return this.getBar(this.currentBarIndex);
    }

    getCurrentChord() {
        const bar = this.getCurrentBar();
        return bar.chords[Math.min(this.currentChordIndex, bar.chords.length - 1)];
    }

    getResponsiveBarsPerRow() {
        return window.innerWidth <= 600 ? 2 : 4;
    }

    handleResize() {
        const barsPerRow = this.getResponsiveBarsPerRow();
        if (barsPerRow !== this.barsPerRow) {
            this.barsPerRow = barsPerRow;
            this.displayedRowStart = Math.floor(this.currentBarIndex / this.barsPerRow);
            this.rowsContainer.style.transform = 'translateY(0)';
        }
        this.keyboard.setRange(...this.keyboardRange());
        this.render();
    }

    keyboardRange() {
        return window.innerWidth <= 600 ? [48, 76] : [36, 84];
    }

    // ── UI wiring ───────────────────────────────────────────────────────────

    initUI() {
        const $ = (id) => document.getElementById(id);

        this.playBtn = $('play-btn');
        this.resetBtn = $('reset-btn');
        this.playBtn.addEventListener('click', () => this.togglePlay());
        this.resetBtn.addEventListener('click', () => this.reset());

        // Tempo: takes effect on the next beat, no restart needed
        this.tempoSlider = $('tempo');
        this.tempoValue = $('tempo-value');
        this.tempoSlider.addEventListener('input', (e) => {
            this.tempo = parseInt(e.target.value);
            this.tempoValue.textContent = this.tempo;
            this.saveSettings();
        });

        // Settings panel
        this.settingsPanel = $('settings-panel');
        $('settings-toggle').addEventListener('click', () => {
            this.settingsPanel.classList.toggle('open');
        });

        // Engine sliders
        this.engineSliders = {
            keyStability: $('key-stability'),
            adventurousness: $('adventurousness'),
            complexity: $('complexity'),
            twoChordProbability: $('two-chord')
        };
        for (const [setting, slider] of Object.entries(this.engineSliders)) {
            slider.addEventListener('input', () => {
                this.engine.updateSettings({ [setting]: parseInt(slider.value) / 100 });
                this.saveSettings();
            });
        }

        // Rhythm section
        this.clickBtn = $('metronome-btn');
        this.drumsBtn = $('drums-btn');
        this.bassBtn = $('bass-btn');
        this.compBtn = $('comp-btn');

        this.clickBtn.addEventListener('click', () => this.setClick(!this.drums.clickEnabled));
        this.drumsBtn.addEventListener('click', () => this.setDrums(!this.drums.rideEnabled));
        this.compBtn.addEventListener('click', () => this.setComp(!this.keys.compEnabled));
        this.bassBtn.addEventListener('click', () => {
            const next = BASS_STYLES[(BASS_STYLES.indexOf(this.bass.style) + 1) % BASS_STYLES.length];
            this.setBassStyle(next);
        });

        // Listening
        this.listenButtons = document.querySelectorAll('[data-listen]');
        this.listenButtons.forEach(btn => {
            btn.addEventListener('click', () => this.setListenMode(btn.dataset.listen));
        });

        this.matchSelect = $('match-level');
        this.matchSelect.addEventListener('change', () => {
            this.matchLevel = this.matchSelect.value;
            this.saveSettings();
            this.updateKeyboard();
        });

        this.hintSelect = $('hint-mode');
        this.hintSelect.addEventListener('change', () => {
            this.hintMode = this.hintSelect.value;
            this.saveSettings();
            this.updateKeyboardVisibility();
            this.updateKeyboard();
        });

        this.analysisToggle = $('analysis-toggle');
        this.analysisToggle.addEventListener('change', () => {
            this.showAnalysis = this.analysisToggle.checked;
            this.saveSettings();
            this.drawAnalysis();
        });

        this.monitorToggle = $('monitor-toggle');
        this.monitorToggle.addEventListener('change', () => {
            this.keys.monitorEnabled = this.monitorToggle.checked;
            if (!this.keys.monitorEnabled) this.keys.stopAll();
            this.saveSettings();
        });

        // Display
        this.keyDisplay = $('current-key');
        this.scoreDisplay = $('score');
        this.midiStatus = $('midi-status');
        this.rowsContainer = $('rows-container');
        this.beatIndicators = document.querySelectorAll('.beat');
        this.keyboardPanel = $('keyboard-panel');
        this.keyboard = new Keyboard($('keyboard'), this.input);
        this.keyboard.setRange(...this.keyboardRange());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('select, input[type="text"]')) return;

            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlay();
            } else if (e.code === 'KeyR') {
                this.reset();
            } else if (e.code === 'ArrowRight') {
                if (this.listenMode === 'wait') this.advanceChord();
                else if (!this.isPlaying) this.goToBar(this.currentBarIndex + 1);
            }
        });
    }

    setClick(enabled) {
        if (enabled) audioCore.ensure();
        this.drums.clickEnabled = enabled;
        this.clickBtn.classList.toggle('active', enabled);
        this.saveSettings();
    }

    setDrums(enabled) {
        if (enabled) audioCore.ensure();
        this.drums.rideEnabled = enabled;
        this.drumsBtn.classList.toggle('active', enabled);
        this.saveSettings();
    }

    setComp(enabled) {
        if (enabled) audioCore.ensure();
        this.keys.compEnabled = enabled;
        if (!enabled) this.compPlan = [];
        this.compBtn.classList.toggle('active', enabled);
        this.saveSettings();
    }

    setBassStyle(style) {
        this.bassBtn.textContent = BASS_LABELS[style];
        this.bassBtn.classList.toggle('active', style !== 'off');
        if (style === 'off') this.bassPlan = [];
        this.saveSettings(style);
        return this.bass.setStyle(style);
    }

    anySoundEnabled() {
        return this.drums.clickEnabled || this.drums.rideEnabled ||
            this.bass.enabled || this.keys.compEnabled;
    }

    // ── Settings persistence ────────────────────────────────────────────────

    saveSettings(bassStyle = this.bass.style) {
        const settings = {
            tempo: this.tempo,
            engine: this.engine.settings,
            click: this.drums.clickEnabled,
            drums: this.drums.rideEnabled,
            comp: this.keys.compEnabled,
            bass: bassStyle,
            matchLevel: this.matchLevel,
            hintMode: this.hintMode,
            showAnalysis: this.showAnalysis,
            monitor: this.keys.monitorEnabled
        };
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            // private mode etc. – settings just won't persist
        }
    }

    loadSettings() {
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        } catch (e) {
            // ignore
        }

        if (saved.tempo) {
            this.tempo = saved.tempo;
            this.tempoSlider.value = this.tempo;
            this.tempoValue.textContent = this.tempo;
        }

        if (saved.engine) {
            this.engine.updateSettings(saved.engine);
            for (const [setting, slider] of Object.entries(this.engineSliders)) {
                if (saved.engine[setting] != null) slider.value = Math.round(saved.engine[setting] * 100);
            }
        }

        // Sound toggles are restored visually, but audio can only start from a
        // user gesture – the first Play (or toggle) click does that.
        this.drums.clickEnabled = !!saved.click;
        this.drums.rideEnabled = !!saved.drums;
        this.keys.compEnabled = !!saved.comp;
        this.bass.style = BASS_STYLES.includes(saved.bass) ? saved.bass : 'off';
        this.clickBtn.classList.toggle('active', this.drums.clickEnabled);
        this.drumsBtn.classList.toggle('active', this.drums.rideEnabled);
        this.compBtn.classList.toggle('active', this.keys.compEnabled);
        this.bassBtn.classList.toggle('active', this.bass.enabled);
        this.bassBtn.textContent = BASS_LABELS[this.bass.style];

        this.matchLevel = Theory.MATCH_LEVELS.includes(saved.matchLevel) ? saved.matchLevel : 'guide';
        this.hintMode = ['none', 'guide', 'voicing'].includes(saved.hintMode) ? saved.hintMode : 'none';
        this.showAnalysis = saved.showAnalysis !== false;
        this.keys.monitorEnabled = saved.monitor !== false;

        this.matchSelect.value = this.matchLevel;
        this.hintSelect.value = this.hintMode;
        this.analysisToggle.checked = this.showAnalysis;
        this.monitorToggle.checked = this.keys.monitorEnabled;

        this.updateKeyboardVisibility();
    }

    // ── Transport ───────────────────────────────────────────────────────────

    clock() {
        return audioCore.ctx ? audioCore.ctx.currentTime : performance.now() / 1000;
    }

    togglePlay() {
        if (this.listenMode === 'wait') {
            this.advanceChord();
        } else if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    async play() {
        if (this.isPlaying || this.listenMode === 'wait') return;

        this.isPlaying = true;
        this.playBtn.textContent = 'Pause';

        audioCore.ensure();
        if (this.bass.enabled) {
            await this.bass.setStyle(this.bass.style);
            if (!this.isPlaying) return; // paused while samples were loading
        }

        // Always (re)start from the top of the current bar, after a count-in
        this.schedBar = this.currentBarIndex;
        this.schedBeat = 0;
        this.countInLeft = this.anySoundEnabled() ? 4 : 0;
        this.nextBeatTime = this.clock() + 0.1;
        this.windows = [];

        this.schedulerId = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
        this.schedule();
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.playBtn.textContent = 'Play';

        clearInterval(this.schedulerId);
        this.schedulerId = null;
        for (const id of this.uiTimers) clearTimeout(id);
        this.uiTimers.clear();

        this.bass.stopAll();
        this.keys.stopAll();
        this.windows = [];

        this.currentBeat = 0;
        this.updateBeatIndicator();
    }

    /** Commit every beat that falls inside the lookahead window. */
    schedule() {
        while (this.isPlaying && this.nextBeatTime < this.clock() + LOOKAHEAD_S) {
            this.scheduleBeat(this.nextBeatTime);
            this.nextBeatTime += 60 / this.tempo;
        }
    }

    scheduleBeat(time) {
        const beatDuration = 60 / this.tempo;

        if (this.countInLeft > 0) {
            const count = 5 - this.countInLeft;
            this.drums.click(time, count === 1);
            this.at(time, () => this.updateBeatIndicator(count, true));
            this.countInLeft--;
            return;
        }

        const barIndex = this.schedBar;
        const beat = this.schedBeat;
        const bar = this.getBar(barIndex);
        const nextChord = this.getBar(barIndex + 1).chords[0];

        if (beat === 0) {
            this.bassPlan = this.bass.enabled && this.bass.loaded ? this.bass.planBar(bar, nextChord) : [];
            this.compPlan = this.keys.planBar(bar, nextChord);
            this.openWindow(barIndex, 0, time);
        } else if (beat === 2 && bar.chords.length === 2) {
            this.openWindow(barIndex, 1, time);
        }

        this.drums.scheduleBeat(beat + 1, time, beatDuration);

        this.bassPlan.forEach((note, i) => {
            if (note.beat !== beat) return;
            const nextBeat = this.bassPlan[i + 1]?.beat ?? 4;
            this.bass.playNote(note.midi, time, (nextBeat - beat) * beatDuration);
        });

        for (const event of this.compPlan) {
            if (Math.floor(event.offset) !== beat) continue;
            const start = time + (event.offset - beat) * beatDuration;
            this.keys.playChord(event.notes, start, event.length * beatDuration, event.velocity);
        }

        this.at(time, () => this.onBeat(barIndex, beat));

        this.schedBeat++;
        if (this.schedBeat === 4) {
            this.schedBeat = 0;
            this.schedBar++;
        }
    }

    /** Run a UI update when the audio clock reaches `time`. */
    at(time, fn) {
        const id = setTimeout(() => {
            this.uiTimers.delete(id);
            fn();
        }, Math.max(0, (time - this.clock()) * 1000));
        this.uiTimers.add(id);
    }

    onBeat(barIndex, beat) {
        this.currentBeat = beat + 1;
        this.updateBeatIndicator(this.currentBeat);

        const bar = this.getBar(barIndex);
        const chordIndex = bar.chords.length === 2 && beat >= 2 ? 1 : 0;

        if (barIndex !== this.currentBarIndex) {
            this.currentChordIndex = chordIndex;
            this.goToBar(barIndex);
        } else if (chordIndex !== this.currentChordIndex) {
            this.currentChordIndex = chordIndex;
            this.updateHighlights();
        }

        this.checkWindows();
        this.updateKeyboard();
    }

    updateBeatIndicator(beat = this.currentBeat, countIn = false) {
        this.beatIndicators.forEach((el, index) => {
            el.classList.toggle('active', index < beat);
            el.classList.toggle('count-in', countIn);
        });
    }

    reset() {
        this.pause();
        this.engine.reset();
        this.bass.reset();
        this.keys.reset();
        this.keyboard.clearLatched();

        this.bars = [];
        this.results.clear();
        this.hintCache.clear();
        this.lastHint = null;
        this.currentBarIndex = 0;
        this.currentChordIndex = 0;
        this.displayedRowStart = 0;
        this.barsPerRow = this.getResponsiveBarsPerRow();
        this.rowsContainer.style.transform = 'translateY(0)';

        this.render();
        this.updateScore();
    }

    // ── Moving through the sheet ────────────────────────────────────────────

    goToBar(index) {
        this.currentBarIndex = index;
        if (!this.isPlaying && this.listenMode !== 'wait') this.currentChordIndex = 0;

        const row = Math.floor(index / this.barsPerRow);
        if (row > this.displayedRowStart && !this.scrolling) {
            this.scrollToRow(row);
        } else {
            this.updateHighlights();
        }
        this.updateKeyboard();
    }

    scrollToRow(row) {
        this.scrolling = true;
        this.updateHighlights();

        const rowElements = this.rowsContainer.querySelectorAll('.row');
        const steps = row - this.displayedRowStart;
        for (let i = 0; i < steps && rowElements[i]; i++) {
            rowElements[i].classList.add('fading');
        }

        const rowHeight = rowElements[0]?.offsetHeight || 100;
        const gap = parseFloat(getComputedStyle(this.rowsContainer).rowGap) || 12;
        this.rowsContainer.style.transform = `translateY(-${(rowHeight + gap) * steps}px)`;

        setTimeout(() => {
            this.displayedRowStart = Math.floor(this.currentBarIndex / this.barsPerRow);
            this.scrolling = false;

            // Snap back with the new rows in place
            this.rowsContainer.style.transition = 'none';
            this.rowsContainer.style.transform = 'translateY(0)';
            this.rowsContainer.offsetHeight; // force reflow
            this.rowsContainer.style.transition = '';

            this.render(true);
        }, 600);
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    render(newRowAdded = false) {
        this.rowsContainer.innerHTML = '';

        const lastRow = this.displayedRowStart + this.visibleRows;
        // One bar beyond what's visible, so marks leaving the last row are known
        this.getBar(lastRow * this.barsPerRow);

        for (let rowIdx = this.displayedRowStart; rowIdx < lastRow; rowIdx++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'row';
            rowEl.dataset.row = rowIdx;
            if (newRowAdded && rowIdx === lastRow - 1) rowEl.classList.add('entering');

            for (let i = 0; i < this.barsPerRow; i++) {
                const index = rowIdx * this.barsPerRow + i;
                rowEl.appendChild(this.createBarElement(this.getBar(index), index));
            }
            this.rowsContainer.appendChild(rowEl);
        }

        this.updateHighlights();
        this.drawAnalysis();
        this.updateKeyboard();
    }

    /** Refresh current/played/hit/miss classes without rebuilding the sheet. */
    updateHighlights() {
        const currentRow = Math.floor(this.currentBarIndex / this.barsPerRow);

        this.rowsContainer.querySelectorAll('.row').forEach(rowEl => {
            rowEl.classList.toggle('upcoming', parseInt(rowEl.dataset.row) > currentRow);
        });

        this.rowsContainer.querySelectorAll('.bar').forEach(barEl => {
            const index = parseInt(barEl.dataset.index);
            const row = Math.floor(index / this.barsPerRow);
            barEl.classList.toggle('current', index === this.currentBarIndex);
            barEl.classList.toggle('played', row === currentRow && index < this.currentBarIndex);
        });

        const showActiveChord = this.isPlaying || this.listenMode === 'wait';
        this.rowsContainer.querySelectorAll('.chord').forEach(chordEl => {
            const key = chordEl.dataset.key;
            const result = this.results.get(key);
            chordEl.classList.toggle('hit', result === 'hit');
            chordEl.classList.toggle('miss', result === 'miss');
            chordEl.classList.toggle('active', showActiveChord &&
                key === `${this.currentBarIndex}:${this.currentChordIndex}`);
        });

        const bar = this.getCurrentBar();
        this.setMusicText(this.keyDisplay, `${Theory.pretty(bar.key.root)} ${bar.key.mode}`);
    }

    createBarElement(bar, index) {
        const barEl = document.createElement('div');
        barEl.className = 'bar';
        barEl.dataset.index = index;

        const barNumEl = document.createElement('div');
        barNumEl.className = 'bar-number';
        barNumEl.textContent = bar.barNumber;
        barEl.appendChild(barNumEl);

        if (bar.keyChanged) {
            const keyBadge = document.createElement('div');
            keyBadge.className = 'key-change-badge';
            this.setMusicText(keyBadge, `${Theory.pretty(bar.key.root)} ${bar.key.mode === 'minor' ? 'min' : 'maj'}`);
            barEl.appendChild(keyBadge);
        }

        if (bar.chords.length === 2) {
            barEl.classList.add('two-chords');
            bar.chords.forEach((chord, idx) => {
                barEl.appendChild(this.createChordElement(chord, `${index}:${idx}`));
                if (idx === 0) {
                    const divider = document.createElement('div');
                    divider.className = 'divider';
                    barEl.appendChild(divider);
                }
            });
        } else {
            const chord = bar.chords[0];
            barEl.appendChild(this.createChordElement(chord, `${index}:0`));

            const degreeEl = document.createElement('div');
            degreeEl.className = 'degree-hint';
            degreeEl.textContent = chord.degree;
            barEl.appendChild(degreeEl);
        }

        return barEl;
    }

    createChordElement(chord, key) {
        const chordEl = document.createElement('div');
        chordEl.className = 'chord';
        chordEl.dataset.key = key;

        const rootEl = document.createElement('span');
        rootEl.className = 'root';
        this.setMusicText(rootEl, chord.fullName.root);

        const qualityEl = document.createElement('span');
        qualityEl.className = 'quality';
        this.setMusicText(qualityEl, chord.fullName.quality);

        chordEl.appendChild(rootEl);
        chordEl.appendChild(qualityEl);
        return chordEl;
    }

    /**
     * Set text, wrapping ♭/♯ so CSS can size them: the display font has no
     * accidentals of its own, and the fallback glyphs are far too big.
     */
    setMusicText(el, text) {
        el.textContent = '';
        for (const part of text.split(/([♭♯])/)) {
            if (part === '♭' || part === '♯') {
                const acc = document.createElement('span');
                acc.className = 'acc';
                acc.textContent = part;
                el.appendChild(acc);
            } else if (part) {
                el.appendChild(document.createTextNode(part));
            }
        }
    }

    // ── Analysis overlay ────────────────────────────────────────────────────

    drawAnalysis() {
        const rowEls = [...this.rowsContainer.querySelectorAll('.row')];
        if (!this.showAnalysis) {
            rowEls.forEach(rowEl => Analysis.draw(rowEl, []));
            return;
        }

        // Analyse from one bar before the first visible bar to one bar after the last
        const firstBar = Math.max(0, this.displayedRowStart * this.barsPerRow - 1);
        const lastBar = (this.displayedRowStart + this.visibleRows) * this.barsPerRow;

        const flat = [];
        for (let b = firstBar; b <= lastBar; b++) {
            this.getBar(b).chords.forEach((chord, c) => flat.push({ chord, key: `${b}:${c}` }));
        }

        const elFor = (key) => this.rowsContainer.querySelector(`.chord[data-key="${key}"]`);
        const perRow = new Map(rowEls.map(rowEl => [rowEl, []]));

        for (const mark of Analysis.annotate(flat.map(f => f.chord))) {
            const fromEl = elFor(flat[mark.from].key);
            const toEl = elFor(flat[mark.to].key);
            const fromRow = fromEl?.closest('.row');
            const toRow = toEl?.closest('.row');

            if (fromRow && fromRow === toRow) {
                perRow.get(fromRow).push({ type: mark.type, fromEl, toEl });
            } else {
                // Spans a line break: draw an open-ended half on each side
                if (fromRow) perRow.get(fromRow).push({ type: mark.type, fromEl, toEl: null });
                if (toRow) perRow.get(toRow).push({ type: mark.type, fromEl: null, toEl });
            }
        }

        for (const [rowEl, marks] of perRow) Analysis.draw(rowEl, marks);
    }

    // ── Listening ───────────────────────────────────────────────────────────

    setListenMode(mode) {
        if (mode === this.listenMode) return;
        if (mode === 'wait') this.pause();

        clearTimeout(this.waitTimer);
        this.waitTimer = null;
        this.listenMode = mode;
        this.windows = [];
        this.freshAttack = false;

        this.listenButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.listen === mode));
        this.playBtn.textContent = mode === 'wait' ? 'Skip' : 'Play';

        if (mode !== 'off') {
            audioCore.ensure();
            this.input.connect();
            if (this.bass.enabled) this.bass.setStyle(this.bass.style);
        } else {
            this.keyboard.clearLatched();
        }

        this.updateKeyboardVisibility();
        this.updateHighlights();
        this.updateKeyboard();
        this.updateScore();
    }

    renderMidiStatus({ state, text }) {
        this.midiStatus.textContent = text;
        this.midiStatus.dataset.state = state;
    }

    handleInput(event) {
        if (event.type === 'on') {
            this.keys.noteOn(event.midi, event.velocity);
            this.freshAttack = true;
            // Judged once, as struck. Re-judging held notes whenever the sheet
            // moves would turn the 7th of E7 red the moment it resolves to A.
            this.verdicts.set(event.midi, this.judgeNote(event.midi));
        } else {
            this.keys.noteOff(event.midi);
            this.verdicts.delete(event.midi);
        }

        this.updateKeyboard();

        if (this.listenMode === 'time') this.checkWindows();
        else if (this.listenMode === 'wait') this.checkWait();
    }

    /**
     * How a note sits against what you could reasonably be playing right now:
     * the current chord – or, in time, a chord whose window is already open
     * for an early push. The kindest reading wins.
     */
    judgeNote(midi) {
        if (this.listenMode === 'off') return null;

        const candidates = [this.getCurrentChord()];
        if (this.listenMode === 'time' && this.isPlaying) {
            const now = this.clock();
            const early = EARLY_BEATS * 60 / this.tempo;
            for (const w of this.windows) {
                if (now >= w.start - early && now < w.end) candidates.push(w.chord);
            }
        }

        const verdicts = candidates.map(chord => Theory.classify(chord, midi));
        return ['chord', 'scale', 'outside'].find(v => verdicts.includes(v));
    }

    setResult(barIndex, chordIndex, result) {
        this.results.set(`${barIndex}:${chordIndex}`, result);
        this.updateHighlights();
        this.updateScore();
    }

    updateScore() {
        const results = [...this.results.values()];
        const hits = results.filter(r => r === 'hit').length;
        this.scoreDisplay.hidden = this.listenMode === 'off' || results.length === 0;
        this.scoreDisplay.textContent = `${hits}/${results.length}`;
    }

    // In-time mode: each chord gets a window on the audio clock; play it at any
    // point inside (or pushed slightly ahead of) that window and it counts.

    openWindow(barIndex, chordIndex, time) {
        if (this.listenMode !== 'time') return;
        const previous = this.windows[this.windows.length - 1];
        if (previous) previous.end = time;

        this.windows.push({
            bar: barIndex,
            chordIndex,
            chord: this.getBar(barIndex).chords[chordIndex],
            start: time,
            end: Infinity,
            result: null
        });
    }

    checkWindows() {
        if (this.listenMode !== 'time' || !this.isPlaying) return;

        const now = this.clock();
        const early = EARLY_BEATS * 60 / this.tempo;
        const held = this.input.notes;

        for (const w of this.windows) {
            if (w.result) continue;
            if (now >= w.end) {
                w.result = 'miss';
                this.setResult(w.bar, w.chordIndex, 'miss');
            } else if (now >= w.start - early && Theory.matches(w.chord, held, this.matchLevel)) {
                w.result = 'hit';
                this.setResult(w.bar, w.chordIndex, 'hit');
            }
        }

        this.windows = this.windows.filter(w => now < w.end);
    }

    // Wait mode: no clock. The sheet moves when you play the chord.

    checkWait() {
        const matching = this.freshAttack &&
            Theory.matches(this.getCurrentChord(), this.input.notes, this.matchLevel);

        if (!matching) {
            clearTimeout(this.waitTimer);
            this.waitTimer = null;
            return;
        }
        if (this.waitTimer) return;

        // Must survive a short hold, so rolling through the notes doesn't count
        this.waitTimer = setTimeout(() => {
            this.waitTimer = null;
            if (this.listenMode !== 'wait') return;
            if (!Theory.matches(this.getCurrentChord(), this.input.notes, this.matchLevel)) return;

            this.setResult(this.currentBarIndex, this.currentChordIndex, 'hit');
            this.advanceChord();
        }, WAIT_HOLD_MS);
    }

    advanceChord() {
        const next = this.chordAfter(this.currentBarIndex, this.currentChordIndex);
        this.freshAttack = false;
        this.keyboard.clearLatched();

        this.currentChordIndex = next.chord;
        this.goToBar(next.bar);

        if (this.bass.enabled) this.bass.playRootNow(this.getCurrentChord());
    }

    // ── On-screen keyboard ──────────────────────────────────────────────────

    updateKeyboardVisibility() {
        const visible = this.listenMode !== 'off' || this.hintMode !== 'none';
        this.keyboardPanel.hidden = !visible;
        this.midiStatus.hidden = this.listenMode === 'off';
    }

    hintsFor(barIndex, chordIndex) {
        if (this.hintMode === 'none') return [];

        const chord = this.getBar(barIndex).chords[chordIndex];
        if (this.hintMode === 'guide') return Theory.guideToneVoicing(chord);

        // Voice-led from whichever voicing was suggested last, then remembered
        const key = `${barIndex}:${chordIndex}`;
        if (!this.hintCache.has(key)) {
            this.lastHint = Theory.rootlessVoicing(chord, this.lastHint);
            this.hintCache.set(key, this.lastHint);
        }
        return this.hintCache.get(key);
    }

    updateKeyboard() {
        if (this.keyboardPanel.hidden) return;

        const hints = this.hintsFor(this.currentBarIndex, this.currentChordIndex);
        const verdicts = this.listenMode === 'off' ? new Map() : this.verdicts;
        this.keyboard.update(this.input.notes, verdicts, hints);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MarkovJazzApp();
});
