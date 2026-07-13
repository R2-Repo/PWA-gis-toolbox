import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SHEET_EXPORT_DPI,
    DEFAULT_SHEET_TEMPLATE,
    computePrintablePageDimensionsIn,
    computeSheetExportPixelDimensions,
    resolveSheetPdfBearing,
    resolveSheetPdfBearings
} from '../js/widgets/sheet-cutting/engine.js';
import { sanitizeExportFilename } from '../js/export/folder-export.js';
import {
    buildSheetPageFilename,
    pixelRingOverlapsCanvas,
    polygonRingFitsViewport,
    placeSheetCanvasOnPdfPage,
    resolveDetailPageMarginsPt
} from '../js/widgets/sheet-cutting/sheet-pdf-export.js';
import {
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_MAP_BEARING_MODES,
    buildSheetContinuationLabels,
    formatRouteStationFt,
    landscapeBearingCandidates,
    normalizeMapBearingForLeftToRight,
    northPointsUpOnPage,
    projectedScreenX,
    resolveLandscapeAlignBearing,
    resolveSheetPdfBearing as resolveBearingDirect,
    tangentToLandscapeMapBearing
} from '../js/widgets/sheet-cutting/sheet-pdf-orientation.js';
import { getLocalTangentBearing } from '../js/widgets/project-stationing/engine.js';
import { buildSheetPdfPagePlan } from '../js/widgets/sheet-cutting/export-builder.js';

globalThis.turf = turf;

describe('sheet export sizing', () => {
    it('computes printable tabloid landscape dimensions with margins', () => {
        const dims = computePrintablePageDimensionsIn(DEFAULT_SHEET_TEMPLATE);
        expect(dims.pageWidthIn).toBe(17);
        expect(dims.pageHeightIn).toBe(11);
        expect(dims.printableWidthIn).toBe(16);
        expect(dims.printableHeightIn).toBe(10);
    });

    it('targets 150 DPI pixel dimensions by default', () => {
        const dims = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE);
        expect(dims.dpi).toBe(DEFAULT_SHEET_EXPORT_DPI);
        expect(dims.widthPx).toBe(2400);
        expect(dims.heightPx).toBe(1500);
        expect(dims.marginsPt.left).toBe(36);
    });

    it('clamps custom DPI into a safe range', () => {
        const low = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE, 48);
        const high = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE, 600);
        expect(low.dpi).toBe(72);
        expect(high.dpi).toBe(300);
    });

    it('reserves a footer band on detail page margins', () => {
        const { marginsPt } = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE);
        const detail = resolveDetailPageMarginsPt(marginsPt, true);
        expect(detail.bottom).toBe(marginsPt.bottom + PDF_DETAIL_FOOTER_BAND_IN * 72);
    });
});

describe('sheet export filenames', () => {
    it('sanitizes unsafe filename characters', () => {
        expect(sanitizeExportFilename('My Project: Phase 1')).toBe('My_Project_Phase_1');
    });

    it('builds per-sheet PDF filenames', () => {
        expect(buildSheetPageFilename('Fiber Route', 'sheet_03')).toBe('Fiber_Route_sheet_03.pdf');
        expect(buildSheetPageFilename('Fiber Route', 'overview')).toBe('Fiber_Route_overview.pdf');
    });
});

