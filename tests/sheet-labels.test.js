import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    buildInitialSheetLabelPoint,
    buildSheetLabelCollection,
    formatSheetLabel,
    isLabelPointInsideFrame
} from '../js/widgets/sheet-cutting/sheet-labels.js';

globalThis.turf = turf;

describe('sheet labels', () => {
    const route = turf.lineString([
        [-111.92, 40.75],
        [-111.90, 40.75],
        [-111.88, 40.75]
    ]);

    function buildFrame(sheetNumber, startFt, endFt) {
        const start = turf.along(route, startFt, { units: 'feet' });
        const end = turf.along(route, endFt, { units: 'feet' });
        const leftStart = turf.destination(start, 175, 90, { units: 'feet' });
        const rightStart = turf.destination(start, 175, -90, { units: 'feet' });
        const leftEnd = turf.destination(end, 175, 90, { units: 'feet' });
        const rightEnd = turf.destination(end, 175, -90, { units: 'feet' });
        const ring = [
            leftStart.geometry.coordinates,
            leftEnd.geometry.coordinates,
            rightEnd.geometry.coordinates,
            rightStart.geometry.coordinates,
            leftStart.geometry.coordinates
        ];

        return turf.polygon([ring], {
            sheet_id: `sheet-${sheetNumber}`,
            sheet_number: sheetNumber,
            center_distance_ft: (startFt + endFt) / 2
        });
    }

    it('formats sheet labels with zero padding', () => {
        expect(formatSheetLabel(1)).toBe('Sheet 01');
        expect(formatSheetLabel(12)).toBe('Sheet 12');
        expect(formatSheetLabel(0)).toBe('');
    });

    it('places labels on the route center inside each polygon', () => {
        const frame = buildFrame(1, 0, 1100);
        const label = buildInitialSheetLabelPoint(frame, route);

        expect(label?.properties?.sheet_label).toBe('Sheet 01');
        expect(isLabelPointInsideFrame(label, frame)).toBe(true);
    });

    it('keeps labels inside their frames and separated along the route', () => {
        const frames = turf.featureCollection([
            buildFrame(1, 0, 1100),
            buildFrame(2, 1100, 2200),
            buildFrame(3, 2200, 3300)
        ]);

        const labels = buildSheetLabelCollection(frames, route);
        expect(labels.features).toHaveLength(3);

        for (const label of labels.features) {
            const frame = frames.features.find(
                (entry) => entry.properties.sheet_id === label.properties.sheet_id
            );
            expect(isLabelPointInsideFrame(label, frame)).toBe(true);
        }

        for (let i = 0; i < labels.features.length; i++) {
            for (let j = i + 1; j < labels.features.length; j++) {
                const separation = turf.distance(labels.features[i], labels.features[j], { units: 'feet' });
                expect(separation).toBeGreaterThan(500);
            }
        }
    });
});
