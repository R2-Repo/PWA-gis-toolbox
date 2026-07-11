import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    calculateMapFrameGroundDimensions,
    generateSheetFramesAlongRoute,
    generateMatchLine,
    buildOverviewSheet,
    validateSheetCoverage
} from '../js/widgets/sheet-cutting/engine.js';

globalThis.turf = turf;

describe('sheet cutting engine', () => {
    const routeLine = turf.lineString([
        [-111.9, 40.75],
        [-111.89, 40.75],
        [-111.88, 40.751],
        [-111.87, 40.752]
    ]);

    it('calculates map-frame ground dimensions from paper and scale', () => {
        const dims = calculateMapFrameGroundDimensions({
            paperSize: 'ANSI_D',
            orientation: 'landscape',
            scale: 200
        });
        expect(dims.mapFrameWidthFt).toBeGreaterThan(0);
        expect(dims.mapFrameHeightFt).toBeGreaterThan(0);
    });

    it('generates sequential sheet frames along a route', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200 });
        const sheets = generateSheetFramesAlongRoute({
            routeLine,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            overlapFt: 100
        });
        expect(sheets.length).toBeGreaterThan(0);
        expect(sheets[0].sheetNumber).toBe(1);
        if (sheets.length > 1) {
            expect(sheets[0].nextSheetId).toBe(sheets[1].sheetId);
            expect(sheets[1].previousSheetId).toBe(sheets[0].sheetId);
        }
    });

    it('generates match-line labels', () => {
        const sheet = { sheetId: 's1', endDistanceFt: 1000 };
        const matchLine = generateMatchLine(sheet, 4);
        expect(matchLine.label).toContain('SHEET 04');
    });

    it('builds an overview sheet with sheet boxes', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200 });
        const sheets = generateSheetFramesAlongRoute({
            routeLine,
            mapFrameWidthFt: dims.mapFrameWidthFt
        });
        const overview = buildOverviewSheet(sheets, routeLine);
        expect(overview.sheetType).toBe('overview');
        expect(overview.sheetBoxes.length).toBe(sheets.length);
    });

    it('validates sheet coverage warnings', () => {
        const result = validateSheetCoverage([], []);
        expect(result.valid).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});
