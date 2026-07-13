/**
 * Sheet plan PDF export — polygon-clipped map captures written one page at a time
 * to a user-chosen folder (File System Access API).
 *
 * Detail pages clip the live map to the sheet polygon. Overview is a full rectangular
 * capture of all sheet outlines. Each page is saved immediately so memory stays flat.
 */

import { loadJsPDF } from '../../core/libs.js';
import {
    isFolderExportSupported,
    pickExportFolder,
    sanitizeExportFilename,
    writeBlobToFolder
} from '../../export/folder-export.js';
import {
    captureMapCanvas,
    ensureMapFrameReady,
    suspendMapInteractions
} from '../../map/map-export.js';
import { extractPrimaryRing } from './export-builder.js';
import {
    boundsFromGeoJson,
    buildSingleSheetFrameCollection,
    clearSheetPreview,
    showSheetPreview
} from './sheet-preview.js';
import {
    PAGE_ORIENTATIONS,
    computePdfPageSizePt,
    computeSheetExportPixelDimensions,
    DEFAULT_SHEET_EXPORT_DPI
} from './engine.js';
import {
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_MAP_BEARING_MODES,
    DEFAULT_PDF_MAP_BEARING_MODE,
    buildSheetContinuationLabels,
    resolveSheetPdfBearing,
    resolveSheetPdfBearings
} from './sheet-pdf-orientation.js';

const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 18;
/** Extra inset when fitting a sheet polygon into the padded viewport. */
const SHEET_FIT_INSET_RATIO = 0.98;
/** Safety margin (CSS px) kept between polygon vertices and the map canvas edge. */
const SHEET_CAPTURE_EDGE_MARGIN_PX = 32;
const NORTH_ARROW_SIZE_PT = 28;

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
        && (maxY - minY) > 1;
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
 * One-shot zoom/pan correction so the full ring fits inside the viewport margin.
 *
 * @param {object} mapService
 * @param {number[][]} ring
 * @param {object} [options]
 */
export async function ensureRingFitsCaptureViewport(mapService, ring, options = {}) {
    const map = mapService?.getMap?.();
    if (!map || !ring?.length) return;

    const marginPx = options.marginPx ?? SHEET_CAPTURE_EDGE_MARGIN_PX;
    const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
    const cssH = Math.max(1, map.getContainer()?.clientHeight || 1);

    let bounds = measureRingInCssPixels(map, ring);
    const fits = () =>
        bounds.minX >= marginPx
        && bounds.minY >= marginPx
        && bounds.maxX <= cssW - marginPx
        && bounds.maxY <= cssH - marginPx;

    if (fits()) return;

    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(
        (cssW - marginPx * 2) / spanX,
        (cssH - marginPx * 2) / spanY,
        1
    );

    if (scale < 0.999) {
        map.zoomTo(map.getZoom() + Math.log2(scale), { duration: 0 });
        await ensureMapFrameReady(map);
        bounds = measureRingInCssPixels(map, ring);
    }

    const polyCenterX = (bounds.minX + bounds.maxX) / 2;
    const polyCenterY = (bounds.minY + bounds.maxY) / 2;
    map.panBy([cssW / 2 - polyCenterX, cssH / 2 - polyCenterY], { duration: 0 });
    await ensureMapFrameReady(map);
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
    const fitInset = options.fitInset ?? SHEET_FIT_INSET_RATIO;
    const captureMarginPx = options.captureMarginPx ?? SHEET_CAPTURE_EDGE_MARGIN_PX;
    const bounds = boundsFromGeoJson({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] }
    });

    if (bounds) {
        await fitMapToBounds(mapService, bounds, {
            padding,
            maxZoom,
            bearing,
            pitch: options.pitch ?? 0,
            duration: options.duration ?? 0
        });
    } else {
        map.jumpTo({ bearing, pitch: options.pitch ?? 0, duration: 0 });
        await ensureMapFrameReady(map);
    }

    const projectRing = () => ring.map(([lng, lat]) => map.project([lng, lat]));
    let projected = projectRing();
    let minX = Math.min(...projected.map((point) => point.x));
    let maxX = Math.max(...projected.map((point) => point.x));
    let minY = Math.min(...projected.map((point) => point.y));
    let maxY = Math.max(...projected.map((point) => point.y));
    let spanX = Math.max(1, maxX - minX);
    let spanY = Math.max(1, maxY - minY);

    const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
    const cssH = Math.max(1, map.getContainer()?.clientHeight || 1);
    const availW = Math.max(1, cssW - padding * 2 - captureMarginPx * 2);
    const availH = Math.max(1, cssH - padding * 2 - captureMarginPx * 2);
    const scale = Math.min(availW / spanX, availH / spanY) * fitInset;

    if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.005) {
        const nextZoom = Math.min(maxZoom, map.getZoom() + Math.log2(scale));
        map.zoomTo(nextZoom, { duration: 0 });
        await ensureMapFrameReady(map);

        projected = projectRing();
        minX = Math.min(...projected.map((point) => point.x));
        maxX = Math.max(...projected.map((point) => point.x));
        minY = Math.min(...projected.map((point) => point.y));
        maxY = Math.max(...projected.map((point) => point.y));
    }

    const polyCenterX = (minX + maxX) / 2;
    const polyCenterY = (minY + maxY) / 2;
    map.panBy([cssW / 2 - polyCenterX, cssH / 2 - polyCenterY], { duration: 0 });
    await ensureMapFrameReady(map);

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
 * @param {import('jspdf').jsPDF} doc
 * @param {HTMLCanvasElement} canvas
 * @param {object} marginsPt
 * @param {object} [options]
 */
