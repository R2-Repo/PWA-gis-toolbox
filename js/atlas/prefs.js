/**
 * Operator preference helpers (SQLite atlas_pref via DatabaseService).
 */

export const PREF_MONITOR_INTERVAL = 'monitor.interval';
export const PREF_DASHBOARD_SCOPE = 'dashboard.scope';
export const PREF_TRIAGE_MODE = 'triage.mode';
export const PREF_SESSIONS_RETENTION_DAYS = 'sessions.retentionDays';
export const PREF_MAP_PING_FILTER = 'map.pingFilter';
export const PREF_PING_COUNT = 'ping.count';

const INTERVAL_VALUES = new Set(['continuous', '1', '2', '5', '30', '60']);
const SCOPE_VALUES = new Set(['network', 'selection']);
const TRIAGE_VALUES = new Set(['unreachable', 'stale', 'untested', 'attention']);
const RETENTION_VALUES = new Set(['0', '7', '30', '90']);
const MAP_PING_FILTER_VALUES = new Set([
    'all',
    'attention',
    'unreachable',
    'warning',
    'untested',
    'intermittent',
    'no_ip'
]);
const PING_COUNT_VALUES = new Set(['1', '2', '4', '8']);

/**
 * @returns {{
 *   monitorInterval: number|string,
 *   dashScope: 'network'|'selection',
 *   triageMode: string,
 *   sessionsRetentionDays: number,
 *   mapPingFilter: string,
 *   pingCount: number
 * }}
 */
export function defaultAtlasPrefs() {
    return {
        monitorInterval: 1,
        dashScope: 'network',
        triageMode: 'unreachable',
        sessionsRetentionDays: 30,
        mapPingFilter: 'all',
        pingCount: 4
    };
}

/**
 * @param {Record<string, string|null|undefined>|null|undefined} raw
 */
export function normalizeAtlasPrefs(raw) {
    const prefs = defaultAtlasPrefs();
    if (!raw || typeof raw !== 'object') return prefs;

    const intervalRaw = raw[PREF_MONITOR_INTERVAL] ?? raw.monitorInterval;
    if (intervalRaw != null && intervalRaw !== '') {
        const s = String(intervalRaw);
        if (INTERVAL_VALUES.has(s)) {
            prefs.monitorInterval = s === 'continuous' ? 'continuous' : Number(s);
        }
    }

    const scopeRaw = raw[PREF_DASHBOARD_SCOPE] ?? raw.dashScope;
    if (scopeRaw != null && SCOPE_VALUES.has(String(scopeRaw))) {
        prefs.dashScope = /** @type {'network'|'selection'} */ (String(scopeRaw));
    }

    const triageRaw = raw[PREF_TRIAGE_MODE] ?? raw.triageMode;
    if (triageRaw != null && TRIAGE_VALUES.has(String(triageRaw))) {
        prefs.triageMode = String(triageRaw);
    }

    const retentionRaw = raw[PREF_SESSIONS_RETENTION_DAYS] ?? raw.sessionsRetentionDays;
    if (retentionRaw != null && retentionRaw !== '') {
        const s = String(retentionRaw);
        if (RETENTION_VALUES.has(s)) {
            prefs.sessionsRetentionDays = Number(s);
        }
    }

    const mapFilterRaw = raw[PREF_MAP_PING_FILTER] ?? raw.mapPingFilter;
    if (mapFilterRaw != null && MAP_PING_FILTER_VALUES.has(String(mapFilterRaw))) {
        prefs.mapPingFilter = String(mapFilterRaw);
    }

    const pingCountRaw = raw[PREF_PING_COUNT] ?? raw.pingCount;
    if (pingCountRaw != null && pingCountRaw !== '') {
        const s = String(pingCountRaw);
        if (PING_COUNT_VALUES.has(s)) {
            prefs.pingCount = Number(s);
        }
    }

    return prefs;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {string|null} serialized value or null to clear
 */
export function serializePrefValue(key, value) {
    if (value == null || value === '') return null;
    if (key === PREF_MONITOR_INTERVAL) {
        const s = String(value);
        return INTERVAL_VALUES.has(s) ? s : null;
    }
    if (key === PREF_DASHBOARD_SCOPE) {
        const s = String(value);
        return SCOPE_VALUES.has(s) ? s : null;
    }
    if (key === PREF_TRIAGE_MODE) {
        const s = String(value);
        return TRIAGE_VALUES.has(s) ? s : null;
    }
    if (key === PREF_SESSIONS_RETENTION_DAYS) {
        const s = String(value);
        return RETENTION_VALUES.has(s) ? s : null;
    }
    if (key === PREF_MAP_PING_FILTER) {
        const s = String(value);
        return MAP_PING_FILTER_VALUES.has(s) ? s : null;
    }
    if (key === PREF_PING_COUNT) {
        const s = String(value);
        return PING_COUNT_VALUES.has(s) ? s : null;
    }
    return null;
}
