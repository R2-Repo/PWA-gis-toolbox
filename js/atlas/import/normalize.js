/**
 * Field normalization for Atlas imports.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeInventoryName(value) {
    if (value == null) return '';
    return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeIp(value) {
    if (value == null) return '';
    return String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeChannel(value) {
    if (value == null) return '';
    return String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeDropNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    const s = String(value).trim();
    if (!s) return null;
    const m = s.match(/(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeCoord(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
}

/**
 * Get a field from a row with case-insensitive / alias matching.
 * @param {Record<string, unknown>} row
 * @param {string[]} aliases
 * @returns {unknown}
 */
export function pickField(row, aliases) {
    if (!row) return undefined;
    const keys = Object.keys(row);
    const lower = new Map(keys.map((k) => [k.toLowerCase().replace(/[\s_]+/g, ''), k]));
    for (const alias of aliases) {
        const key = lower.get(alias.toLowerCase().replace(/[\s_]+/g, ''));
        if (key != null) return row[key];
    }
    return undefined;
}

/**
 * Detect FiberSwitchLocation sheet role.
 * @param {string} sheetName
 * @param {string[]} fields
 * @returns {'tmd'|'switchfiber'|'unknown'}
 */
export function detectWorkbookSheetRole(sheetName, fields) {
    const name = String(sheetName || '').toLowerCase();
    if (name.includes('tmd') || name.includes('signalsite')) return 'tmd';
    if (name.includes('switchfiber') || name.includes('switch')) return 'switchfiber';
    const lowerFields = fields.map((f) => f.toLowerCase());
    const hasSiteId = lowerFields.some((f) => f.includes('site id') || f === 'siteid');
    const hasIp = lowerFields.some((f) => f.includes('network ip') || f.includes('ip address'));
    if (hasSiteId && !hasIp) return 'tmd';
    if (hasIp) return 'switchfiber';
    return 'unknown';
}

/**
 * @param {string} filename
 * @returns {'fiberswitch'|'atms'|'unknown'}
 */
export function detectSourceFileKind(filename) {
    const n = String(filename || '').toLowerCase();
    if (n.includes('fiberswitch') || n.endsWith('.xlsx') || n.endsWith('.xls')) {
        if (n.includes('atms')) return 'atms';
        return 'fiberswitch';
    }
    if (n.includes('atms') || n.endsWith('.csv')) return 'atms';
    return 'unknown';
}
