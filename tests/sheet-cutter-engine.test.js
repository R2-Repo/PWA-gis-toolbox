import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    ROTATION_MODES,
    calculateSheetRotation,
    createMatchlines,
    createSheetFramesAlongRoute,
    createSheetIndexRows,
    createSheetLabelPoints,
    createSheetStations,
    formatSheetName,
    formatStation,
    normalizeCenterlineGeometry,
    runSheetCutter,
    validateSheetCutterInput
} from '../js/widgets/sheet-cutter/engine.js';

globalThis.turf = turf;

function makeRoute(lengthFt = 2500) {
    const endLng = -111.9 + (lengthFt / 364000);
    return turf.lineString([
        [-111.9, 40.75],
        [endLng, 40.75]
    ]);
}

function baseInput(overrides = {}) {
    const route = makeRoute(2500);
    return {
        centerlineFeatures: [route],
        options: {
            units: 'feet',
            routeNameField: null,
            useSelectedOnly: true,
            reverseRoute: false,
            startStation: 0,
            sheet: {
                preset: 'ARCH_D_LANDSCAPE',
                orientation: 'landscape',
                usableFrameWidth: 800,
                usableFrameHeight: 400,
                scale: '1in=100ft',
                overlap: 100,
                corridorWidth: 300
            },
            rotation: {
                mode: ROTATION_MODES.FOLLOW_CENTERLINE
            },
            numbering: {
                prefix: 'C-',
                startNumber: 101,
                increment: 1,
                padLength: 0
            },
            matchlines: {
                enabled: true,
                aheadTemplate: 'MATCHLINE - SEE SHEET {nextSheet}',
                backTemplate: 'MATCHLINE - SEE SHEET {previousSheet}'
            }
        },
        ...overrides
    };
}

