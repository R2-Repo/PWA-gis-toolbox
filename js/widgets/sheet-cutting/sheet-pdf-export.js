/**
 * Sheet plan PDF export — hybrid vector overlay + basemap underlay per page.
 * Written one file at a time to a user-chosen folder (File System Access API).
 */

import { loadJsPDF } from '../../core/libs.js';
import {
    isFolderExportSupported,
    pickExportFolder,
    sanitizeExportFilename,
    writeBlobToFolder
} from '../../export/folder-export.js';
import {
    captureLiveFrame,
    captureMapCanvas,
    computePixelRatioForTargetDimensions,
    ensureMapFrameReady,
    SHEET_EXPORT_MAX_PIXEL_RATIO,
    suspendMapInteractions
} from '../../map/map-export.js';
import { extractPrimaryRing, buildSharedMatchLineRegistry, stationKey } from './export-builder.js';
import {
    boundsFromGeoJson,
    buildSingleSheetFrameCollection,
    clearSheetPreview,
    showSheetPreview,
    suppressMapDataLayersForCapture,
} from './sheet-preview.js';
import {
    PAGE_ORIENTATIONS,
    computePdfPageSizePt,
    computeSheetExportPixelDimensions,
    DEFAULT_BASEMAP_DPI,
    resolveBasemapDpi
} from './engine.js';
import {
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_MAP_BEARING_MODES,
    DEFAULT_PDF_MAP_BEARING_MODE,
    buildSheetContinuationLabels,
    buildSheetEdgeSeeLabelSpecs,
    normalizeDegrees,
    resolveSheetPdfBearing,
    resolveSheetPdfBearings
} from './sheet-pdf-orientation.js';
import { getLocalTangentBearing } from '../project-stationing/engine.js';
import { buildSheetPageTransform, computeSheetImagePlacement } from './sheet-pdf-placement.js';
import { renderFeatureCollectionToPdf } from './sheet-pdf-vector.js';

const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 18;
/** Safety margin (CSS px) kept between polygon vertices and the map canvas edge. */
const SHEET_CAPTURE_EDGE_MARGIN_PX = 56;
const NORTH_ARROW_SIZE_PT = 28;
/** Ground offset from match-line cap to place SEE SHEET labels outside the polygon. */
const EDGE_SEE_LABEL_OFFSET_FT = 20;
const EDGE_SEE_LABEL_FONT_PT = 7.5;

/**
 * @param {import('maplibre-gl').Map} map
 * @returns {Promise<void>}
 */
function waitForMapSettled(map) {
    return new Promise((resolve) => {
        if (!map) {
            resolve();
            return;
        }
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            map.off('moveend', finish);
            map.off('idle', finish);
            resolve();
        };
        map.once('moveend', finish);
        map.once('idle', finish);
        map.triggerRepaint();
        window.setTimeout(finish, 2000);
    });
}

/**
 * @param {import('maplibre-gl').Map} map
 * @returns {object}
 */
export function saveMapCamera(map) {
    const center = map.getCenter();
    return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
    };
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {object} camera
 */
export function restoreMapCamera(map, camera) {
    if (!map || !camera) return;
    map.jumpTo({
        center: camera.center,
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch
    });
}

/**
 * @param {object} mapService
 * @param {[[number, number], [number, number]]} bounds
 * @param {object} [options]
 */
