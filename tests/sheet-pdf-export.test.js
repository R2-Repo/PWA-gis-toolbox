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
    measureNominalSheetClipPx,
    placeSheetCanvasOnPdfPage,
    canvasToBasemapJpegDataUrl,
    canvasToSheetUnderlayDataUrl,
    resolveDetailPageMarginsPt,
    resolveExportLayerIds,
    computeRotatedTextAnchor,
    resolveLeftHandSeeLabelVisualCenter,
    resolveRightHandSeeLabelVisualCenter,
    resolveSeeLabelVisualCenterOutside,
    resolveSheetEdgeSeeLabelPlacements,
    warnIfBasemapDpiConstrained
} from '../js/widgets/sheet-cutting/sheet-pdf-export.js';
import { prepareExportLayerVisibility, suppressMapDataLayersForCapture } from '../js/widgets/sheet-cutting/sheet-preview.js';
import {
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_DETAIL_FOOTER_GAP_IN,
    PDF_MAP_BEARING_MODES,
    TITLE_BLOCK_CELL_RATIOS,
    buildSheetContinuationLabels,
    buildSheetEdgeSeeLabelSpecs,
    buildSheetTitleBlockFooterModel,
    buildInsetTitleBlockFooterModel,
    formatRouteStationFt,
    formatSeeSheetLabel,
    formatSheetExportDate,
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
import { buildPdfRingFromPixelRing, buildSheetPageTransform, computeCapEdgePdfPlacementFromPdfPoints, findCapEdgeVertexIndices, isRightHandCapMidpoint, offsetLeftHandLabelOutsidePdfRing, offsetRightHandLabelOutsidePdfRing, placeLabelOutsidePdfCutout, pickTextAngleWithBottomTowardInterior, pointInPdfRing, resolveRightHandSeeLabelDrawPosition } from '../js/widgets/sheet-cutting/sheet-pdf-placement.js';

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

    it('keeps UDOT Fiber live layers visible during basemap capture', () => {
        const visibility = new Map([
            ['udot-fiber-lines', true],
            ['design-a', true],
            ['other-layer', true]
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
            getLayerIds: () => ['udot-fiber-lines', 'design-a', 'other-layer'],
            getLayerRecord: (layerId) => ({ layerIds: [`${layerId}-line`] }),
            toggleLayer: (layerId, show) => {
                toggled.push({ layerId, show });
                visibility.set(layerId, show);
            }
        };

        const restore = suppressMapDataLayersForCapture(mapService, ['udot-fiber-lines']);
        expect(toggled).toEqual([
            { layerId: 'design-a', show: false },
            { layerId: 'other-layer', show: false }
        ]);
        expect(visibility.get('udot-fiber-lines')).toBe(true);
        restore();
        expect(visibility.get('udot-fiber-lines')).toBe(true);
        expect(visibility.get('design-a')).toBe(true);
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

    it('reserves a footer band and gap on detail page margins', () => {
        const { marginsPt } = computeSheetExportPixelDimensions(DEFAULT_SHEET_TEMPLATE);
        const detail = resolveDetailPageMarginsPt(marginsPt, true);
        const footerPt = PDF_DETAIL_FOOTER_BAND_IN * 72;
        const gapPt = PDF_DETAIL_FOOTER_GAP_IN * 72;
        expect(detail.bottom).toBe(Math.max(marginsPt.bottom, footerPt + gapPt));
        expect(detail.bottom).toBeGreaterThan(footerPt);
        const without = resolveDetailPageMarginsPt(marginsPt, false);
        expect(without.bottom).toBe(marginsPt.bottom);
    });
});

describe('sheet export filenames', () => {
    it('keeps spaces and only replaces characters illegal in a file name', () => {
        expect(sanitizeExportFilename('My Project: Phase 1')).toBe('My Project_ Phase 1');
        expect(sanitizeExportFilename('  Belt Route  ')).toBe('Belt Route');
    });

    it('builds per-sheet PDF filenames', () => {
        expect(buildSheetPageFilename('Fiber Route', 'sheet_03')).toBe('Fiber Route_sheet_03.pdf');
        expect(buildSheetPageFilename('Fiber Route', 'overview')).toBe('Fiber Route_overview.pdf');
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

    it('formats export dates as MM/DD/YYYY', () => {
        expect(formatSheetExportDate(new Date(2026, 6, 14))).toBe('07/14/2026');
        expect(formatSheetExportDate(new Date(2026, 0, 5))).toBe('01/05/2026');
    });

    it('builds title-block footer model with project, date, sheet, and spare ratios', () => {
        const model = buildSheetTitleBlockFooterModel({
            projectName: 'Belt Route',
            exportDate: new Date(2026, 6, 14),
            sheet: { sheetNumber: 8, startDistanceFt: 0, endDistanceFt: 1000 },
            totalSheets: 15
        });
        expect(model.projectLabel).toBe('Project:');
        expect(model.projectValue).toBe('Belt Route');
        expect(buildSheetTitleBlockFooterModel({
            projectName: 'I-15 Northbound Widening',
            exportDate: '07/14/2026',
            sheet: { sheetNumber: 1 },
            totalSheets: 2
        }).projectValue).toBe('I-15 Northbound Widening');
        expect(model.dateLabel).toBe('Date:');
        expect(model.dateValue).toBe('07/14/2026');
        expect(model.sheetLabel).toBe('Sheet 08 of 15');
        expect(model.cellRatios).toEqual(TITLE_BLOCK_CELL_RATIOS);
        expect(model.cellRatios.reduce((sum, r) => sum + r, 0)).toBeCloseTo(1, 5);
    });

    it('builds a DETAILS-series title-block footer', () => {
        const model = buildInsetTitleBlockFooterModel({
            projectName: 'Belt Route',
            exportDate: '07/14/2026',
            insetPageNumber: 2,
            totalInsetPages: 3
        });
        expect(model.sheetLabel).toBe('DETAILS 02 of 03');
        expect(model.projectValue).toBe('Belt Route');
        expect(model.dateValue).toBe('07/14/2026');
    });

    it('accepts a preformatted export date string for the title-block model', () => {
        const model = buildSheetTitleBlockFooterModel({
            projectName: 'Fiber',
            exportDate: '12/01/2026',
            sheet: { sheetNumber: 1 },
            totalSheets: 3
        });
        expect(model.dateValue).toBe('12/01/2026');
        expect(model.sheetLabel).toBe('Sheet 01 of 3');
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

    it('appends packed inset pages after corridor sheets', () => {
        const plan = buildSheetPdfPagePlan({
            routeLine: curvedRoute,
            sheets: {
                template: DEFAULT_SHEET_TEMPLATE,
                overviewSheet: { sheetNumber: 0 },
                sheets: [
                    { sheetId: 'a', sheetNumber: 1, sheetType: 'detail', startDistanceFt: 0, endDistanceFt: 1100 }
                ],
                insetViews: [
                    { insetId: 'i1', label: 'A', bbox: [-111.9, 40.75, -111.89, 40.751], parentSheetId: 'a' },
                    { insetId: 'i2', label: 'B', bbox: [-111.89, 40.75, -111.88, 40.751], parentSheetId: 'a' },
                    { insetId: 'i3', label: 'C', bbox: [-111.88, 40.75, -111.87, 40.751], parentSheetId: 'a' },
                    { insetId: 'i4', label: 'D', bbox: [-111.87, 40.75, -111.86, 40.751], parentSheetId: 'a' },
                    { insetId: 'i5', label: 'E', bbox: [-111.86, 40.75, -111.85, 40.751], parentSheetId: 'a' }
                ]
            }
        });
        const insetPages = plan.pages.filter((page) => page.pageType === 'inset');
        expect(insetPages).toHaveLength(2);
        expect(insetPages[0].insetPageNumber).toBe(1);
        expect(insetPages[0].insetIds).toHaveLength(4);
        expect(insetPages[1].title).toBe('DETAILS 02 of 02');
        expect(insetPages[1].exportBearingDeg).toBe(0);
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

    it('forces right-hand draw positions into the margin even when placement math is wrong', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const placedRect = { x: 100, y: 200, width: 400, height: 200 };
        const transform = {
            placedRect,
            toPdf: (px, py) => ({ x: px, y: py })
        };
        const wrongPlacement = {
            text: 'SEE SHEET 01',
            x: 470,
            y: 300,
            midX: 500,
            midY: 300,
            angle: 90,
            edgeAngleDeg: 90
        };

        expect(isRightHandCapMidpoint(500, placedRect, pdfRing)).toBe(true);
        expect(isRightHandCapMidpoint(100, placedRect, pdfRing)).toBe(false);

        const fixed = resolveRightHandSeeLabelDrawPosition(
            wrongPlacement,
            transform,
            [[500, 200], [500, 400], [100, 400], [100, 200]],
            EDGE_SEE_LABEL_OFFSET_PT
        );

        expect(fixed.x).toBeGreaterThan(wrongPlacement.midX);
        expect(pointInPdfRing(fixed.x, fixed.y, pdfRing)).toBe(false);
        expect(fixed.y).toBe(300);
        expect(fixed.text).toBe('SEE SHEET 01');
    });

    it('offsets right-hand match-line labels away from sheet interior even when centroid normal inverts', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 250 },
            { x: 700, y: 250 },
            { x: 700, y: 350 },
            { x: 500, y: 350 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const pLeft = { x: 500, y: 250 };
        const pRight = { x: 500, y: 350 };
        const interiorRefPdf = { x: 420, y: 300 };
        const placedRect = { x: 100, y: 200, width: 600, height: 200 };

        const placement = computeCapEdgePdfPlacementFromPdfPoints(
            pLeft,
            pRight,
            interiorRefPdf,
            EDGE_SEE_LABEL_OFFSET_PT,
            pdfRing,
            placedRect
        );

        expect(placement).not.toBeNull();
        expect(pointInPdfRing(placement.x, placement.y, pdfRing)).toBe(false);
        expect(placement.x).toBeGreaterThan(placement.midX);
        expect(placement.x).toBeGreaterThanOrEqual(700);
        expect(placement.y).toBeCloseTo(placement.midY, 0);
    });

    it('pushes right-hand labels past the match-line mid even when they start inside', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        // Simulate the bug: label center sits just inside the right match line
        const inside = offsetRightHandLabelOutsidePdfRing(500, 300, EDGE_SEE_LABEL_OFFSET_PT, pdfRing);
        expect(inside.x).toBeGreaterThan(500);
        expect(pointInPdfRing(inside.x, inside.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(495, 300, pdfRing)).toBe(true);
    });

    it('pushes left-hand labels past the match-line mid even when they start inside', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const outside = offsetLeftHandLabelOutsidePdfRing(100, 300, EDGE_SEE_LABEL_OFFSET_PT, pdfRing);
        expect(outside.x).toBeLessThan(100);
        expect(pointInPdfRing(outside.x, outside.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(105, 300, pdfRing)).toBe(true);
    });

    it('forces right-hand visual centers past the cutout max X', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 40, h: 8 })
        };
        const visual = resolveRightHandSeeLabelVisualCenter(
            doc,
            {
                text: 'SEE SHEET 02',
                x: 490,
                y: 300,
                midX: 500,
                midY: 300,
                angle: 90,
                edgeAngleDeg: 90
            },
            pdfRing,
            { x: 300, y: 300 }
        );

        expect(visual.x).toBeGreaterThan(500);
        expect(pointInPdfRing(visual.x, visual.y, pdfRing)).toBe(false);
        expect(visual.y).toBe(300);
        expect(visual.x - 500).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
        expect(visual.x - 500).toBeLessThan(40);
    });

    it('centers rotated SEE SHEET text with left/middle jsPDF anchors', () => {
        // Regression: align:'center'+angle put right-hand glyphs inside the cutout.
        const width = 40;
        const cx = 520;
        const cy = 300;

        const vertical = computeRotatedTextAnchor(cx, cy, width, 90);
        expect(vertical.x).toBeCloseTo(cx, 5);
        expect(vertical.y).toBeCloseTo(cy + width / 2, 5);

        const tilted = computeRotatedTextAnchor(cx, cy, width, 75);
        const rad = (75 * Math.PI) / 180;
        expect(tilted.x).toBeCloseTo(cx - (width / 2) * Math.cos(rad), 5);
        expect(tilted.y).toBeCloseTo(cy + (width / 2) * Math.sin(rad), 5);

        // jsPDF run direction in page y-down is (cos, -sin).
        expect(tilted.x + (width / 2) * Math.cos(rad)).toBeCloseTo(cx, 5);
        expect(tilted.y - (width / 2) * Math.sin(rad)).toBeCloseTo(cy, 5);
    });

    it('keeps tilted right-hand glyph boxes outside the cutout', () => {
        // Parallelogram like the Belt Route sheet: right match line is not at max X.
        const pdfRing = [
            { x: 120, y: 180 },
            { x: 520, y: 140 },
            { x: 560, y: 420 },
            { x: 160, y: 460 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 48, h: 8 })
        };
        const midX = 540;
        const midY = 280;
        const visual = resolveRightHandSeeLabelVisualCenter(
            doc,
            {
                text: 'SEE SHEET 02',
                x: midX - 8,
                y: midY,
                midX,
                midY,
                angle: 75,
                edgeAngleDeg: 75
            },
            pdfRing,
            { x: 340, y: 300 }
        );

        // Standoff is perpendicular to the match-line, not the sheet bbox max X.
        const dist = Math.hypot(visual.x - midX, visual.y - midY);
        expect(dist).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
        expect(pointInPdfRing(visual.x, visual.y, pdfRing)).toBe(false);
    });

    it('keeps parallelogram matchline labels outside on both sides', () => {
        const pdfRing = [
            { x: 120, y: 180 },
            { x: 520, y: 140 },
            { x: 560, y: 420 },
            { x: 160, y: 460 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 48, h: 8 })
        };
        const left = resolveSeeLabelVisualCenterOutside(
            doc,
            {
                text: 'SEE SHEET 05',
                x: 140,
                y: 320,
                midX: 140,
                midY: 320,
                angle: 82,
                edgeAngleDeg: 82
            },
            pdfRing,
            { x: 340, y: 300 },
            'left'
        );
        const right = resolveSeeLabelVisualCenterOutside(
            doc,
            {
                text: 'SEE SHEET 03',
                x: 540,
                y: 280,
                midX: 540,
                midY: 280,
                angle: 82,
                edgeAngleDeg: 82
            },
            pdfRing,
            { x: 340, y: 300 },
            'right'
        );

        expect(pointInPdfRing(left.x, left.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(right.x, right.y, pdfRing)).toBe(false);
        expect(Math.hypot(left.x - 140, left.y - 320)).toBeLessThan(40);
        expect(Math.hypot(right.x - 540, right.y - 280)).toBeLessThan(40);
    });

    it('pushes a slightly-inside matchline mid outside a skewed cutout', () => {
        const pdfRing = [
            { x: 120, y: 180 },
            { x: 520, y: 140 },
            { x: 560, y: 420 },
            { x: 160, y: 460 }
        ];
        const midX = 540;
        const midY = 280;
        const insideX = midX - 6;
        const insideY = midY;
        expect(pointInPdfRing(insideX, insideY, pdfRing)).toBe(true);

        const placed = placeLabelOutsidePdfCutout(
            insideX,
            insideY,
            82,
            EDGE_SEE_LABEL_OFFSET_PT,
            pdfRing,
            { x: 340, y: 300 }
        );

        expect(pointInPdfRing(placed.x, placed.y, pdfRing)).toBe(false);
        expect(Math.hypot(placed.x - midX, placed.y - midY)).toBeLessThan(40);
    });

    it('does not walk back inside when the cap mid is already just outside', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const placed = placeLabelOutsidePdfCutout(
            502,
            300,
            90,
            EDGE_SEE_LABEL_OFFSET_PT,
            pdfRing,
            { x: 300, y: 300 }
        );

        expect(pointInPdfRing(placed.x, placed.y, pdfRing)).toBe(false);
        expect(placed.x).toBeGreaterThan(500);
        expect(placed.x - 500).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
    });

    it('keeps parallelogram labels outside even when the centroid is on the wrong side', () => {
        const pdfRing = [
            { x: 120, y: 180 },
            { x: 520, y: 140 },
            { x: 560, y: 420 },
            { x: 160, y: 460 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 48, h: 8 })
        };
        const visual = resolveSeeLabelVisualCenterOutside(
            doc,
            {
                text: 'SEE SHEET 07',
                x: 540,
                y: 280,
                midX: 540,
                midY: 280,
                angle: 82,
                edgeAngleDeg: 82,
                interiorRefPdf: { x: 340, y: 300 }
            },
            pdfRing,
            { x: 700, y: 280 },
            'right'
        );

        expect(pointInPdfRing(visual.x, visual.y, pdfRing)).toBe(false);
        expect(visual.x).toBeGreaterThan(540);
    });

    it('forces left-hand visual centers outside near the match-line mid', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 40, h: 8 })
        };
        const visual = resolveLeftHandSeeLabelVisualCenter(
            doc,
            {
                text: 'SEE SHEET 05',
                x: 110,
                y: 300,
                midX: 100,
                midY: 300,
                angle: -90,
                edgeAngleDeg: -90
            },
            pdfRing,
            { x: 300, y: 300 }
        );

        expect(visual.x).toBeLessThan(100);
        expect(pointInPdfRing(visual.x, visual.y, pdfRing)).toBe(false);
        expect(visual.y).toBe(300);
        expect(100 - visual.x).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
    });

    it('does not pull left labels to the sheet bbox when the polygon is skewed', () => {
        // Left match mid is near x=140, but a distant corner reaches x=40.
        const pdfRing = [
            { x: 40, y: 120 },
            { x: 520, y: 160 },
            { x: 560, y: 440 },
            { x: 140, y: 400 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 40, h: 8 })
        };
        const midX = 140;
        const midY = 300;
        const visual = resolveLeftHandSeeLabelVisualCenter(
            doc,
            {
                text: 'SEE SHEET 06',
                x: midX + 10,
                y: midY,
                midX,
                midY,
                angle: -90,
                edgeAngleDeg: -90
            },
            pdfRing,
            { x: 320, y: 300 }
        );

        expect(pointInPdfRing(visual.x, visual.y, pdfRing)).toBe(false);
        expect(visual.x).toBeLessThan(midX);
        const dist = Math.hypot(visual.x - midX, visual.y - midY);
        expect(dist).toBeGreaterThanOrEqual(EDGE_SEE_LABEL_OFFSET_PT);
        expect(dist).toBeLessThan(80);
        expect(visual.x).toBeGreaterThan(40);
    });

    it('places both page-side labels outside the cutout consistently', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 40, h: 8 })
        };
        const centroid = { x: 300, y: 300 };
        const left = resolveSeeLabelVisualCenterOutside(
            doc,
            {
                text: 'SEE SHEET 05',
                x: 110,
                y: 300,
                midX: 100,
                midY: 300,
                angle: -90,
                edgeAngleDeg: -90
            },
            pdfRing,
            centroid,
            'left'
        );
        const right = resolveSeeLabelVisualCenterOutside(
            doc,
            {
                text: 'SEE SHEET 03',
                x: 490,
                y: 300,
                midX: 500,
                midY: 300,
                angle: 90,
                edgeAngleDeg: 90
            },
            pdfRing,
            centroid,
            'right'
        );

        expect(pointInPdfRing(left.x, left.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(right.x, right.y, pdfRing)).toBe(false);
        expect(left.x).toBeLessThan(100);
        expect(right.x).toBeGreaterThan(500);
        expect(100 - left.x).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
        expect(right.x - 500).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
        expect(100 - left.x).toBeCloseTo(right.x - 500, 5);
    });

    it('never leaves SEE SHEET text inside the cutout when the normal points inward', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const doc = {
            setFontSize() {},
            getTextDimensions: () => ({ w: 40, h: 8 })
        };
        // Interior reference is on the outside of the right match line, which
        // previously flipped the normal inward and parked the label in the sheet.
        const visual = resolveSeeLabelVisualCenterOutside(
            doc,
            {
                text: 'SEE SHEET 06',
                x: 490,
                y: 300,
                midX: 500,
                midY: 300,
                angle: 90,
                edgeAngleDeg: 90
            },
            pdfRing,
            { x: 700, y: 300 },
            'right'
        );

        expect(pointInPdfRing(visual.x, visual.y, pdfRing)).toBe(false);
        expect(visual.x).toBeGreaterThan(500);
    });

    it('centers labels on a slanted cutout edge with a constant perpendicular offset', () => {
        const pFrom = { x: 200, y: 120 };
        const pTo = { x: 280, y: 480 };
        const pdfRing = [
            { x: 80, y: 140 },
            pFrom,
            pTo,
            { x: 60, y: 500 }
        ];
        const interiorRefPdf = { x: 140, y: 310 };
        const placedRect = { x: 60, y: 120, width: 220, height: 380 };
        const placement = computeCapEdgePdfPlacementFromPdfPoints(
            pFrom,
            pTo,
            interiorRefPdf,
            EDGE_SEE_LABEL_OFFSET_PT,
            pdfRing,
            placedRect
        );

        expect(placement).not.toBeNull();
        expect(placement.midX).toBeCloseTo((pFrom.x + pTo.x) / 2, 5);
        expect(placement.midY).toBeCloseTo((pFrom.y + pTo.y) / 2, 5);

        const edgeDx = pTo.x - pFrom.x;
        const edgeDy = pTo.y - pFrom.y;
        const edgeLen = Math.hypot(edgeDx, edgeDy);
        const toLabelX = placement.x - placement.midX;
        const toLabelY = placement.y - placement.midY;
        // Offset is perpendicular to the border, so the along-edge component is ~0.
        expect((toLabelX * edgeDx + toLabelY * edgeDy) / edgeLen).toBeCloseTo(0, 5);
        expect(Math.hypot(toLabelX, toLabelY)).toBeCloseTo(EDGE_SEE_LABEL_OFFSET_PT, 5);
        expect(pointInPdfRing(placement.x, placement.y, pdfRing)).toBe(false);
    });

    it('offsets left-hand match-line labels away from sheet interior', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const pLeft = { x: 100, y: 200 };
        const pRight = { x: 100, y: 400 };
        const interiorRefPdf = { x: 300, y: 300 };
        const placedRect = { x: 100, y: 200, width: 400, height: 200 };

        const placement = computeCapEdgePdfPlacementFromPdfPoints(
            pLeft,
            pRight,
            interiorRefPdf,
            EDGE_SEE_LABEL_OFFSET_PT,
            pdfRing,
            placedRect
        );

        expect(placement).not.toBeNull();
        expect(pointInPdfRing(placement.x, placement.y, pdfRing)).toBe(false);
        expect(placement.x).toBeLessThan(placement.midX);
        expect(placement.x).toBeLessThan(100);
    });

    it('places right-side cap labels outside the polygon when route reads right-to-left on page', () => {
        const sheet = detailSheets[1];
        const registry = buildCorridorMatchLineRegistry(detailSheets, eastRoute);
        const frames = buildSheetFramesGeoJson(detailSheets, eastRoute).features;
        const frameRing = frames[1].geometry.coordinates[0];
        const rtlMap = {
            project: ([lng, lat]) => {
                const point = map.project([lng, lat]);
                return { x: 1200 - point.x, y: point.y };
            }
        };
        const framePixelRing = frameRing.map(([lng, lat]) => {
            const point = rtlMap.project([lng, lat]);
            return [point.x, point.y];
        });
        const rtlTransform = buildSheetPageTransform(
            framePixelRing,
            marginsPt,
            pageSize,
            { preferLandscapeFlow: true }
        );
        const pdfRing = buildPdfRingFromPixelRing(framePixelRing, rtlTransform);
        const startCap = registry.get(stationKey(sheet.startDistanceFt));
        const endCap = registry.get(stationKey(sheet.endDistanceFt));
        const startSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[0];
        const endSpec = buildSheetEdgeSeeLabelSpecs(sheet, detailSheets.length)[1];

        const startPlacement = computeSheetEdgeSeeLabelPlacement(
            startSpec,
            startCap,
            eastRoute,
            rtlTransform,
            rtlMap,
            1,
            framePixelRing,
            frameRing
        );
        const endPlacement = computeSheetEdgeSeeLabelPlacement(
            endSpec,
            endCap,
            eastRoute,
            rtlTransform,
            rtlMap,
            1,
            framePixelRing,
            frameRing
        );

        expect(startPlacement?.text).toBe('SEE SHEET 01');
        expect(endPlacement?.text).toBe('SEE SHEET 03');
        expect(pointInPdfRing(startPlacement.x, startPlacement.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(endPlacement.x, endPlacement.y, pdfRing)).toBe(false);
        expect(startPlacement.x).toBeGreaterThan(startPlacement.midX);
        expect(endPlacement.x).toBeLessThan(endPlacement.midX);
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
        const placed = { width: 0, height: 0, format: '' };
        const doc = {
            internal: { pageSize: { getWidth: () => 1224, getHeight: () => 792 } },
            addImage: (_data, fmt, _x, _y, width, height) => {
                placed.format = fmt;
                placed.width = width;
                placed.height = height;
            }
        };
        const canvas = {
            width: 2000,
            height: 600,
            toDataURL: (type) => (type === 'image/jpeg' ? 'data:image/jpeg;base64,abc' : 'data:image/png;base64,abc')
        };
        const marginsPt = { top: 36, right: 36, bottom: 36, left: 36 };

        placeSheetCanvasOnPdfPage(doc, canvas, marginsPt, { preferLandscapeFlow: true });

        const availW = 1224 - 72;
        expect(placed.format).toBe('JPEG');
        expect(placed.width).toBeCloseTo(availW, 0);
        expect(placed.height).toBeLessThan(availW);
    });

    it('encodes the basemap as JPEG after flattening onto white', () => {
        const calls = [];
        const canvas = {
            width: 4,
            height: 3,
            toDataURL: (type, quality) => {
                calls.push({ type, quality });
                return 'data:image/jpeg;base64,abc';
            }
        };

        expect(canvasToBasemapJpegDataUrl(canvas)).toBe('data:image/jpeg;base64,abc');
        expect(calls).toEqual([{ type: 'image/jpeg', quality: 0.88 }]);
    });

    it('embeds Fiber underlays as PNG', () => {
        const placed = { format: '' };
        const doc = {
            internal: { pageSize: { getWidth: () => 1224, getHeight: () => 792 } },
            addImage: (_data, fmt) => {
                placed.format = fmt;
            }
        };
        const canvas = {
            width: 200,
            height: 100,
            toDataURL: (type) => (type === 'image/png' ? 'data:image/png;base64,abc' : 'data:image/jpeg;base64,abc')
        };
        placeSheetCanvasOnPdfPage(doc, canvas, { top: 36, right: 36, bottom: 36, left: 36 }, {
            imageFormat: 'PNG'
        });
        expect(placed.format).toBe('PNG');
        expect(canvasToSheetUnderlayDataUrl(canvas, 'PNG').format).toBe('PNG');
    });
});