describe('sheet PDF orientation', () => {
    const curvedRoute = turf.lineString([
        [-111.9, 40.75],
        [-111.895, 40.75],
        [-111.89, 40.751],
        [-111.885, 40.752],
        [-111.88, 40.753],
        [-111.875, 40.754],
        [-111.87, 40.755]
    ]);

    const eastRoute = turf.lineString([
        [-111.92, 40.75],
        [-111.91, 40.75],
        [-111.90, 40.75]
    ]);

    it('formats route station labels', () => {
        expect(formatRouteStationFt(0)).toBe('0+000');
        expect(formatRouteStationFt(2100)).toBe('2+100');
    });

    it('builds continuation labels for middle sheets', () => {
        const labels = buildSheetContinuationLabels({ sheetNumber: 3, startDistanceFt: 2200, endDistanceFt: 3300 }, 8);
        expect(labels.sheetLabel).toBe('Sheet 03 of 8');
        expect(labels.stationRange).toBe('2+200 – 3+300');
        expect(labels.continueFrom).toBe('← Sheet 02');
        expect(labels.continueTo).toBe('Sheet 04 →');
    });

    it('uses north-up bearing when explicitly requested', () => {
        const sheet = {
            sheetId: 's1',
            startDistanceFt: 0,
            endDistanceFt: 1100
        };
        expect(resolveSheetPdfBearing(sheet, eastRoute, {
            mode: PDF_MAP_BEARING_MODES.NORTH_UP
        })).toBe(0);
    });

    it('aligns landscape sheets without flipping upside down', () => {
        const sheet = {
            sheetId: 's1',
            startDistanceFt: 0,
            endDistanceFt: 1000
        };
        const bearing = resolveSheetPdfBearing(sheet, eastRoute);
        expect(northPointsUpOnPage(bearing)).toBe(true);
        expect(Math.abs(bearing - 180)).toBeGreaterThan(90);

        const westRoute = turf.lineString([
            [-111.90, 40.75],
            [-111.91, 40.75],
            [-111.92, 40.75]
        ]);
        const westBearing = resolveSheetPdfBearing(sheet, westRoute);
        expect(northPointsUpOnPage(westBearing)).toBe(true);
        expect(Math.abs(westBearing - 180)).toBeGreaterThan(90);
    });

    it('picks the upright landscape candidate from tangent', () => {
        const tangent = 45;
        const [a, b] = landscapeBearingCandidates(tangent);
        expect(northPointsUpOnPage(a)).toBe(true);
        expect(northPointsUpOnPage(b)).toBe(false);
        expect(resolveLandscapeAlignBearing(tangent, eastRoute, 0, 1000)).toBe(a);
    });

    it('uses start-station tangent instead of center rotationDeg in match-line mode', () => {
        const sheet = {
            sheetId: 's1',
            startDistanceFt: 1100,
            endDistanceFt: 2200,
            centerDistanceFt: 1650,
            rotationDeg: getLocalTangentBearing(curvedRoute, 1650)
        };
        const exportBearing = resolveSheetPdfBearing(sheet, curvedRoute, {
            mode: PDF_MAP_BEARING_MODES.MATCH_LINE
        });
        const startTangent = getLocalTangentBearing(curvedRoute, 1102);
        const expected = normalizeMapBearingForLeftToRight(
            curvedRoute,
            sheet.startDistanceFt,
            sheet.endDistanceFt,
            tangentToLandscapeMapBearing(startTangent)
        );
        expect(exportBearing).toBeCloseTo(expected, 4);
        expect(Math.abs(exportBearing - sheet.rotationDeg)).toBeGreaterThan(0.01);
    });

    it('normalizes eastbound routes to left-to-right flow in match-line mode', () => {
        const sheet = {
            sheetId: 'e1',
            startDistanceFt: 0,
            endDistanceFt: 1000
        };
        const bearing = resolveBearingDirect(sheet, eastRoute, {
            mode: PDF_MAP_BEARING_MODES.MATCH_LINE
        });
        const start = turf.along(eastRoute, 0, { units: 'feet' }).geometry.coordinates;
        const end = turf.along(eastRoute, 1000, { units: 'feet' }).geometry.coordinates;
        const origin = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
        expect(projectedScreenX(end, origin, bearing)).toBeGreaterThan(projectedScreenX(start, origin, bearing));
    });

    it('anchors export bearing at each sheet start match line in match-line mode', () => {
        const sheet2 = {
            sheetId: 'b',
            startDistanceFt: 1100,
            endDistanceFt: 2200
        };
        const bearing = resolveSheetPdfBearing(sheet2, curvedRoute, {
            mode: PDF_MAP_BEARING_MODES.MATCH_LINE
        });
        const startTangent = getLocalTangentBearing(curvedRoute, 1102);
        const expected = normalizeMapBearingForLeftToRight(
            curvedRoute,
            sheet2.startDistanceFt,
            sheet2.endDistanceFt,
            tangentToLandscapeMapBearing(startTangent)
        );
        expect(bearing).toBeCloseTo(expected, 4);
    });

    it('includes export metadata in the PDF page plan', () => {
        const plan = buildSheetPdfPagePlan({
            routeLine: curvedRoute,
            sheets: {
                template: DEFAULT_SHEET_TEMPLATE,
                overviewSheet: { sheetNumber: 0 },
                sheets: [
                    { sheetId: 'a', sheetNumber: 1, sheetType: 'detail', startDistanceFt: 0, endDistanceFt: 1100 },
                    { sheetId: 'b', sheetNumber: 2, sheetType: 'detail', startDistanceFt: 1100, endDistanceFt: 2200 }
                ]
            }
        });

        expect(plan.pages[0].pageType).toBe('overview');
        expect(plan.pages[0].exportBearingDeg).toBe(0);
        expect(plan.pages[1].exportBearingDeg).toBeDefined();
        expect(northPointsUpOnPage(plan.pages[1].exportBearingDeg)).toBe(true);
        expect(northPointsUpOnPage(plan.pages[2].exportBearingDeg)).toBe(true);
        expect(plan.pages[1].continueToSheet).toBe(2);
        expect(plan.pages[2].continueFromSheet).toBe(1);
        expect(plan.pages[2].stationRange).toBe('1+100 – 2+200');
    });
});