export async function fitMapToBounds(mapService, bounds, options = {}) {
    const map = mapService?.getMap?.();
    if (!map || !bounds) return;

    const fitOptions = {
        padding: options.padding ?? FIT_PADDING,
        maxZoom: options.maxZoom ?? FIT_MAX_ZOOM,
        duration: options.duration ?? 0,
        bearing: options.bearing ?? 0,
        pitch: options.pitch ?? 0
    };

    if (typeof map.cameraForBounds === 'function') {
        const camera = map.cameraForBounds(bounds, fitOptions);
        map.jumpTo({ ...camera, duration: fitOptions.duration });
    } else {
        map.fitBounds(bounds, fitOptions);
    }

    await waitForMapSettled(map);
    await ensureMapFrameReady(map);
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ring
 * @param {number} marginPx
 * @returns {boolean}
 */
export function polygonRingFitsViewport(map, ring, marginPx = SHEET_CAPTURE_EDGE_MARGIN_PX) {
    if (!map || !ring?.length) return false;

    const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
    const cssH = Math.max(1, map.getContainer()?.clientHeight || 1);
    const inset = Math.max(0, marginPx);

    for (const [lng, lat] of ring) {
        const point = map.project([lng, lat]);
        if (
            point.x < inset
            || point.y < inset
            || point.x > cssW - inset
            || point.y > cssH - inset
        ) {
            return false;
        }
    }

    return true;
}

/**
 * True when every vertex of a device-pixel ring sits inside the canvas with margin.
 * @param {number[][]} pixelRing
 * @param {HTMLCanvasElement} canvas
 * @param {number} [marginPx]
 * @returns {boolean}
 */
export function pixelRingInsideCanvas(pixelRing, canvas, marginPx = 2) {
    if (!pixelRing?.length || !canvas) return false;

    const inset = Math.max(0, marginPx);
    const epsilon = 0.75;
    for (const [x, y] of pixelRing) {
        if (
            x < inset - epsilon
            || y < inset - epsilon
            || x > canvas.width - inset + epsilon
            || y > canvas.height - inset + epsilon
        ) {
            return false;
        }
    }

    return true;
}

/**
 * True when a device-pixel ring overlaps the captured map canvas with usable area.
 * @param {number[][]} pixelRing
 * @param {HTMLCanvasElement} canvas
 * @returns {boolean}
 */
export function pixelRingOverlapsCanvas(pixelRing, canvas) {
    if (!pixelRing?.length || !canvas) return false;

    const xs = pixelRing.map(([x]) => x);
    const ys = pixelRing.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return maxX > 0
        && minX < canvas.width
        && maxY > 0
        && minY < canvas.height
        && (maxX - minX) > 1
        && (maxY - minY) > 1
        && pixelRingInsideCanvas(pixelRing, canvas, 2);
}

/**
 * Measure a polygon ring in CSS pixel coordinates.
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ring
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number }}
 */
function measureRingInCssPixels(map, ring) {
    const projected = ring.map(([lng, lat]) => map.project([lng, lat]));
    return {
        minX: Math.min(...projected.map((point) => point.x)),
        maxX: Math.max(...projected.map((point) => point.x)),
        minY: Math.min(...projected.map((point) => point.y)),
        maxY: Math.max(...projected.map((point) => point.y))
    };
}

/**
 * Center the polygon ring in the map viewport.
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ring
 */
async function centerRingInViewport(map, ring) {
    const bounds = measureRingInCssPixels(map, ring);
    const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
    const cssH = Math.max(1, map.getContainer()?.clientHeight || 1);
    const polyCenterX = (bounds.minX + bounds.maxX) / 2;
    const polyCenterY = (bounds.minY + bounds.maxY) / 2;
    map.panBy([cssW / 2 - polyCenterX, cssH / 2 - polyCenterY], { duration: 0 });
    await ensureMapFrameReady(map);
}

/**
 * Zoom out only as needed so every polygon vertex fits inside the viewport margin.
 *
 * @param {object} mapService
 * @param {number[][]} ring
 * @param {object} [options]
 */
export async function ensureRingFitsCaptureViewport(mapService, ring, options = {}) {
    const map = mapService?.getMap?.();
    if (!map || !ring?.length) return;

    const marginPx = options.marginPx ?? SHEET_CAPTURE_EDGE_MARGIN_PX;
    const maxPasses = options.maxPasses ?? 6;
    const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
    const cssH = Math.max(1, map.getContainer()?.clientHeight || 1);

    for (let pass = 0; pass < maxPasses; pass++) {
        if (polygonRingFitsViewport(map, ring, marginPx)) {
            await centerRingInViewport(map, ring);
            if (polygonRingFitsViewport(map, ring, marginPx)) {
                return;
            }
        }

        const bounds = measureRingInCssPixels(map, ring);
        const spanX = Math.max(1, bounds.maxX - bounds.minX);
        const spanY = Math.max(1, bounds.maxY - bounds.minY);
        const scale = Math.min(
            (cssW - marginPx * 2) / spanX,
            (cssH - marginPx * 2) / spanY,
            1
        );

        if (!Number.isFinite(scale) || scale >= 0.999) {
            if (!polygonRingFitsViewport(map, ring, marginPx)) {
                map.zoomTo(map.getZoom() + Math.log2(0.9), { duration: 0 });
                await ensureMapFrameReady(map);
                continue;
            }
            return;
        }

        map.zoomTo(map.getZoom() + Math.log2(scale), { duration: 0 });
        await ensureMapFrameReady(map);
    }
}

/**
 * @param {object} mapService
 * @param {number[][]} ring
 * @param {object} [options]
 */
export async function fitMapToPolygonRing(mapService, ring, options = {}) {
    const map = mapService?.getMap?.();
    if (!map || !ring?.length) return;

    const padding = options.padding ?? FIT_PADDING;
    const maxZoom = options.maxZoom ?? FIT_MAX_ZOOM;
    const bearing = options.bearing ?? 0;
    const captureMarginPx = options.captureMarginPx ?? SHEET_CAPTURE_EDGE_MARGIN_PX;
    const bounds = boundsFromGeoJson({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] }
    });

    map.jumpTo({ bearing, pitch: options.pitch ?? 0, duration: 0 });
    await ensureMapFrameReady(map);

    if (bounds) {
        await fitMapToBounds(mapService, bounds, {
            padding: padding + captureMarginPx,
            maxZoom,
            bearing,
            pitch: options.pitch ?? 0,
            duration: options.duration ?? 0
        });
    }

    await ensureRingFitsCaptureViewport(mapService, ring, { marginPx: captureMarginPx });
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ringLngLat
 * @returns {number[][]}
 */
