import { downloadBlob } from '../export/exporter.js';

/** jsPDF / PDF spec practical max page dimension in points */
const MAX_PDF_PAGE_PT = 14400;
const MAX_EXPORT_PIXEL_RATIO = 4;
const GPU_MAX_RENDERBUFFER_FALLBACK = 8192;
const GPU_MARGIN = 0.95;

/** Higher cap for sheet PDF export so small map panels can still reach print DPI. */
export const SHEET_EXPORT_MAX_PIXEL_RATIO = 12;

export const GIF_MAX_WIDTH = 1280;

function waitForMapIdle(map, timeoutMs = 12000) {
    return new Promise((resolve) => {
        if (!map) {
            resolve();
            return;
        }
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            map.off('idle', finish);
            resolve();
        };
        map.once('idle', finish);
        map.triggerRepaint();
        window.setTimeout(finish, timeoutMs);
    });
}

export async function ensureMapFrameReady(map) {
    await waitForMapIdle(map);
}

/**
 * Wait for tiles and a stable GL frame after bumping pixel ratio (sheet PDF export).
 * @param {import('maplibre-gl').Map} map
 * @param {{ maxWaitMs?: number }} [options]
 */
export async function ensureHighResCaptureReady(map, options = {}) {
    const maxWaitMs = options.maxWaitMs ?? 8000;
    await ensureMapFrameReady(map);

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        if (typeof map.areTilesLoaded !== 'function' || map.areTilesLoaded()) {
            break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        map.triggerRepaint();
    }

    await ensureMapFrameReady(map);
    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

function getMapPixelRatio(map) {
    if (typeof map.getPixelRatio === 'function') {
        return map.getPixelRatio();
    }
    return window.devicePixelRatio || 1;
}

function getMaxSafePixelRatio(map, maxRatioCap = MAX_EXPORT_PIXEL_RATIO) {
    const container = map.getContainer();
    const cssW = Math.max(1, container?.clientWidth || 1);
    const cssH = Math.max(1, container?.clientHeight || 1);

    const canvas = map.getCanvas();
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    let maxDim = GPU_MAX_RENDERBUFFER_FALLBACK;
    if (gl) {
        maxDim = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || maxDim;
    }
    maxDim = Math.floor(maxDim * GPU_MARGIN);

    return Math.min(maxDim / cssW, maxDim / cssH, maxRatioCap);
}

export function computeExportPixelRatio(map) {
    const currentRatio = getMapPixelRatio(map);
    const gpuMaxRatio = getMaxSafePixelRatio(map);
    const target = Math.min(gpuMaxRatio, Math.max(3, currentRatio * 2));
    if (target <= currentRatio) {
        return currentRatio;
    }
    return target;
}

/**
 * Pixel ratio needed so the map canvas reaches at least targetWidthPx (clamped to GPU limits).
 * @param {import('maplibre-gl').Map} map
 * @param {number} targetWidthPx
 * @param {object} [options]
 * @returns {number}
 */
export function computePixelRatioForTargetWidth(map, targetWidthPx, options = {}) {
    return computePixelRatioForTargetDimensions(map, targetWidthPx, null, options);
}

/**
 * Pixel ratio to reach target capture dimensions (clamped to GPU limits).
 * @param {import('maplibre-gl').Map} map
 * @param {number} targetWidthPx
 * @param {number|null} targetHeightPx
 * @param {object} [options]
 * @returns {number}
 */
export function computePixelRatioForTargetDimensions(map, targetWidthPx, targetHeightPx = null, options = {}) {
    const container = map.getContainer();
    const cssW = Math.max(1, container?.clientWidth || 1);
    const cssH = Math.max(1, container?.clientHeight || 1);
    const currentRatio = getMapPixelRatio(map);
    const maxRatioCap = options.maxPixelRatio ?? MAX_EXPORT_PIXEL_RATIO;
    const gpuMaxRatio = getMaxSafePixelRatio(map, maxRatioCap);

    const canvas = map.getCanvas();
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    let maxDim = GPU_MAX_RENDERBUFFER_FALLBACK;
    if (gl) {
        maxDim = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || maxDim;
    }
    maxDim = Math.floor(maxDim * GPU_MARGIN);

    const ratioForWidth = targetWidthPx / cssW;
    const ratioForHeight = targetHeightPx ? targetHeightPx / cssH : ratioForWidth;
    const ratioForHeightCap = maxDim / cssH;
    const ratioForWidthCap = maxDim / cssW;
    const target = Math.min(
        gpuMaxRatio,
        ratioForWidth,
        ratioForHeight,
        ratioForHeightCap,
        ratioForWidthCap
    );
    return Math.max(currentRatio, Math.min(maxRatioCap, target));
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {number} targetWidthPx
 * @param {number|null} targetHeightPx
 * @param {object} [options]
 * @returns {{ exportRatio: number, canvasWidthPx: number, canvasHeightPx: number, meetsWidthTarget: boolean, meetsHeightTarget: boolean }}
 */
export function resolveCapturePixelDimensions(map, targetWidthPx, targetHeightPx = null, options = {}) {
    const cssW = Math.max(1, map.getContainer()?.clientWidth || 1);
    const cssH = Math.max(1, map.getContainer()?.clientHeight || 1);
    const exportRatio = computePixelRatioForTargetDimensions(map, targetWidthPx, targetHeightPx, options);
    const canvasWidthPx = Math.round(cssW * exportRatio);
    const canvasHeightPx = Math.round(cssH * exportRatio);
    return {
        exportRatio,
        canvasWidthPx,
        canvasHeightPx,
        meetsWidthTarget: canvasWidthPx >= targetWidthPx,
        meetsHeightTarget: !targetHeightPx || canvasHeightPx >= targetHeightPx
    };
}

export function willUseHighResExport(mapService) {
    const map = mapService?.getMap?.();
    if (!map?.loaded?.()) return false;
    const currentRatio = getMapPixelRatio(map);
    return computeExportPixelRatio(map) > currentRatio;
}

/** Copy WebGL map pixels before the map is resized or pixel ratio is restored. */
function snapshotMapCanvas(sourceCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Map export failed');
    }
    ctx.drawImage(sourceCanvas, 0, 0);
    return canvas;
}

export function captureLiveFrame(map, mapService) {
    const canvas = snapshotMapCanvas(map.getCanvas());
    if (mapService.is3DEnabled?.()) {
        const container = map.getContainer();
        const cssW = Math.max(1, container?.clientWidth || 1);
        const pixelScale = cssW > 0 ? canvas.width / cssW : 1;
        mapService.compositeAnnotationOverlay?.(canvas.getContext('2d'), pixelScale);
    }
    return canvas;
}

export function scaleCanvasToImageData(sourceCanvas, maxWidth = GIF_MAX_WIDTH) {
    let width = sourceCanvas.width;
    let height = sourceCanvas.height;
    if (width > maxWidth) {
        height = Math.max(1, Math.round(height * maxWidth / width));
        width = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('GIF export failed');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
}

export function suspendMapInteractions(map) {
    const names = ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate'];
    const prev = {};
    for (const name of names) {
        const handler = map[name];
        if (!handler?.disable) continue;
        prev[name] = handler.isEnabled();
        handler.disable();
    }
    return () => {
        for (const name of names) {
            const handler = map[name];
            if (handler?.enable && prev[name]) {
                handler.enable();
            }
        }
    };
}

export function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('PNG export failed'));
            }, 'image/png');
        } catch (err) {
            reject(err);
        }
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
    });
}

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

