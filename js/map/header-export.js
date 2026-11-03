/**
 * Header print export (PNG / PDF). Caps canvas size and warns if tiles are not ready.
 */

import { downloadBlob } from '../export/exporter.js';
import {
    buildMapExportFilename,
    canvasToPngBlob,
    captureMapCanvas,
    computeExportPixelRatio,
    willUseHighResExport
} from './map-export.js';
import {
    EXPORT_CANVAS_MAX_PIXELS,
    didTileReadinessTimeOut,
    fitExportPixelSize,
    reportTileReadinessTimeout,
    scaleCanvasToExportLimit
} from './export-canvas-guard.js';

export { willUseHighResExport };

const MAX_PDF_PAGE_PT = 14400;

function fitPdfPageSize(width, height) {
    const pageW = Math.max(1, Math.round(width));
    const pageH = Math.max(1, Math.round(height));
    if (pageW <= MAX_PDF_PAGE_PT && pageH <= MAX_PDF_PAGE_PT) {
        return { pageW, pageH, imageW: pageW, imageH: pageH };
    }
    const scale = Math.min(MAX_PDF_PAGE_PT / pageW, MAX_PDF_PAGE_PT / pageH);
    return {
        pageW: Math.max(1, Math.round(pageW * scale)),
        pageH: Math.max(1, Math.round(pageH * scale)),
        imageW: Math.max(1, Math.round(pageW * scale)),
        imageH: Math.max(1, Math.round(pageH * scale))
    };
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
    });
}

async function buildMapPdfBlob(canvas) {
    const pngBlob = await canvasToPngBlob(canvas);
    const pngDataUrl = await blobToDataUrl(pngBlob);
    const { loadJsPDF } = await import('../core/libs.js');
    const JsPDF = await loadJsPDF();
    const { pageW, pageH, imageW, imageH } = fitPdfPageSize(canvas.width, canvas.height);
    const doc = new JsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: [pageW, pageH],
        compress: false
    });
    doc.addImage(pngDataUrl, 'PNG', 0, 0, imageW, imageH);
    return doc.output('blob');
}

function predictedExportSize(map) {
    const cssW = map?.getContainer?.()?.clientWidth;
    const cssH = map?.getContainer?.()?.clientHeight;
    if (!cssW || !cssH) return null;
    const ratio = computeExportPixelRatio(map);
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    return {
        width: Math.max(1, Math.round(cssW * ratio)),
        height: Math.max(1, Math.round(cssH * ratio))
    };
}

/**
 * @param {object} mapService
 * @param {'png'|'pdf'} format
 * @param {object} [options]
 * @param {boolean} [options.blockWhenDualScreen]
 * @param {{ isActive?: boolean }} [options.dualScreenCoordinator]
 * @param {number} [options.maxPixels]
 * @param {number} [options.maxWidth]
 * @param {(message: string, type?: string) => void} [options.onWarning]
 */
export async function exportHeaderMapView(mapService, format, options = {}) {
    const { blockWhenDualScreen = true, dualScreenCoordinator = null } = options;

    if (blockWhenDualScreen && dualScreenCoordinator?.isActive) {
        throw new Error('Map is in the Dual Screen window — export from that window.');
    }
    if (format !== 'png' && format !== 'pdf') {
        throw new Error(`Unknown export format: ${format}`);
    }

    const limits = {
        maxPixels: options.maxPixels ?? EXPORT_CANVAS_MAX_PIXELS,
        maxWidth: options.maxWidth
    };
    const map = mapService?.getMap?.();
    let tileReadinessTimedOut = false;
    const captureOptions = {
        highResCapture: true,
        // Read tile state immediately after the readiness wait, before a second wait
        // or restoring the pixel ratio can hide the timeout.
        rewaitAfterBeforeCapture: false,
        beforeCapture(captureMap) {
            tileReadinessTimedOut = didTileReadinessTimeOut(captureMap);
        }
    };

    try {
        const predicted = predictedExportSize(map);
        if (predicted) {
            const fitted = fitExportPixelSize(predicted.width, predicted.height, limits);
            if (fitted.scaled) {
                captureOptions.targetWidthPx = fitted.width;
                captureOptions.targetHeightPx = fitted.height;
            }
        }
    } catch {
        // The snapshot is scaled to the cap after capture.
    }

    const captured = await captureMapCanvas(mapService, captureOptions);
    if (tileReadinessTimedOut) {
        reportTileReadinessTimeout(options.onWarning);
    }

    const { canvas } = scaleCanvasToExportLimit(captured, limits);

    if (format === 'png') {
        const blob = await canvasToPngBlob(canvas);
        const filename = buildMapExportFilename('png');
        downloadBlob(blob, filename);
        return {
            filename,
            width: canvas.width,
            height: canvas.height,
            tileReadinessTimedOut
        };
    }

    const blob = await buildMapPdfBlob(canvas);
    const filename = buildMapExportFilename('pdf');
    downloadBlob(blob, filename);
    return {
        filename,
        width: canvas.width,
        height: canvas.height,
        tileReadinessTimedOut
    };
}
