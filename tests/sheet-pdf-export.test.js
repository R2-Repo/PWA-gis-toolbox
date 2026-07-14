// @vitest-environment jsdom
import * as turf from '@turf/turf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_BASEMAP_DPI,
    DEFAULT_SHEET_EXPORT_DPI,
    DEFAULT_SHEET_TEMPLATE,
    MAX_BASEMAP_DPI,
    computePrintablePageDimensionsIn,
    computeSheetExportPixelDimensions,
    resolveBasemapDpi,
    resolveSheetPdfBearing,
    resolveSheetPdfBearings
} from '../js/widgets/sheet-cutting/engine.js';
import { sanitizeExportFilename } from '../js/export/folder-export.js';
import {
    buildSheetPageFilename,
    computeSheetExportProgress,
    computeSheetEdgeSeeLabelPlacement,
    EDGE_SEE_LABEL_OFFSET_PT,
    measureProjectedRingSpan,
    pickLandscapeAlignCaptureBearing,
    pixelRingInsideCanvas,
    pixelRingOverlapsCanvas,
    polygonRingFitsViewport,
    placeSheetCanvasOnPdfPage,
    resolveDetailPageMarginsPt,
    resolveExportLayerIds,
    resolveSheetEdgeSeeLabelPlacements,
    warnIfBasemapDpiConstrained
} from '../js/widgets/sheet-cutting/sheet-pdf-export.js';
import { prepareExportLayerVisibility } from '../js/widgets/sheet-cutting/sheet-preview.js';
import {
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_MAP_BEARING_MODES,
    buildSheetContinuationLabels,
    buildSheetEdgeSeeLabelSpecs,
    formatRouteStationFt,
    formatSeeSheetLabel,
    landscapeBearingCandidates,
    normalizeMapBearingForLeftToRight,
    northPointsUpOnPage,
    projectedScreenX,
    resolveLandscapeAlignBearing,
    resolveSheetPdfBearing as resolveBearingDirect,
    tangentToLandscapeMapBearing
} from '../js/widgets/sheet-cutting/sheet-pdf-orientation.js';
import { getLocalTangentBearing } from '../js/widgets/project-stationing/engine.js';
import { buildCorridorMatchLineRegistry, buildSheetFramesGeoJson, buildSheetPdfPagePlan, buildOverviewGeoJson, stationKey } from '../js/widgets/sheet-cutting/export-builder.js';
import { buildPdfRingFromPixelRing, buildSheetPageTransform, findCapEdgeVertexIndices, pickTextAngleWithBottomTowardInterior, pointInPdfRing } from '../js/widgets/sheet-cutting/sheet-pdf-placement.js';

globalThis.turf = turf;

describe('sheet PDF export layer visibility', () => {
    it('resolves export layer ids from route centerline and checked design layers', () => {
        const ids = resolveExportLayerIds({
            project: { stationingRouteLayerId: 'route-1' },
            sheets: { designLayerIds: ['design-a', 'design-b'] }
        });
        expect(ids).toEqual(['route-1', 'design-a', 'design-b']);
    });

    it('hides only layers outside the export scope and restores prior visibility', () => {
        const visibility = new Map([
            ['route-1', true],
            ['design-a', true],
            ['other-layer', true],
            ['hidden-layer', false]
        ]);
        const toggled = [];

        const mapService = {
            getMap: () => ({
                getLayer: (subId) => ({ id: subId }),
                getLayoutProperty: (subId, prop) => {
                    if (prop !== 'visibility') return 'visible';
                    const parentId = subId.replace(/-line$/, '');
                    return visibility.get(parentId) ? 'visible' : 'none';
                }
            }),
            getLayerIds: () => ['route-1', 'design-a', 'other-layer', 'hidden-layer'],
            getLayerRecord: (layerId) => ({ layerIds: [`${layerId}-line`] }),
            toggleLayer: (layerId, show) => {
                toggled.push({ layerId, show });
                visibility.set(layerId, show);
            }
        };

        const restore = prepareExportLayerVisibility(mapService, ['route-1', 'design-a']);

        expect(toggled).toEqual([{ layerId: 'other-layer', show: false }]);
        expect(visibility.get('route-1')).toBe(true);
        expect(visibility.get('design-a')).toBe(true);
        expect(visibility.get('other-layer')).toBe(false);
        expect(visibility.get('hidden-layer')).toBe(false);

        restore();

        expect(toggled).toEqual([
            { layerId: 'other-layer', show: false },
            { layerId: 'other-layer', show: true }
        ]);
        expect(visibility.get('other-layer')).toBe(true);
        expect(visibility.get('hidden-layer')).toBe(false);
    });

    it('builds overview vector content with route, sheet outlines, and labels only', () => {
        const overview = buildOverviewGeoJson(
            { sheetBoxes: [] },
            turf.lineString([[-112, 40], [-111.9, 40]]),
            {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { sheet_id: 's1', sheet_number: 1 },
                    geometry: { type: 'Polygon', coordinates: [[[-112, 40], [-111.9, 40], [-111.9, 40.01], [-112, 40.01], [-112, 40]]] }
                }]
            }
        );

        expect(overview.features.map((f) => f.properties.feature_type)).toEqual([
            'overview_route',
            'overview_sheet_outline',
            'overview_sheet_label'
        ]);
    });
});