async function buildMapPdfBlob(canvas, pngDataUrl) {
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

/** @param {ImageData[]} frames */
export async function buildGifBlob(frames, delayMs) {
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
    const enc = GIFEncoder();
    for (const imageData of frames) {
        const palette = quantize(imageData.data, 256);
        const index = applyPalette(imageData.data, palette);
        enc.writeFrame(index, imageData.width, imageData.height, { palette, delay: delayMs });
    }
    enc.finish();
    return new Blob([enc.bytes()], { type: 'image/gif' });
}

export function buildMapExportFilename(ext) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate())
    ].join('-') + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    return `gis-toolbox-map-${stamp}.${ext}`;
}

/**
 * @param {object} mapService
 * @param {{ targetWidthPx?: number, targetHeightPx?: number, maxPixelRatio?: number, highResCapture?: boolean, beforeCapture?: (map: import('maplibre-gl').Map) => void }} [options]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function captureMapCanvas(mapService, options = {}) {
    const map = mapService?.getMap?.();
    if (!map) {
        throw new Error('Map is not ready');
    }
    if (!map.loaded()) {
        throw new Error('Map is still loading');
    }

    const originalRatio = getMapPixelRatio(map);
    const ratioOptions = { maxPixelRatio: options.maxPixelRatio };
    const exportRatio = options.targetWidthPx
        ? computePixelRatioForTargetDimensions(
            map,
            options.targetWidthPx,
            options.targetHeightPx ?? null,
            ratioOptions
        )
        : computeExportPixelRatio(map);
    const bumped = exportRatio > originalRatio;

    if (bumped) {
        map.setPixelRatio(exportRatio);
    }

    const waitForCapture = options.highResCapture ? ensureHighResCaptureReady : ensureMapFrameReady;
    await waitForCapture(map);

    try {
        options.beforeCapture?.(map);
        if (options.beforeCapture) {
            await waitForCapture(map);
        }
        return captureLiveFrame(map, mapService);
    } finally {
        if (bumped) {
            map.setPixelRatio(originalRatio);
            map.resize();
        }
    }
}

export async function exportMapView(mapService, format, options = {}) {
    const { blockWhenDualScreen = true, dualScreenCoordinator = null } = options;

    if (blockWhenDualScreen && dualScreenCoordinator?.isActive) {
        throw new Error('Map is in the Dual Screen window — export from that window.');
    }

    const canvas = await captureMapCanvas(mapService);

    if (format === 'png') {
        const blob = await canvasToPngBlob(canvas);
        const filename = buildMapExportFilename('png');
        downloadBlob(blob, filename);
        return { filename, width: canvas.width, height: canvas.height };
    }

    if (format === 'pdf') {
        const pngBlob = await canvasToPngBlob(canvas);
        const pngDataUrl = await blobToDataUrl(pngBlob);
        const blob = await buildMapPdfBlob(canvas, pngDataUrl);
        const filename = buildMapExportFilename('pdf');
        downloadBlob(blob, filename);
        return { filename, width: canvas.width, height: canvas.height };
    }

    throw new Error(`Unknown export format: ${format}`);
}

/**
 * Wire a vanilla header print dropdown (dual-screen secondary window).
 */
