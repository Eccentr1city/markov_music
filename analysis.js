/**
 * Harmonic analysis overlay
 *
 * The usual lead-sheet markings, worked out from roots and qualities alone
 * (so secondary and modulating cadences are caught too):
 *
 *   bracket        ii–V        minor/half-dim chord up a 4th to a dominant
 *   solid arrow    V → I       dominant resolving down a 5th
 *   dashed arrow   subV → I    dominant resolving down a half-step
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const Analysis = {
    /**
     * @param {Array} chords  flat list of chord objects (rootPc, family)
     * @returns {Array} [{ type, from, to }] with indices into `chords`
     */
    annotate(chords) {
        const marks = [];

        for (let i = 0; i < chords.length - 1; i++) {
            const a = chords[i];
            const b = chords[i + 1];
            const motion = (b.rootPc - a.rootPc + 12) % 12;

            if ((a.family === 'min' || a.family === 'hdim') && b.family === 'dom' && motion === 5) {
                marks.push({ type: 'bracket', from: i, to: i + 1 });
            }

            if (a.family === 'dom' && motion === 5) {
                marks.push({ type: 'arrow', from: i, to: i + 1 });
            } else if (a.family === 'dom' && motion === 11) {
                marks.push({ type: 'dashed', from: i, to: i + 1 });
            }
        }

        return marks;
    },

    /**
     * Draw marks into one row.
     * @param {HTMLElement} rowEl
     * @param {Array} marks  [{ type, fromEl, toEl }] – either element may be
     *                       null when that end of the mark is on another row
     */
    draw(rowEl, marks) {
        rowEl.querySelector('svg.analysis')?.remove();
        if (!marks.length) return;

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.classList.add('analysis');
        const row = rowEl.getBoundingClientRect();

        const box = (el) => {
            const chord = el.getBoundingClientRect();
            const bar = el.closest('.bar').getBoundingClientRect();
            return {
                left: chord.left - row.left,
                right: chord.right - row.left,
                centre: (chord.left + chord.right) / 2 - row.left,
                top: chord.top - row.top,
                barBottom: bar.bottom - row.top
            };
        };

        const path = (d, className) => {
            const el = document.createElementNS(SVG_NS, 'path');
            el.setAttribute('d', d);
            el.setAttribute('class', className);
            svg.appendChild(el);
        };

        for (const { type, fromEl, toEl } of marks) {
            const a = fromEl ? box(fromEl) : null;
            const b = toEl ? box(toEl) : null;

            if (type === 'bracket') {
                const y = (a || b).barBottom - 9;
                const tick = 5;
                const x1 = a ? a.centre : -4;
                const x2 = b ? b.centre : row.width + 4;
                path(
                    (a ? `M ${x1} ${y - tick} L ${x1} ${y} ` : `M ${x1} ${y} `) +
                    `L ${x2} ${y}` + (b ? ` L ${x2} ${y - tick}` : ''),
                    'mark bracket'
                );
                continue;
            }

            // Arrows arc from the top-right of one symbol to the top-left of the next
            const y = (a || b).top + 8;
            const x1 = a ? a.right + 4 : -4;
            const x2 = b ? b.left - 5 : row.width + 4;
            const lift = Math.min(18, 8 + (x2 - x1) * 0.12);
            const cx = (x1 + x2) / 2;
            const cy = y - lift;
            const dashed = type === 'dashed' ? ' dashed' : '';
            path(`M ${x1} ${y} Q ${cx} ${cy} ${x2} ${y}`, `mark arrow${dashed}`);

            if (b) {
                // Arrowhead along the curve's final tangent
                const angle = Math.atan2(y - cy, x2 - cx);
                const size = 5;
                const wing = (offset) => {
                    const t = angle + Math.PI + offset;
                    return `${x2 + size * Math.cos(t)} ${y + size * Math.sin(t)}`;
                };
                path(`M ${wing(0.45)} L ${x2} ${y} L ${wing(-0.45)}`, 'mark arrow');
            }
        }

        rowEl.appendChild(svg);
    }
};

window.Analysis = Analysis;
