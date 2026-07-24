import { createWebPlatform } from './web/web-platform.js';

/**
 * Create the active platform bundle.
 *
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {import('./contracts.js').PlatformBundle}
 */
export function createPlatform(opts = {}) {
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
 * Refresh platform capabilities.
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {Promise<import('./contracts.js').PlatformBundle>}
 */
export async function refreshPlatformBundle(opts = {}) {
    return getPlatformBundle({ ...opts, refresh: true });
}
