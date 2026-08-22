/**
 * Sheet plan PDF export — high-DPI basemap capture + crisp vector overlays per page.
 * Detail sheets: basemap raster (plus live Fiber paint) + vector design layers and gold sheet outline.
 * Overview: basemap raster + vector sheet index (polygons, red route, labels).
 */

import { loadJsPDF } from '../../core/libs.js';
import {
    isFolderExportSupported,
    pickExportFolder,
    sanitizeExportFilename,
    writeBlobToFolder
} from '../../export/folder-export.js';
import {
    applyMapPixelRatio,
    captureLiveFrame,
    captureMapCanvas,
    computePixelRatioForTargetDimensions,
    ensureHighResCaptureReady,
    ensureMapCameraSettled,
    ensureMapFrameReady,
    resolveCapturePixelDimensions,
    restoreMapPixelRatio,
    SHEET_EXPORT_MAX_PIXEL_RATIO,
    suspendMapInteractions
} from '../../map/map-export.js';
import { extractPrimaryRing, buildCorridorMatchLineRegistry, stationKey, clipFeaturesToSheetFrame } from './export-builder.js';
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
    resolveBasemapDpi,
    resolveSheetFrameDimensions
} from './engine.js';
import {
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_DETAIL_FOOTER_GAP_IN,
    PDF_MAP_BEARING_MODES,
    DEFAULT_PDF_MAP_BEARING_MODE,
    buildSheetEdgeSeeLabelSpecs,
    buildSheetTitleBlockFooterModel,
    buildInsetTitleBlockFooterModel,
    resolveSheetPdfBearing,
    resolveSheetPdfBearings
} from './sheet-pdf-orientation.js';
import {
    buildPdfRingFromGeoRing,
    buildPdfRingFromPixelRing,
    buildSheetPageTransform,
    computeCapEdgePdfPlacement,
    computeCapEdgePdfPlacementFromRing,
    computePdfRingCentroid,
    computeSheetImagePlacement,
    isRightHandCapMidpoint,
    placeLabelOutsidePdfCutout,
    pointInPdfRing
} from './sheet-pdf-placement.js';
import { renderFeatureCollectionToPdf } from './sheet-pdf-vector.js';
import {
    collectUdotFiberSheetFeatures,
    listVisibleUdotFiberLayerIds,
    omitRasterizedLiveFeatures,
    refreshUdotFiberPaintLayers
} from './sheet-pdf-fiber.js';
import { resolveFiberLayerIdsForPdfExport } from './fiber-operational.js';
import {
    buildInsetCalloutFeatures,
    computeInsetQuadrantRects,
    formatInsetScaleLabel,
    packInsetPages,
    polygonFromInsetView
} from './inset-views.js';
import { getLayers } from '../../core/state.js';
import { getWidgetEntry } from '../widget-state-store.js';
import { restoreCalloutSession } from '../plan-set-callouts/engine.js';
import { isFiberCalloutSession } from '../plan-set-callouts/fiber-callout-engine.js';
import { drawInsetCalloutsOnPdf, drawSheetCalloutsOnPdf } from '../plan-set-callouts/pdf-callouts.js';
import { hideCalloutPreviewForCapture } from '../plan-set-callouts/preview.js';
import { refreshCalloutRuntimePreview } from '../plan-set-callouts/runtime.js';

const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 18;
/** Safety margin (CSS px) kept between polygon vertices and the map canvas edge. */
const SHEET_CAPTURE_EDGE_MARGIN_PX = 56;
/** Camera-only waits (zoom/pan) — skip tile-stability passes. */
const CAMERA_SETTLE_OPTIONS = { maxWaitMs: 5000, stableFrames: 0, styleTimeoutMs: 4000 };
/** Single tile pass before reading pixels from the GL canvas. */
const CAPTURE_READY_OPTIONS = { maxWaitMs: 8000, stableFrames: 1 };
const NORTH_ARROW_SIZE_PT = 28;
const INSET_NORTH_ARROW_SIZE_PT = 16;
const INSET_CAPTURE_MAX_ZOOM = 22;
const EDGE_SEE_LABEL_FONT_PT = 7.5;
/** Extra gap from the cutout border to the inner edge of matchline text. 0 = touching. */
export const EDGE_SEE_LABEL_GAP_PT = 0;
/** Basemap underlay JPEG quality. Linework stays vector; this only shrinks the background. */
export const BASEMAP_JPEG_QUALITY = 0.88;
/** Distance from cutout border to the label visual center so the inner glyph edge sits on the border. */
export const EDGE_SEE_LABEL_OFFSET_PT = EDGE_SEE_LABEL_GAP_PT + EDGE_SEE_LABEL_FONT_PT * 0.5;
const EDGE_SEE_LABEL_INTERIOR_EPS_FT = 2;

/**
 * Fiber callouts overlay corridor PDFs only (`pageType === 'detail'`).
 * @returns {object|null}
 */
function loadCalloutSessionForPdf() {
    const entry = getWidgetEntry('plan-set-callouts');
    if (!entry?.state) return null;
    try {
        const session = restoreCalloutSession(entry.state);
        return isFiberCalloutSession(session) ? session : null;
    } catch {
        return isFiberCalloutSession(entry.state) ? entry.state : null;
    }
}

/**
 * Measure SEE SHEET text width in PDF points at the label font size.
 * @param {import('jspdf').jsPDF} doc
 * @param {string} text
 * @returns {number}
 */
export function measureSeeLabelWidthPt(doc, text) {
    doc.setFontSize(EDGE_SEE_LABEL_FONT_PT);
    if (typeof doc.getTextDimensions === 'function') {
        const dims = doc.getTextDimensions(String(text ?? ''));
        if (dims?.w > 0) return dims.w;
    }
    if (typeof doc.getTextWidth === 'function') {
        const width = doc.getTextWidth(String(text ?? ''));
        if (width > 0) return width;
    }
    return String(text ?? '').length * EDGE_SEE_LABEL_FONT_PT * 0.45;
}

/**
 * jsPDF left-align anchor so rotated text is visually centered on (cx, cy).
 * jsPDF Tm run direction in page y-down is (cos θ, −sin θ). See docs/SHEET_CUTTING.md.
 * Do not use align:'center' with angle.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} widthPt
 * @param {number} angleDeg
 * @returns {{ x: number, y: number }}
 */
export function computeRotatedTextAnchor(cx, cy, widthPt, angleDeg) {
    const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
    const half = Math.max(0, Number(widthPt) || 0) / 2;
    return {
        x: cx - half * Math.cos(rad),
        y: cy + half * Math.sin(rad)
    };
}

/**
 * Draw rotated text centered on (cx, cy).
 * Anchor with left/middle and compensate so the glyph box centers on (cx, cy).
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {string} text
 * @param {number} cx - desired visual center X
 * @param {number} cy - desired visual center Y
 * @param {number} angleDeg
 */
