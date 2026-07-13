import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SHEET_TEMPLATE,
    DEFAULT_SHEET_LENGTH_FT,
    DEFAULT_CORRIDOR_WIDTH_FT,
    calculateMapFrameGroundDimensions,
    resolveSheetFrameDimensions,
    computePdfPageSizePt,
    generateSheetFramesAlongRoute,
    generateMatchLine,
    generateSheetMatchLines,
    assignFeaturesToSheets,
    buildOverviewSheet,
    validateSheetCoverage,
    validateSheetTiling,
    validateClippedSheetOverlap,
    validateCenterlinePolygonCoverage
} from '../js/widgets/sheet-cutting/engine.js';
import {
    buildClippedSheetPolygon,
    buildPaperFrameRectangle,
    buildSheetFramesGeoJson,
    buildCorridorMatchLineRegistry,
    enforceCapVerticesOnRing,
    stationKey,
    coordsEqual,
    sharedBoundaryEdgesOverlap,
    buildSheetExportPackage
} from '../js/widgets/sheet-cutting/export-builder.js';
import { getLocalTangentBearing } from '../js/widgets/project-stationing/engine.js';

globalThis.turf = turf;

describe('sheet cutting engine', () => {
    const routeLine = turf.lineString([
        [-111.9, 40.75],
        [-111.89, 40.75],
        [-111.88, 40.751],
        [-111.87, 40.752]
    ]);

    it('resolves direct foot dimensions from template', () => {
        const dims = resolveSheetFrameDimensions({
            sheetLengthFt: 1100,
            corridorWidthFt: 350
        });
        expect(dims.mapFrameWidthFt).toBe(1100);
        expect(dims.mapFrameHeightFt).toBe(350);
    });

    it('uses default foot dimensions when template has no legacy scale', () => {
        const dims = resolveSheetFrameDimensions({});
        expect(dims.mapFrameWidthFt).toBe(DEFAULT_SHEET_LENGTH_FT);
        expect(dims.mapFrameHeightFt).toBe(DEFAULT_CORRIDOR_WIDTH_FT);
    });

    it('falls back to scale-based dimensions for legacy sessions', () => {
        const dims = resolveSheetFrameDimensions({
            paperSize: 'TABLOID',
            orientation: 'landscape',
            scale: 200
        });
        expect(dims.mapFrameWidthFt).toBeGreaterThan(0);
        expect(dims.mapFrameHeightFt).toBeGreaterThan(0);
    });

    it('calculates map-frame ground dimensions from paper and scale', () => {
        const dims = calculateMapFrameGroundDimensions({
            paperSize: 'ANSI_D',
            orientation: 'landscape',
            scale: 200
        });
        expect(dims.mapFrameWidthFt).toBeGreaterThan(0);
        expect(dims.mapFrameHeightFt).toBeGreaterThan(0);
    });

    it('default template uses tabloid landscape with foot dimensions', () => {
        expect(DEFAULT_SHEET_TEMPLATE.paperSize).toBe('TABLOID');
        expect(DEFAULT_SHEET_TEMPLATE.sheetLengthFt).toBe(1100);
        expect(DEFAULT_SHEET_TEMPLATE.corridorWidthFt).toBe(350);
        expect(DEFAULT_SHEET_TEMPLATE.overlapFt).toBeUndefined();
    });

    it('generates sequential non-overlapping sheet frames along a route', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200 });
        const sheets = generateSheetFramesAlongRoute({
            routeLine,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            sheetTemplate: dims
        });
        const routeLengthFt = turf.length(routeLine, { units: 'feet' });

        expect(sheets.length).toBeGreaterThan(0);
        expect(sheets[0].sheetNumber).toBe(1);
        expect(sheets[0].startDistanceFt).toBeCloseTo(0, 1);

        for (let i = 0; i < sheets.length - 1; i++) {
            expect(sheets[i].endDistanceFt).toBeCloseTo(sheets[i + 1].startDistanceFt, 1);
            expect(sheets[i].nextSheetId).toBe(sheets[i + 1].sheetId);
            expect(sheets[i + 1].previousSheetId).toBe(sheets[i].sheetId);
        }

        expect(sheets[sheets.length - 1].endDistanceFt).toBeCloseTo(routeLengthFt, 1);

        const totalCoverage = sheets.reduce((sum, sheet) => sum + (sheet.endDistanceFt - sheet.startDistanceFt), 0);
        expect(totalCoverage).toBeCloseTo(routeLengthFt, 1);
    });

    it('generates bidirectional match-line metadata', () => {
        const sheets = [
            { sheetId: 's1', sheetNumber: 1, startDistanceFt: 0, endDistanceFt: 1000 },
            { sheetId: 's2', sheetNumber: 2, startDistanceFt: 1000, endDistanceFt: 2000 },
            { sheetId: 's3', sheetNumber: 3, startDistanceFt: 2000, endDistanceFt: 2500 }
        ];
        const matchLines = generateSheetMatchLines(sheets);
        expect(matchLines).toHaveLength(2 * (sheets.length - 1));

        const endLine = matchLines.find((line) => line.sheetId === 's1' && line.position === 'end');
        expect(endLine.adjacentSheetNumber).toBe(2);
        expect(endLine.adjacentSheetId).toBe('s2');
        expect(endLine.label).toContain('SHEET 02');

        const startLine = matchLines.find((line) => line.sheetId === 's2' && line.position === 'start');
        expect(startLine.adjacentSheetNumber).toBe(1);
        expect(startLine.adjacentSheetId).toBe('s1');
    });

    it('generates match-line labels with position', () => {
        const sheet = { sheetId: 's1', startDistanceFt: 900, endDistanceFt: 1000 };
        const matchLine = generateMatchLine(sheet, 'end', 4, 's4');
        expect(matchLine.label).toContain('SHEET 04');
        expect(matchLine.position).toBe('end');
        expect(matchLine.matchLineStation).toBe(1000);
    });

    it('builds an overview sheet with sheet boxes', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200 });
        const sheets = generateSheetFramesAlongRoute({
            routeLine,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            sheetTemplate: dims
        });
        const overview = buildOverviewSheet(sheets, routeLine);
        expect(overview.sheetType).toBe('overview');
        expect(overview.sheetBoxes.length).toBe(sheets.length);
    });

    it('assigns boundary features to exactly one sheet using half-open intervals', () => {
        const routeLengthFt = turf.length(routeLine, { units: 'feet' });
        const midpoint = routeLengthFt / 2;
        const sheets = [
            { sheetId: 's1', startDistanceFt: 0, endDistanceFt: midpoint },
            { sheetId: 's2', startDistanceFt: midpoint, endDistanceFt: routeLengthFt }
        ];
        const boundaryPoint = turf.along(routeLine, midpoint, { units: 'feet' });
        const feature = {
            id: 'boundary-feature',
            geometry: boundaryPoint.geometry,
            properties: {}
        };

        const assignments = assignFeaturesToSheets([feature], sheets, routeLine);
        const assignedCount = Object.values(assignments).filter((ids) => ids.includes('boundary-feature')).length;
        expect(assignedCount).toBe(1);
    });

    it('validates sheet tiling warnings', () => {
        const result = validateSheetTiling([], 1000);
        expect(result.valid).toBe(false);
        expect(result.warnings).toContain('No sheet boxes generated.');
    });

    it('validates sheet coverage warnings', () => {
        const result = validateSheetCoverage([], []);
        expect(result.valid).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});

