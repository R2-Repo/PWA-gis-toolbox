/**
 * Import scan performance limits and cache (Build 10).
 *
 * Level 1 — sniff (existing head sample)
 * Level 2 — sampled value scan (bounded features / bytes)
 * Level 3 — exact admission count (full pass, cached)
 */

/** Distinct values kept per field in the filter UI scan. */
export const VALUE_SCAN_VALUE_CAP = 2000;

/** Stop value sampling after this many features/rows. */
export const VALUE_SCAN_MAX_FEATURES = 10_000;

/** Stop value sampling after this many decoded/read bytes. */
export const VALUE_SCAN_MAX_BYTES = 16 * 1024 * 1024;

const DEFAULT_CACHE_LIMIT = 32;

/** @type {Map<string, { value: unknown, at: number }>} */
const _cache = new Map();
/** @type {Set<Worker>} */
const _activeWorkers = new Set();

/**
 * @param {File|null|undefined} file
 * @returns {string}
 */
export function fileIdentityKey(file) {
    if (!file) return 'nofile';
    return `${file.name}|${file.size}|${file.lastModified || 0}`;
}

/**
 * @param {File} file
 * @param {{
 *   fieldNames?: string[],
 *   valueCap?: number,
 *   sampleMaxFeatures?: number,
 *   sampleMaxBytes?: number
 * }} [options]
 */
export function valueScanCacheKey(file, options = {}) {
    const fields = Array.isArray(options.fieldNames) ? [...options.fieldNames].sort().join('\0') : '';
    const valueCap = options.valueCap ?? VALUE_SCAN_VALUE_CAP;
    const sampleMaxFeatures = options.sampleMaxFeatures ?? VALUE_SCAN_MAX_FEATURES;
    const sampleMaxBytes = options.sampleMaxBytes ?? VALUE_SCAN_MAX_BYTES;
    return `values|${fileIdentityKey(file)}|${fields}|${valueCap}|${sampleMaxFeatures}|${sampleMaxBytes}`;
}

/**
 * @param {File} file
 * @param {{ featureFilter?: object|null, fenceBbox?: number[]|null }} [options]
 */
export function estimateCacheKey(file, options = {}) {
    let filterKey = 'null';
    let fenceKey = 'null';
    try {
        filterKey = JSON.stringify(options.featureFilter ?? null);
    } catch {
        filterKey = String(Date.now());
    }
    try {
        fenceKey = JSON.stringify(options.fenceBbox ?? null);
    } catch {
        fenceKey = 'badfence';
    }
    return `estimate|${fileIdentityKey(file)}|${filterKey}|${fenceKey}`;
}

/**
 * @param {string} key
 * @returns {unknown|undefined}
 */
export function getImportScanCache(key) {
    const hit = _cache.get(key);
    if (!hit) return undefined;
    // LRU touch
    _cache.delete(key);
    _cache.set(key, hit);
    return hit.value;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} [limit]
 */
export function setImportScanCache(key, value, limit = DEFAULT_CACHE_LIMIT) {
    if (_cache.has(key)) _cache.delete(key);
    _cache.set(key, { value, at: Date.now() });
    while (_cache.size > limit) {
        const oldest = _cache.keys().next().value;
        _cache.delete(oldest);
    }
}

export function clearImportScanCache() {
    _cache.clear();
}

/** @returns {number} */
export function importScanCacheSize() {
    return _cache.size;
}

/**
 * Track a scan/estimate worker so dialog close / cancel can terminate orphans.
 * @param {Worker} worker
 * @returns {() => void} untrack + terminate
 */
export function trackImportScanWorker(worker) {
    if (!worker) return () => {};
    _activeWorkers.add(worker);
    return () => {
        _activeWorkers.delete(worker);
        try {
            worker.terminate();
        } catch { /* ignore */ }
    };
}

export function terminateAllImportScanWorkers() {
    for (const worker of [..._activeWorkers]) {
        try {
            worker.terminate();
        } catch { /* ignore */ }
    }
    _activeWorkers.clear();
}

/** @returns {number} */
export function activeImportScanWorkerCount() {
    return _activeWorkers.size;
}

export default {
    VALUE_SCAN_VALUE_CAP,
    VALUE_SCAN_MAX_FEATURES,
    VALUE_SCAN_MAX_BYTES,
    fileIdentityKey,
    valueScanCacheKey,
    estimateCacheKey,
    getImportScanCache,
    setImportScanCache,
    clearImportScanCache,
    importScanCacheSize,
    trackImportScanWorker,
    terminateAllImportScanWorkers,
    activeImportScanWorkerCount
};