export function placeSheetCanvasOnPdfPage(doc, canvas, marginsPt, options = {}) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const availW = pageW - marginsPt.left - marginsPt.right;
    const availH = pageH - marginsPt.top - marginsPt.bottom;
    const preferLandscapeFlow = options.preferLandscapeFlow !== false;

    let scale;
    if (preferLandscapeFlow && canvas.width >= canvas.height) {
        scale = availW / canvas.width;
        if (canvas.height * scale > availH) {
            scale = availH / canvas.height;
        }
    } else {
        scale = Math.min(availW / canvas.width, availH / canvas.height);
    }

    const width = canvas.width * scale;
    const height = canvas.height * scale;
    const x = marginsPt.left + (availW - width) / 2;
    const y = marginsPt.top + (availH - height) / 2;
    const dataUrl = canvas.toDataURL('image/png');
    doc.addImage(dataUrl, 'PNG', x, y, width, height, undefined, 'FAST');
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
 * @param {HTMLCanvasElement} canvas
 * @param {object} template
 * @param {object} [pageOptions]
 * @returns {Promise<Blob>}
 */
export async function buildSinglePagePdfBlob(canvas, template = {}, pageOptions = {}) {
    const orientation = template.orientation === PAGE_ORIENTATIONS.PORTRAIT
        ? PAGE_ORIENTATIONS.PORTRAIT
        : PAGE_ORIENTATIONS.LANDSCAPE;
    const format = resolvePdfPageFormat(template);
    const { marginsPt } = computeSheetExportPixelDimensions(template, template.exportDpi);
    const isDetail = pageOptions.pageType === 'detail';
    const layoutMargins = isDetail
        ? resolveDetailPageMarginsPt(marginsPt, true)
        : marginsPt;
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({
        orientation,
        unit: 'pt',
        format,
        compress: true
    });

    placeSheetCanvasOnPdfPage(doc, canvas, layoutMargins, {
        preferLandscapeFlow: isDetail
    });

    const mapBearing = pageOptions.exportBearingDeg ?? 0;
    const pageW = doc.internal.pageSize.getWidth();
    if (isDetail && pageOptions.sheet) {
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
 * @param {object} mapService
 * @param {object} template
 * @returns {Promise<HTMLCanvasElement>}
 */
async function captureMapAtSheetDpi(mapService, template, beforeCapture) {
    const { widthPx } = computeSheetExportPixelDimensions(template, template.exportDpi);
    return captureMapCanvas(mapService, { targetWidthPx: widthPx, beforeCapture });
}

/**
 * Capture the map at export DPI and clip to a polygon ring in device pixels.
 * Ring projection runs at export resolution before the map pixel ratio is restored.
 *
 * @param {object} mapService
 * @param {object} template
 * @param {number[][]} ring
 * @returns {Promise<HTMLCanvasElement>}
 */
async function captureClippedSheetMap(mapService, template, ring) {
    let pixelRing = null;
    const mapCanvas = await captureMapAtSheetDpi(mapService, template, (map) => {
        pixelRing = projectRingToDevicePixels(map, ring);
    });

    if (!pixelRing?.length) {
        throw new Error('Sheet polygon ring is empty');
    }

    if (!pixelRingOverlapsCanvas(pixelRing, mapCanvas)) {
        throw new Error('Sheet polygon is outside the map capture area — try exporting again');
    }

    return clipMapCanvasToPolygonRing(mapCanvas, pixelRing);
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
    const detailSheets = (session?.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');
    if (!sheetFrames?.features?.length || !detailSheets.length) {
        throw new Error('Generate sheets before exporting PDF');
    }

    const template = {
        exportDpi: DEFAULT_SHEET_EXPORT_DPI,
        ...(session?.sheets?.template || exportPackage?.template || {})
    };
    const includeOverview = template.includeOverview !== false && exportPackage?.pdf?.pages?.[0]?.pageType === 'overview';
    const projectName = session?.project?.projectName || exportPackage?.projectName || 'sheet_cutting';
    const exportDims = computeSheetExportPixelDimensions(template, template.exportDpi);
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
            onProgress?.(`Rendering overview (${exportDims.dpi} DPI)…`);
            showSheetPreview(mapService, layers);
            const overviewBounds = boundsFromGeoJson(sheetFrames);
            if (!overviewBounds) {
                throw new Error('Could not determine overview bounds');
            }
            await fitMapToBounds(mapService, overviewBounds, { pitch: 0, bearing: 0 });
            const overviewCanvas = await captureMapAtSheetDpi(mapService, template);
            const overviewBlob = await buildSinglePagePdfBlob(overviewCanvas, template, {
                pageType: 'overview',
                exportBearingDeg: 0
            });
            const overviewFile = buildSheetPageFilename(projectName, 'overview');
            await writeBlobToFolder(folderHandle, overviewFile, overviewBlob);
            writtenFiles.push(overviewFile);
        }

        for (let index = 0; index < detailSheets.length; index++) {
            const sheet = detailSheets[index];
            const label = String(sheet.sheetNumber).padStart(2, '0');
            onProgress?.(`Rendering sheet ${label} (${index + 1} of ${detailSheets.length}, ${exportDims.dpi} DPI)…`);

            const frameCollection = buildSingleSheetFrameCollection(sheetFrames, sheet.sheetId);
            const frameFeature = frameCollection?.features?.[0];
            if (!frameFeature) continue;

            const ring = extractPrimaryRing(frameFeature);
            if (!ring?.length) continue;

            const exportBearing = pdfBearings.get(sheet.sheetId)
                ?? resolveSheetPdfBearing(sheet, routeLine, { mode: pdfBearingMode });

            showSheetPreview(mapService, layers, { singleFrame: frameCollection });

            await fitMapToPolygonRing(mapService, ring, {
                pitch: 0,
                bearing: exportBearing
            });

            let clippedCanvas = await captureClippedSheetMap(mapService, template, ring);
            let captureBearing = exportBearing;

            if (
                pdfBearingMode !== PDF_MAP_BEARING_MODES.NORTH_UP
                && clippedCanvas.height > clippedCanvas.width
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
                    const retryClip = await captureClippedSheetMap(mapService, template, ring);
                    if (retryClip.width >= retryClip.height) {
                        clippedCanvas = retryClip;
                        captureBearing = endBearing;
                    }
                }
            }

            const pageBlob = await buildSinglePagePdfBlob(clippedCanvas, template, {
                pageType: 'detail',
                exportBearingDeg: captureBearing,
                sheet,
                totalSheets: detailSheets.length
            });
            const pageFile = buildSheetPageFilename(projectName, `sheet_${label}`);
            await writeBlobToFolder(folderHandle, pageFile, pageBlob);
            writtenFiles.push(pageFile);
        }

        if (!writtenFiles.length) {
            throw new Error('No sheet PDFs were produced');
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
