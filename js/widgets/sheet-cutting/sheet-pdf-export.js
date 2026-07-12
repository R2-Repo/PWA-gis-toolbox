/**
 * Sheet plan PDF export — MapLibre map captures assembled with jsPDF.
 *
 * Overview and detail pages are literal screenshots of the live map (basemap,
 * design layers, symbology) after fitBounds, matching what the user sees.
 */

import { downloadBlob } from '../../export/exporter.js';
import { loadJsPDF } from '../../core/libs.js';
import {
    captureMapCanvas,
    canvasToPngBlob,
    ensureMapFrameReady,
    suspendMapInteractions
} from '../../map/map-export.js';
import {
    boundsFromGeoJson,
    buildSingleSheetFrameCollection,
    clearSheetPreview,
    showSheetPreview
} from './sheet-preview.js';
import { PAGE_ORIENTATIONS, computePdfPageSizePt } from './engine.js';

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
        window.setTimeout(finish, 1500);
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
        bearing: options.bearing,
        pitch: options.pitch ?? 0
    });
    await waitForMapSettled(map);
    await ensureMapFrameReady(map);
}

/**
 * @param {object} mapService
 * @returns {Promise<{ dataUrl: string, width: number, height: number }>}
 */
export async function captureMapView(mapService) {
    const canvas = await captureMapCanvas(mapService);
    const pngBlob = await canvasToPngBlob(canvas);
    const dataUrl = await blobToDataUrl(pngBlob);
    return { dataUrl, width: canvas.width, height: canvas.height };
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
    });
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {string} dataUrl
 * @param {number} imageWidth
 * @param {number} imageHeight
 */
export function addMapCaptureToPdfPage(doc, dataUrl, imageWidth, imageHeight) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const scale = Math.min(pageW / imageWidth, pageH / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    const x = (pageW - width) / 2;
    const y = (pageH - height) / 2;
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
 * @param {object[]} captures
 * @param {object} [options]
 * @returns {Promise<Blob>}
 */
export async function buildSheetPlanPdfBlob(captures = [], options = {}) {
    const orientation = options.orientation === PAGE_ORIENTATIONS.PORTRAIT
        ? PAGE_ORIENTATIONS.PORTRAIT
        : PAGE_ORIENTATIONS.LANDSCAPE;
    const format = options.pageFormat || resolvePdfPageFormat(options.template || {});
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({
        orientation,
        unit: 'pt',
        format,
        compress: true
    });

    for (let i = 0; i < captures.length; i++) {
        if (i > 0) {
            doc.addPage(format, orientation);
        }
        const capture = captures[i];
        addMapCaptureToPdfPage(doc, capture.dataUrl, capture.width, capture.height);
    }

    return doc.output('blob');
}

/**
 * @param {string} projectName
 * @returns {string}
 */
export function buildSheetPlanPdfFilename(projectName = 'sheet_cutting') {
    const safe = String(projectName || 'sheet_cutting').replace(/\s+/g, '_');
    return `${safe}_sheet_plan.pdf`;
}

/**
 * @param {object} params
 * @returns {Promise<{ filename: string, pageCount: number }>}
 */
export async function exportSheetPlanPdf({
    mapService,
    exportPackage,
    session,
    onProgress,
    blockWhenDualScreen = true,
    dualScreenCoordinator: coordinator = null
}) {
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

    const template = session?.sheets?.template || exportPackage?.template || {};
    const includeOverview = template.includeOverview !== false && exportPackage?.pdf?.pages?.[0]?.pageType === 'overview';
    const savedCamera = saveMapCamera(map);
    const resumeInteractions = suspendMapInteractions(map);
    const captures = [];
    const fitOptions = { pitch: 0, bearing: savedCamera.bearing };

    try {
        if (includeOverview) {
            onProgress?.('Capturing overview map view…');
            showSheetPreview(mapService, layers);
            const overviewBounds = boundsFromGeoJson(sheetFrames);
            if (!overviewBounds) {
                throw new Error('Could not determine overview bounds');
            }
            await fitMapToBounds(mapService, overviewBounds, fitOptions);
            captures.push(await captureMapView(mapService));
        }

        for (let index = 0; index < detailSheets.length; index++) {
            const sheet = detailSheets[index];
            const label = String(sheet.sheetNumber).padStart(2, '0');
            onProgress?.(`Capturing sheet ${label} (${index + 1} of ${detailSheets.length})…`);

            const singleFrame = buildSingleSheetFrameCollection(sheetFrames, sheet.sheetId);
            if (!singleFrame) continue;

            showSheetPreview(mapService, layers, { singleFrame });
            const sheetBounds = boundsFromGeoJson(singleFrame);
            if (!sheetBounds) continue;

            await fitMapToBounds(mapService, sheetBounds, fitOptions);
            captures.push(await captureMapView(mapService));
        }

        if (!captures.length) {
            throw new Error('No map captures were produced');
        }

        onProgress?.('Building PDF…');
        const blob = await buildSheetPlanPdfBlob(captures, {
            template,
            orientation: template.orientation || PAGE_ORIENTATIONS.LANDSCAPE
        });

        const filename = buildSheetPlanPdfFilename(session?.project?.projectName);
        downloadBlob(blob, filename);
        return { filename, pageCount: captures.length };
    } finally {
        restoreMapCamera(map, savedCamera);
        resumeInteractions?.();
        showSheetPreview(mapService, layers);
        await ensureMapFrameReady(map);
    }
}
