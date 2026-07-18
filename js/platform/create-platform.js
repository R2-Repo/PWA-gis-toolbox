import { createWebPlatform } from './web/web-platform.js';
import {
    createWindowsPlatform,
    createWindowsPlatformWithHandshake
} from './windows/windows-platform.js';

/**
 * Detect desktop Vite mode or an explicit windows runtime flag.
 * @returns {boolean}
 */
export function isWindowsDesktopRuntime() {
    if (typeof window === 'undefined') return false;
    const runtimeFlag = String(import.meta.env?.VITE_GIS_RUNTIME || '').toLowerCase();
    if (runtimeFlag === 'windows' || runtimeFlag === 'desktop') return true;
    return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * True when native Tauri IPC is actually available.
 * @returns {boolean}
 */
export function isTauriShellPresent() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * Create the active platform bundle for this runtime.
 *
 * Uses the Windows provider only inside the live Tauri shell so browser
 * previews of the desktop Vite mode do not call missing IPC.
 *
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {import('./contracts.js').PlatformBundle}
 */
export function createPlatform(opts = {}) {
    if (isTauriShellPresent()) {
        return createWindowsPlatform(opts);
    }
    return createWebPlatform(opts);
}

/** @type {import('./contracts.js').PlatformBundle | null} */
let cachedBundle = null;

/**
 * Lazy singleton used by registry filtering and getWidgetContext().
 * @param {{ showToast?: (message: string, type?: string) => void, refresh?: boolean }} [opts]
 * @returns {import('./contracts.js').PlatformBundle}
 */
export function getPlatformBundle(opts = {}) {
    if (!cachedBundle || opts.refresh) {
        cachedBundle = createPlatform(opts);
    } else if (opts.showToast) {
        cachedBundle.services.notifications.show = opts.showToast;
    }
    return cachedBundle;
}

/**
 * Refresh Windows capabilities from the Rust handshake (no-op on web).
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {Promise<import('./contracts.js').PlatformBundle>}
 */
export async function refreshPlatformBundle(opts = {}) {
    if (!isTauriShellPresent()) {
        return getPlatformBundle({ ...opts, refresh: true });
    }
    cachedBundle = await createWindowsPlatformWithHandshake(opts);
    return cachedBundle;
}