describe('sheet export sizing', () => {
    it('computes printable tabloid landscape dimensions with margins', () => {
        const dims = computePrintablePageDimensionsIn(DEFAULT_SHEET_TEMPLATE);
        expect(dims.pageWidthIn).toBe(17);
        expect(dims.pageHeightIn).toBe(11);
        expect(dims.printableWidthIn).toBe(16);
        expect(dims.printableHeightIn).toBe(10);
    });

    it('targets 150 DPI basemap dimensions by default', () => {
        const dims = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE);
        expect(dims.dpi).toBe(DEFAULT_BASEMAP_DPI);
        expect(dims.widthPx).toBe(2400);
        expect(dims.heightPx).toBe(1500);
        expect(dims.marginsPt.left).toBe(36);
    });

    it('clamps custom basemap DPI into a safe range', () => {
        const low = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE, 48);
        const high = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE, 600);
        expect(low.dpi).toBe(72);
        expect(high.dpi).toBe(MAX_BASEMAP_DPI);
        expect(resolveBasemapDpi({ basemapDpi: 250 })).toBe(MAX_BASEMAP_DPI);
        expect(DEFAULT_SHEET_EXPORT_DPI).toBe(DEFAULT_BASEMAP_DPI);
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

    it('formats SEE SHEET edge labels with zero padding', () => {
        expect(formatSeeSheetLabel(4)).toBe('SEE SHEET 04');
        expect(formatSeeSheetLabel(12)).toBe('SEE SHEET 12');
        expect(formatSeeSheetLabel(0)).toBe('');
    });

    it('builds edge SEE SHEET specs for first, middle, and last sheets', () => {
        const first = buildSheetEdgeSeeLabelSpecs({ sheetNumber: 1, startDistanceFt: 0, endDistanceFt: 1100 }, 5);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ position: 'end', adjacentSheetNumber: 2, text: 'SEE SHEET 02', stationFt: 1100 });

        const middle = buildSheetEdgeSeeLabelSpecs({ sheetNumber: 3, startDistanceFt: 2200, endDistanceFt: 3300 }, 5);
        expect(middle).toHaveLength(2);
        expect(middle[0]).toMatchObject({ position: 'start', adjacentSheetNumber: 2, text: 'SEE SHEET 02', stationFt: 2200 });
        expect(middle[1]).toMatchObject({ position: 'end', adjacentSheetNumber: 4, text: 'SEE SHEET 04', stationFt: 3300 });

        const last = buildSheetEdgeSeeLabelSpecs({ sheetNumber: 5, startDistanceFt: 4400, endDistanceFt: 5500 }, 5);
        expect(last).toHaveLength(1);
        expect(last[0]).toMatchObject({ position: 'start', adjacentSheetNumber: 4, text: 'SEE SHEET 04', stationFt: 4400 });
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

describe('sheet PDF edge SEE SHEET labels', () => {
    const eastRoute = turf.lineString([
        [-112.0, 40.0],
        [-111.9, 40.0],
        [-111.8, 40.0]
    ]);

    const detailSheets = [
        { sheetId: 's1', sheetNumber: 1, startDistanceFt: 0, endDistanceFt: 1100, mapFrameWidthFt: 1100, mapFrameHeightFt: 350 },
        { sheetId: 's2', sheetNumber: 2, startDistanceFt: 1100, endDistanceFt: 2200, mapFrameWidthFt: 1100, mapFrameHeightFt: 350 },
        { sheetId: 's3', sheetNumber: 3, startDistanceFt: 2200, endDistanceFt: 3300, mapFrameWidthFt: 1100, mapFrameHeightFt: 350 }
    ];

    const map = {
        project: ([lng, lat]) => ({
            x: (lng + 112) * 10000,
            y: (40.1 - lat) * 10000
        })
    };

    const pixelRing = [[100, 100], [900, 100], [900, 700], [100, 700]];
    const marginsPt = { top: 36, right: 36, bottom: 108, left: 36 };
    const pageSize = { width: 1224, height: 792 };
    const transform = buildSheetPageTransform(
        pixelRing,
        marginsPt,
        pageSize,
        { preferLandscapeFlow: true }
    );

    function anglesParallel(aDeg, bDeg, tolerance = 1) {
        const diff = Math.abs(((aDeg - bDeg + 180) % 360) - 180);
        return diff <= tolerance || Math.abs(diff - 180) <= tolerance;
    }

    function interiorRefPdf(routeLine, stationFt, position, captureScale = 1) {
        const totalLength = turf.length(routeLine, { units: 'feet' });
        const interiorFt = position === 'start'
            ? Math.min(stationFt + 2, totalLength)
            : Math.max(stationFt - 2, 0);
        const coord = turf.along(routeLine, interiorFt, { units: 'feet' }).geometry.coordinates;
        return transform.projectLngLat(map, coord[0], coord[1], captureScale);
    }

    it('places edge labels outside the map frame with cap-aligned rotation', () => {
        const sheet = detailSheets[1];
        const registry = buildCorridorMatchLineRegistry(detailSheets, eastRoute);
        const frames = buildSheetFramesGeoJson(detailSheets, eastRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const framePixelRing = frameRing.map(([lng, lat]) => {
            const point = map.project([lng, lat]);
            return [point.x, point.y];
        });
        const startCap = registry.get(stationKey(sheet.startDistanceFt));
        const endCap = registry.get(stationKey(sheet.endDistanceFt));
        const startSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[0];
        const endSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[1];

        const startPlacement = computeSheetEdgeSeeLabelPlacement(
            startSpec,
            startCap,
            eastRoute,
            transform,
            map,
            1,
            framePixelRing,
            frameRing
        );
        const endPlacement = computeSheetEdgeSeeLabelPlacement(
            endSpec,
            endCap,
            eastRoute,
            transform,
            map,
            1,
            framePixelRing,
            frameRing
        );

        expect(startPlacement?.text).toBe('SEE SHEET 01');
        expect(endPlacement?.text).toBe('SEE SHEET 03');
        expect(startPlacement.x).toBeLessThan(endPlacement.x);

        for (const [placement, spec] of [
            [startPlacement, startSpec],
            [endPlacement, endSpec]
        ]) {
            expect(anglesParallel(placement.angle, pickTextAngleWithBottomTowardInterior(
                placement.edgeAngleDeg,
                placement.x,
                placement.y,
                interiorRefPdf(eastRoute, spec.stationFt, spec.position)
            ))).toBe(true);
            expect(pointInPdfRing(
                placement.x,
                placement.y,
                buildPdfRingFromPixelRing(framePixelRing, transform)
            )).toBe(false);
            expect(Math.hypot(placement.x - placement.midX, placement.y - placement.midY))
                .toBeGreaterThanOrEqual(EDGE_SEE_LABEL_OFFSET_PT - 0.5);

            const interior = interiorRefPdf(eastRoute, spec.stationFt, spec.position);
            const toLabelX = placement.x - placement.midX;
            const toLabelY = placement.y - placement.midY;
            const toInteriorX = interior.x - placement.midX;
            const toInteriorY = interior.y - placement.midY;
            expect(toLabelX * toInteriorX + toLabelY * toInteriorY).toBeLessThan(0);
        }
    });

    it('finds consecutive cap edge indices in sheet frame rings', () => {
        const sheet = detailSheets[1];
        const registry = buildCorridorMatchLineRegistry(detailSheets, eastRoute);
        const frames = buildSheetFramesGeoJson(detailSheets, eastRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const startCap = registry.get(stationKey(sheet.startDistanceFt));
        const endCap = registry.get(stationKey(sheet.endDistanceFt));

        expect(findCapEdgeVertexIndices(frameRing, startCap)).toEqual({
            leftIndex: expect.any(Number),
            rightIndex: expect.any(Number)
        });
        expect(findCapEdgeVertexIndices(frameRing, endCap)).toEqual({
            leftIndex: expect.any(Number),
            rightIndex: expect.any(Number)
        });
    });

    it('tracks cap edge angle on a rotated PDF clip ring via pixelRing', () => {
        const sheet = detailSheets[1];
        const registry = buildCorridorMatchLineRegistry(detailSheets, eastRoute);
        const frames = buildSheetFramesGeoJson(detailSheets, eastRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const basePixelRing = frameRing.map(([lng, lat]) => {
            const point = map.project([lng, lat]);
            return [point.x, point.y];
        });

        const cx = basePixelRing.reduce((sum, [x]) => sum + x, 0) / basePixelRing.length;
        const cy = basePixelRing.reduce((sum, [, y]) => sum + y, 0) / basePixelRing.length;
        const rad = (18 * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotatedPixelRing = basePixelRing.map(([x, y]) => {
            const dx = x - cx;
            const dy = y - cy;
            return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
        });

        const rotatedTransform = buildSheetPageTransform(
            rotatedPixelRing,
            marginsPt,
            pageSize,
            { preferLandscapeFlow: true }
        );
        const startCap = registry.get(stationKey(sheet.startDistanceFt));
        const startSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[0];
        const indices = findCapEdgeVertexIndices(frameRing, startCap);
        expect(indices).not.toBeNull();

        const placement = computeSheetEdgeSeeLabelPlacement(
            startSpec,
            startCap,
            eastRoute,
            rotatedTransform,
            map,
            1,
            rotatedPixelRing,
            frameRing
        );

        const leftPx = rotatedPixelRing[indices.leftIndex];
        const rightPx = rotatedPixelRing[indices.rightIndex];
        const limit = frameRing.length;
        const isClosed = limit > 1 && frameRing[0][0] === frameRing[limit - 1][0] && frameRing[0][1] === frameRing[limit - 1][1];
        const vertexCount = isClosed ? limit - 1 : limit;
        const next = (index) => (index + 1) % vertexCount;
        const fromPx = next(indices.leftIndex) === indices.rightIndex ? leftPx : rightPx;
        const toPx = next(indices.leftIndex) === indices.rightIndex ? rightPx : leftPx;
        const pFrom = rotatedTransform.toPdf(fromPx[0], fromPx[1]);
        const pTo = rotatedTransform.toPdf(toPx[0], toPx[1]);
        const edgeAngleDeg = (Math.atan2(pTo.y - pFrom.y, pTo.x - pFrom.x) * 180) / Math.PI;

        expect(placement).not.toBeNull();
        expect(placement.edgeAngleDeg).toBeCloseTo(edgeAngleDeg, 1);
        expect(anglesParallel(
            placement.angle,
            pickTextAngleWithBottomTowardInterior(
                edgeAngleDeg,
                placement.x,
                placement.y,
                interiorRefPdf(eastRoute, startSpec.stationFt, startSpec.position)
            )
        )).toBe(true);
        expect(pointInPdfRing(
            placement.x,
            placement.y,
            buildPdfRingFromPixelRing(rotatedPixelRing, rotatedTransform)
        )).toBe(false);
        expect(Math.abs(placement.angle)).not.toBeCloseTo(90, 0);
    });

    it('places the start-cap label outside the polygon on the west edge', () => {
        const sheet = detailSheets[1];
        const registry = buildCorridorMatchLineRegistry(detailSheets, eastRoute);
        const frames = buildSheetFramesGeoJson(detailSheets, eastRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const framePixelRing = frameRing.map(([lng, lat]) => {
            const point = map.project([lng, lat]);
            return [point.x, point.y];
        });
        const pdfRing = buildPdfRingFromPixelRing(framePixelRing, transform);
        const startCap = registry.get(stationKey(sheet.startDistanceFt));
        const startSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[0];

        const placement = computeSheetEdgeSeeLabelPlacement(
            startSpec,
            startCap,
            eastRoute,
            transform,
            map,
            1,
            framePixelRing,
            frameRing
        );

        expect(placement?.text).toBe('SEE SHEET 01');
        expect(pointInPdfRing(placement.x, placement.y, pdfRing)).toBe(false);
        expect(placement.x).toBeLessThan(placement.midX);
    });

    it('places the end-cap label outside the polygon on the east edge', () => {
        const sheet = detailSheets[1];
        const registry = buildCorridorMatchLineRegistry(detailSheets, eastRoute);
        const frames = buildSheetFramesGeoJson(detailSheets, eastRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const framePixelRing = frameRing.map(([lng, lat]) => {
            const point = map.project([lng, lat]);
            return [point.x, point.y];
        });
        const pdfRing = buildPdfRingFromPixelRing(framePixelRing, transform);
        const endCap = registry.get(stationKey(sheet.endDistanceFt));
        const endSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[1];

        const placement = computeSheetEdgeSeeLabelPlacement(
            endSpec,
            endCap,
            eastRoute,
            transform,
            map,
            1,
            framePixelRing,
            frameRing
        );

        expect(placement?.text).toBe('SEE SHEET 03');
        expect(pointInPdfRing(placement.x, placement.y, pdfRing)).toBe(false);
        expect(placement.x).toBeGreaterThan(placement.midX);
    });

    it('mirrors start-cap labels to the exterior side on reversed route flow', () => {
        const westRoute = turf.lineString([
            [-111.8, 40.0],
            [-111.9, 40.0],
            [-112.0, 40.0]
        ]);
        const sheets = [
            { sheetId: 's1', sheetNumber: 1, startDistanceFt: 0, endDistanceFt: 1100, mapFrameWidthFt: 1100, mapFrameHeightFt: 350 },
            { sheetId: 's2', sheetNumber: 2, startDistanceFt: 1100, endDistanceFt: 2200, mapFrameWidthFt: 1100, mapFrameHeightFt: 350 }
        ];
        const sheet = sheets[1];
        const registry = buildCorridorMatchLineRegistry(sheets, westRoute);
        const frames = buildSheetFramesGeoJson(sheets, westRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const framePixelRing = frameRing.map(([lng, lat]) => {
            const point = map.project([lng, lat]);
            return [point.x, point.y];
        });
        const westTransform = buildSheetPageTransform(
            framePixelRing,
            marginsPt,
            pageSize,
            { preferLandscapeFlow: true }
        );
        const pdfRing = buildPdfRingFromPixelRing(framePixelRing, westTransform);
        const startCap = registry.get(stationKey(sheet.startDistanceFt));
        const startSpec = buildSheetEdgeSeeLabelSpecs(sheet, sheets.length)[0];

        const placement = computeSheetEdgeSeeLabelPlacement(
            startSpec,
            startCap,
            westRoute,
            westTransform,
            map,
            1,
            framePixelRing,
            frameRing
        );

        const interior = westTransform.projectLngLat(
            map,
            ...turf.along(westRoute, sheet.startDistanceFt + 2, { units: 'feet' }).geometry.coordinates,
            1
        );

        expect(placement?.text).toBe('SEE SHEET 01');
        expect(pointInPdfRing(placement.x, placement.y, pdfRing)).toBe(false);
        expect((placement.x - placement.midX) * (interior.x - placement.midX)
            + (placement.y - placement.midY) * (interior.y - placement.midY)).toBeLessThan(0);
        expect(placement.x).toBeGreaterThan(placement.midX);
    });

    it('resolves both edge placements for a middle sheet', () => {
        const sheet = detailSheets[1];
        const exportBearing = resolveSheetPdfBearing(sheet, eastRoute);
        const placements = resolveSheetEdgeSeeLabelPlacements(
            sheet,
            detailSheets.length,
            detailSheets,
            eastRoute,
            transform,
            map,
            1,
            exportBearing
        );

        expect(placements).toHaveLength(2);
        expect(placements.map((entry) => entry.text)).toEqual(['SEE SHEET 01', 'SEE SHEET 03']);
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
        const canvas = { width: 200, height: 200 };
        expect(pixelRingOverlapsCanvas([[300, 50], [400, 50], [400, 150], [300, 150]], canvas)).toBe(false);
        expect(pixelRingOverlapsCanvas([[20, 20], [180, 20], [180, 180], [20, 180]], canvas)).toBe(true);
        expect(pixelRingInsideCanvas([[-5, 20], [180, 20], [180, 180], [20, 180]], canvas, 2)).toBe(false);
        expect(pixelRingInsideCanvas([[20, 20], [180, 20], [180, 180], [20, 180]], canvas, 2)).toBe(true);
    });
});

describe('sheet PDF landscape-align bearing picker', () => {
    const wideRing = [
        [-1, -0.5],
        [1, -0.5],
        [1, 0.5],
        [-1, 0.5],
        [-1, -0.5]
    ];

    function createBearingCompareMap() {
        let bearing = 0;
        const listeners = {};

        const map = {
            getCenter: () => ({ lng: 0, lat: 0 }),
            getZoom: () => 10,
            getBearing: () => bearing,
            jumpTo: (camera) => {
                bearing = camera.bearing ?? bearing;
                window.setTimeout(() => {
                    map.emit('moveend');
                    map.emit('idle');
                }, 0);
            },
            loaded: () => true,
            isStyleLoaded: () => true,
            isMoving: () => false,
            areTilesLoaded: () => true,
            triggerRepaint: () => {},
            on: (event, handler) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(handler);
            },
            off: (event, handler) => {
                if (!listeners[event]) return;
                listeners[event] = listeners[event].filter((entry) => entry !== handler);
            },
            once: (event, handler) => {
                const wrapped = (...args) => {
                    map.off(event, wrapped);
                    handler(...args);
                };
                map.on(event, wrapped);
            },
            emit: (event, ...args) => {
                for (const handler of [...(listeners[event] || [])]) {
                    handler(...args);
                }
            },
            project: ([lng, lat]) => {
                const rad = (bearing * Math.PI) / 180;
                const x = lng * Math.cos(rad) - lat * Math.sin(rad);
                const y = lng * Math.sin(rad) + lat * Math.cos(rad);
                return { x: x * 100, y: y * 100 };
            }
        };

        return map;
    }

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps the start bearing when the projected ring is already wider than tall', async () => {
        const map = createBearingCompareMap();
        const chosen = await pickLandscapeAlignCaptureBearing(map, wideRing, 0, 90);
        expect(chosen).toBe(0);
        expect(measureProjectedRingSpan(map, wideRing).width).toBeGreaterThan(
            measureProjectedRingSpan(map, wideRing).height
        );
    });

    it('switches to the end bearing when only that orientation is landscape', async () => {
        const map = createBearingCompareMap();
        const chosen = await pickLandscapeAlignCaptureBearing(map, wideRing, 90, 0);
        expect(chosen).toBe(0);
    });

    it('falls back to the start bearing when neither orientation is landscape', async () => {
        const map = createBearingCompareMap();
        const chosen = await pickLandscapeAlignCaptureBearing(map, wideRing, 90, 270);
        expect(chosen).toBe(90);
    });
});

describe('sheet PDF basemap readiness helpers', () => {
    it('warns when capture pixel dimensions cannot meet the template DPI target', () => {
        const warnings = [];
        const map = {
            getContainer: () => ({ clientWidth: 200, clientHeight: 150 }),
            getCanvas: () => ({
                getContext: () => ({
                    getParameter: () => 8192
                })
            }),
            getPixelRatio: () => 1
        };

        warnIfBasemapDpiConstrained(map, DEFAULT_SHEET_TEMPLATE, (message) => warnings.push(message));

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/Basemap may look soft/i);
    });

    it('does not warn when the map panel can reach the template DPI target', () => {
        const warnings = [];
        const { widthPx, heightPx } = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE);
        const map = {
            getContainer: () => ({ clientWidth: widthPx, clientHeight: heightPx }),
            getCanvas: () => ({
                getContext: () => ({
                    getParameter: () => 8192
                })
            }),
            getPixelRatio: () => 1
        };

        warnIfBasemapDpiConstrained(map, DEFAULT_SHEET_TEMPLATE, (message) => warnings.push(message));

        expect(warnings).toHaveLength(0);
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

describe('sheet PDF export progress', () => {
    it('returns fixed percentages for folder, prep, and done phases', () => {
        expect(computeSheetExportProgress({ phase: 'folder' })).toBe(0);
        expect(computeSheetExportProgress({ phase: 'prep' })).toBe(2);
        expect(computeSheetExportProgress({ phase: 'done' })).toBe(100);
    });

    it('scales page completion up to 95% before the done phase', () => {
        expect(computeSheetExportProgress({ completedPages: 0, totalPages: 10, phase: 'pages' })).toBe(2);
        expect(computeSheetExportProgress({ completedPages: 5, totalPages: 10, phase: 'pages' })).toBe(49);
        expect(computeSheetExportProgress({ completedPages: 10, totalPages: 10, phase: 'pages' })).toBe(95);
    });
});
