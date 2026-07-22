/**
 * Pick newest FiberSwitchLocation workbook, ATMS CSV, Hub List, and Connected Buildings CSV from an inbox file list.
 */

/**
 * @param {string} name
 * @returns {string|null} YYYY-MM-DD from filename
 */
export function extractDateFromFilename(name) {
    const m = String(name || '').match(/(20\d{2})[-_](\d{2})[-_](\d{2})/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * @param {{ name?: string }} file
 * @returns {boolean}
 */
export function isHubListFilename(file) {
    const n = String(file?.name || '').toLowerCase();
    if (!n) return false;
    if (isConnectedBuildingsFilename(file)) return false;
    const hasHub = n.includes('hub');
    const hasList = n.includes('list') || n.includes('hubs');
    return hasHub && hasList;
}

/**
 * Optional Connected Buildings CSV.
 * @param {{ name?: string }} file
 * @returns {boolean}
 */
export function isConnectedBuildingsFilename(file) {
    const n = String(file?.name || '').toLowerCase();
    if (!n) return false;
    const hasConnected = n.includes('connected');
    const hasBuilding = n.includes('building') || n.includes('buildings');
    return hasConnected && hasBuilding;
}

/**
 * @param {Array<{ name: string, path: string, ext: string, modifiedMs?: number, size?: number }>} files
 */
export function pickNewestWorkbook(files) {
    const candidates = (files || []).filter((f) => {
        const n = f.name.toLowerCase();
        const ext = (f.ext || '').toLowerCase();
        if (ext !== 'xlsx' && ext !== 'xls') return false;
        return n.includes('fiberswitch') || n.includes('fiber_switch') || n.includes('switchlocation');
    });
    if (!candidates.length) {
        // fallback: any xlsx/xls
        return sortNewest((files || []).filter((f) => {
            const ext = (f.ext || '').toLowerCase();
            return ext === 'xlsx' || ext === 'xls';
        }))[0] || null;
    }
    return sortNewest(candidates)[0] || null;
}

/**
 * @param {Array<{ name: string, path: string, ext: string, modifiedMs?: number }>} files
 */
export function pickNewestAtmsCsv(files) {
    const candidates = (files || []).filter((f) => {
        if (isHubListFilename(f) || isConnectedBuildingsFilename(f)) return false;
        const n = f.name.toLowerCase();
        const ext = (f.ext || '').toLowerCase();
        if (ext !== 'csv' && ext !== 'txt') return false;
        return n.includes('atms') || n.includes('master') || n.includes('device');
    });
    if (!candidates.length) {
        return sortNewest((files || []).filter((f) => {
            if (isHubListFilename(f) || isConnectedBuildingsFilename(f)) return false;
            return (f.ext || '').toLowerCase() === 'csv';
        }))[0] || null;
    }
    return sortNewest(candidates)[0] || null;
}

/**
 * Official Hub List CSV (optional).
 * @param {Array<{ name: string, path: string, ext: string, modifiedMs?: number }>} files
 */
export function pickNewestHubList(files) {
    const candidates = (files || []).filter((f) => {
        const ext = (f.ext || '').toLowerCase();
        if (ext !== 'csv' && ext !== 'txt') return false;
        return isHubListFilename(f);
    });
    return sortNewest(candidates)[0] || null;
}

/**
 * Optional Connected Buildings CSV.
 * @param {Array<{ name: string, path: string, ext: string, modifiedMs?: number }>} files
 */
export function pickNewestConnectedBuildings(files) {
    const candidates = (files || []).filter((f) => {
        const ext = (f.ext || '').toLowerCase();
        if (ext !== 'csv' && ext !== 'txt') return false;
        return isConnectedBuildingsFilename(f);
    });
    return sortNewest(candidates)[0] || null;
}

/**
 * @param {Array<{ name: string, modifiedMs?: number }>} files
 */
function sortNewest(files) {
    return [...files].sort((a, b) => {
        const da = extractDateFromFilename(a.name);
        const db = extractDateFromFilename(b.name);
        if (da && db && da !== db) return db.localeCompare(da);
        if (da && !db) return -1;
        if (!da && db) return 1;
        return (b.modifiedMs || 0) - (a.modifiedMs || 0);
    });
}

/**
 * @param {Array<object>} files
 * @returns {{ workbook: object|null, atms: object|null, hubList: object|null, connectedBuildings: object|null }}
 */
export function detectInboxSources(files) {
    return {
        workbook: pickNewestWorkbook(files),
        atms: pickNewestAtmsCsv(files),
        hubList: pickNewestHubList(files),
        connectedBuildings: pickNewestConnectedBuildings(files)
    };
}

/**
 * @deprecated Prefer detectInboxSources — kept for callers that only need workbook+ATMS.
 * @param {Array<object>} files
 */
export function detectInboxPair(files) {
    const src = detectInboxSources(files);
    return { workbook: src.workbook, atms: src.atms };
}
