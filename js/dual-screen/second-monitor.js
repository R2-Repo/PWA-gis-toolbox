/**
 * Optional full-screen placement of the dual-screen pop-out on a non-primary monitor.
 * Uses the Window Management API (window.getScreenDetails). Never throws.
 */

export const SECOND_MONITOR_NOTICES = {
    unsupported: 'This browser cannot place a window on another monitor. Opening the normal Dual Screen window.',
    denied: 'Second-monitor permission was denied. Opening the normal Dual Screen window.',
    single: 'Only one screen was found. Opening the normal Dual Screen window.'
};

/**
 * @param {'unsupported' | 'denied' | 'single'} reason
 */
function fail(reason) {
    return {
        ok: false,
        reason,
        notice: SECOND_MONITOR_NOTICES[reason] || SECOND_MONITOR_NOTICES.unsupported
    };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {object | null | undefined} screen
 * @returns {{ availLeft: number, availTop: number, availWidth: number, availHeight: number } | null}
 */
export function readScreenBounds(screen) {
    if (!screen || typeof screen !== 'object') return null;
    const availLeft = finiteNumber(screen.availLeft ?? screen.left);
    const availTop = finiteNumber(screen.availTop ?? screen.top);
    const availWidth = finiteNumber(screen.availWidth ?? screen.width);
    const availHeight = finiteNumber(screen.availHeight ?? screen.height);
    if (availLeft == null || availTop == null || availWidth == null || availHeight == null) return null;
    if (availWidth < 1 || availHeight < 1) return null;
    return { availLeft, availTop, availWidth, availHeight };
}

/**
 * Prefer a screen explicitly marked non-primary. One screen, or no identifiable
 * second screen, returns null so the caller opens the normal pop-out.
 * @param {object | null | undefined} details
 * @returns {object | null}
 */
export function pickNonPrimaryScreen(details) {
    const screens = Array.isArray(details?.screens) ? details.screens.filter(Boolean) : [];
    if (screens.length < 2) return null;
    const explicit = screens.find((screen) => screen.isPrimary === false);
    if (explicit) return explicit;
    const current = details?.currentScreen;
    if (current) {
        const other = screens.find((screen) => screen !== current && screen.isPrimary !== true);
        if (other) return other;
    }
    return null;
}

/**
 * @param {{ getScreenDetails?: unknown } | null | undefined} [host]
 *   Window-like object. Omit to use the real window. `{}` is the unsupported case.
 * @returns {Promise<
 *   | { ok: true, screen: { availLeft: number, availTop: number, availWidth: number, availHeight: number } }
 *   | { ok: false, reason: 'unsupported' | 'denied' | 'single', notice: string }
 * >}
 */
export async function resolveSecondMonitorPlacement(host) {
    /** @type {unknown} */
    let getScreenDetails;
    /** @type {object | null} */
    let target = null;
    try {
        const resolved = host === undefined ? globalThis : host;
        if (!resolved || (typeof resolved !== 'object' && typeof resolved !== 'function')) {
            return fail('unsupported');
        }
        target = /** @type {object} */ (resolved);
        getScreenDetails = target.getScreenDetails;
    } catch {
        return fail('unsupported');
    }
    if (typeof getScreenDetails !== 'function') return fail('unsupported');

    let details;
    try {
        details = await getScreenDetails.call(target);
    } catch {
        return fail('denied');
    }

    try {
        const screen = pickNonPrimaryScreen(details);
        if (!screen) return fail('single');
        const bounds = readScreenBounds(screen);
        if (!bounds) return fail('unsupported');
        return { ok: true, screen: bounds };
    } catch {
        return fail('unsupported');
    }
}
