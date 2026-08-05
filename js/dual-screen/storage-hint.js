/**
 * Dual Screen Mode — sessionStorage UX hint only (not session / layer data).
 */

export const DUAL_SCREEN_HINT_KEY = 'dualScreenActive';
export const DUAL_SCREEN_HINT_VALUE = '1';

export const POPUP_BLOCKED_MESSAGE =
    'Could not open the Dual Screen map window. Allow pop-ups for this site, then click Dual Screen again.';

export const RELOAD_REMINDER_MESSAGE =
    'Dual Screen was on before this reload. Click Dual Screen to open the map window again (not opened automatically).';

/**
 * @param {Storage | null | undefined} storage
 * @param {boolean} active
 */
export function setDualScreenActiveHint(storage, active) {
    if (!storage) return;
    try {
        if (active) storage.setItem(DUAL_SCREEN_HINT_KEY, DUAL_SCREEN_HINT_VALUE);
        else storage.removeItem(DUAL_SCREEN_HINT_KEY);
    } catch (_) {
        /* quota / private mode */
    }
}

/**
 * @param {Storage | null | undefined} storage
 * @returns {boolean}
 */
export function hasDualScreenActiveHint(storage) {
    if (!storage) return false;
    try {
        return storage.getItem(DUAL_SCREEN_HINT_KEY) === DUAL_SCREEN_HINT_VALUE;
    } catch (_) {
        return false;
    }
}

/**
 * One-shot reload reminder per page load (in-memory guard).
 * @param {Storage | null | undefined} storage
 * @param {{ consumed?: boolean }} [state]
 * @returns {boolean}
 */
export function consumeDualScreenReloadReminder(storage, state = {}) {
    if (state.consumed) return false;
    if (!hasDualScreenActiveHint(storage)) return false;
    state.consumed = true;
    return true;
}
