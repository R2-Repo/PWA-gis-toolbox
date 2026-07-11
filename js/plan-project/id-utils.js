/**
 * Stable ID generation for plan-production projects.
 */

let sequence = 0;

/**
 * @param {string} [prefix]
 * @returns {string}
 */
export function createStableId(prefix = 'pp') {
    sequence += 1;
    const time = Date.now().toString(36);
    const seq = sequence.toString(36).padStart(4, '0');
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${time}_${seq}_${rand}`;
}

/**
 * Reset in-memory sequence (tests only).
 */
export function resetIdSequence() {
    sequence = 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStableId(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9]*_[a-z0-9_]+$/i.test(value);
}
