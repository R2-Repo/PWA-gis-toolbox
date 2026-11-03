import { describe, expect, it } from 'vitest';
import { jenksUpperBreaks } from '../js/map/class-breaks.js';
import {
    autoClassifyNatural,
    autoClassifyRange,
    compilePaint,
    editClassBreak
} from '../js/map/style-engine.js';

function features(values) {
    return values.map((value) => ({
        type: 'Feature',
        properties: { amount: value },
        geometry: { type: 'Point', coordinates: [0, 0] }
    }));
}

describe('class breaks', () => {
    it('puts a skewed outlier in its own natural-break class', () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
        const natural = jenksUpperBreaks(values, 3);
        expect(natural.upper).toHaveLength(3);
        expect(natural.upper[natural.upper.length - 1]).toBe(100);
        expect(natural.upper[natural.upper.length - 2]).toBeLessThan(20);

        const equal = autoClassifyRange('amount', features(values), 3, 'ylOrRd', null, 'equal');
        const jenks = autoClassifyNatural('amount', features(values), 3, 'ylOrRd');
        expect(jenks.classes).toHaveLength(3);
        expect(jenks.classes[2].max).toBe(100);
        expect(jenks.classes[1].max).toBeLessThan(equal.classes[1].max);
    });

    it('keeps a manual break edit and a reversed ramp', () => {
        const ranged = autoClassifyRange('amount', features([0, 10, 20, 30, 40]), 2, 'ylOrRd', null, 'equal');
        const variable = { type: 'range', field: 'amount', ramp: 'ylOrRd', ...ranged };
        const edited = editClassBreak(variable, 0, { max: 12 });
        expect(edited.method).toBe('manual');
        expect(edited.classes[0].max).toBe(12);
        expect(edited.classes[1].min).toBe(12);
        expect(edited.classes[0].label).toContain('12.0');

        const named = editClassBreak({
            ...variable,
            classes: variable.classes.map((cls, index) => ({ ...cls, label: index === 0 ? 'Quiet' : cls.label }))
        }, 0, { max: 15 });
        expect(named.classes[0].label).toBe('Quiet');
        expect(named.classes[0].max).toBe(15);

        const paint = compilePaint({
            mode: 'smart',
            fillColor: '#000000',
            strokeColor: '#000000',
            smart: {
                defaultStyle: {},
                filterRules: [],
                visualVariables: [{
                    id: 'ramp',
                    type: 'ramp',
                    field: 'amount',
                    channel: 'fill',
                    ramp: 'ylOrRd',
                    rampReverse: true,
                    min: 0,
                    max: 10
                }]
            }
        }, 'polygon');
        expect(JSON.stringify(paint.fillColor)).toContain('#800026');
    });
});