describe('sheet cutting geometry', () => {
    const curvedRoute = turf.lineString([
        [-111.9, 40.75],
        [-111.895, 40.75],
        [-111.89, 40.751],
        [-111.885, 40.752],
        [-111.88, 40.753],
        [-111.875, 40.754],
        [-111.87, 40.755]
    ]);

    it('builds route-aligned paper rectangles', () => {
        const center = turf.along(curvedRoute, 500, { units: 'feet' });
        const rect = buildPaperFrameRectangle(center, 90, 1000, 500);
        expect(rect.geometry.type).toBe('Polygon');
        expect(rect.geometry.coordinates[0]).toHaveLength(5);
    });

    it('builds clipped sheet polygons without overlap between neighbors', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200 });
        const sheets = generateSheetFramesAlongRoute({
            routeLine: curvedRoute,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            sheetTemplate: dims
        }).map((sheet) => ({
            ...sheet,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            mapFrameHeightFt: dims.mapFrameHeightFt
        }));

        expect(sheets.length).toBeGreaterThan(1);

        const frames = buildSheetFramesGeoJson(sheets, curvedRoute).features;
        expect(frames.length).toBe(sheets.length);

        for (let i = 0; i < frames.length - 1; i++) {
            const intersection = turf.intersect(turf.featureCollection([frames[i], frames[i + 1]]));
            if (intersection) {
                const overlapArea = turf.area(intersection);
                expect(overlapArea).toBeLessThan(1);
            }
        }

        const overlap = validateClippedSheetOverlap(sheets, curvedRoute);
        expect(overlap.valid).toBe(true);

        const centerline = validateCenterlinePolygonCoverage(sheets, curvedRoute, 15);
        expect(centerline.valid).toBe(true);

        for (const frame of frames) {
            expect(turf.kinks(frame).features).toHaveLength(0);
        }

        const corridorCaps = buildCorridorMatchLineRegistry(sheets, curvedRoute);
        for (let i = 0; i < frames.length - 1; i++) {
            expect(sharedBoundaryEdgesOverlap(frames[i], frames[i + 1])).toBe(true);

            const boundaryCap = corridorCaps.get(stationKey(sheets[i].endDistanceFt));
            expect(boundaryCap).toBeTruthy();
            const ringA = frames[i].geometry.coordinates[0];
            const ringB = frames[i + 1].geometry.coordinates[0];
            expect(ringA.some((coord) => coordsEqual(coord, boundaryCap.left))).toBe(true);
            expect(ringA.some((coord) => coordsEqual(coord, boundaryCap.right))).toBe(true);
            expect(ringB.some((coord) => coordsEqual(coord, boundaryCap.left))).toBe(true);
            expect(ringB.some((coord) => coordsEqual(coord, boundaryCap.right))).toBe(true);
        }
    });

    it('clips sheet polygons to station boundaries on curved routes', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200 });
        const sheets = generateSheetFramesAlongRoute({
            routeLine: curvedRoute,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            sheetTemplate: dims
        }).map((sheet) => ({
            ...sheet,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            mapFrameHeightFt: dims.mapFrameHeightFt
        }));

        const middleSheet = sheets[Math.floor(sheets.length / 2)];
        const clipped = buildClippedSheetPolygon(middleSheet, curvedRoute);
        expect(clipped?.geometry?.type).toBe('Polygon');

        const vertexCount = clipped.geometry.coordinates[0].length;
        expect(vertexCount).toBeGreaterThanOrEqual(4);
    });

    it('keeps shared match-line corners on wide sheets along curved routes', () => {
        const sheets = generateSheetFramesAlongRoute({
            routeLine: curvedRoute,
            mapFrameWidthFt: 1100,
            sheetTemplate: { mapFrameHeightFt: 350 }
        }).map((sheet) => ({
            ...sheet,
            mapFrameWidthFt: 1100,
            mapFrameHeightFt: 350
        }));

        expect(sheets.length).toBeGreaterThan(1);

        const frames = buildSheetFramesGeoJson(sheets, curvedRoute).features;
        const corridorCaps = buildCorridorMatchLineRegistry(sheets, curvedRoute);

        for (let i = 0; i < frames.length - 1; i++) {
            expect(sharedBoundaryEdgesOverlap(frames[i], frames[i + 1])).toBe(true);

            const boundaryCap = corridorCaps.get(stationKey(sheets[i].endDistanceFt));
            expect(boundaryCap).toBeTruthy();
            const ringA = frames[i].geometry.coordinates[0];
            const ringB = frames[i + 1].geometry.coordinates[0];
            expect(ringA.some((coord) => coordsEqual(coord, boundaryCap.left))).toBe(true);
            expect(ringA.some((coord) => coordsEqual(coord, boundaryCap.right))).toBe(true);
            expect(ringB.some((coord) => coordsEqual(coord, boundaryCap.left))).toBe(true);
            expect(ringB.some((coord) => coordsEqual(coord, boundaryCap.right))).toBe(true);
        }
    });

    it('mirrors corridor half-width equally on both sides of centerline', () => {
        const sheets = generateSheetFramesAlongRoute({
            routeLine: curvedRoute,
            mapFrameWidthFt: 1100,
            sheetTemplate: { mapFrameHeightFt: 350 }
        }).map((sheet) => ({
            ...sheet,
            mapFrameWidthFt: 1100,
            mapFrameHeightFt: 350
        }));

        const frames = buildSheetFramesGeoJson(sheets, curvedRoute).features;
        const halfHeightFt = 175;

        for (let i = 0; i < sheets.length; i++) {
            const sheet = sheets[i];
            const frame = frames[i];

            for (let stationFt = sheet.startDistanceFt + 25; stationFt < sheet.endDistanceFt - 25; stationFt += 75) {
                const center = turf.along(curvedRoute, stationFt, { units: 'feet' });
                const bearing = getLocalTangentBearing(curvedRoute, stationFt);
                const probeDistFt = Math.max(halfHeightFt - 20, halfHeightFt * 0.85);
                const leftInside = turf.destination(center, probeDistFt, bearing - 90, { units: 'feet' });
                const rightInside = turf.destination(center, probeDistFt, bearing + 90, { units: 'feet' });
                const leftOutside = turf.destination(center, halfHeightFt + 10, bearing - 90, { units: 'feet' });
                const rightOutside = turf.destination(center, halfHeightFt + 10, bearing + 90, { units: 'feet' });

                expect(turf.booleanPointInPolygon(leftInside, frame)).toBe(true);
                expect(turf.booleanPointInPolygon(rightInside, frame)).toBe(true);
                expect(turf.booleanPointInPolygon(leftOutside, frame)).toBe(false);
                expect(turf.booleanPointInPolygon(rightOutside, frame)).toBe(false);
            }
        }
    });

    it('builds GIS layer export package with PDF page plan and no CSV sidecars', () => {
        const dims = calculateMapFrameGroundDimensions({ scale: 200, paperSize: 'TABLOID' });
        const sheets = generateSheetFramesAlongRoute({
            routeLine: curvedRoute,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            sheetTemplate: dims
        }).map((sheet) => ({
            ...sheet,
            mapFrameWidthFt: dims.mapFrameWidthFt,
            mapFrameHeightFt: dims.mapFrameHeightFt
        }));

        const pointInside = turf.along(curvedRoute, sheets[0].centerDistanceFt, { units: 'feet' });
        const exportPackage = buildSheetExportPackage({
            project: { projectName: 'Export Test' },
            routeLine: curvedRoute,
            designFeatures: [{
                type: 'Feature',
                id: 'feature-1',
                properties: { feature_id: 'feature-1' },
                geometry: pointInside.geometry
            }],
            sheets: {
                template: {
                    paperSize: 'TABLOID',
                    orientation: 'landscape',
                    sheetLengthFt: 1100,
                    corridorWidthFt: 350,
                    includeOverview: true
                },
                sheets,
                overviewSheet: { sheetBoxes: sheets.map((sheet) => ({ sheetId: sheet.sheetId, sheetNumber: sheet.sheetNumber, centerDistanceFt: sheet.centerDistanceFt })) },
                matchLines: []
            }
        });

        expect(exportPackage.csv).toBeUndefined();
        expect(exportPackage.layers.sheetFrames.features.length).toBe(sheets.length);
        expect(exportPackage.layers.perSheet[0].contents.features.length).toBeGreaterThan(1);
        expect(exportPackage.pdf.pages[0].pageType).toBe('overview');
        expect(exportPackage.pdf.pages[1].pageType).toBe('detail');
        expect(exportPackage.pdf.paperSize).toBe('TABLOID');
        expect(exportPackage.pdf.sheetLengthFt).toBe(1100);
        expect(exportPackage.pdf.corridorWidthFt).toBe(350);
    });

    it('resolves tabloid landscape PDF page size in points', () => {
        const format = computePdfPageSizePt({ paperSize: 'TABLOID', orientation: 'landscape' });
        expect(format).toEqual([17 * 72, 11 * 72]);
    });
});
