/**
 * Format ping timestamps (ISO or unix seconds from Rust).
 */

/**
 * @param {string|number|null|undefined} at
 * @returns {Date|null}
 */
export function parsePingAt(at) {
    if (at == null || at === '') return null;
    const s = String(at);
    if (/^\d+$/.test(s)) {
        const n = Number(s);
        const d = new Date(n < 1e12 ? n * 1000 : n);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {string|number|null|undefined} at
 */
export function formatPingWhen(at) {
    const d = parsePingAt(at);
    if (!d) return at ? String(at) : 'never';
    return d.toLocaleString();
}

/**
 * @param {string|number|null|undefined} at
 */
export function formatPingAge(at) {
    const d = parsePingAt(at);
    if (!d) return 'no ping yet';
    const ms = Date.now() - d.getTime();
    if (ms < 0) return 'just now';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/**
 * @param {string|number|null|undefined} at
 * @param {number} [staleHours=24]
 */
export function isPingStale(at, staleHours = 24) {
    const d = parsePingAt(at);
    if (!d) return true;
    return Date.now() - d.getTime() > staleHours * 3600 * 1000;
}