describe('sheet cutter engine', () => {
    it('validates required input', () => {
        const result = validateSheetCutterInput({ centerlineFeatures: [], options: {} });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects missing centerline', () => {
        const result = runSheetCutter({ centerlineFeatures: [], options: baseInput().options });
        expect(result.ok).toBe(false);
        expect(result.errors.join(' ')).toMatch(/centerline/i);
    });

    it('rejects non-line geometry', () => {
        const point = turf.point([-111.9, 40.75]);
        const result = runSheetCutter({
            centerlineFeatures: [point],
            options: baseInput().options
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join(' ')).toMatch(/LineString/i);
    });

    it('creates one sheet for a route shorter than sheet length', () => {
        const shortRoute = makeRoute(300);
        const result = runSheetCutter({
            centerlineFeatures: [shortRoute],
            options: baseInput().options
        });
        expect(result.ok).toBe(true);
        expect(result.sheetExtentFeatures).toHaveLength(1);
        expect(result.warnings.some((entry) => /shorter than one sheet/i.test(entry))).toBe(true);
    });

    it('creates correct number of sheets for a known route length', () => {
        const route = makeRoute(2500);
        const routeLength = turf.length(route, { units: 'feet' });
        const sheetLength = 800;
        const overlap = 100;
        const expected = createSheetStations(routeLength, sheetLength, overlap).length;

        const result = runSheetCutter({
            centerlineFeatures: [route],
            options: baseInput().options
        });

        expect(result.ok).toBe(true);
        expect(result.sheetExtentFeatures).toHaveLength(expected);
    });

    it('applies overlap correctly', () => {
        const stations = createSheetStations(2500, 800, 100);
        expect(stations.length).toBeGreaterThan(1);
        expect(stations[1].stationStart).toBe(700);
        expect(stations[0].stationEnd - stations[1].stationStart).toBe(100);
    });

    it('generates stable sheet numbers', () => {
        const result = runSheetCutter(baseInput());
        expect(result.ok).toBe(true);
        expect(result.sheetExtentFeatures[0].properties.sheet_name).toBe('C-101');
        expect(result.sheetExtentFeatures[1].properties.sheet_name).toBe('C-102');
    });

    it('generates previous/next sheet references', () => {
        const result = runSheetCutter(baseInput());
        const first = result.sheetExtentFeatures[0].properties;
        const second = result.sheetExtentFeatures[1].properties;
        expect(first.previous_sheet).toBeNull();
        expect(first.next_sheet).toBe('C-102');
        expect(second.previous_sheet).toBe('C-101');
    });

    it('creates no back matchline on first sheet', () => {
        const result = runSheetCutter(baseInput());
        const firstSheetId = result.sheetExtentFeatures[0].properties.sheet_id;
        const firstMatchlines = result.matchlineFeatures.filter(
            (feature) => feature.properties.sheet_id === firstSheetId
        );
        expect(firstMatchlines.some((feature) => feature.properties.match_type === 'back')).toBe(false);
        expect(firstMatchlines.some((feature) => feature.properties.match_type === 'ahead')).toBe(true);
    });

    it('creates no ahead matchline on last sheet', () => {
        const result = runSheetCutter(baseInput());
        const last = result.sheetExtentFeatures[result.sheetExtentFeatures.length - 1];
        const lastMatchlines = result.matchlineFeatures.filter(
            (feature) => feature.properties.sheet_id === last.properties.sheet_id
        );
        expect(lastMatchlines.some((feature) => feature.properties.match_type === 'ahead')).toBe(false);
        expect(lastMatchlines.some((feature) => feature.properties.match_type === 'back')).toBe(true);
    });

    it('creates correct middle sheet matchlines', () => {
        const result = runSheetCutter(baseInput());
        if (result.sheetExtentFeatures.length < 3) return;

        const middle = result.sheetExtentFeatures[1].properties.sheet_id;
        const middleMatchlines = result.matchlineFeatures.filter(
            (feature) => feature.properties.sheet_id === middle
        );
        expect(middleMatchlines).toHaveLength(2);
        expect(middleMatchlines.map((feature) => feature.properties.match_type).sort()).toEqual(['ahead', 'back']);
    });

    it('handles reverse route direction', () => {
        const forward = runSheetCutter(baseInput());
        const reversed = runSheetCutter(baseInput({
            options: {
                ...baseInput().options,
                reverseRoute: true
            }
        }));

        expect(forward.ok).toBe(true);
        expect(reversed.ok).toBe(true);

        const forwardCenter = forward.sheetLabelFeatures[0].geometry.coordinates;
        const reversedCenter = reversed.sheetLabelFeatures[0].geometry.coordinates;
        const distanceFt = turf.distance(turf.point(forwardCenter), turf.point(reversedCenter), { units: 'feet' });
        expect(distanceFt).toBeGreaterThan(1000);
    });

    it('handles north-up rotation', () => {
        const route = makeRoute(1200);
        const stations = createSheetStations(turf.length(route, { units: 'feet' }), 800, 100);
        const frames = createSheetFramesAlongRoute(route, stations, {
            frameWidthFt: 800,
            frameHeightFt: 400,
            rotationMode: ROTATION_MODES.NORTH_UP,
            scaleLabel: '1:100',
            numbering: { prefix: 'C-', startNumber: 1, increment: 1 }
        });
        expect(frames.every((frame) => frame.rotation_deg === 0)).toBe(true);
    });

    it('handles follow-centerline rotation', () => {
        const route = makeRoute(1200);
        const rotation = calculateSheetRotation(route, 0, 800, ROTATION_MODES.FOLLOW_CENTERLINE);
        expect(Number.isFinite(rotation)).toBe(true);
    });

    it('handles LineString', () => {
        const line = turf.lineString([[-111.9, 40.75], [-111.89, 40.75]]);
        const normalized = normalizeCenterlineGeometry([line]);
        expect(normalized.route?.geometry?.type).toBe('LineString');
    });

    it('handles MultiLineString where possible', () => {
        const multi = turf.multiLineString([
            [[-111.9, 40.75], [-111.895, 40.75]],
            [[-111.895, 40.75], [-111.89, 40.75]]
        ]);
        const normalized = normalizeCenterlineGeometry([multi]);
        expect(normalized.route?.geometry?.type).toBe('LineString');
        expect(normalized.warnings.length).toBeGreaterThan(0);
    });

    it('returns warnings for disconnected multipart route', () => {
        const partA = turf.lineString([[-111.9, 40.75], [-111.895, 40.75]]);
        const partB = turf.lineString([[-111.80, 40.75], [-111.79, 40.75]]);
        const normalized = normalizeCenterlineGeometry([partA, partB]);
        expect(normalized.warnings.some((entry) => /disconnected|multipart/i.test(entry))).toBe(true);
    });

    it('creates sheet label points', () => {
        const result = runSheetCutter(baseInput());
        expect(result.sheetLabelFeatures.length).toBe(result.sheetExtentFeatures.length);
        expect(result.sheetLabelFeatures[0].geometry.type).toBe('Point');
    });

    it('creates sheet index rows', () => {
        const result = runSheetCutter(baseInput());
        expect(result.sheetIndexRows.length).toBe(result.sheetExtentFeatures.length);
        expect(result.sheetIndexRows[0]).toMatchObject({
            sheet_name: 'C-101',
            sequence: 1
        });
    });

    it('prevents overlap greater than or equal to sheet length', () => {
        const validation = validateSheetCutterInput(baseInput({
            options: {
                ...baseInput().options,
                sheet: {
                    ...baseInput().options.sheet,
                    overlap: 800
                }
            }
        }));
        expect(validation.valid).toBe(false);
        expect(validation.errors.join(' ')).toMatch(/overlap/i);
    });

    it('formats station labels and sheet names', () => {
        expect(formatStation(817.15)).toBe('8+17.15');
        expect(formatSheetName('C-', 101)).toBe('C-101');
    });

    it('creates matchline labels with templates', () => {
        const route = makeRoute(2500);
        const result = runSheetCutter(baseInput());
        const ahead = result.matchlineFeatures.find((feature) => feature.properties.match_type === 'ahead');
        expect(ahead?.properties.label).toContain('C-102');
    });

    it('creates sheet label and index helpers independently', () => {
        const route = makeRoute(1800);
        const stations = createSheetStations(turf.length(route, { units: 'feet' }), 800, 100);
        const frames = createSheetFramesAlongRoute(route, stations, {
            frameWidthFt: 800,
            frameHeightFt: 400,
            rotationMode: ROTATION_MODES.FOLLOW_CENTERLINE,
            numbering: { prefix: 'C-', startNumber: 101, increment: 1 }
        });
        const labels = createSheetLabelPoints(frames);
        const indexRows = createSheetIndexRows(frames);
        const matchlines = createMatchlines(frames, route, {
            frameHeightFt: 400,
            matchlines: { enabled: true }
        });
        expect(labels).toHaveLength(frames.length);
        expect(indexRows).toHaveLength(frames.length);
        expect(matchlines.length).toBeGreaterThan(0);
    });
});
