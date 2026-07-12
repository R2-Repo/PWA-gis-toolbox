import { downloadBlob } from '../export/exporter.js';

/** jsPDF / PDF spec practical max page dimension in points */
const MAX_PDF_PAGE_PT = 14400;
const MAX_EXPORT_PIXEL_RATIO = 4;
const GPU_MAX_RENDERBUFFER_FALLBACK = 8192;
const GPU_MARGIN = 0.95;

export const GIF_MAX_WIDTH = 1280;

function waitForMapIdle(map) {
    return new Promise((resolve) => {
        if (!map) {
            resolve();
            return;
        }
        map.once('idle', resolve);
        map.triggerRepaint();
    });
}

export async function ensureMapFrameReady(map) {
    await waitForMapIdle(map);
}

function getMapPixelRatio(map) {
    if (typeof map.getPixelRatio === 'function') {
        return map.getPixelRatio();
    }
    return window.devicePixelRatio || 1;
}

function getMaxSafePixelRatio(map) {
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

    return Math.min(maxDim / cssW, maxDim / cssH, MAX_EXPORT_PIXEL_RATIO);
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
 * @returns {number}
 */
export function computePixelRatioForTargetWidth(map, targetWidthPx) {
    const container = map.getContainer();
    const cssW = Math.max(1, container?.clientWidth || 1);
    const cssH = Math.max(1, container?.clientHeight || 1);
    const currentRatio = getMapPixelRatio(map);
    const gpuMaxRatio = getMaxSafePixelRatio(map);

    const canvas = map.getCanvas();
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    let maxDim = GPU_MAX_RENDERBUFFER_FALLBACK;
    if (gl) {
        maxDim = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || maxDim;
    }
    maxDim = Math.floor(maxDim * GPU_MARGIN);

    const ratioForWidth = targetWidthPx / cssW;
    const ratioForHeightCap = maxDim / cssH;
    const target = Math.min(gpuMaxRatio, ratioForWidth, ratioForHeightCap);
    return Math.max(currentRatio, Math.min(MAX_EXPORT_PIXEL_RATIO, target));
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
 * @param {{ targetWidthPx?: number }} [options]
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
    const exportRatio = options.targetWidthPx
        ? computePixelRatioForTargetWidth(map, options.targetWidthPx)
        : computeExportPixelRatio(map);
    const bumped = exportRatio > originalRatio;

    if (bumped) {
        map.setPixelRatio(exportRatio);
    }

    await ensureMapFrameReady(map);

    try {
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