describe('nominal sheet clip measurement', () => {
    function mockMap(bearing = 0) {
        const center = { lng: -111.89, lat: 40.76 };
        const latRad = center.lat * Math.PI / 180;
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(latRad);
        const pxPerM = 2;
        return {
            getCenter: () => center,
            getBearing: () => bearing,
            project: ([lng, lat]) => ({
                x: (lng - center.lng) * metersPerDegLng * pxPerM,
                y: (center.lat - lat) * metersPerDegLat * pxPerM
            })
        };
    }

    it('returns a landscape nominal window from sheet length and corridor width', () => {
        const measured = measureNominalSheetClipPx(mockMap(0), {
            sheetLengthFt: 1100,
            corridorWidthFt: 350
        }, 1);

        expect(measured).not.toBeNull();
        expect(measured.widthPx).toBeGreaterThan(measured.heightPx);
        expect(measured.widthPx / measured.heightPx).toBeCloseTo(1100 / 350, 1);
    });

    it('scales with captureScale', () => {
        const map = mockMap(0);
        const template = { sheetLengthFt: 1100, corridorWidthFt: 350 };
        const at1 = measureNominalSheetClipPx(map, template, 1);
        const at2 = measureNominalSheetClipPx(map, template, 2);
        expect(at2.widthPx).toBeCloseTo(at1.widthPx * 2, 5);
        expect(at2.heightPx).toBeCloseTo(at1.heightPx * 2, 5);
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
