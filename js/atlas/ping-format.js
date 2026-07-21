/**
 * Format ping timestamps and map display statuses.
 */

/**
 * Canonical IP key for pingResults lookups (trim; empty → '').
 * @param {unknown} ip
 * @returns {string}
 */
export function normalizePingIp(ip) {
    if (ip == null) return '';
    return String(ip).trim();
}

/**
 * @param {Record<string, import('./types.js').PingStatusEntry>|null|undefined} raw
 * @returns {Record<string, import('./types.js').PingStatusEntry>}
 */
export function normalizePingResultsMap(raw) {
    /** @type {Record<string, import('./types.js').PingStatusEntry>} */
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [ip, entry] of Object.entries(raw)) {
        const key = normalizePingIp(ip);
        if (!key || !entry) continue;
        out[key] = entry;
    }
    return out;
}

/**
 * @param {Record<string, import('./types.js').PingStatusEntry>|null|undefined} pingResults
 * @param {unknown} ip
 * @returns {import('./types.js').PingStatusEntry|null}
 */
export function getPingEntry(pingResults, ip) {
    const key = normalizePingIp(ip);
    if (!key || !pingResults) return null;
    return pingResults[key] || null;
}

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

/**
 * Normalize legacy / raw status strings.
 * @param {string|null|undefined} status
 */
export function normalizePingStatus(status) {
    const s = String(status || 'untested');
    if (s === 'warning') return 'stale_reachable';
    return s;
}

/**
 * Classify multi-packet ICMP counts (mirrors Rust thresholds).
 * @param {number} sent
 * @param {number} received
 * @returns {'reachable'|'unreachable'|'intermittent'}
 */
export function classifyPingCounts(sent, received) {
    const s = Math.max(0, Number(sent) || 0);
    const r = Math.max(0, Math.min(s, Number(received) || 0));
    if (s <= 0 || r <= 0) return 'unreachable';
    if (r >= s) return 'reachable';
    if (r / s < 0.75) return 'intermittent';
    return 'reachable';
}

/**
 * Map/UI display status for a drop/device ping entry.
 * @param {{ status?: string, at?: string|number|null }|null|undefined} entry
 * @param {{ hasIp?: boolean }} [opts]
 * @returns {string}
 */
export function displayPingStatus(entry, opts = {}) {
    if (opts.hasIp === false) return 'no_ip';
    let status = normalizePingStatus(entry?.status);
    if (!entry || !status) status = 'untested';
    if (status === 'pending' || status === 'untested' || status === 'intermittent' || status === 'no_ip') {
        return status;
    }
    if (status === 'reachable') {
        return isPingStale(entry?.at) ? 'stale_reachable' : 'reachable';
    }
    if (status === 'unreachable') {
        return isPingStale(entry?.at) ? 'stale_unreachable' : 'unreachable';
    }
    if (status === 'stale_reachable' || status === 'stale_unreachable' || status === 'mixed') {
        return status;
    }
    return 'untested';
}

/** Map halo / hub fill colors (hex). */
export const ATLAS_PING_COLORS = Object.freeze({
    reachable: '#39ff14',
    unreachable: '#ff2d2d',
    stale_reachable: '#4d7c4d',
    stale_unreachable: '#7a3a3a',
    pending: '#ca8a04',
    untested: '#94a3b8',
    intermittent: '#facc15',
    no_ip: '#0a0a0a',
    no_channel: '#0a0a0a',
    mixed: '#a78bfa'
});

/** Halo opacity by status. */
export const ATLAS_PING_OPACITY = Object.freeze({
    reachable: 0.75,
    unreachable: 0.75,
    stale_reachable: 0.35,
    stale_unreachable: 0.35,
    pending: 0.5,
    untested: 0.35,
    intermittent: 0.75,
    no_ip: 0.65,
    no_channel: 0.65,
    mixed: 0.75
});

export const ATLAS_DROP_CORE_COLOR = '#2563eb';
/** Drop core when fiber channel is missing/null. */
export const ATLAS_DROP_NO_CHANNEL_COLOR = '#cbd5e1';
export const ATLAS_DROP_CORE_RADIUS = 5;
export const ATLAS_DROP_CORE_RADIUS_SMALL = 3.5;
export const ATLAS_STATUS_RADIUS = 9;
export const ATLAS_STATUS_RADIUS_SMALL = 7;
export const ATLAS_SELECTED_COLOR = '#ff2bd6';
export const ATLAS_HUB_ISSUE_COLOR = '#ff2d2d';
