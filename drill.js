/**
 * Drill - one chord type (or a few), random roots, any voicing
 *
 * A chord symbol appears; you play it however you like; it counts when the
 * required tones are down with nothing outside. Every attempt is logged raw,
 * and roots you find hard come back more often.
 *
 * How history is used (deliberately conservative):
 *   - It never crosses chord types: a bad C-7 says nothing about C13.
 *   - Within a type it is only a weak, fading prior. Each session opens with
 *     one pass through every root, and today's evidence outweighs the past
 *     after a few attempts.
 *   - The log keeps everything (including the exact notes played), so the
 *     policy can change later without losing data.
 */

const DRILL_LOG_KEY = 'markov-jazz-drill-log';
const DRILL_SETTINGS_KEY = 'markov-jazz-drill-settings';
const DRILL_LOG_LIMIT = 6000;

const DRILL_HOLD_MS = 120;           // same hold as wait mode
const DRILL_BAD_FACTOR = 2.5;        // a wrong note outweighs any normal-speed clean attempt
const DRILL_AWAY_MS = 15000;         // longer than this (and 5x your median) = you stepped away
const DRILL_DEFAULT_MS = 2500;       // stand-in median before there's any data
const DRILL_HISTORY_HALF_LIFE_DAYS = 14;
const DRILL_HISTORY_MAX_WEIGHT = 1.5; // history counts as at most this many attempts
const DRILL_HEATMAP_DAYS = 60;

const DRILL_GROUPS = [
    { label: 'Major', types: ['maj7', 'maj9', '6', '69', 'maj7#11'] },
    { label: 'Dominant', types: ['7', '9', '13', '7#11', 'sus4', '7b9', '7#9', '7alt'] },
    { label: 'Minor', types: ['m7', 'm9', 'm11', 'm6', 'm69'] },
    { label: 'Diminished', types: ['m7b5', 'dim7'] },
];

// How each root is usually written for a chord of that family. Where charts
// genuinely use both, either may come up.
const DRILL_ROOT_NAMES = {
    flat:  ['C', 'Db', 'D', 'Eb', 'E', 'F', ['F#', 'Gb'], 'G', 'Ab', 'A', 'Bb', 'B'],
    sharp: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', ['G#', 'Ab'], 'A', 'Bb', 'B'],
};
const DRILL_COLUMN_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// ─── Scoring (pure functions over log entries) ──────────────────────────────
// Entry: { t, s, q, r, ms, c, k, h, w, a, n }
//   t time · s session · q chord type · r root pitch class · ms time to correct
//   c clean · k skipped · h hint used · w warm-up · a away · n notes played