function drawRotatedTextWithHalo(doc, text, cx, cy, angleDeg) {
    const label = String(text ?? '');
    doc.setFontSize(EDGE_SEE_LABEL_FONT_PT);
    const width = measureSeeLabelWidthPt(doc, label);
    const angle = Number(angleDeg) || 0;
    const { x: anchorX, y: anchorY } = computeRotatedTextAnchor(cx, cy, width, angle);
    const options = { align: 'left', baseline: 'middle', angle };

    doc.setTextColor(255, 255, 255);
    for (const [dx, dy] of [
        [-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8],
        [-0.6, -0.6], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6]
    ]) {
        doc.text(label, anchorX + dx, anchorY + dy, options);
    }
    doc.setTextColor(20, 20, 20);
    doc.text(label, anchorX, anchorY, options);
}

/**
 * Visual center for a matchline label: midpoint of the cutout border edge,
 * then a fixed perpendicular standoff outside the polygon.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number, midX?: number, midY?: number, text: string, angle: number, edgeAngleDeg?: number }} placement
 * @param {Array<{ x: number, y: number }>|null} pdfRing
 * @param {{ x: number, y: number }|null} ringCentroid
 * @param {'left'|'right'} side
 * @returns {{ x: number, y: number, angle: number, text: string }}
 */
export function resolveSeeLabelVisualCenterOutside(doc, placement, pdfRing, ringCentroid, side) {
    if (!placement?.text || placement.midX == null || placement.midY == null) {
        return placement;
    }

    const fallbackAngle = side === 'left' ? -90 : 90;
    const edgeAngle = placement.edgeAngleDeg ?? fallbackAngle;
    const interior = placement.interiorRefPdf ?? ringCentroid;
    const placed = placeLabelOutsidePdfCutout(
        placement.midX,
        placement.midY,
        edgeAngle,
        EDGE_SEE_LABEL_OFFSET_PT,
        pdfRing,
        interior
    );

    return {
        ...placement,
        x: placed.x,
        y: placed.y,
        angle: placed.angle,
        midX: placed.midX,
        midY: placed.midY,
        edgeAngleDeg: placed.edgeAngleDeg
    };
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number, midX?: number, midY?: number, text: string, angle: number, edgeAngleDeg?: number }} placement
 * @param {Array<{ x: number, y: number }>|null} pdfRing
 * @param {{ x: number, y: number }|null} ringCentroid
 * @returns {{ x: number, y: number, angle: number, text: string }}
 */
export function resolveRightHandSeeLabelVisualCenter(doc, placement, pdfRing, ringCentroid) {
    return resolveSeeLabelVisualCenterOutside(doc, placement, pdfRing, ringCentroid, 'right');
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number, midX?: number, midY?: number, text: string, angle: number, edgeAngleDeg?: number }} placement
 * @param {Array<{ x: number, y: number }>|null} pdfRing
 * @param {{ x: number, y: number }|null} ringCentroid
 * @returns {{ x: number, y: number, angle: number, text: string }}
 */
export function resolveLeftHandSeeLabelVisualCenter(doc, placement, pdfRing, ringCentroid) {
    return resolveSeeLabelVisualCenterOutside(doc, placement, pdfRing, ringCentroid, 'left');
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
        exportBearingDeg = 0,
        matchLineRegistry = null,
        pixelRing = null,
        frameRing = null
    } = options;

    const placements = resolveSheetEdgeSeeLabelPlacements(
        sheet,
        totalSheets,
        detailSheets,
        routeLine,
        transform,
        map,
        captureScale,
        exportBearingDeg,
        matchLineRegistry,
        pixelRing,
        frameRing
    );

    const pdfRing = frameRing?.length && transform?.projectLngLat && map
        ? buildPdfRingFromGeoRing(frameRing, transform, map, captureScale)
        : (pixelRing?.length && transform?.toPdf
            ? buildPdfRingFromPixelRing(pixelRing, transform)
            : null);
    const ringCentroid = pdfRing?.length ? computePdfRingCentroid(pdfRing) : null;
    const ringMinX = pdfRing?.length ? Math.min(...pdfRing.map((p) => p.x)) : null;
    const ringMaxX = pdfRing?.length ? Math.max(...pdfRing.map((p) => p.x)) : null;
    const ringCenterX = ringMinX != null && ringMaxX != null
        ? (ringMinX + ringMaxX) / 2
        : (transform?.placedRect
            ? transform.placedRect.x + transform.placedRect.width / 2
            : null);

    for (const placement of placements) {
        // Both sides: force visual center into the page margin outside the cutout.
        const isRightHand = placement.midX != null && ringCenterX != null
            ? placement.midX >= ringCenterX
            : isRightHandCapMidpoint(placement.midX, transform?.placedRect, pdfRing);
        const side = isRightHand ? 'right' : 'left';
        const drawAt = resolveSeeLabelVisualCenterOutside(
            doc,
            placement,
            pdfRing,
            ringCentroid,
            side
        );

        drawRotatedTextWithHalo(doc, drawAt.text, drawAt.x, drawAt.y, drawAt.angle);
    }
}

/**
 * @param {object} session
 * @returns {string[]}
 */
export function resolveExportLayerIds(session) {
    return [
        session?.project?.stationingRouteLayerId,
        ...(session?.sheets?.designLayerIds || [])
    ].filter(Boolean);
}

/**
 * Warn when the map panel cannot reach the template basemap DPI (capture will be upscaled).
 * @param {import('maplibre-gl').Map} map
 * @param {object} template
 * @param {(message: string) => void} [onWarning]
 */