export function projectRingToDevicePixels(map, ringLngLat) {
    const container = map.getContainer();
    const cssW = Math.max(1, container?.clientWidth || 1);
    const canvas = map.getCanvas();
    const scale = canvas.width / cssW;

    return ringLngLat.map(([lng, lat]) => {
        const point = map.project([lng, lat]);
        return [point.x * scale, point.y * scale];
    });
}

/**
 * Clip a map capture to a polygon ring in device-pixel coordinates.
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {number[][]} pixelRing
 * @returns {HTMLCanvasElement}
 */
export function clipMapCanvasToPolygonRing(sourceCanvas, pixelRing) {
    if (!pixelRing?.length) {
        throw new Error('Sheet polygon ring is empty');
    }

    const xs = pixelRing.map(([x]) => x);
    const ys = pixelRing.map(([, y]) => y);
    const minX = Math.floor(Math.min(...xs));
    const minY = Math.floor(Math.min(...ys));
    const maxX = Math.ceil(Math.max(...xs));
    const maxY = Math.ceil(Math.max(...ys));
    const outW = Math.max(1, maxX - minX);
    const outH = Math.max(1, maxY - minY);

    const output = document.createElement('canvas');
    output.width = outW;
    output.height = outH;
    const ctx = output.getContext('2d');
    if (!ctx) {
        throw new Error('Map clip failed');
    }

    ctx.beginPath();
    const translated = pixelRing.map(([x, y]) => [x - minX, y - minY]);
    ctx.moveTo(translated[0][0], translated[0][1]);
    for (let i = 1; i < translated.length; i++) {
        ctx.lineTo(translated[i][0], translated[i][1]);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(sourceCanvas, -minX, -minY);
    return output;
}

/**
 * @param {object} marginsPt
 * @param {boolean} [includeFooterBand]
 * @returns {object}
 */
export function resolveDetailPageMarginsPt(marginsPt, includeFooterBand = true) {
    const footerPt = includeFooterBand ? PDF_DETAIL_FOOTER_BAND_IN * 72 : 0;
    return {
        top: marginsPt.top,
        right: marginsPt.right,
        bottom: marginsPt.bottom + footerPt,
        left: marginsPt.left
    };
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} sizePt
 * @param {number} mapBearingDeg
 */
export function drawNorthArrowOnPdf(doc, centerX, centerY, sizePt, mapBearingDeg) {
    const angle = -Number(mapBearingDeg || 0);
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rot = (x, y) => [
        centerX + x * cos - y * sin,
        centerY + x * sin + y * cos
    ];

    const shaft = sizePt * 0.5;
    const head = sizePt * 0.2;
    const [topX, topY] = rot(0, -shaft - head);
    const [baseX, baseY] = rot(0, shaft * 0.15);
    const [leftX, leftY] = rot(-head * 0.55, -shaft + head * 0.15);
    const [rightX, rightY] = rot(head * 0.55, -shaft + head * 0.15);
    const [labelX, labelY] = rot(0, -shaft - head - 10);

    doc.setDrawColor(20, 20, 20);
    doc.setFillColor(20, 20, 20);
    doc.setLineWidth(1.1);
    doc.line(baseX, baseY, topX, topY);
    doc.triangle(topX, topY, leftX, leftY, rightX, rightY, 'F');
    doc.setFontSize(9);
    doc.text('N', labelX, labelY, { align: 'center' });
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} sheet
 * @param {number} totalSheets
 * @param {object} marginsPt
 */
export function drawSheetContinuationFooter(doc, sheet, totalSheets, marginsPt) {
    const labels = buildSheetContinuationLabels(sheet, totalSheets);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const footerTop = pageH - marginsPt.bottom + 6;
    const leftX = marginsPt.left;
    const rightX = pageW - marginsPt.right;
    const centerX = pageW / 2;

    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text(labels.sheetLabel, leftX, footerTop, { align: 'left' });
    doc.text(labels.stationRange, centerX, footerTop, { align: 'center' });

    const continuationParts = [labels.continueFrom, labels.continueTo].filter(Boolean);
    if (continuationParts.length) {
        doc.text(continuationParts.join('   '), rightX, footerTop, { align: 'right' });
    }
}

/**
 * @param {object} spec
 * @param {{ left: number[], right: number[] }} cap
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {object} transform
 * @param {import('maplibre-gl').Map} map
 * @param {number} captureScale
 * @param {number} exportBearingDeg
 * @param {number} [routeTangentDeg]
 * @returns {{ x: number, y: number, angle: number, text: string }|null}
 */
export function computeSheetEdgeSeeLabelPlacement(
    spec,
    cap,
    routeLine,
    transform,
    map,
    captureScale,
    exportBearingDeg,
    routeTangentDeg = null
) {
    if (!spec?.text || !cap?.left?.length || !cap?.right?.length || !transform?.projectLngLat || !map || !routeLine?.geometry) {
        return null;
    }

    const midpoint = turf.point([
        (cap.left[0] + cap.right[0]) / 2,
        (cap.left[1] + cap.right[1]) / 2
    ]);
    const tangent = Number.isFinite(routeTangentDeg)
        ? routeTangentDeg
        : getLocalTangentBearing(routeLine, spec.stationFt);
    const outsideBearing = spec.position === 'start'
        ? normalizeDegrees(tangent + 180)
        : normalizeDegrees(tangent);
    const anchor = turf.destination(midpoint, EDGE_SEE_LABEL_OFFSET_FT, outsideBearing, { units: 'feet' });
    const [lng, lat] = anchor.geometry.coordinates;
    const pdfPoint = transform.projectLngLat(map, lng, lat, captureScale);

    let angle = normalizeDegrees(tangent - exportBearingDeg);
    if (angle > 90 && angle < 270) {
        angle = normalizeDegrees(angle + 180);
    }

    return {
        x: pdfPoint.x,
        y: pdfPoint.y,
        angle: -angle,
        text: spec.text
    };
}

/**
 * @param {object} sheet
 * @param {number} totalSheets
 * @param {object[]} detailSheets
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {object} transform
 * @param {import('maplibre-gl').Map} map
 * @param {number} captureScale
 * @param {number} exportBearingDeg
 * @returns {Array<{ x: number, y: number, angle: number, text: string }>}
 */
export function resolveSheetEdgeSeeLabelPlacements(
    sheet,
    totalSheets,
    detailSheets,
    routeLine,
    transform,
    map,
    captureScale,
    exportBearingDeg
) {
    if (!sheet || !routeLine?.geometry || !transform?.projectLngLat || !map) {
        return [];
    }

    const registry = buildSharedMatchLineRegistry(detailSheets, routeLine);
    const specs = buildSheetEdgeSeeLabelSpecs(sheet, totalSheets);
    const placements = [];
    const routeTangentDeg = getLocalTangentBearing(
        routeLine,
        sheet.centerDistanceFt ?? sheet.startDistanceFt ?? specs[0]?.stationFt ?? 0
    );

    for (const spec of specs) {
        const cap = registry.get(stationKey(spec.stationFt));
        const placement = computeSheetEdgeSeeLabelPlacement(
            spec,
            cap,
            routeLine,
            transform,
            map,
            captureScale,
            exportBearingDeg,
            routeTangentDeg
        );
        if (placement) {
            placements.push(placement);
        }
    }

    return placements;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} angle
 */
function drawRotatedTextWithHalo(doc, text, x, y, angle) {
    const options = { align: 'center', baseline: 'middle', angle };
    doc.setFontSize(EDGE_SEE_LABEL_FONT_PT);
    doc.setTextColor(255, 255, 255);
    for (const [dx, dy] of [
        [-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8],
        [-0.6, -0.6], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6]
    ]) {
        doc.text(text, x + dx, y + dy, options);
    }
    doc.setTextColor(20, 20, 20);
    doc.text(text, x, y, options);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} options
 */