const DrillStats = {
    counted(entry) {
        return !entry.w && !entry.a;
    },

    isBad(entry) {
        return !entry.c || !!entry.h || !!entry.k;
    },

    /** Typical clean time for a set of attempts (one session, one chord type). */
    baseline(entries) {
        const clean = entries.filter(e => !this.isBad(e)).map(e => e.ms);
        const all = entries.filter(e => !e.k).map(e => e.ms);
        return median(clean) ?? median(all) ?? DRILL_DEFAULT_MS;
    },

    /**
     * How hard one attempt was, relative to `baseline`. 1 = typical.
     * Correctness dominates: a wrong note, a hint or a skip costs at least
     * 2.5x typical, however fast it was. Among clean attempts, faster is better.
     */
    cost(entry, baseline) {
        if (!this.isBad(entry)) return entry.ms / baseline;
        const ms = entry.k ? baseline : Math.max(entry.ms, baseline);
        return DRILL_BAD_FACTOR * ms / baseline;
    },

    /** Per-root difficulty within one session: root → { n, rel } (recent attempts weigh more). */
    sessionScores(entries) {
        const counted = entries.filter(e => this.counted(e));
        const baseline = this.baseline(counted);
        const scores = new Map();
        for (const entry of counted) {
            const cost = this.cost(entry, baseline);
            const previous = scores.get(entry.r);
            scores.set(entry.r, previous
                ? { n: previous.n + 1, rel: previous.rel * 0.5 + cost * 0.5 }
                : { n: 1, rel: cost });
        }
        return scores;
    },

    /**
     * What past sessions say about each root of ONE chord type:
     * root → { rel, strength (0-1) }. Each session is normalised to its own
     * baseline, so a tired day doesn't read as weakness; old sessions fade.
     */
    historyPrior(log, type, excludeSession, now = Date.now()) {
        const sessions = new Map();
        for (const entry of log) {
            if (entry.q !== type || entry.s === excludeSession || !this.counted(entry)) continue;
            if (!sessions.has(entry.s)) sessions.set(entry.s, []);
            sessions.get(entry.s).push(entry);
        }

        const totals = new Map();
        for (const entries of sessions.values()) {
            const baseline = this.baseline(entries);
            for (const entry of entries) {
                const ageDays = (now - entry.t) / 86400000;
                const weight = Math.pow(0.5, ageDays / DRILL_HISTORY_HALF_LIFE_DAYS);
                const total = totals.get(entry.r) || { sum: 0, weight: 0 };
                total.sum += weight * this.cost(entry, baseline);
                total.weight += weight;
                totals.set(entry.r, total);
            }
        }

        const prior = new Map();
        for (const [root, { sum, weight }] of totals) {
            prior.set(root, { rel: sum / weight, strength: Math.min(1, weight / 3) });
        }
        return prior;
    },

    /** Blend today, the past and a neutral guess into a selection weight. */
    weight(session, prior) {
        const n = session ? session.n : 0;
        const past = prior ? DRILL_HISTORY_MAX_WEIGHT * prior.strength : 0;
        const difficulty = (n * (session ? session.rel : 0) + past * (prior ? prior.rel : 0) + 1) / (n + past + 1);
        // Flattened on purpose: a weak root should come up several times as often
        // as a strong one, not every other chord
        return Math.pow(Math.min(3, Math.max(0.6, difficulty)), 1.5);
    }
};

// ─── The drill ──────────────────────────────────────────────────────────────

class DrillMode {
    constructor(app) {
        this.app = app;
        this.active = false;

        this.log = this.loadLog();
        this.types = new Set(['maj7']);
        this.mix = false;            // false: one chord type at a time; true: prompts drawn from several
        this.matchLevel = 'named';
        this.freshStart = false;
        this.loadSettings();

        this.sessionId = null;
        this.firstPass = [];
        this.priors = new Map();     // type → historyPrior
        this.chord = null;
        this.item = null;
        this.lastItem = null;
        this.shownAt = 0;
        this.unclean = false;
        this.hinted = false;
        this.warmup = false;
        this.freshAttack = false;
        this.holdTimer = null;

        this.initUI();
    }

    // ── Storage ─────────────────────────────────────────────────────────────

    loadLog() {
        try {
            const log = JSON.parse(localStorage.getItem(DRILL_LOG_KEY));
            return Array.isArray(log) ? log : [];
        } catch (e) {
            return [];
        }
    }

    saveLog() {
        if (this.log.length > DRILL_LOG_LIMIT) this.log = this.log.slice(-DRILL_LOG_LIMIT);
        try {
            localStorage.setItem(DRILL_LOG_KEY, JSON.stringify(this.log));
        } catch (e) {
            // storage full or unavailable – the session still works
        }
    }

    loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(DRILL_SETTINGS_KEY)) || {};
            const types = (saved.types || []).filter(t => Theory.QUALITIES[t]);
            this.mix = !!saved.mix;
            if (types.length) this.types = new Set(this.mix ? types : types.slice(0, 1));
            if (Theory.MATCH_LEVELS.includes(saved.matchLevel)) this.matchLevel = saved.matchLevel;
        } catch (e) {
            // defaults
        }
    }

    saveSettings() {
        try {
            localStorage.setItem(DRILL_SETTINGS_KEY, JSON.stringify({
                types: [...this.types],
                mix: this.mix,
                matchLevel: this.matchLevel
            }));
        } catch (e) {
            // ignore
        }
    }

    // ── UI ──────────────────────────────────────────────────────────────────

    initUI() {
        const $ = (id) => document.getElementById(id);
        this.typesEl = $('drill-types');
        this.promptEl = $('drill-prompt');
        this.chordEl = $('drill-chord');
        this.needsEl = $('drill-needs');
        this.statusEl = $('drill-status');
        this.heatmapEl = $('drill-heatmap');
        this.progressPanel = $('drill-progress');
        this.tooltipEl = $('drill-tooltip');
        this.captionEl = $('drill-caption');
        this.chips = new Map();

        this.mixToggle = $('drill-mix');
        this.mixToggle.checked = this.mix;
        this.mixToggle.addEventListener('change', () => this.setMix(this.mixToggle.checked));

        for (const group of DRILL_GROUPS) {
            const groupEl = document.createElement('div');
            groupEl.className = 'drill-type-group';

            const label = document.createElement('span');
            label.className = 'drill-type-label';
            label.textContent = group.label;
            groupEl.appendChild(label);

            for (const type of group.types) {
                const chip = document.createElement('button');
                chip.className = 'btn toggle chip';
                chip.dataset.type = type;
                this.app.setMusicText(chip, Theory.displayQuality(type));
                chip.addEventListener('click', () => this.chooseType(type));
                groupEl.appendChild(chip);
                this.chips.set(type, chip);
            }
            this.typesEl.appendChild(groupEl);
        }
        this.renderTypes();

        $('drill-skip').addEventListener('click', () => this.skip());
        $('drill-hint').addEventListener('click', () => this.showHint());

        this.matchSelect = $('drill-match');
        this.matchSelect.value = this.matchLevel;
        this.matchSelect.addEventListener('change', () => {
            this.matchLevel = this.matchSelect.value;
            this.saveSettings();
            this.renderPrompt();
        });

        this.freshToggle = $('drill-fresh');
        this.freshToggle.addEventListener('change', () => {
            this.freshStart = this.freshToggle.checked;
        });

        this.progressBtn = $('drill-progress-btn');
        this.progressBtn.addEventListener('click', () => {
            const open = this.progressPanel.hidden;
            this.progressPanel.hidden = !open;
            this.progressBtn.classList.toggle('active', open);
            if (open) this.renderHeatmap();
        });

        $('drill-clear').addEventListener('click', () => {
            if (!confirm('Delete all drill history? This cannot be undone.')) return;
            this.log = [];
            this.saveLog();
            this.priors.clear();
            this.renderHeatmap();
            this.renderStatus();
        });
    }

    /**
     * Each chip is a whole chord type, not an extension to stack. Normally
     * picking one replaces the last; with Mix on, prompts are drawn from all
     * the selected types (one type per prompt – never combined).
     */
    chooseType(type) {
        if (!this.mix) {
            if (this.types.size === 1 && this.types.has(type)) return;
            this.types = new Set([type]);
        } else if (!this.types.has(type)) {
            this.types.add(type);
        } else if (this.types.size > 1) {
            this.types.delete(type);
        } else {
            return; // keep at least one
        }
        this.typesChanged();
    }

    setMix(mix) {
        this.mix = mix;
        if (!mix && this.types.size > 1) {
            // Keep the type on screen, or failing that the first one
            const keep = this.item && this.types.has(this.item.type) ? this.item.type : [...this.types][0];
            this.types = new Set([keep]);
        }
        this.typesChanged();
    }

    typesChanged() {
        this.saveSettings();
        this.renderTypes();
        if (!this.active) return;

        // Anything not yet played this session still gets its turn in the opening pass
        const played = new Set(this.sessionEntries().filter(e => DrillStats.counted(e)).map(e => `${e.q}:${e.r}`));
        this.firstPass = this.shuffle(this.items().filter(i => !played.has(i.id)));
        if (!this.item || !this.types.has(this.item.type)) this.next();
        this.renderStatus();
    }

    renderTypes() {
        for (const [type, chip] of this.chips) {
            const on = this.types.has(type);
            chip.classList.toggle('active', on);
            chip.setAttribute('aria-pressed', String(on));
        }

        const text = this.mix ? '' : 'Enable mix to alternate between multiple varieties';
        this.app.setMusicText(this.captionEl, text);
    }

    // ── Session ─────────────────────────────────────────────────────────────

    enter() {
        this.active = true;
        this.sessionId = Date.now();
        this.priors.clear();
        this.firstPass = this.shuffle(this.items());
        this.lastItem = null;
        this.warmup = true;   // the first prompt isn't timed fairly: you're still sitting down
        this.next();
        this.renderStatus();
        if (!this.progressPanel.hidden) this.renderHeatmap();
    }

    leave() {
        this.active = false;
        clearTimeout(this.holdTimer);
        this.holdTimer = null;
        this.chord = null;
        this.tooltipEl.hidden = true;
    }

    items() {
        const items = [];
        for (const type of this.types) {
            for (let root = 0; root < 12; root++) items.push({ id: `${type}:${root}`, type, root });
        }
        return items;
    }

    sessionEntries(type = null) {
        return this.log.filter(e => e.s === this.sessionId && (!type || e.q === type));
    }

    shuffle(list) {
        const out = [...list];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    // ── Choosing the next chord ─────────────────────────────────────────────

    priorFor(type) {
        if (this.freshStart) return new Map();
        if (!this.priors.has(type)) {
            this.priors.set(type, DrillStats.historyPrior(this.log, type, this.sessionId));
        }
        return this.priors.get(type);
    }

    chooseItem() {
        const last = this.lastItem;
        const differs = (item) => !last || item.root !== last.root;

        // Opening pass: every root once, in random order, never the same root twice running
        if (this.firstPass.length) {
            const index = Math.max(0, this.firstPass.findIndex(differs));
            return this.firstPass.splice(index, 1)[0];
        }

        const items = this.items();
        let pool = items.filter(differs);
        if (!pool.length) pool = items;

        const sessionScores = new Map();
        const weights = pool.map(item => {
            if (!sessionScores.has(item.type)) {
                sessionScores.set(item.type, DrillStats.sessionScores(this.sessionEntries(item.type)));
            }
            return DrillStats.weight(sessionScores.get(item.type).get(item.root), this.priorFor(item.type).get(item.root));
        });

        let pick = Math.random() * weights.reduce((sum, w) => sum + w, 0);
        for (let i = 0; i < pool.length; i++) {
            pick -= weights[i];
            if (pick <= 0) return pool[i];
        }
        return pool[pool.length - 1];
    }

    next() {
        clearTimeout(this.holdTimer);
        this.holdTimer = null;

        if (!this.types.size) {
            this.item = null;
            this.chord = null;
            this.renderPrompt();
            this.app.updateKeyboard();
            return;
        }

        this.item = this.chooseItem();
        this.lastItem = this.item;

        const family = Theory.family(this.item.type);
        const names = DRILL_ROOT_NAMES[family === 'maj' || family === 'dom' ? 'flat' : 'sharp'][this.item.root];
        const root = Array.isArray(names) ? names[Math.floor(Math.random() * names.length)] : names;

        this.chord = {
            root,
            rootPc: this.item.root,
            quality: this.item.type,
            family,
            fullName: { root: Theory.pretty(root), quality: Theory.displayQuality(this.item.type) }
        };
        this.shownAt = performance.now();
        this.unclean = false;
        this.hinted = false;
        this.freshAttack = false;

        this.renderPrompt();
        this.app.keyboard.clearLatched();
        this.app.updateKeyboard();
    }

    // ── Playing ─────────────────────────────────────────────────────────────

    judge(midi) {
        return this.chord ? Theory.classify(this.chord, midi) : null;
    }

    hints() {
        return this.chord && this.hinted ? Theory.rootlessVoicing(this.chord, [57, 60, 64, 67]) : [];
    }

    handleInput(event, verdict) {
        if (!this.chord) return;
        if (event.type === 'on') {
            this.freshAttack = true;
            if (verdict === 'outside') this.unclean = true;
        }
        this.check();
    }

    matches() {
        return Theory.matches(this.chord, this.app.input.notes, this.matchLevel);
    }

    check() {
        if (!(this.freshAttack && this.matches())) {
            clearTimeout(this.holdTimer);
            this.holdTimer = null;
            return;
        }
        if (this.holdTimer) return;

        const landedAt = performance.now();
        this.holdTimer = setTimeout(() => {
            this.holdTimer = null;
            if (!this.active || !this.chord || !this.matches()) return;
            this.complete(landedAt - this.shownAt);
        }, DRILL_HOLD_MS);
    }

    complete(ms) {
        this.record({ ms: Math.round(ms), clean: !this.unclean, skipped: false });
        if (this.app.bass.enabled) this.app.bass.playRootNow(this.chord);

        this.promptEl.classList.remove('landed');
        void this.promptEl.offsetWidth; // restart the flash
        this.promptEl.classList.add('landed');
        this.next();
    }

    skip() {
        if (!this.chord) return;
        this.record({ ms: Math.round(performance.now() - this.shownAt), clean: false, skipped: true });
        this.next();
    }

    showHint() {
        if (!this.chord) return;
        this.hinted = true;
        this.app.updateKeyboard();
    }

    record({ ms, clean, skipped }) {
        const baseline = DrillStats.baseline(this.sessionEntries(this.item.type).filter(e => DrillStats.counted(e)));
        const away = !skipped && ms > Math.max(DRILL_AWAY_MS, 5 * baseline);

        this.log.push({
            t: Date.now(),
            s: this.sessionId,
            q: this.item.type,
            r: this.item.root,
            ms,
            c: clean ? 1 : 0,
            k: skipped ? 1 : 0,
            h: this.hinted ? 1 : 0,
            w: this.warmup ? 1 : 0,
            a: away ? 1 : 0,
            n: [...this.app.input.notes].sort((a, b) => a - b)
        });
        this.saveLog();

        // An attempt that didn't count (warm-up, or you stepped away) gets another go
        if (this.warmup || away) this.firstPass.push(this.item);
        this.warmup = false;

        this.renderStatus();
        if (!this.progressPanel.hidden) this.renderHeatmap();
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    renderPrompt() {
        if (!this.chord) {
            this.chordEl.textContent = '—';
            this.needsEl.textContent = 'Pick a chord type to practise';
            return;
        }

        this.chordEl.textContent = '';
        const root = document.createElement('span');
        root.className = 'root';
        this.app.setMusicText(root, this.chord.fullName.root);
        const quality = document.createElement('span');
        quality.className = 'quality';
        this.app.setMusicText(quality, this.chord.fullName.quality);
        this.chordEl.append(root, quality);

        this.needsEl.textContent = '';
        this.app.setMusicText(this.needsEl, Theory.describeRequirement(this.chord, this.matchLevel));
    }

    renderStatus() {
        const entries = this.sessionEntries().filter(e => DrillStats.counted(e));
        if (!entries.length) {
            this.statusEl.textContent = this.firstPass.length
                ? 'Opening pass: every root once, in random order'
                : '';
            return;
        }

        const clean = entries.filter(e => !DrillStats.isBad(e));
        const typical = median(clean.map(e => e.ms));
        const parts = [
            `${entries.length} played`,
            `${Math.round(100 * clean.length / entries.length)}% clean`
        ];
        if (typical) parts.push(`${(typical / 1000).toFixed(1)}s typical`);
        if (this.firstPass.length) parts.push(`${this.firstPass.length} left in opening pass`);
        this.statusEl.textContent = parts.join(' · ');
    }

    /**
     * Chord types × roots. Colour is difficulty relative to your typical time
     * for that chord type (one hue; brighter = harder); the number is the
     * typical clean time in seconds.
     */
    renderHeatmap() {
        const since = Date.now() - DRILL_HEATMAP_DAYS * 86400000;
        const recent = this.log.filter(e => e.t >= since && DrillStats.counted(e));
        this.heatmapEl.textContent = '';

        const order = DRILL_GROUPS.flatMap(g => g.types);
        const types = order.filter(type => recent.some(e => e.q === type));

        if (!types.length) {
            const empty = document.createElement('p');
            empty.className = 'drill-empty';
            empty.textContent = 'Nothing yet. After a round or two, the roots that slow you down will show up here.';
            this.heatmapEl.appendChild(empty);
            return;
        }

        const table = document.createElement('table');
        table.className = 'heatmap';

        const head = table.createTHead().insertRow();
        head.appendChild(document.createElement('th'));
        for (const name of DRILL_COLUMN_NAMES) {
            const th = document.createElement('th');
            th.scope = 'col';
            this.app.setMusicText(th, Theory.pretty(name));
            head.appendChild(th);
        }

        const body = table.createTBody();
        for (const type of types) {
            const row = body.insertRow();
            const label = document.createElement('th');
            label.scope = 'row';
            this.app.setMusicText(label, Theory.displayQuality(type));
            row.appendChild(label);

            // Normalise each session to itself, as the selection logic does
            const bySession = new Map();
            for (const entry of recent.filter(e => e.q === type)) {
                if (!bySession.has(entry.s)) bySession.set(entry.s, []);
                bySession.get(entry.s).push(entry);
            }
            const cells = Array.from({ length: 12 }, () => ({ costs: [], clean: [], n: 0 }));
            for (const entries of bySession.values()) {
                const baseline = DrillStats.baseline(entries);
                for (const entry of entries) {
                    const cell = cells[entry.r];
                    cell.n++;
                    cell.costs.push(DrillStats.cost(entry, baseline));
                    if (!DrillStats.isBad(entry)) cell.clean.push(entry.ms);
                }
            }

            cells.forEach((cell, root) => {
                const td = row.insertCell();
                if (!cell.n) {
                    td.className = 'empty';
                    return;
                }

                const difficulty = cell.costs.reduce((s, c) => s + c, 0) / cell.costs.length;
                // 0.8x typical → 0, 2.2x typical → 1
                const level = Math.min(1, Math.max(0, (difficulty - 0.8) / 1.4));
                td.style.setProperty('--level', level.toFixed(3));
                td.classList.toggle('bright', level > 0.55);

                const typical = median(cell.clean);
                td.textContent = typical ? (typical / 1000).toFixed(1) : '–';
                td.tabIndex = 0;

                const cleanPct = Math.round(100 * cell.clean.length / cell.n);
                const name = `${Theory.pretty(DRILL_COLUMN_NAMES[root])}${Theory.displayQuality(type)}`;
                const detail = `${cell.n} attempt${cell.n === 1 ? '' : 's'} · ${cleanPct}% clean` +
                    (typical ? ` · ${(typical / 1000).toFixed(1)}s typical` : '') +
                    ` · ${difficulty.toFixed(1)}× your norm`;
                td.setAttribute('aria-label', `${name}: ${detail}`);

                const show = () => this.showTooltip(td, name, detail);
                const hide = () => { this.tooltipEl.hidden = true; };
                td.addEventListener('pointerenter', show);
                td.addEventListener('focus', show);
                td.addEventListener('pointerleave', hide);
                td.addEventListener('blur', hide);
            });
        }

        this.heatmapEl.appendChild(table);
    }

    showTooltip(cell, name, detail) {
        this.tooltipEl.textContent = '';
        const title = document.createElement('strong');
        this.app.setMusicText(title, name);
        const text = document.createElement('span');
        text.textContent = detail;
        this.tooltipEl.append(title, text);
        this.tooltipEl.hidden = false;

        const rect = cell.getBoundingClientRect();
        const tip = this.tooltipEl.getBoundingClientRect();
        const left = Math.min(window.innerWidth - tip.width - 8, Math.max(8, rect.left + rect.width / 2 - tip.width / 2));
        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${Math.max(8, rect.top - tip.height - 8)}px`;
    }
}

if (typeof window !== 'undefined') {
    window.DrillMode = DrillMode;
    window.DrillStats = DrillStats;
}
if (typeof module !== 'undefined') module.exports = { DrillStats };
