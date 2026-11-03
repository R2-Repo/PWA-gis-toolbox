/**
 * Header print export (PNG / PDF).
 * PDF uses a Letter or Tabloid page with a fitted map, title, scale bar, and north arrow.
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
import {
    HEADER_PDF_DOCUMENT_COMPRESS,
    HEADER_PDF_IMAGE_COMPRESSION,
    HEADER_PDF_JPEG_QUALITY,
    groundWidthMetersFromView,
    layoutHeaderPdf
} from './header-pdf-layout.js';

export { willUseHighResExport };

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
    });
}

function canvasToJpegDataUrl(canvas, quality) {
    if (typeof canvas?.toDataURL === 'function') {
        try {
            const url = canvas.toDataURL('image/jpeg', quality);
            if (typeof url === 'string' && url.startsWith('data:image/jpeg')) {
                return Promise.resolve(url);
            }
        } catch {
            // Some canvases only expose toBlob.
        }
    }
    return new Promise((resolve, reject) => {
        if (typeof canvas?.toBlob !== 'function') {
            reject(new Error('Map image could not be compressed'));
            return;
        }
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Map image could not be compressed'));
                return;
            }
            blobToDataUrl(blob).then(resolve, reject);
        }, 'image/jpeg', quality);
    });
}

function boundsFromMap(map) {
    const bounds = map?.getBounds?.();
    if (!bounds) return null;
    const west = typeof bounds.getWest === 'function' ? bounds.getWest() : bounds.west;
    const south = typeof bounds.getSouth === 'function' ? bounds.getSouth() : bounds.south;
    const east = typeof bounds.getEast === 'function' ? bounds.getEast() : bounds.east;
    const north = typeof bounds.getNorth === 'function' ? bounds.getNorth() : bounds.north;
    if (![west, south, east, north].every(Number.isFinite)) return null;
    return { west, south, east, north };
}

function drawScaleBar(doc, bar) {
    const pad = 4;
    const top = bar.labelY - 10;
    const backdropH = (bar.y + bar.height + pad) - top;
    doc.setFillColor(255, 255, 255);
    doc.rect(bar.x - pad, top, bar.width + (pad * 2), backdropH, 'F');
    for (const segment of bar.segments) {
        const shade = segment.fill === '#ffffff' ? 255 : 17;
        doc.setFillColor(shade, shade, shade);
        doc.rect(segment.x, segment.y, segment.width, segment.height, 'F');
    }
    doc.setDrawColor(17, 17, 17);
    doc.setLineWidth(0.6);
    doc.rect(bar.x, bar.y, bar.width, bar.height, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(17, 17, 17);
    doc.text(bar.label, bar.labelX, bar.labelY, { align: 'center' });
}

function drawNorthArrow(doc, north) {
    const half = north.size / 2;
    doc.setFillColor(255, 255, 255);
    doc.rect(north.cx - half, north.cy - half, north.size, north.size, 'F');
    doc.setFillColor(17, 17, 17);
    doc.triangle(
        north.tip.x,
        north.tip.y,
        north.left.x,
        north.left.y,
        north.right.x,
        north.right.y,
        'F'
    );
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(17, 17, 17);
    doc.text(north.label.text, north.label.x, north.label.y, { align: 'center' });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} map
 * @param {{ pageSize?: 'letter'|'tabloid', title?: string }} [options]
 */
export async function buildHeaderPdfBlob(canvas, map, options = {}) {
    const center = map?.getCenter?.();
    const ground = groundWidthMetersFromView({
        bounds: boundsFromMap(map),
        latitude: center?.lat,
        zoom: map?.getZoom?.(),
        imageWidthPx: canvas.width
    });
    const layout = layoutHeaderPdf({
        pageSize: options.pageSize,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        title: options.title,
        groundWidthMeters: ground.groundWidthMeters,
        bearingDeg: map?.getBearing?.() ?? 0
    });
    const jpeg = await canvasToJpegDataUrl(canvas, layout.compression.jpegQuality);
    const { loadJsPDF } = await import('../core/libs.js');
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({
        orientation: layout.page.orientation,
        unit: 'pt',
        format: [layout.page.pageW, layout.page.pageH],
        compress: HEADER_PDF_DOCUMENT_COMPRESS
    });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout.title.fontSize);
    doc.setTextColor(20, 20, 20);
    doc.text(layout.title.text, layout.title.x, layout.title.y, { align: layout.title.align });
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.6);
    doc.rect(layout.image.x, layout.image.y, layout.image.width, layout.image.height, 'S');
    doc.addImage(
        jpeg,
        'JPEG',
        layout.image.x,
        layout.image.y,
        layout.image.width,
        layout.image.height,
        'map',
        HEADER_PDF_IMAGE_COMPRESSION
    );
    drawScaleBar(doc, layout.scaleBar);
    drawNorthArrow(doc, layout.north);
    return { blob: doc.output('blob'), layout };
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
 * @param {'letter'|'tabloid'} [options.pageSize]
 * @param {string} [options.title]
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

    const { blob, layout } = await buildHeaderPdfBlob(canvas, map, options);
    const filename = buildMapExportFilename('pdf');
    downloadBlob(blob, filename);
    return {
        filename,
        width: canvas.width,
        height: canvas.height,
        tileReadinessTimedOut,
        pageSize: layout.page.pageSize,
        pageWidthPt: layout.page.pageW,
        pageHeightPt: layout.page.pageH
    };
}
