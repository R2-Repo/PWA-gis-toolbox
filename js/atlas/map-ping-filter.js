/**
 * Map ping-status visibility filter (Atlas map layers).
 */

/** @type {readonly string[]} */
export const MAP_PING_FILTER_VALUES = Object.freeze([
    'all',
    'attention',
    'unreachable',
    'warning',
    'untested'
]);

/**
 * Display statuses included by a filter mode.
 * @param {string|null|undefined} filter
 * @returns {string[]|null} null means all statuses
 */
export function statusesForMapPingFilter(filter) {
    const mode = String(filter || 'all');
    if (mode === 'all') return null;
    if (mode === 'unreachable') return ['unreachable'];
    if (mode === 'warning') return ['warning'];
    if (mode === 'untested') return ['untested', 'pending'];
    if (mode === 'attention') return ['unreachable', 'warning', 'untested', 'pending'];
    return null;
}

/**
 * @param {string|null|undefined} pingStatus
 * @param {string|null|undefined} filter
 * @param {{ selected?: boolean }} [opts]
 */
export function matchesMapPingFilter(pingStatus, filter, opts = {}) {
    if (opts.selected) return true;
    const statuses = statusesForMapPingFilter(filter);
    if (!statuses) return true;
    const status = pingStatus || 'untested';
    return statuses.includes(status);
}

/**
 * MapLibre filter for hub/drop layers. Selected features always pass.
 * @param {'hub'|'drop'} atlasKind
 * @param {string|null|undefined} filter
 * @returns {any[]}
 */
export function atlasMapKindFilterExpression(atlasKind, filter) {
    const kindEq = ['==', ['get', 'atlasKind'], atlasKind];
    const statuses = statusesForMapPingFilter(filter);
    if (!statuses) return kindEq;
    return [
        'all',
        kindEq,
        [
            'any',
            ['==', ['get', 'selected'], 1],
            ['in', ['get', 'pingStatus'], ['literal', statuses]]
        ]
    ];
}

/**
 * Short label for UI select options.
 * @param {string} filter
 */
export function mapPingFilterLabel(filter) {
    switch (String(filter || 'all')) {
        case 'attention':
            return 'Needs attention';
        case 'unreachable':
            return 'Unreachable';
        case 'warning':
            return 'Stale / warning';
        case 'untested':
            return 'Untested';
        default:
            return 'All pings';
    }
}