export function warnIfBasemapDpiConstrained(map, template, onWarning) {
    if (!map || !onWarning) return;

    const dpi = resolveBasemapDpi(template);
    const { widthPx, heightPx } = computeSheetExportPixelDimensions(template, dpi);
    const dims = resolveCapturePixelDimensions(map, widthPx, heightPx, {
        maxPixelRatio: SHEET_EXPORT_MAX_PIXEL_RATIO
    });

    if (!dims.meetsWidthTarget || !dims.meetsHeightTarget) {
        onWarning('Basemap may look soft — widen the map panel or lower basemap quality for sharper output.');
    }
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

    await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
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
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ring
 * @returns {{ width: number, height: number }}
 */
export function measureProjectedRingSpan(map, ring) {
    const bounds = measureRingInCssPixels(map, ring);
    return {
        width: Math.max(1, bounds.maxX - bounds.minX),
        height: Math.max(1, bounds.maxY - bounds.minY)
    };
}

/**
 * Rotate the map camera without refitting — used to compare landscape-align bearings.
 * @param {import('maplibre-gl').Map} map
 * @param {number} bearing
 * @param {number} [pitch]
 */
async function jumpMapToBearing(map, bearing, pitch = 0) {
    if (!map) return;

    const center = map.getCenter();
    map.jumpTo({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing,
        pitch,
        duration: 0
    });
    await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
}

/**
 * Pick the bearing that keeps the sheet polygon wider than tall using projection only.
 * Width/height ratio is invariant to zoom and pan, so a full fit per candidate is unnecessary.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {number[][]} ring
 * @param {number} exportBearing
 * @param {number} endBearing
 * @returns {Promise<number>}
 */
export async function pickLandscapeAlignCaptureBearing(map, ring, exportBearing, endBearing) {
    await jumpMapToBearing(map, exportBearing);
    const startSpan = measureProjectedRingSpan(map, ring);
    if (startSpan.width >= startSpan.height) {
        return exportBearing;
    }

    if (Math.abs(endBearing - exportBearing) <= 0.01) {
        return exportBearing;
    }

    await jumpMapToBearing(map, endBearing);
    const endSpan = measureProjectedRingSpan(map, ring);
    if (endSpan.width >= endSpan.height) {
        return endBearing;
    }

    return exportBearing;
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
    await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
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
                await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
                continue;
            }
            return;
        }

        map.zoomTo(map.getZoom() + Math.log2(scale), { duration: 0 });
        await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
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
    await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);

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
 * Detail pages reserve the bottom of the page for the title-block footer.
 * Map content ends above the footer, with a gap so the two do not touch.
 * @param {object} marginsPt
 * @param {boolean} [includeFooterBand]
 * @returns {object}
 */
export function resolveDetailPageMarginsPt(marginsPt, includeFooterBand = true) {
    const footerPt = includeFooterBand ? PDF_DETAIL_FOOTER_BAND_IN * 72 : 0;
    const gapPt = includeFooterBand ? PDF_DETAIL_FOOTER_GAP_IN * 72 : 0;
    return {
        top: marginsPt.top,
        right: marginsPt.right,
        bottom: includeFooterBand
            ? Math.max(marginsPt.bottom, footerPt + gapPt)
            : marginsPt.bottom,
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
 * Draw the official 5-cell title-block footer on a detail sheet PDF.
 * Cells: Project | Date | spare | spare | Sheet NN of N
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {object} sheet
 * @param {number} totalSheets
 * @param {object} marginsPt
 * @param {{ projectName?: string, exportDate?: Date|string }} [options]
 */
export function drawSheetTitleBlockFooter(doc, sheet, totalSheets, marginsPt, options = {}) {
    const model = options.model || buildSheetTitleBlockFooterModel({
        projectName: options.projectName,
        exportDate: options.exportDate,
        sheet,
        totalSheets
    });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const boxHeight = PDF_DETAIL_FOOTER_BAND_IN * 72;
    const boxLeft = marginsPt.left;
    const boxWidth = Math.max(1, pageW - marginsPt.left - marginsPt.right);
    // Pin the title block to the page bottom; map content uses a larger bottom
    // margin so a gap remains above this box.
    const boxTop = pageH - boxHeight;
    const ratios = model.cellRatios;
    const cellXs = [boxLeft];
    for (let i = 0; i < ratios.length - 1; i += 1) {
        cellXs.push(cellXs[i] + boxWidth * ratios[i]);
    }
    const cellWidths = ratios.map((r) => boxWidth * r);
    const padX = 4;
    const padY = 3.5;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1.1);
    doc.rect(boxLeft, boxTop, boxWidth, boxHeight);
    doc.setLineWidth(0.6);
    for (let i = 1; i < cellXs.length; i += 1) {
        doc.line(cellXs[i], boxTop, cellXs[i], boxTop + boxHeight);
    }

    doc.setTextColor(20, 20, 20);
    // Project / Date: bold label, then bold value with extra line spacing.
    const labelBaseline = boxTop + padY + 7;
    const valueBaseline = labelBaseline + 13;
    const projectMaxW = Math.max(8, cellWidths[0] - padX * 2);
    const dateMaxW = Math.max(8, cellWidths[1] - padX * 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(model.projectLabel, cellXs[0] + padX, labelBaseline, { align: 'left' });
    doc.text(model.dateLabel, cellXs[1] + padX, labelBaseline, { align: 'left' });

    doc.setFontSize(10);
    const projectLines = doc.splitTextToSize(model.projectValue, projectMaxW);
    const dateLines = doc.splitTextToSize(model.dateValue, dateMaxW);
    doc.text(projectLines[0] || '', cellXs[0] + padX, valueBaseline, { align: 'left' });
    doc.text(dateLines[0] || '', cellXs[1] + padX, valueBaseline, { align: 'left' });

    doc.setFontSize(11);
    const sheetCenterX = cellXs[4] + cellWidths[4] / 2;
    const sheetCenterY = boxTop + boxHeight / 2 + 3;
    doc.text(model.sheetLabel, sheetCenterX, sheetCenterY, { align: 'center' });
    doc.setFont('helvetica', 'normal');
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} cell
 * @param {object} inset
 * @param {number} [parentSheetNumber]
 * @param {string} [scaleLabel]
 */
export function drawInsetCellChrome(doc, cell, inset, parentSheetNumber = 0, scaleLabel = '') {
    if (!doc || !cell?.chromeRect) return;
    const { chromeRect, headerRect } = cell;
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.85);
    doc.rect(chromeRect.x, chromeRect.y, chromeRect.width, chromeRect.height);
    doc.setLineWidth(0.4);
    doc.setDrawColor(180, 180, 180);
    doc.line(headerRect.x, headerRect.y + headerRect.height, headerRect.x + headerRect.width, headerRect.y + headerRect.height);

    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const title = `DETAIL ${inset?.label || ''}`.trim();
    doc.text(title, headerRect.x + 4, headerRect.y + Math.min(11, headerRect.height - 2), { align: 'left' });

    const see = Number(parentSheetNumber) > 0
        ? `SEE SHEET ${String(parentSheetNumber).padStart(2, '0')}`
        : '';
    const right = [see, scaleLabel].filter(Boolean).join('  ·  ');
    if (right) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(right, headerRect.x + headerRect.width - 4, headerRect.y + Math.min(11, headerRect.height - 2), {
            align: 'right'
        });
    }
    doc.setFont('helvetica', 'normal');
}

/**
 * @param {object} spec
 * @param {{ left: number[], right: number[] }} cap
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {object} transform
 * @param {import('maplibre-gl').Map} map
 * @param {number} captureScale
 * @param {number[][]} [pixelRing]
 * @param {number[][]} [frameRing]
 * @returns {{ x: number, y: number, angle: number, text: string, midX?: number, midY?: number, edgeAngleDeg?: number }|null}
 */