describe('sheet PDF capture safety', () => {
    it('detects polygon vertices outside the viewport margin', () => {
        const ring = [
            [-111.91, 40.75],
            [-111.905, 40.75],
            [-111.905, 40.751],
            [-111.91, 40.751],
            [-111.91, 40.75]
        ];
        const map = {
            getContainer: () => ({ clientWidth: 1000, clientHeight: 800 }),
            project: ([lng, lat]) => {
                if (lng === -111.91 && lat === 40.751) {
                    return { x: 5, y: 5 };
                }
                return { x: 500, y: 400 };
            }
        };

        expect(polygonRingFitsViewport(map, ring, 72)).toBe(false);
        expect(polygonRingFitsViewport(map, ring, 4)).toBe(true);
    });

    it('detects when a projected ring misses the capture canvas', () => {
        const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
        const canvas = { width: 200, height: 200 };
        expect(pixelRingOverlapsCanvas([[300, 50], [400, 50], [400, 150], [300, 150]], canvas)).toBe(false);
        expect(pixelRingOverlapsCanvas([[20, 20], [180, 20], [180, 180], [20, 180]], canvas)).toBe(true);
    });
});

describe('sheet PDF placement', () => {
    it('prefers filling printable width for landscape-flow canvases', () => {
        const placed = { width: 0, height: 0 };
        const doc = {
            internal: { pageSize: { getWidth: () => 1224, getHeight: () => 792 } },
            addImage: (_data, _fmt, _x, _y, width, height) => {
                placed.width = width;
                placed.height = height;
            }
        };
        const canvas = {
            width: 2000,
            height: 600,
            toDataURL: () => 'data:image/png;base64,abc'
        };
        const marginsPt = { top: 36, right: 36, bottom: 36, left: 36 };

        placeSheetCanvasOnPdfPage(doc, canvas, marginsPt, { preferLandscapeFlow: true });

        const availW = 1224 - 72;
        expect(placed.width).toBeCloseTo(availW, 0);
        expect(placed.height).toBeLessThan(availW);
    });
});
