/** @typedef {{ basemapBlocked: string[], telemetryBlocked: string[], unexpectedBlocked: string[] }} NetworkGuardState */

const BASEMAP_HOST_RE =
    /(?:^|\.)((?:basemaps\.)?cartocdn\.com|carto\.com|openstreetmap\.org|tile\.openstreetmap\.org|opentopomap\.org|arcgisonline\.com|esri\.com|server\.arcgisonline\.com)$/i;

const TELEMETRY_HOST_RE = /(?:^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)$/i;

const BASEMAP_PATH_RE =
    /\/(?:gl\/|vector\/|rastertiles\/|fonts\/|ArcGIS\/|tile\/)/i;

export function isTelemetryRequest(url) {
    try {
        return TELEMETRY_HOST_RE.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * @param {string} url
 */
export function isBasemapRequest(url) {
    try {
        const u = new URL(url);
        if (BASEMAP_HOST_RE.test(u.hostname)) return true;
        if (/\.(?:png|pbf|mvt|webp)$/i.test(u.pathname) && BASEMAP_PATH_RE.test(u.pathname)) {
            return BASEMAP_HOST_RE.test(u.hostname);
        }
        if (u.pathname.includes('style.json') && BASEMAP_HOST_RE.test(u.hostname)) return true;
    } catch {
        return false;
    }
    return false;
}

/**
 * @param {string} url
 * @param {string} [baseURL]
 */
export function guardBaseURL() {
    return `http://127.0.0.1:${process.env.GIS_TEST_PORT || '5175'}`;
}

export function isAllowedLocalRequest(url, baseURL = guardBaseURL()) {
    try {
        const u = new URL(url, baseURL);
        if (u.protocol === 'blob:' || u.protocol === 'data:') return true;
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
        const host = u.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch {
        return false;
    }
}

/**
 * Attach context-level network guard for Playwright.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ baseURL?: string }} [options]
 * @returns {Promise<NetworkGuardState>}
 */
export async function attachNetworkGuard(context, options = {}) {
    const baseURL = options.baseURL || guardBaseURL();
    /** @type {NetworkGuardState} */
    const state = { basemapBlocked: [], telemetryBlocked: [], unexpectedBlocked: [] };

    await context.route('**/*', (route) => {
        const url = route.request().url();
        if (isAllowedLocalRequest(url, baseURL)) {
            route.continue().catch(() => {});
            return;
        }
        if (isBasemapRequest(url)) {
            state.basemapBlocked.push(url);
            route.abort('blockedbyclient').catch(() => {});
            return;
        }
        if (isTelemetryRequest(url)) {
            state.telemetryBlocked.push(url);
            route.abort('blockedbyclient').catch(() => {});
            return;
        }
        state.unexpectedBlocked.push(url);
        route.abort('blockedbyclient').catch(() => {});
    });

    return state;
}

/**
 * @param {NetworkGuardState} state
 */
export function assertNoUnexpectedBlocks(state) {
    if (state.unexpectedBlocked.length > 0) {
        const sample = state.unexpectedBlocked.slice(0, 8).join('\n  ');
        throw new Error(
            `Unexpected blocked network requests (${state.unexpectedBlocked.length}):\n  ${sample}`
        );
    }
}
