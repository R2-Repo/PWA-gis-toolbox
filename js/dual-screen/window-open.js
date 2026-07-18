/**
 * Dual Screen — open the secondary map window via the platform WindowService.
 *
 * Web/PWA: browser window.open (unchanged behavior).
 * Windows desktop: Tauri WebviewWindow (js/platform/windows/).
 */

import { getPlatformBundle } from '../platform/create-platform.js';

export const MAP_WINDOW_NAME = 'gis-toolbox-map';
export const MAP_WINDOW_PATH = 'map-window.html';
/** Tauri webview label for the secondary map window. */
export const MAP_WEBVIEW_LABEL = 'map';

/**
 * @param {Pick<Screen, 'availWidth' | 'availHeight' | 'availLeft' | 'availTop'>} [screenLike]
 * @returns {{ width: number, height: number, x: number, y: number }}
 */
export function buildMapWindowBounds(screenLike = globalThis.screen) {
    const availWidth = screenLike?.availWidth ?? 1280;
    const availHeight = screenLike?.availHeight ?? 800;
    const availLeft = screenLike?.availLeft ?? 0;
    const availTop = screenLike?.availTop ?? 0;
    const width = Math.min(1600, Math.max(800, availWidth - 48));
    const height = Math.min(960, Math.max(600, availHeight - 48));
    const x = Math.max(0, Math.round(availLeft + (availWidth - width) / 2));
    const y = Math.max(0, Math.round(availTop + (availHeight - height) / 2));
    return { width, height, x, y };
}

/**
 * Build window.open features for a dedicated map window (not a browser tab).
 * @param {Pick<Screen, 'availWidth' | 'availHeight' | 'availLeft' | 'availTop'>} [screenLike]
 * @returns {string}
 */
export function buildMapWindowFeatures(screenLike = globalThis.screen) {
    const { width, height, x, y } = buildMapWindowBounds(screenLike);
    return [
        `width=${width}`,
        `height=${height}`,
        `left=${x}`,
        `top=${y}`,
        'menubar=no',
        'toolbar=no',
        'location=no',
        'status=no',
        'resizable=yes',
        'scrollbars=no'
    ].join(',');
}

/**
 * @param {import('../platform/contracts.js').MapWindowHandle | null | undefined} handle
 * @returns {boolean}
 */
export function isSecondaryMapWindowOpen(handle) {
    return !!(handle && !handle.closed);
}

/**
 * Open (or reuse) the secondary map window for the active platform.
 * @returns {Promise<import('../platform/contracts.js').MapWindowHandle | null>}
 */
export async function openSecondaryMapWindow() {
    const bounds = buildMapWindowBounds();
    const features = buildMapWindowFeatures();
    const windows = getPlatformBundle().services.windows;
    if (!windows?.openMapWindow) return null;

    try {
        return await windows.openMapWindow({
            url: MAP_WINDOW_PATH,
            name: MAP_WINDOW_NAME,
            label: MAP_WEBVIEW_LABEL,
            title: 'GIS Toolbox — Map',
            features,
            bounds
        });
    } catch (err) {
        console.warn('[DualScreen] openMapWindow failed', err);
        return null;
    }
}
