/**
 * Pixel-area cap and tile-readiness warning for header and poster exports.
 */

import { showToast } from '../ui/toast.js';

/** About 16 million pixels. */
export const EXPORT_CANVAS_MAX_PIXELS = 16_000_000;

export const TILE_READINESS_TIMEOUT_WARNING =
    'The map did not finish loading in time. The saved image may look incomplete.';

/**
 * Tiles still unloaded after ensureMapCaptureReady means that wait hit its time limit.
 * @param {import('maplibre-gl').Map | null | undefined} map
 */
export function didTileReadinessTimeOut(map) {
    return typeof map?.areTilesLoaded === 'function' && map.areTilesLoaded() === false;
}

/**
 * @param {((message: string, type?: string) => void) | null | undefined} onWarning
 */
export function reportTileReadinessTimeout(onWarning) {
    const notify = typeof onWarning === 'function' ? onWarning : showToast;
    notify(TILE_READINESS_TIMEOUT_WARNING, 'warning');
}

/**
 * Scale a capture down so it stays within maxWidth and the pixel-area cap.
 * @param {number} width
 * @param {number} height
 * @param {{ maxPixels?: number, maxWidth?: number|null }} [options]
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function fitExportPixelSize(width, height, options = {}) {
    const maxPixels = options.maxPixels ?? EXPORT_CANVAS_MAX_PIXELS;
    const sourceW = Math.max(1, Math.round(Number(width) || 1));
    const sourceH = Math.max(1, Math.round(Number(height) || 1));
    let w = sourceW;
    let h = sourceH;

    const maxWidth = Number(options.maxWidth);
    if (Number.isFinite(maxWidth) && maxWidth > 0 && w > maxWidth) {
        const cappedW = Math.max(1, Math.floor(maxWidth));
        h = Math.max(1, Math.round((h * cappedW) / w));
        w = cappedW;
    }

    if (maxPixels > 0 && (w * h) > maxPixels) {
        const scale = Math.sqrt(maxPixels / (w * h));
        w = Math.max(1, Math.floor(w * scale));
        h = Math.max(1, Math.floor(h * scale));
        while ((w * h) > maxPixels && h > 1) h -= 1;
        while ((w * h) > maxPixels && w > 1) w -= 1;
    }

    return {
        width: w,
        height: h,
        scaled: w !== sourceW || h !== sourceH
    };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ maxPixels?: number, maxWidth?: number|null }} [options]
 * @returns {{ canvas: HTMLCanvasElement, width: number, height: number, scaled: boolean }}
 */
export function scaleCanvasToExportLimit(canvas, options = {}) {
    const fitted = fitExportPixelSize(canvas?.width, canvas?.height, options);
    if (!fitted.scaled) {
        return { canvas, ...fitted };
    }

    const out = document.createElement('canvas');
    out.width = fitted.width;
    out.height = fitted.height;
    const ctx = out.getContext('2d');
    if (!ctx) {
        throw new Error('Map export failed');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, fitted.width, fitted.height);
    return { canvas: out, ...fitted };
}