export function setupMapPrintMenu(options) {
    const {
        menuRoot,
        mapService: mapApi,
        showToast = null,
        blockWhenDualScreen = false,
        dualScreenCoordinator = null
    } = options || {};

    if (!menuRoot || !mapApi) return;

    const toggleBtn = menuRoot.querySelector('#btn-print-map') || menuRoot.querySelector('button');
    const dropdown = menuRoot.querySelector('.header-print-dropdown');
    let busy = false;
    let open = false;

    const setOpen = (value) => {
        open = value;
        dropdown?.classList.toggle('open', open);
    };

    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (busy) return;
        setOpen(!open);
    });

    document.addEventListener('click', (e) => {
        if (open && !menuRoot.contains(e.target)) {
            setOpen(false);
        }
    });

    dropdown?.querySelectorAll('[data-format]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const format = btn.dataset.format;
            if (!format || busy) return;
            setOpen(false);
            busy = true;
            if (toggleBtn) toggleBtn.disabled = true;
            const prevText = toggleBtn?.textContent;
            if (toggleBtn) toggleBtn.textContent = '…';
            try {
                if (willUseHighResExport(mapApi)) {
                    showToast?.('Exporting high-resolution map…', 'info');
                }
                await exportMapView(mapApi, format, { blockWhenDualScreen, dualScreenCoordinator });
                showToast?.(`${format.toUpperCase()} saved.`, 'success');
            } catch (err) {
                showToast?.(err.message || 'Map export failed.', 'error');
            } finally {
                busy = false;
                if (toggleBtn) {
                    toggleBtn.disabled = false;
                    toggleBtn.textContent = prevText || '🖨️ Print ▾';
                }
            }
        });
    });
}
