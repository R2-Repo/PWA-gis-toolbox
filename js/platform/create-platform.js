import { createWebPlatform } from './web/web-platform.js';

/**
 * Detect whether we are running inside a Tauri Windows shell.
 * Safe in browsers: returns false when Tauri globals are absent.
 * @returns {boolean}
 */
export function isWindowsDesktopRuntime() {
    if (typeof window === 'undefined') return false;
    const runtimeFlag = String(import.meta.env?.VITE_GIS_RUNTIME || '').toLowerCase();
    if (runtimeFlag === 'windows' || runtimeFlag === 'desktop') return true;
    return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * Create the active platform bundle for this runtime.
 * Today only the web provider is implemented; Windows provider lands with Tauri.
 *
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {import('./contracts.js').PlatformBundle}
 */
export function createPlatform(opts = {}) {
    // Windows provider is intentionally not imported here yet.
    // When added, branch on isWindowsDesktopRuntime() and load js/platform/windows/.
    if (isWindowsDesktopRuntime()) {
        // Soft fallback until js/platform/windows/ exists — keeps the UI bootable.
        const web = createWebPlatform(opts);
        return {
            ...web,
            platform: {
                ...web.platform,
                runtime: 'windows',
                os: 'windows',
                capabilities: {
                    ...web.platform.capabilities,
                    // nativeFiles will flip true once the Tauri bridge is wired.
                    nativeFiles: {
                        available: false,
                        reason: 'Windows platform bridge not initialized yet'
                    }
                }
            }
        };
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