export function computeSheetEdgeSeeLabelPlacement(
    spec,
    cap,
    routeLine,
    transform,
    map,
    captureScale,
    pixelRing = null,
    frameRing = null
) {
    if (!spec?.text || !cap?.left?.length || !cap?.right?.length || !transform?.projectLngLat || !map || !routeLine?.geometry) {
        return null;
    }

    const totalLength = turf.length(routeLine, { units: 'feet' });
    const stationFt = spec.stationFt ?? 0;
    const interiorFt = spec.position === 'start'
        ? Math.min(stationFt + EDGE_SEE_LABEL_INTERIOR_EPS_FT, totalLength)
        : Math.max(stationFt - EDGE_SEE_LABEL_INTERIOR_EPS_FT, 0);
    const interiorCoord = turf.along(routeLine, interiorFt, { units: 'feet' }).geometry.coordinates;
    const interiorRefPdf = transform.projectLngLat(map, interiorCoord[0], interiorCoord[1], captureScale);
    const placedRect = transform.placedRect ?? null;

    let placement = null;
    if (pixelRing?.length && frameRing?.length && transform?.toPdf) {
        placement = computeCapEdgePdfPlacementFromRing({
            ring: frameRing,
            pixelRing,
            cap,
            transform,
            interiorRefPdf,
            offsetPt: EDGE_SEE_LABEL_OFFSET_PT,
            placedRect
        });
    }
    if (!placement) {
        placement = computeCapEdgePdfPlacement(
            cap,
            transform,
            map,
            captureScale,
            interiorRefPdf,
            EDGE_SEE_LABEL_OFFSET_PT,
            pixelRing,
            placedRect
        );
    }
    if (!placement) return null;

    return {
        x: placement.x,
        y: placement.y,
        angle: placement.angle,
        text: spec.text,
        midX: placement.midX,
        midY: placement.midY,
        edgeAngleDeg: placement.edgeAngleDeg,
        interiorRefPdf
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
 * @param {Map<string, { stationFt: number, left: number[], right: number[] }>|null} [matchLineRegistry]
 * @param {number[][]} [pixelRing]
 * @param {number[][]} [frameRing]
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
    exportBearingDeg,
    matchLineRegistry = null,
    pixelRing = null,
    frameRing = null
) {
    if (!sheet || !routeLine?.geometry || !transform?.projectLngLat || !map) {
        return [];
    }

    const registry = matchLineRegistry ?? buildCorridorMatchLineRegistry(detailSheets, routeLine);
    const specs = buildSheetEdgeSeeLabelSpecs(sheet, totalSheets);
    const placements = [];

    for (const spec of specs) {
        const cap = registry.get(stationKey(spec.stationFt));
        const placement = computeSheetEdgeSeeLabelPlacement(
            spec,
            cap,
            routeLine,
            transform,
            map,
            captureScale,
            pixelRing,
            frameRing
        );
        if (placement) {
            placements.push(placement);
        }
    }

    return placements;
}

/**
 * Device pixels for a ground length at the current map zoom (along a geographic bearing).
 * @param {import('maplibre-gl').Map} map
 * @param {number} feet
 * @param {number} geographicBearingDeg
 * @param {number} [captureScale]
 * @returns {number}
 */
export function projectGroundFeetToDevicePixels(map, feet, geographicBearingDeg, captureScale = 1) {
    if (!map || !Number.isFinite(feet) || feet <= 0 || typeof turf === 'undefined') {
        return 0;
    }

    const center = map.getCenter();
    const origin = [center.lng, center.lat];
    const dest = turf.destination(turf.point(origin), feet, geographicBearingDeg, { units: 'feet' });
    const a = map.project(origin);
    const b = map.project(dest.geometry.coordinates);
    return Math.hypot(b.x - a.x, b.y - a.y) * Math.max(1, captureScale);
}

/**
 * Pixel size of a full-length sheet at the current camera, used so remnant pages
 * keep the same PDF scale and corridor height as every other sheet.
 * Screen +X is along-route for landscape-align (map bearing + 90°).
 *
 * @param {import('maplibre-gl').Map} map
 * @param {object} template
 * @param {number} [captureScale]
 * @returns {{ widthPx: number, heightPx: number }|null}
 */
export function measureNominalSheetClipPx(map, template, captureScale = 1) {
    if (!map) return null;

    const { mapFrameWidthFt, mapFrameHeightFt } = resolveSheetFrameDimensions(template);
    const bearing = Number(map.getBearing?.()) || 0;
    const widthPx = projectGroundFeetToDevicePixels(map, mapFrameWidthFt, bearing + 90, captureScale);
    const heightPx = projectGroundFeetToDevicePixels(map, mapFrameHeightFt, bearing + 180, captureScale);
    if (widthPx < 1 || heightPx < 1) return null;
    return { widthPx, heightPx };
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {HTMLCanvasElement} canvas
 * @param {object} marginsPt
 * @param {object} [options]
 */
/**
 * Encode the basemap canvas as JPEG. Clipped corridor pixels are flattened onto white
 * first so transparent corners do not become black.
 * @param {HTMLCanvasElement|{ toDataURL?: Function, getContext?: Function, width?: number, height?: number }} canvas
 * @param {number} [quality]
 * @returns {string}
 */
export function canvasToBasemapJpegDataUrl(canvas, quality = BASEMAP_JPEG_QUALITY) {
    const q = Number(quality);
    const jpegQuality = Number.isFinite(q) ? Math.min(1, Math.max(0.5, q)) : BASEMAP_JPEG_QUALITY;
    const flat = flattenCanvasOntoWhite(canvas);
    return flat.toDataURL('image/jpeg', jpegQuality);
}

/**
 * Fiber linework stays on PNG so JPEG does not smear class colors.
 * @param {HTMLCanvasElement|{ toDataURL?: Function, getContext?: Function, width?: number, height?: number }} canvas
 * @param {'JPEG'|'PNG'} [format]
 * @returns {{ dataUrl: string, format: 'JPEG'|'PNG' }}
 */
export function canvasToSheetUnderlayDataUrl(canvas, format = 'JPEG') {
    const flat = flattenCanvasOntoWhite(canvas);
    if (String(format).toUpperCase() === 'PNG') {
        return { dataUrl: flat.toDataURL('image/png'), format: 'PNG' };
    }
    return { dataUrl: canvasToBasemapJpegDataUrl(canvas), format: 'JPEG' };
}

/**
 * @param {HTMLCanvasElement|{ toDataURL?: Function, getContext?: Function, width?: number, height?: number }} canvas
 * @returns {HTMLCanvasElement|{ toDataURL?: Function, getContext?: Function, width?: number, height?: number }}
 */
function flattenCanvasOntoWhite(canvas) {
    if (typeof document === 'undefined' || typeof canvas?.getContext !== 'function') {
        return canvas;
    }
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return canvas;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return canvas;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0);
    return out;
}

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
    const { dataUrl, format } = canvasToSheetUnderlayDataUrl(canvas, options.imageFormat);
    doc.addImage(
        dataUrl,
        format,
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
async function captureBasemapAtDpi(mapService, template, beforeCapture, options = {}) {
    const dpi = resolveBasemapDpi(template);
    const { widthPx, heightPx } = computeSheetExportPixelDimensions(template, dpi);
    return captureMapCanvas(mapService, {
        targetWidthPx: widthPx,
        targetHeightPx: heightPx,
        maxPixelRatio: SHEET_EXPORT_MAX_PIXEL_RATIO,
        highResCapture: true,
        captureReadyOptions: CAPTURE_READY_OPTIONS,
        beforeCapture,
        preservePixelRatio: options.preservePixelRatio === true,
        rewaitAfterBeforeCapture: options.rewaitAfterBeforeCapture !== false
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
 * @returns {Promise<number>}
 */
async function bumpMapToExportRatio(map, template) {
    const dpi = resolveBasemapDpi(template);
    const { widthPx, heightPx } = computeSheetExportPixelDimensions(template, dpi);
    const originalRatio = typeof map.getPixelRatio === 'function' ? map.getPixelRatio() : 1;
    const exportRatio = computePixelRatioForTargetDimensions(map, widthPx, heightPx, {
        maxPixelRatio: SHEET_EXPORT_MAX_PIXEL_RATIO
    });

    if (exportRatio > originalRatio) {
        applyMapPixelRatio(map, exportRatio);
        await ensureHighResCaptureReady(map, CAPTURE_READY_OPTIONS);
    }

    return exportRatio;
}

/**
 * @param {object} mapService
 * @param {object} template
 * @param {number[][]} ring
 * @param {{ skipViewportFit?: boolean, keepLayerIds?: string[] }} [options]
 * @returns {Promise<{ canvas: HTMLCanvasElement, pixelRing: number[][], captureScale: number }>}
 */
async function captureBasemapUnderlay(mapService, template, ring, options = {}) {
    clearSheetPreview(mapService);
    const restoreDataLayers = suppressMapDataLayersForCapture(mapService, options.keepLayerIds || []);
    const restoreCallouts = hideCalloutPreviewForCapture(mapService);
    const map = mapService?.getMap?.();

    try {
        if (!map) {
            throw new Error('Map is not ready');
        }

        const skipViewportFit = options.skipViewportFit === true;

        for (let attempt = 0; attempt < 5; attempt++) {
            if (!skipViewportFit || attempt > 0 || !polygonRingFitsViewport(map, ring, SHEET_CAPTURE_EDGE_MARGIN_PX)) {
                await ensureRingFitsCaptureViewport(mapService, ring, {
                    marginPx: SHEET_CAPTURE_EDGE_MARGIN_PX + attempt * 8,
                    maxPasses: 4
                });
            }

            if (!ringFitsCaptureCanvas(map, ring, 2)) {
                map.zoomTo(map.getZoom() + Math.log2(0.9), { duration: 0 });
                await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
                continue;
            }

            const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
            const captureScale = map.getCanvas().width / cssW;
            const pixelRing = projectRingToDevicePixels(map, ring);
            await ensureHighResCaptureReady(map, CAPTURE_READY_OPTIONS);
            const mapCanvas = captureLiveFrame(map, mapService);

            if (!pixelRingInsideCanvas(pixelRing, mapCanvas, 2)) {
                map.zoomTo(map.getZoom() + Math.log2(0.9), { duration: 0 });
                await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
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
        restoreCallouts();
        restoreDataLayers();
    }
}

/**
 * Overview capture: basemap tiles only; route, sheet frames, and labels are vector overlays.
 *
 * @param {object} mapService
 * @param {object} template
 * @returns {Promise<{ canvas: HTMLCanvasElement, captureScale: number }>}
 */
async function captureOverviewBasemap(mapService, template) {
    clearSheetPreview(mapService);
    const restoreDataLayers = suppressMapDataLayersForCapture(mapService);
    const restoreCallouts = hideCalloutPreviewForCapture(mapService);
    const map = mapService?.getMap?.();

    try {
        let captureScale = 1;
        const canvas = await captureBasemapAtDpi(mapService, template, (captureMap) => {
            const cssW = Math.max(1, captureMap.getContainer()?.clientWidth || 1);
            captureScale = captureMap.getCanvas().width / cssW;
        }, { preservePixelRatio: true, rewaitAfterBeforeCapture: false });
        return { canvas, captureScale };
    } finally {
        restoreCallouts();
        restoreDataLayers();
        if (map) {
            await ensureMapFrameReady(map);
        }
    }
}

/**
 * Pick the map bearing that keeps the clipped sheet wider than tall on the page.
 *
 * @param {object} mapService
 * @param {number[][]} ring
 * @param {object} sheet
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {string} pdfBearingMode
 * @param {Map<string, number>} pdfBearings
 * @returns {Promise<number>}
 */
async function resolveDetailCaptureBearing(mapService, ring, sheet, routeLine, pdfBearingMode, pdfBearings) {
    const map = mapService?.getMap?.();
    const exportBearing = pdfBearings.get(sheet.sheetId)
        ?? resolveSheetPdfBearing(sheet, routeLine, { mode: pdfBearingMode });

    let chosenBearing = exportBearing;
    if (map && pdfBearingMode !== PDF_MAP_BEARING_MODES.NORTH_UP) {
        const endBearing = resolveSheetPdfBearing(sheet, routeLine, {
            mode: pdfBearingMode,
            sampleAt: 'end'
        });
        chosenBearing = await pickLandscapeAlignCaptureBearing(
            map,
            ring,
            exportBearing,
            endBearing
        );
    }

    await fitMapToPolygonRing(mapService, ring, { pitch: 0, bearing: chosenBearing });
    return chosenBearing;
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
    overviewPlacement = false,
    JsPDFCtor = null,
    matchLineRegistry = null,
    underlayFormat = 'JPEG'
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
    const JsPDF = JsPDFCtor ?? await loadJsPDF();
    const doc = new JsPDF({
        orientation,
        unit: 'pt',
        format,
        compress: true
    });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let transform = null;

    if (basemapCanvas) {
        const placementOptions = { preferLandscapeFlow: isDetail && Boolean(pixelRing?.length) };
        if (isDetail && pixelRing?.length && map) {
            const nominal = measureNominalSheetClipPx(map, template, captureScale);
            if (nominal) {
                placementOptions.referenceWidthPx = nominal.widthPx;
                placementOptions.referenceHeightPx = nominal.heightPx;
            }
        }

        if (overviewPlacement || !pixelRing?.length) {
            placeSheetCanvasOnPdfPage(doc, basemapCanvas, layoutMargins, {
                preferLandscapeFlow: false,
                imageFormat: underlayFormat
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
                ...placementOptions,
                imageFormat: underlayFormat
            });
            transform = buildSheetPageTransform(
                pixelRing,
                layoutMargins,
                { width: pageW, height: pageH },
                placementOptions
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
        drawNorthArrowOnPdf(
            doc,
            pageW - layoutMargins.right - NORTH_ARROW_SIZE_PT * 0.6,
            layoutMargins.top + NORTH_ARROW_SIZE_PT * 0.9,
            NORTH_ARROW_SIZE_PT,
            mapBearing
        );
        drawSheetTitleBlockFooter(
            doc,
            pageOptions.sheet,
            pageOptions.totalSheets ?? 1,
            layoutMargins,
            {
                projectName: pageOptions.projectName,
                exportDate: pageOptions.exportDate
            }
        );
        if (pageOptions.calloutSession && map && transform) {
            const frameRing = pageOptions.frameRing || [];
            const goldPdfRing = frameRing.map((coord) => (
                transform.projectLngLat(map, coord[0], coord[1], captureScale)
            )).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
            drawSheetCalloutsOnPdf(doc, {
                session: pageOptions.calloutSession,
                sheetId: pageOptions.sheet.sheetId,
                map,
                transform,
                captureScale,
                layoutMargins,
                pageW,
                pageH,
                goldPdfRing,
                insetViews: pageOptions.insetViews || []
            });
        }
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
 * @param {{ completedPages?: number, totalPages?: number, phase?: 'folder' | 'prep' | 'pages' | 'done' }} params
 * @returns {number}
 */
export function computeSheetExportProgress({ completedPages = 0, totalPages = 1, phase = 'pages' }) {
    if (phase === 'folder') return 0;
    if (phase === 'prep') return 2;
    if (phase === 'done') return 100;
    if (!totalPages || totalPages < 1) return 2;
    const capped = Math.min(Math.max(0, completedPages), totalPages);
    return Math.round(Math.min(95, 2 + (capped / totalPages) * 93));
}

function emitExportProgress(onProgress, payload) {
    if (!onProgress) return;
    if (typeof payload === 'string') {
        onProgress(payload);
        return;
    }
    onProgress(payload);
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException('Export cancelled.', 'AbortError');
    }
}

const INSET_FIT_PADDING = 28;

/**
 * @param {object} params
 * @returns {Promise<object>}
 */
async function captureInsetQuadrant({
    mapService,
    template,
    inset,
    fiberLayerIds = [],
    refreshLiveFiberIds = [],
    pdfFiberOmitIds = [],
    designFeatures = []
}) {
    const polygon = polygonFromInsetView(inset);
    const ring = extractPrimaryRing(polygon);
    if (!ring?.length) {
        throw new Error(`Detail ${inset?.label || ''} is missing a bounding box`);
    }

    await fitMapToPolygonRing(mapService, ring, {
        bearing: 0,
        pitch: 0,
        maxZoom: INSET_CAPTURE_MAX_ZOOM,
        padding: INSET_FIT_PADDING
    });

    if (refreshLiveFiberIds.length) {
        await refreshUdotFiberPaintLayers(mapService, refreshLiveFiberIds);
    }

    const fiberFeatures = collectUdotFiberSheetFeatures(mapService, fiberLayerIds, polygon);
    const underlay = await captureBasemapUnderlay(mapService, template, ring, {
        skipViewportFit: true
    });
    const clippedDesign = omitRasterizedLiveFeatures(
        { type: 'FeatureCollection', features: clipFeaturesToSheetFrame(polygon, designFeatures) },
        pdfFiberOmitIds
    );
    const outline = {
        type: 'Feature',
        geometry: polygon.geometry,
        properties: {
            ...(polygon.properties || {}),
            feature_type: 'inset_outline',
            inset_id: inset.insetId,
            inset_label: inset.label
        }
    };

    return {
        inset,
        parentSheetNumber: inset.parentSheetNumber || 0,
        polygon,
        underlay,
        vectorFeatures: {
            type: 'FeatureCollection',
            features: [outline, ...(clippedDesign?.features || []), ...fiberFeatures]
        }
    };
}

/**
 * @param {object} params
 * @returns {Promise<Blob>}
 */
export async function buildInsetPagePdfBlob({
    template = {},
    page = {},
    captures = [],
    map = null,
    mapService = null,
    projectName = 'Sheet Cutter',
    exportDate = new Date(),
    JsPDFCtor = null,
    calloutSession = null
}) {
    const orientation = template.orientation === PAGE_ORIENTATIONS.PORTRAIT
        ? PAGE_ORIENTATIONS.PORTRAIT
        : PAGE_ORIENTATIONS.LANDSCAPE;
    const format = resolvePdfPageFormat(template);
    const basemapDpi = resolveBasemapDpi(template);
    const { marginsPt } = computeSheetExportPixelDimensions(template, basemapDpi);
    const layoutMargins = resolveDetailPageMarginsPt(marginsPt, true);
    const JsPDF = JsPDFCtor ?? await loadJsPDF();
    const doc = new JsPDF({
        orientation,
        unit: 'pt',
        format,
        compress: true
    });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const cells = computeInsetQuadrantRects(pageW, pageH, layoutMargins);

    for (let i = 0; i < cells.length; i += 1) {
        const capture = captures[i];
        const cell = cells[i];
        if (!capture?.underlay?.canvas || !cell) continue;

        const placementOptions = {
            preferLandscapeFlow: false,
            targetRect: cell.mapRect,
            imageFormat: 'JPEG'
        };
        placeSheetCanvasOnPdfPage(doc, capture.underlay.canvas, layoutMargins, placementOptions);
        const transform = buildSheetPageTransform(
            capture.underlay.pixelRing,
            layoutMargins,
            { width: pageW, height: pageH },
            placementOptions
        );
        if (capture.vectorFeatures?.features?.length && map && transform) {
            renderFeatureCollectionToPdf(
                doc,
                capture.vectorFeatures,
                map,
                transform,
                capture.underlay.captureScale,
                {
                    layerStyleFor: (layerId) => (layerId ? mapService?.getLayerStyle?.(layerId) : null)
                }
            );
        }

        const scaleLabel = formatInsetScaleLabel(capture.polygon, transform.placedRect?.width);
        drawInsetCellChrome(doc, cell, capture.inset, capture.parentSheetNumber, scaleLabel);
        drawNorthArrowOnPdf(
            doc,
            cell.mapRect.x + cell.mapRect.width - 16,
            cell.mapRect.y + 18,
            INSET_NORTH_ARROW_SIZE_PT,
            0
        );
        if (calloutSession && capture.inset && map && transform) {
            drawInsetCalloutsOnPdf(doc, {
                session: calloutSession,
                insetView: capture.inset,
                map,
                transform,
                captureScale: capture.underlay.captureScale,
                layoutMargins,
                pageW,
                pageH,
                clipRect: cell.mapRect
            });
        }
    }

    drawSheetTitleBlockFooter(doc, null, page.totalInsetPages || 1, layoutMargins, {
        projectName,
        exportDate,
        model: buildInsetTitleBlockFooterModel({
            projectName,
            exportDate,
            insetPageNumber: page.insetPageNumber || 1,
            totalInsetPages: page.totalInsetPages || 1
        })
    });

    return doc.output('blob');
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
    onWarning,
    signal = null,
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

    const fiberPdfLayers = resolveFiberLayerIdsForPdfExport(
        listVisibleUdotFiberLayerIds(mapService),
        getLayers()
    );
    const fiberLayerIds = fiberPdfLayers.fiberLayerIds;
    const pdfFiberOmitIds = fiberPdfLayers.omitIds;
    const refreshLiveFiberIds = fiberPdfLayers.refreshLiveIds;
    const template = {
        basemapDpi: DEFAULT_BASEMAP_DPI,
        ...(session?.sheets?.template || exportPackage?.template || {})
    };
    const basemapDpi = resolveBasemapDpi(template);
    const includeOverview = exportPackage?.pdf?.pages?.[0]?.pageType === 'overview';
    const projectName = session?.project?.projectName || exportPackage?.projectName || 'sheet_cutting';
    const exportDate = new Date();
    const routeLine = session?.routeLine || exportPackage?.layers?.route?.features?.[0] || null;
    const pdfBearingMode = template.pdfMapBearingMode ?? DEFAULT_PDF_MAP_BEARING_MODE;
    const pdfBearings = resolveSheetPdfBearings(detailSheets, routeLine, { mode: pdfBearingMode });
    const matchLineRegistry = routeLine?.geometry
        ? buildCorridorMatchLineRegistry(detailSheets, routeLine)
        : null;
    const JsPDFCtor = await loadJsPDF();
    const packedInsets = exportPackage?.insets?.pages
        ? exportPackage.insets
        : packInsetPages(session?.sheets?.insetViews || []);
    const insetCallouts = exportPackage?.layers?.insetViews?.features?.length
        ? exportPackage.layers.insetViews.features
        : buildInsetCalloutFeatures(session?.sheets?.insetViews || [], packedInsets.detailsPageByInsetId);
    const calloutSession = loadCalloutSessionForPdf();
    const totalPages = (includeOverview ? 1 : 0) + detailSheets.length + packedInsets.pages.length;
    let completedPages = 0;

    const reportProgress = ({
        phase = 'pages',
        step,
        fileIndex = null,
        fileName = null
    }) => {
        const percent = computeSheetExportProgress({
            completedPages: phase === 'pages' ? completedPages : undefined,
            totalPages,
            phase
        });
        emitExportProgress(onProgress, {
            percent,
            step,
            fileIndex,
            fileCount: totalPages > 1 ? totalPages : null,
            fileName,
            batchLabelUnit: 'Page'
        });
    };

    reportProgress({
        phase: 'folder',
        step: 'Choose a folder for sheet PDFs…'
    });
    const folderHandle = await pickExportFolder();
    const folderName = folderHandle.name || 'selected folder';

    throwIfAborted(signal);
    reportProgress({
        phase: 'prep',
        step: 'Preparing map for export…'
    });

    const savedCamera = saveMapCamera(map);
    const sessionOriginalPixelRatio = typeof map?.getPixelRatio === 'function' ? map.getPixelRatio() : 1;
    const was3d = mapService.is3DEnabled?.() ?? false;
    const resumeInteractions = suspendMapInteractions(map);
    const writtenFiles = [];
    let dpiWarningShown = false;
    const maybeWarnDpi = () => {
        if (dpiWarningShown) return;
        warnIfBasemapDpiConstrained(map, template, (message) => {
            dpiWarningShown = true;
            onWarning?.(message);
        });
    };

    try {
        if (was3d) {
            mapService.disable3D?.({ animate: false });
            await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);
        }

        await bumpMapToExportRatio(map, template);
        maybeWarnDpi();

        if (includeOverview) {
            throwIfAborted(signal);
            const overviewFile = buildSheetPageFilename(projectName, 'overview');
            const overviewPageIndex = 0;
            reportProgress({
                step: 'Rendering overview (basemap + sheet index)…',
                fileIndex: overviewPageIndex,
                fileName: overviewFile
            });
            clearSheetPreview(mapService);
            mapService.clearTempFeatures?.();
            await ensureMapCameraSettled(map, CAMERA_SETTLE_OPTIONS);

            const overviewBounds = boundsFromGeoJson(sheetFrames);
            if (!overviewBounds) {
                throw new Error('Could not determine overview bounds');
            }
            reportProgress({
                step: 'Positioning map for overview…',
                fileIndex: overviewPageIndex,
                fileName: overviewFile
            });
            await fitMapToBounds(mapService, overviewBounds, { pitch: 0, bearing: 0 });
            reportProgress({
                step: `Capturing overview basemap at ${basemapDpi} DPI…`,
                fileIndex: overviewPageIndex,
                fileName: overviewFile
            });
            const { canvas: overviewCanvas, captureScale } = await captureOverviewBasemap(
                mapService,
                template
            );
            reportProgress({
                step: 'Building overview PDF…',
                fileIndex: overviewPageIndex,
                fileName: overviewFile
            });
            const overviewBlob = await buildHybridPagePdfBlob({
                template,
                pageOptions: { pageType: 'overview', exportBearingDeg: 0 },
                map,
                mapService,
                basemapCanvas: overviewCanvas,
                captureScale,
                vectorFeatures: layers.overview || null,
                overviewPlacement: true,
                JsPDFCtor
            });
            reportProgress({
                step: `Writing ${overviewFile}…`,
                fileIndex: overviewPageIndex,
                fileName: overviewFile
            });
            await writeBlobToFolder(folderHandle, overviewFile, overviewBlob);
            writtenFiles.push(overviewFile);
            completedPages += 1;
            reportProgress({
                step: 'Overview saved.',
                fileIndex: overviewPageIndex,
                fileName: overviewFile
            });
        }

        const skippedSheets = [];
        for (let index = 0; index < detailSheets.length; index++) {
            throwIfAborted(signal);
            const sheet = detailSheets[index];
            const label = String(sheet.sheetNumber).padStart(2, '0');
            const pageFile = buildSheetPageFilename(projectName, `sheet_${label}`);
            const pageIndex = (includeOverview ? 1 : 0) + index;
            reportProgress({
                step: `Rendering sheet ${label} (${index + 1} of ${detailSheets.length})…`,
                fileIndex: pageIndex,
                fileName: pageFile
            });

            const frameCollection = buildSingleSheetFrameCollection(sheetFrames, sheet.sheetId);
            const frameFeature = frameCollection?.features?.[0];
            if (!frameFeature) {
                skippedSheets.push(label);
                onWarning?.(`Sheet ${label} is missing a frame polygon — skipped so later sheets can still export.`);
                reportProgress({
                    step: `Skipped sheet ${label} (missing frame).`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
                continue;
            }

            try {
                const ring = extractPrimaryRing(frameFeature);
                if (!ring?.length) {
                    throw new Error(`Sheet ${label} frame polygon is empty`);
                }

                reportProgress({
                    step: `Positioning map for sheet ${label}…`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
                const exportBearing = await resolveDetailCaptureBearing(
                    mapService,
                    ring,
                    sheet,
                    routeLine,
                    pdfBearingMode,
                    pdfBearings
                );

                reportProgress({
                    step: `Capturing basemap at ${basemapDpi} DPI for sheet ${label}…`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
                if (refreshLiveFiberIds.length) {
                    await refreshUdotFiberPaintLayers(mapService, refreshLiveFiberIds);
                }
                const fiberFeatures = collectUdotFiberSheetFeatures(
                    mapService,
                    fiberLayerIds,
                    frameFeature
                );
                const underlay = await captureBasemapUnderlay(mapService, template, ring, {
                    skipViewportFit: true
                });

                reportProgress({
                    step: `Building PDF for sheet ${label}…`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
                const sheetLayer = perSheetLayers.find((entry) => entry.sheetId === sheet.sheetId);
                const cleaned = omitRasterizedLiveFeatures(sheetLayer?.contents || null, pdfFiberOmitIds);
                const pageBlob = await buildHybridPagePdfBlob({
                    template,
                    pageOptions: {
                        pageType: 'detail',
                        exportBearingDeg: exportBearing,
                        sheet,
                        totalSheets: detailSheets.length,
                        detailSheets,
                        routeLine,
                        matchLineRegistry,
                        frameRing: ring,
                        projectName,
                        exportDate,
                        calloutSession,
                        insetViews: session?.sheets?.insetViews || []
                    },
                    map,
                    mapService,
                    basemapCanvas: underlay.canvas,
                    pixelRing: underlay.pixelRing,
                    captureScale: underlay.captureScale,
                    vectorFeatures: {
                        type: 'FeatureCollection',
                        features: [
                            ...(cleaned?.features || []),
                            ...fiberFeatures,
                            ...insetCallouts.filter((feature) => (
                                feature?.properties?.parent_sheet_id === sheet.sheetId
                            ))
                        ]
                    },
                    JsPDFCtor,
                    matchLineRegistry
                });
                reportProgress({
                    step: `Writing ${pageFile}…`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
                await writeBlobToFolder(folderHandle, pageFile, pageBlob);
                writtenFiles.push(pageFile);
                completedPages += 1;
                reportProgress({
                    step: `Sheet ${label} saved.`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
            } catch (err) {
                throwIfAborted(signal);
                if (err?.name === 'AbortError') throw err;
                skippedSheets.push(label);
                onWarning?.(err?.message || `Sheet ${label} export failed — later sheets will still export.`);
                reportProgress({
                    step: `Skipped sheet ${label}.`,
                    fileIndex: pageIndex,
                    fileName: pageFile
                });
            }
        }

        const skippedInsets = [];
        const designFeatures = session?.designFeatures || [];
        for (let pageIndex = 0; pageIndex < packedInsets.pages.length; pageIndex += 1) {
            throwIfAborted(signal);
            const insetPage = packedInsets.pages[pageIndex];
            const label = String(insetPage.insetPageNumber).padStart(2, '0');
            const pageFile = buildSheetPageFilename(projectName, `details_${label}`);
            const fileIndex = (includeOverview ? 1 : 0) + detailSheets.length + pageIndex;
            reportProgress({
                step: `Rendering details page ${label} (${pageIndex + 1} of ${packedInsets.pages.length})…`,
                fileIndex,
                fileName: pageFile
            });

            try {
                const captures = [];
                for (const inset of insetPage.quadrants) {
                    throwIfAborted(signal);
                    if (!inset) {
                        captures.push(null);
                        continue;
                    }
                    reportProgress({
                        step: `Capturing DETAIL ${inset.label} for details ${label}…`,
                        fileIndex,
                        fileName: pageFile
                    });
                    try {
                        const capture = await captureInsetQuadrant({
                            mapService,
                            template,
                            inset,
                            fiberLayerIds,
                            refreshLiveFiberIds,
                            pdfFiberOmitIds,
                            designFeatures
                        });
                        captures.push(capture);
                    } catch (err) {
                        throwIfAborted(signal);
                        if (err?.name === 'AbortError') throw err;
                        skippedInsets.push(`${inset.label}`);
                        onWarning?.(err?.message || `Detail ${inset.label} export failed — other boxes will still export.`);
                        captures.push(null);
                    }
                }

                if (!captures.some(Boolean)) {
                    skippedInsets.push(`page ${label}`);
                    onWarning?.(`Details page ${label} had no usable detail boxes — skipped.`);
                    continue;
                }

                reportProgress({
                    step: `Building details PDF ${label}…`,
                    fileIndex,
                    fileName: pageFile
                });
                const pageBlob = await buildInsetPagePdfBlob({
                    template,
                    page: insetPage,
                    captures,
                    map,
                    mapService,
                    projectName,
                    exportDate,
                    JsPDFCtor,
                    calloutSession
                });
                reportProgress({
                    step: `Writing ${pageFile}…`,
                    fileIndex,
                    fileName: pageFile
                });
                await writeBlobToFolder(folderHandle, pageFile, pageBlob);
                writtenFiles.push(pageFile);
                completedPages += 1;
                reportProgress({
                    step: `Details ${label} saved.`,
                    fileIndex,
                    fileName: pageFile
                });
            } catch (err) {
                throwIfAborted(signal);
                if (err?.name === 'AbortError') throw err;
                skippedInsets.push(`page ${label}`);
                onWarning?.(err?.message || `Details page ${label} export failed — later pages will still export.`);
                reportProgress({
                    step: `Skipped details ${label}.`,
                    fileIndex,
                    fileName: pageFile
                });
            }
        }

        if (writtenFiles.length <= (includeOverview ? 1 : 0)) {
            throw new Error('No detail sheet PDFs were produced');
        }

        reportProgress({
            phase: 'done',
            step: `Saved ${writtenFiles.length} PDF(s) to ${folderName}.`
        });
        return {
            pageCount: writtenFiles.length,
            folderName,
            files: writtenFiles,
            skippedSheets,
            skippedInsets
        };
    } finally {
        try {
            await restoreMapPixelRatio(map, sessionOriginalPixelRatio);
            if (was3d) {
                mapService.enable3D?.({ animate: false });
            }
            restoreMapCamera(map, savedCamera);
            resumeInteractions?.();
            showSheetPreview(mapService, layers);
            refreshCalloutRuntimePreview();
            await ensureMapFrameReady(map);
        } catch (_) {
            // Best-effort recovery so a failed export does not leave the map wedged.
        }
    }
}
