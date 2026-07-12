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

const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 18;

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

    map.fitBounds(bounds, {
        padding: options.padding ?? FIT_PADDING,
        maxZoom: options.maxZoom ?? FIT_MAX_ZOOM,
        duration: options.duration ?? 0,
        bearing: options.bearing ?? 0,
        pitch: options.pitch ?? 0
    });
    await waitForMapSettled(map);
    await ensureMapFrameReady(map);
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
 * @param {import('jspdf').jsPDF} doc
 * @param {HTMLCanvasElement} canvas
 * @param {object} marginsPt
 */
export function placeCanvasOnPdfPage(doc, canvas, marginsPt) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const availW = pageW - marginsPt.left - marginsPt.right;
    const availH = pageH - marginsPt.top - marginsPt.bottom;
    const scale = Math.min(availW / canvas.width, availH / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    const x = marginsPt.left + (availW - width) / 2;
    const y = marginsPt.top + (availH - height) / 2;
    const dataUrl = canvas.toDataURL('image/png');
    doc.addImage(dataUrl, 'PNG', x, y, width, height, undefined, 'FAST');
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
 * @returns {Promise<Blob>}
 */
export async function buildSinglePagePdfBlob(canvas, template = {}) {
    const orientation = template.orientation === PAGE_ORIENTATIONS.PORTRAIT
        ? PAGE_ORIENTATIONS.PORTRAIT
        : PAGE_ORIENTATIONS.LANDSCAPE;
    const format = resolvePdfPageFormat(template);
    const { marginsPt } = computeSheetExportPixelDimensions(template, template.exportDpi);
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({
        orientation,
        unit: 'pt',
        format,
        compress: true
    });
    placeCanvasOnPdfPage(doc, canvas, marginsPt);
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
async function captureMapAtSheetDpi(mapService, template) {
    const { widthPx } = computeSheetExportPixelDimensions(template, template.exportDpi);
    return captureMapCanvas(mapService, { targetWidthPx: widthPx });
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
            const overviewBlob = await buildSinglePagePdfBlob(overviewCanvas, template);
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

            clearSheetPreview(mapService);

            const sheetBounds = boundsFromGeoJson(frameCollection);
            if (!sheetBounds) continue;

            await fitMapToBounds(mapService, sheetBounds, {
                pitch: 0,
                bearing: sheet.rotationDeg ?? 0
            });

            const mapCanvas = await captureMapAtSheetDpi(mapService, template);
            const ring = extractPrimaryRing(frameFeature);
            if (!ring?.length) continue;

            const pixelRing = projectRingToDevicePixels(map, ring);
            const clippedCanvas = clipMapCanvasToPolygonRing(mapCanvas, pixelRing);
            const pageBlob = await buildSinglePagePdfBlob(clippedCanvas, template);
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
