/**
 * Markov Jazz Changes - App Controller
 * Handles UI, timing, and lead sheet display with row-based scrolling
 */

/**
 * Metronome class for generating audio clicks
 * Uses Web Audio API to create classy bell-like tones
 */
class Metronome {
    constructor() {
        this.audioContext = null;
        this.enabled = false;
        this.initAudio();
    }

    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not supported', e);
        }
    }

    // Play jazz-style percussion click sounds (hi-hat / stick click vibe)
    playBeat(beatNumber) {
        if (!this.enabled || !this.audioContext) return;

        const now = this.audioContext.currentTime;

        // Create noise source for unpitched percussion
        const bufferSize = this.audioContext.sampleRate * 0.05; // 50ms of noise
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = noiseBuffer.getChannelData(0);

        // Fill with white noise
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;

        // Bandpass filter to shape the click character
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';

        // Gain for envelope
        const gain = this.audioContext.createGain();

        // Connect: noise -> filter -> gain -> output
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioContext.destination);

        // Different characteristics for different beats
        let filterFreq, filterQ, volume, decay;

        if (beatNumber === 1) {
            // Beat 1: Gentle stick click (downbeat accent)
            filterFreq = 2800;
            filterQ = 1.0;
            volume = 0.14;
            decay = 0.05;
        } else if (beatNumber === 3) {
            // Beat 3: Softer click
            filterFreq = 3400;
            filterQ = 0.7;
            volume = 0.05;
            decay = 0.07;
        } else {
            // Beats 2 & 4: Subtle brushy hi-hat (jazz backbeat)
            filterFreq = 5000;
            filterQ = 0.5;
            volume = 0.01;
            decay = 0.08;
        }

        filter.frequency.setValueAtTime(filterFreq, now);
        filter.Q.setValueAtTime(filterQ, now);

        // Softer attack, longer decay (more subtle envelope)
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(volume, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        // Play
        noise.start(now);
        noise.stop(now + 0.05);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        // Resume audio context if user interaction has happened
        if (enabled && this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    toggle() {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }
}

class MarkovJazzApp {
    constructor() {
        this.engine = new MarkovJazzEngine();
        this.metronome = new Metronome();
        this.isPlaying = false;
        this.tempo = 120;
        this.currentBeat = 0;

        // Row-based tracking (responsive)
        this.barsPerRow = this.getResponsiveBarsPerRow();
        this.visibleRows = this.getVisibleRows();
        this.currentBarIndex = 0;  // Global bar index (0-based)
        this.rows = [];            // Array of row data
        this.displayedRowStart = 0; // Which row index is at the top of display

        this.intervalId = null;

        this.initUI();
        this.initRows();
        this.render();

        // Re-layout on resize (with debounce)
        this._resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.handleResize(), 250);
        });
    }

    getResponsiveBarsPerRow() {
        return window.innerWidth <= 600 ? 2 : 4;
    }

    getVisibleRows() {
        return window.innerWidth <= 600 ? 3 : 3;
    }

    handleResize() {
        const newBarsPerRow = this.getResponsiveBarsPerRow();
        const newVisibleRows = this.getVisibleRows();

        if (newBarsPerRow !== this.barsPerRow) {
            // Bars per row changed — need to rebuild row layout
            // Collect all generated bars from existing rows
            const allBars = [];
            for (const row of this.rows) {
                allBars.push(...row.bars);
            }

            this.barsPerRow = newBarsPerRow;
            this.visibleRows = newVisibleRows;

            // Redistribute bars into new row sizes
            this.rows = [];
            for (let i = 0; i < allBars.length; i += this.barsPerRow) {
                this.rows.push({ bars: allBars.slice(i, i + this.barsPerRow) });
            }

            // Pad last row if incomplete
            const lastRow = this.rows[this.rows.length - 1];
            while (lastRow && lastRow.bars.length < this.barsPerRow) {
                lastRow.bars.push(this.engine.generateBar());
            }

            // Recalculate display position
            this.displayedRowStart = Math.floor(this.currentBarIndex / this.barsPerRow);

            // Ensure we have enough rows ahead
            while (this.rows.length < this.displayedRowStart + this.visibleRows) {
                this.rows.push(this.generateRow());
            }

            this.rowsContainer.style.transform = 'translateY(0)';
            this.render();
        } else if (newVisibleRows !== this.visibleRows) {
            this.visibleRows = newVisibleRows;
            this.render();
        }
    }

    initUI() {
        // Transport controls
        this.playBtn = document.getElementById('play-btn');
        this.resetBtn = document.getElementById('reset-btn');

        this.playBtn.addEventListener('click', () => this.togglePlay());
        this.resetBtn.addEventListener('click', () => this.reset());

        // Tempo control
        this.tempoSlider = document.getElementById('tempo');
        this.tempoValue = document.getElementById('tempo-value');

        this.tempoSlider.addEventListener('input', (e) => {
            this.tempo = parseInt(e.target.value);
            this.tempoValue.textContent = this.tempo;
            if (this.isPlaying) {
                this.stopTimer();
                this.startTimer();
            }
        });

        // Settings panel
        this.settingsToggle = document.getElementById('settings-toggle');
        this.settingsPanel = document.getElementById('settings-panel');

        this.settingsToggle.addEventListener('click', () => {
            this.settingsPanel.classList.toggle('open');
        });

        // Setting sliders
        this.keyStabilitySlider = document.getElementById('key-stability');
        this.adventurenessSlider = document.getElementById('adventurousness');
        this.complexitySlider = document.getElementById('complexity');

        this.keyStabilitySlider.addEventListener('input', (e) => {
            this.engine.updateSettings({ keyStability: parseInt(e.target.value) / 100 });
        });

        this.adventurenessSlider.addEventListener('input', (e) => {
            this.engine.updateSettings({ adventurousness: parseInt(e.target.value) / 100 });
        });

        this.complexitySlider.addEventListener('input', (e) => {
            this.engine.updateSettings({ complexity: parseInt(e.target.value) / 100 });
        });

        // Two-chord probability slider
        this.twoChordSlider = document.getElementById('two-chord');
        this.twoChordSlider.addEventListener('input', (e) => {
            this.engine.updateSettings({ twoChordProbability: parseInt(e.target.value) / 100 });
        });

        // Key display
        this.keyDisplay = document.getElementById('current-key');

        // Lead sheet containers
        this.leadSheet = document.getElementById('lead-sheet');
        this.rowsContainer = document.getElementById('rows-container');

        // Beat indicators
        this.beatIndicators = document.querySelectorAll('.beat');

        // Metronome toggle
        this.metronomeBtn = document.getElementById('metronome-btn');
        if (this.metronomeBtn) {
            this.metronomeBtn.addEventListener('click', () => {
                const enabled = this.metronome.toggle();
                this.metronomeBtn.classList.toggle('active', enabled);
                this.metronomeBtn.textContent = enabled ? '🔔 On' : '🔕 Off';
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlay();
            } else if (e.code === 'KeyR') {
                this.reset();
            } else if (e.code === 'ArrowRight' && !this.isPlaying) {
                this.advanceBar();
            }
        });
    }

    initRows() {
        this.rows = [];
        this.currentBarIndex = 0;
        this.displayedRowStart = 0;

        // Generate initial rows based on visible count
        for (let i = 0; i < this.visibleRows; i++) {
            this.rows.push(this.generateRow());
        }
    }

    generateRow() {
        const bars = [];
        for (let i = 0; i < this.barsPerRow; i++) {
            bars.push(this.engine.generateBar());
        }
        return { bars };
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        this.isPlaying = true;
        this.playBtn.textContent = 'Pause';
        this.startTimer();
    }

    pause() {
        this.isPlaying = false;
        this.playBtn.textContent = 'Play';
        this.stopTimer();
    }

    startTimer() {
        const beatInterval = (60 / this.tempo) * 1000;

        this.intervalId = setInterval(() => {
            this.tick();
        }, beatInterval);
    }

    stopTimer() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    tick() {
        this.currentBeat++;

        // Advance AFTER beat 4 completes (when we'd hit beat 5)
        if (this.currentBeat > 4) {
            this.currentBeat = 1;
            this.advanceBar();
        }

        // Play metronome sound for current beat
        this.metronome.playBeat(this.currentBeat);

        this.updateBeatIndicator();
    }

    updateBeatIndicator() {
        this.beatIndicators.forEach((el, index) => {
            el.classList.toggle('active', index < this.currentBeat);
        });
    }

    updateCurrentBarHighlight() {
        // Update highlight without full re-render (for smooth transitions)
        const allBars = this.rowsContainer.querySelectorAll('.bar');
        const currentRow = Math.floor(this.currentBarIndex / this.barsPerRow);

        allBars.forEach((barEl) => {
            const barNum = parseInt(barEl.querySelector('.bar-number')?.textContent);
            if (!barNum) return;

            const globalIdx = barNum - 1; // bar numbers are 1-indexed
            const barRow = Math.floor(globalIdx / this.barsPerRow);

            barEl.classList.remove('current', 'played');

            if (globalIdx === this.currentBarIndex) {
                barEl.classList.add('current');
            } else if (barRow === currentRow && globalIdx < this.currentBarIndex) {
                barEl.classList.add('played');
            }
        });

        // Update key display
        const currentBar = this.getCurrentBar();
        if (currentBar) {
            this.keyDisplay.textContent = `${currentBar.key.root} ${currentBar.key.mode}`;
        }
    }

    advanceBar() {
        this.currentBarIndex++;

        const currentRow = Math.floor(this.currentBarIndex / this.barsPerRow);
        const positionInRow = this.currentBarIndex % this.barsPerRow;

        // When we move to a new row (position 0 of next row)
        if (positionInRow === 0 && currentRow > this.displayedRowStart) {
            this.scrollToNextRow();
        } else {
            this.render();
        }
    }

    scrollToNextRow() {
        // Update the highlight immediately (before animation)
        this.updateCurrentBarHighlight();

        // Add fading class to top row
        const rowElements = this.rowsContainer.querySelectorAll('.row');
        if (rowElements[0]) {
            rowElements[0].classList.add('fading');
        }

        // Animate container up
        const rowHeight = rowElements[0]?.offsetHeight || 100;
        const gap = window.innerWidth <= 600 ? 8 : 12; // matches CSS gap
        this.rowsContainer.style.transform = `translateY(-${rowHeight + gap}px)`;

        // After animation completes
        setTimeout(() => {
            this.displayedRowStart++;

            // Generate new row if needed
            while (this.rows.length < this.displayedRowStart + this.visibleRows) {
                this.rows.push(this.generateRow());
            }

            // Reset transform and re-render
            this.rowsContainer.style.transition = 'none';
            this.rowsContainer.style.transform = 'translateY(0)';

            // Force reflow
            this.rowsContainer.offsetHeight;

            this.rowsContainer.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';

            this.render(true); // Pass flag to indicate new row added
        }, 600);
    }

    reset() {
        this.pause();
        this.currentBeat = 0;
        this.engine.reset();
        this.barsPerRow = this.getResponsiveBarsPerRow();
        this.visibleRows = this.getVisibleRows();
        this.rowsContainer.style.transform = 'translateY(0)';
        this.initRows();
        this.render();
        this.updateBeatIndicator();
    }

    render(newRowAdded = false) {
        this.rowsContainer.innerHTML = '';

        const currentRow = Math.floor(this.currentBarIndex / this.barsPerRow);
        const positionInRow = this.currentBarIndex % this.barsPerRow;

        // Update key display based on current bar
        const currentBar = this.getCurrentBar();
        if (currentBar) {
            this.keyDisplay.textContent = `${currentBar.key.root} ${currentBar.key.mode}`;
        }

        // Display rows starting from displayedRowStart
        const rowsToShow = this.displayedRowStart + this.visibleRows;
        for (let rowIdx = this.displayedRowStart; rowIdx < rowsToShow; rowIdx++) {
            if (rowIdx >= this.rows.length) break;

            const rowData = this.rows[rowIdx];
            const rowEl = document.createElement('div');
            rowEl.className = 'row';

            // Mark upcoming rows
            if (rowIdx > currentRow) {
                rowEl.classList.add('upcoming');

                // Add entering animation to the newest row
                if (newRowAdded && rowIdx === rowsToShow - 1) {
                    rowEl.classList.add('entering');
                }
            }

            // Render each bar in the row
            rowData.bars.forEach((bar, barIdx) => {
                const globalBarIdx = rowIdx * this.barsPerRow + barIdx;
                const barEl = this.createBarElement(bar, globalBarIdx);
                rowEl.appendChild(barEl);
            });

            this.rowsContainer.appendChild(rowEl);
        }
    }

    getCurrentBar() {
        const rowIdx = Math.floor(this.currentBarIndex / this.barsPerRow);
        const posIdx = this.currentBarIndex % this.barsPerRow;

        if (this.rows[rowIdx] && this.rows[rowIdx].bars[posIdx]) {
            return this.rows[rowIdx].bars[posIdx];
        }
        return null;
    }

    createBarElement(bar, globalBarIdx) {
        const currentRow = Math.floor(this.currentBarIndex / this.barsPerRow);
        const barRow = Math.floor(globalBarIdx / this.barsPerRow);

        const barEl = document.createElement('div');
        barEl.className = 'bar';

        // Current bar
        if (globalBarIdx === this.currentBarIndex) {
            barEl.classList.add('current');
        }
        // Played bars in current row
        else if (barRow === currentRow && globalBarIdx < this.currentBarIndex) {
            barEl.classList.add('played');
        }

        // Bar number
        const barNumEl = document.createElement('div');
        barNumEl.className = 'bar-number';
        barNumEl.textContent = bar.barNumber;
        barEl.appendChild(barNumEl);

        // Key change badge
        if (bar.keyChanged) {
            const keyBadge = document.createElement('div');
            keyBadge.className = 'key-change-badge';
            keyBadge.textContent = 'new key';
            barEl.appendChild(keyBadge);
        }

        if (bar.chords.length === 2) {
            barEl.classList.add('two-chords');

            bar.chords.forEach((chord, idx) => {
                barEl.appendChild(this.createChordElement(chord));
                if (idx === 0) {
                    const divider = document.createElement('div');
                    divider.className = 'divider';
                    barEl.appendChild(divider);
                }
            });
        } else {
            const chord = bar.chords[0];
            barEl.appendChild(this.createChordElement(chord));

            // Show degree hint
            const degreeEl = document.createElement('div');
            degreeEl.className = 'degree-hint';
            degreeEl.textContent = chord.degree;
            barEl.appendChild(degreeEl);
        }

        return barEl;
    }

    createChordElement(chord) {
        const chordEl = document.createElement('div');
        chordEl.className = 'chord';

        const rootEl = document.createElement('span');
        rootEl.className = 'root';
        rootEl.textContent = chord.fullName.root;

        const qualityEl = document.createElement('span');
        qualityEl.className = 'quality';
        qualityEl.textContent = chord.fullName.quality;

        chordEl.appendChild(rootEl);
        chordEl.appendChild(qualityEl);

        return chordEl;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MarkovJazzApp();
});
