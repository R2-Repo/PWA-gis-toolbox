/**
 * Plan Set Callouts wizard footer rules (pure).
 */

/**
 * Last-step Done must stay clickable. Do not also require `step < stepCount`.
 * @param {{ busy?: boolean, canAdvance?: boolean }} [input]
 * @returns {boolean}
 */
export function isCalloutPrimaryActionDisabled(input = {}) {
    return Boolean(input.busy || !input.canAdvance);
}

/**
 * @param {number} step
 * @param {{ projectName?: string, hasSheetSession?: boolean, hasLeaders?: boolean }} [input]
 * @returns {boolean}
 */
export function canAdvanceCalloutStep(step, input = {}) {
    if (step === 1) return Boolean(String(input.projectName || '').trim() && input.hasSheetSession);
    if (step === 2) return Boolean(input.hasLeaders);
    return true;
}