export function drawSheetEdgeSeeLabels(doc, options = {}) {
    const {
        sheet,
        totalSheets = 1,
        detailSheets = [],
        routeLine = null,
        transform = null,
        map = null,
        captureScale = 1,
        exportBearingDeg = 0
    } = options;

    const placements = resolveSheetEdgeSeeLabelPlacements(
        sheet,
        totalSheets,
        detailSheets,
        routeLine,
        transform,
        map,
        captureScale,
        exportBearingDeg
    );

    for (const placement of placements) {
        drawRotatedTextWithHalo(doc, placement.text, placement.x, placement.y, placement.angle);
    }
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {HTMLCanvasElement} canvas
 * @param {object} marginsPt
 * @param {object} [options]
 */
export function placeSheetCanvasOnPdfPage(doc, canvas, marginsPt, options = {}) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const placement = computeSheetImagePlacement(
        pageW,
        pageH,
        marginsPt,
        canvas.width,
        canvas.height,
        options
    );
    const dataUrl = canvas.toDataURL('image/png');
    doc.addImage(
        dataUrl,
        'PNG',
        placement.x,
        placement.y,
        placement.width,
        placement.height,
        undefined,
        'NONE'
    );
    return placement;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {HTMLCanvasElement} canvas
 * @param {object} marginsPt
 */
export function placeCanvasOnPdfPage(doc, canvas, marginsPt) {
    placeSheetCanvasOnPdfPage(doc, canvas, marginsPt, { preferLandscapeFlow: false });
}

/**
 * @param {object} template
 * @returns {[number, number]}
 */
export function resolvePdfPageFormat(template = {}) {
    return computePdfPageSizePt(template);
}

/**
 * @param {object} mapService
 * @param {object} template
 * @param {(map: import('maplibre-gl').Map) => void} [beforeCapture]
 * @returns {Promise<HTMLCanvasElement>}
 */
async function captureBasemapAtDpi(mapService, template, beforeCapture) {
    const dpi = resolveBasemapDpi(template);
    const { widthPx, heightPx } = computeSheetExportPixelDimensions(template, dpi);
    return captureMapCanvas(mapService, {
        targetWidthPx: widthPx,
        targetHeightPx: heightPx,
        maxPixelRatio: SHEET_EXPORT_MAX_PIXEL_RATIO,
        highResCapture: false,
        beforeCapture
    });
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ring
 * @param {number} [insetPx]
 * @returns {boolean}
 */
function ringFitsCaptureCanvas(map, ring, insetPx = 2) {
    const canvas = map.getCanvas();
    const pixelRing = projectRingToDevicePixels(map, ring);
    return pixelRingInsideCanvas(pixelRing, canvas, insetPx);
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {object} template
 * @returns {Promise<{ exportRatio: number, originalRatio: number }>}
 */
async function bumpMapToExportRatio(map, template) {
    const dpi = resolveBasemapDpi(template);
    const { widthPx, heightPx } = computeSheetExportPixelDimensions(template, dpi);
    const originalRatio = typeof map.getPixelRatio === 'function' ? map.getPixelRatio() : 1;
    const exportRatio = computePixelRatioForTargetDimensions(map, widthPx, heightPx, {
        maxPixelRatio: SHEET_EXPORT_MAX_PIXEL_RATIO
    });

    if (exportRatio > originalRatio) {
        map.setPixelRatio(exportRatio);
        await ensureMapFrameReady(map);
    }

    return { exportRatio, originalRatio };
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {number} originalRatio
 */
async function restoreMapPixelRatio(map, originalRatio) {
    const currentRatio = typeof map.getPixelRatio === 'function' ? map.getPixelRatio() : 1;
    if (currentRatio > originalRatio) {
        map.setPixelRatio(originalRatio);
        map.resize();
        await ensureMapFrameReady(map);
    }
}

/**
 * @param {object} mapService
 * @param {object} template
 * @param {number[][]} ring
 * @returns {Promise<{ canvas: HTMLCanvasElement, pixelRing: number[][], captureScale: number }>}
 */
async function captureBasemapUnderlay(mapService, template, ring) {
    clearSheetPreview(mapService);
    const restoreDataLayers = suppressMapDataLayersForCapture(mapService);
    const map = mapService?.getMap?.();
    const sessionOriginalRatio = typeof map?.getPixelRatio === 'function' ? map.getPixelRatio() : 1;

    try {
        if (!map) {
            throw new Error('Map is not ready');
        }

        let originalRatio = sessionOriginalRatio;

        for (let attempt = 0; attempt < 8; attempt++) {
            await ensureRingFitsCaptureViewport(mapService, ring, {
                marginPx: SHEET_CAPTURE_EDGE_MARGIN_PX + attempt * 8,
                maxPasses: 6
            });
            await ensureMapFrameReady(map);

            await restoreMapPixelRatio(map, originalRatio);
            ({ originalRatio } = await bumpMapToExportRatio(map, template));

            if (!ringFitsCaptureCanvas(map, ring, 2)) {
                await restoreMapPixelRatio(map, originalRatio);
                map.zoomTo(map.getZoom() + Math.log2(0.9), { duration: 0 });
                await ensureMapFrameReady(map);
                continue;
            }

            const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
            const captureScale = map.getCanvas().width / cssW;
            const pixelRing = projectRingToDevicePixels(map, ring);
            const mapCanvas = captureLiveFrame(map, mapService);

            await restoreMapPixelRatio(map, originalRatio);

            if (!pixelRingInsideCanvas(pixelRing, mapCanvas, 2)) {
                map.zoomTo(map.getZoom() + Math.log2(0.9), { duration: 0 });
                await ensureMapFrameReady(map);
                continue;
            }

            return {
                canvas: clipMapCanvasToPolygonRing(mapCanvas, pixelRing),
                pixelRing,
                captureScale
            };
        }

        throw new Error('Sheet polygon extends outside the map capture area — try widening the map panel or lowering basemap quality');
    } finally {
        if (map) {
            await restoreMapPixelRatio(map, sessionOriginalRatio);
        }
        restoreDataLayers();
    }
}

/**
 * @param {object} mapService
 * @param {object} template
 * @returns {Promise<{ canvas: HTMLCanvasElement, captureScale: number }>}
 */
async function captureOverviewBasemap(mapService, template) {
    let captureScale = 1;
    const canvas = await captureBasemapAtDpi(mapService, template, (map) => {
        const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
        captureScale = map.getCanvas().width / cssW;
    });
    return { canvas, captureScale };
}

/**
 * @param {object} params
 * @returns {Promise<Blob>}
 */
export async function buildHybridPagePdfBlob({
    template = {},
    pageOptions = {},
    map,
    mapService,
    basemapCanvas = null,
    pixelRing = null,
    captureScale = 1,
    vectorFeatures = null,
    overviewPlacement = false
}) {
    const orientation = template.orientation === PAGE_ORIENTATIONS.PORTRAIT
        ? PAGE_ORIENTATIONS.PORTRAIT
        : PAGE_ORIENTATIONS.LANDSCAPE;
    const format = resolvePdfPageFormat(template);
    const basemapDpi = resolveBasemapDpi(template);
    const { marginsPt } = computeSheetExportPixelDimensions(template, basemapDpi);
    const isDetail = pageOptions.pageType === 'detail';
    const layoutMargins = isDetail
        ? resolveDetailPageMarginsPt(marginsPt, true)
        : marginsPt;
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({
        orientation,
        unit: 'pt',
        format,
        compress: false
    });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let transform = null;

    if (basemapCanvas) {
        if (overviewPlacement || !pixelRing?.length) {
            placeSheetCanvasOnPdfPage(doc, basemapCanvas, layoutMargins, {
                preferLandscapeFlow: false
            });
            transform = buildSheetPageTransform(
                [
                    [0, 0],
                    [basemapCanvas.width, 0],
                    [basemapCanvas.width, basemapCanvas.height],
                    [0, basemapCanvas.height]
                ],
                layoutMargins,
                { width: pageW, height: pageH },
                { preferLandscapeFlow: false }
            );
        } else {
            placeSheetCanvasOnPdfPage(doc, basemapCanvas, layoutMargins, {
                preferLandscapeFlow: isDetail
            });
            transform = buildSheetPageTransform(
                pixelRing,
                layoutMargins,
                { width: pageW, height: pageH },
                { preferLandscapeFlow: isDetail }
            );
        }
    }

    if (vectorFeatures?.features?.length && map && transform) {
        renderFeatureCollectionToPdf(
            doc,
            vectorFeatures,
            map,
            transform,
            captureScale,
            {
                layerStyleFor: (layerId) => (layerId ? mapService?.getLayerStyle?.(layerId) : null)
            }
        );
    }

    const mapBearing = pageOptions.exportBearingDeg ?? 0;
    if (isDetail && pageOptions.sheet) {
        if (pageOptions.routeLine && transform && map) {
            drawSheetEdgeSeeLabels(doc, {
                sheet: pageOptions.sheet,
                totalSheets: pageOptions.totalSheets ?? 1,
                detailSheets: pageOptions.detailSheets ?? [],
                routeLine: pageOptions.routeLine,
                transform,
                map,
                captureScale,
                exportBearingDeg: mapBearing
            });
        }
        drawNorthArrowOnPdf(
            doc,
            pageW - layoutMargins.right - NORTH_ARROW_SIZE_PT * 0.6,
            layoutMargins.top + NORTH_ARROW_SIZE_PT * 0.9,
            NORTH_ARROW_SIZE_PT,
            mapBearing
        );
        drawSheetContinuationFooter(
            doc,
            pageOptions.sheet,
            pageOptions.totalSheets ?? 1,
            layoutMargins
        );
    } else if (pageOptions.pageType === 'overview') {
        drawNorthArrowOnPdf(
            doc,
            pageW - layoutMargins.right - NORTH_ARROW_SIZE_PT * 0.6,
            layoutMargins.top + NORTH_ARROW_SIZE_PT * 0.9,
            NORTH_ARROW_SIZE_PT,
            0
        );
    }

    return doc.output('blob');
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} template
 * @param {object} [pageOptions]
 * @returns {Promise<Blob>}
 */
export async function buildSinglePagePdfBlob(canvas, template = {}, pageOptions = {}) {
    return buildHybridPagePdfBlob({
        template,
        pageOptions,
        basemapCanvas: canvas
    });
}

/**
 * @param {string} projectName
 * @param {string} suffix
 * @returns {string}
 */
export function buildSheetPageFilename(projectName, suffix) {
    const base = sanitizeExportFilename(projectName || 'sheet_cutting');
    const tail = sanitizeExportFilename(suffix);
    return `${base}_${tail}.pdf`;
}

/**
 * @param {object} params
 * @returns {Promise<{ pageCount: number, folderName: string, files: string[] }>}
 */
export async function exportSheetPlanPdf({
    mapService,
    exportPackage,
    session,
    onProgress,
    blockWhenDualScreen = true,
    dualScreenCoordinator: coordinator = null
}) {
    if (!isFolderExportSupported()) {
        throw new Error(
            'Folder export requires Chrome or Edge. Each sheet PDF is saved to a folder you choose as it is rendered.'
        );
    }

    const coordinatorRef = coordinator ?? (await import('../../dual-screen/coordinator.js')).default;
    if (blockWhenDualScreen && coordinatorRef?.isActive) {
        throw new Error('Map is in the Dual Screen window — export from that window.');
    }

    const map = mapService?.getMap?.();
    if (!map?.loaded?.()) {
        throw new Error('Map is not ready');
    }

    const layers = exportPackage?.layers || {};
    const sheetFrames = layers.sheetFrames;
    const perSheetLayers = layers.perSheet || [];
    const detailSheets = (session?.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');
    if (!sheetFrames?.features?.length || !detailSheets.length) {
        throw new Error('Generate sheets before exporting PDF');
    }

    const template = {
        basemapDpi: DEFAULT_BASEMAP_DPI,
        ...(session?.sheets?.template || exportPackage?.template || {})
    };
    const basemapDpi = resolveBasemapDpi(template);
    const includeOverview = template.includeOverview !== false && exportPackage?.pdf?.pages?.[0]?.pageType === 'overview';
    const projectName = session?.project?.projectName || exportPackage?.projectName || 'sheet_cutting';
    const routeLine = session?.routeLine || exportPackage?.layers?.route?.features?.[0] || null;
    const pdfBearingMode = template.pdfMapBearingMode ?? DEFAULT_PDF_MAP_BEARING_MODE;
    const pdfBearings = resolveSheetPdfBearings(detailSheets, routeLine, { mode: pdfBearingMode });

    onProgress?.('Choose a folder for sheet PDFs…');
    const folderHandle = await pickExportFolder();
    const folderName = folderHandle.name || 'selected folder';

    const savedCamera = saveMapCamera(map);
    const was3d = mapService.is3DEnabled?.() ?? false;
    const resumeInteractions = suspendMapInteractions(map);
    const writtenFiles = [];

    try {
        if (was3d) {
            mapService.disable3D?.({ animate: false });
            await waitForMapSettled(map);
        }

        if (includeOverview) {
            onProgress?.(`Rendering overview (basemap ${basemapDpi} DPI + vector)…`);
            clearSheetPreview(mapService);
            mapService.clearTempFeatures?.();
            await ensureMapFrameReady(map);
            const restoreDataLayers = suppressMapDataLayersForCapture(mapService);
            try {
                const overviewBounds = boundsFromGeoJson(sheetFrames);
                if (!overviewBounds) {
                    throw new Error('Could not determine overview bounds');
                }
                await fitMapToBounds(mapService, overviewBounds, { pitch: 0, bearing: 0 });
                const { canvas: overviewCanvas, captureScale } = await captureOverviewBasemap(mapService, template);
                const overviewBlob = await buildHybridPagePdfBlob({
                    template,
                    pageOptions: { pageType: 'overview', exportBearingDeg: 0 },
                    map,
                    mapService,
                    basemapCanvas: overviewCanvas,
                    captureScale,
                    vectorFeatures: layers.overview || null,
                    overviewPlacement: true
                });
                const overviewFile = buildSheetPageFilename(projectName, 'overview');
                await writeBlobToFolder(folderHandle, overviewFile, overviewBlob);
                writtenFiles.push(overviewFile);
            } finally {
                restoreDataLayers();
            }
            await ensureMapFrameReady(map);
        }

        for (let index = 0; index < detailSheets.length; index++) {
            const sheet = detailSheets[index];
            const label = String(sheet.sheetNumber).padStart(2, '0');
            onProgress?.(`Rendering sheet ${label} (${index + 1} of ${detailSheets.length}, vector + basemap ${basemapDpi} DPI)…`);

            const frameCollection = buildSingleSheetFrameCollection(sheetFrames, sheet.sheetId);
            const frameFeature = frameCollection?.features?.[0];
            if (!frameFeature) {
                throw new Error(`Sheet ${label} is missing a frame polygon`);
            }

            const ring = extractPrimaryRing(frameFeature);
            if (!ring?.length) {
                throw new Error(`Sheet ${label} frame polygon is empty`);
            }

            const exportBearing = pdfBearings.get(sheet.sheetId)
                ?? resolveSheetPdfBearing(sheet, routeLine, { mode: pdfBearingMode });

            await fitMapToPolygonRing(mapService, ring, {
                pitch: 0,
                bearing: exportBearing
            });
            await ensureMapFrameReady(map);

            let underlay = await captureBasemapUnderlay(mapService, template, ring);
            let captureBearing = exportBearing;

            if (
                pdfBearingMode !== PDF_MAP_BEARING_MODES.NORTH_UP
                && underlay.canvas.height > underlay.canvas.width
            ) {
                const endBearing = resolveSheetPdfBearing(sheet, routeLine, {
                    mode: pdfBearingMode,
                    sampleAt: 'end'
                });
                if (Math.abs(endBearing - exportBearing) > 0.01) {
                    await fitMapToPolygonRing(mapService, ring, {
                        pitch: 0,
                        bearing: endBearing
                    });
                    await ensureMapFrameReady(map);
                    const retryUnderlay = await captureBasemapUnderlay(mapService, template, ring);
                    if (retryUnderlay.canvas.width >= retryUnderlay.canvas.height) {
                        underlay = retryUnderlay;
                        captureBearing = endBearing;
                    }
                }
            }

            const sheetLayer = perSheetLayers.find((entry) => entry.sheetId === sheet.sheetId);
            const pageBlob = await buildHybridPagePdfBlob({
                template,
                pageOptions: {
                    pageType: 'detail',
                    exportBearingDeg: captureBearing,
                    sheet,
                    totalSheets: detailSheets.length,
                    detailSheets,
                    routeLine
                },
                map,
                mapService,
                basemapCanvas: underlay.canvas,
                pixelRing: underlay.pixelRing,
                captureScale: underlay.captureScale,
                vectorFeatures: sheetLayer?.contents || null
            });
            const pageFile = buildSheetPageFilename(projectName, `sheet_${label}`);
            await writeBlobToFolder(folderHandle, pageFile, pageBlob);
            writtenFiles.push(pageFile);
        }

        if (writtenFiles.length <= (includeOverview ? 1 : 0)) {
            throw new Error('No detail sheet PDFs were produced');
        }

        onProgress?.(`Saved ${writtenFiles.length} PDF(s) to ${folderName}.`);
        return { pageCount: writtenFiles.length, folderName, files: writtenFiles };
    } finally {
        if (was3d) {
            mapService.enable3D?.({ animate: false });
        }
        restoreMapCamera(map, savedCamera);
        resumeInteractions?.();
        showSheetPreview(mapService, layers);
        await ensureMapFrameReady(map);
    }
}
