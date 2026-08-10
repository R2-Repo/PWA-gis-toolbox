/**
 * Pre-import distinct-value scan — streams the file in a worker and returns
 * capped value lists per field for the filter UI.
 *
 * Build 10: samples at most VALUE_SCAN_MAX_FEATURES / VALUE_SCAN_MAX_BYTES and
 * caches results by file identity + options.
 */
import { detectFormat } from './importer.js';
import { IMPORT_VALUE_SCAN_CAP } from './import-feature-filter.js';
import { STREAM_FORMATS, sniffJsonIsFeatureCollection, sniffXmlIsKml } from './stream/stream-policy.js';
import {
    VALUE_SCAN_MAX_FEATURES,
    VALUE_SCAN_MAX_BYTES,
    valueScanCacheKey,
    getImportScanCache,
    setImportScanCache,
    trackImportScanWorker
} from './import-scan-cache.js';

/**
 * @param {File} file
 * @param {{
 *   fieldNames?: string[],
 *   format?: string,
 *   onProgress?: (percent: number, step: string) => void,
 *   valueCap?: number,
 *   sampleMaxFeatures?: number,
 *   sampleMaxBytes?: number,
 *   bypassCache?: boolean
 * }} [options]
 * @returns {{
 *   promise: Promise<{
 *     fields: object[],
 *     rowCount: number,
 *     supported: boolean,
 *     sampled?: boolean,
 *     message?: string
 *   }>,
 *   cancel: () => void
 * }}
 */
export function scanImportFieldValues(file, options = {}) {
    const {
        fieldNames = [],
        format: formatHint = null,
        onProgress,
        valueCap = IMPORT_VALUE_SCAN_CAP,
        sampleMaxFeatures = VALUE_SCAN_MAX_FEATURES,
        sampleMaxBytes = VALUE_SCAN_MAX_BYTES,
        bypassCache = false
    } = options;

    const cacheKey = valueScanCacheKey(file, {
        fieldNames,
        valueCap,
        sampleMaxFeatures,
        sampleMaxBytes
    });

    if (!bypassCache) {
        const cached = getImportScanCache(cacheKey);
        if (cached) {
            return {
                promise: Promise.resolve(cached),
                cancel: () => {}
            };
        }
    }

    let worker = null;
    let cancelled = false;
    let settled = false;
    /** @type {(() => void)|null} */
    let untrack = null;
    /** @type {((e: Error) => void)|null} */
    let failFn = null;

    const report = (percent, step) => {
        try {
            onProgress?.(Math.max(0, Math.min(100, percent)), step);
        } catch { /* ignore */ }
    };

    const promise = new Promise((resolve, reject) => {
        failFn = (err) => {
            if (settled) return;
            settled = true;
            untrack?.();
            untrack = null;
            worker = null;
            reject(err);
        };

        void (async () => {
            const format = formatHint || detectFormat(file);
            let streamFormat = format;
            if (format === 'json') {
                const ok = await sniffJsonIsFeatureCollection(file);
                if (!ok) {
                    settled = true;
                    const unsupported = {
                        fields: fieldNames.map((name) => ({
                            name, values: [], truncated: false, uniqueCount: 0
                        })),
                        rowCount: 0,
                        supported: false,
                        sampled: false,
                        message: 'Value lists are not available for this JSON type — enter filter values manually.'
                    };
                    setImportScanCache(cacheKey, unsupported);
                    resolve(unsupported);
                    return;
                }
                streamFormat = 'geojson';
            }
            if (format === 'xml') {
                const ok = await sniffXmlIsKml(file);
                if (!ok) {
                    settled = true;
                    const unsupported = {
                        fields: fieldNames.map((name) => ({
                            name, values: [], truncated: false, uniqueCount: 0
                        })),
                        rowCount: 0,
                        supported: false,
                        sampled: false,
                        message: 'Value lists are not available for this XML type — enter filter values manually.'
                    };
                    setImportScanCache(cacheKey, unsupported);
                    resolve(unsupported);
                    return;
                }
                streamFormat = 'kml';
            }

            if (!STREAM_FORMATS.has(streamFormat) && streamFormat !== 'geojson') {
                settled = true;
                const unsupported = {
                    fields: fieldNames.map((name) => ({
                        name, values: [], truncated: false, uniqueCount: 0
                    })),
                    rowCount: 0,
                    supported: false,
                    sampled: false,
                    message: 'Value lists are not available for this format — enter filter values manually.'
                };
                setImportScanCache(cacheKey, unsupported);
                resolve(unsupported);
                return;
            }

            if (cancelled) {
                reject(Object.assign(new Error('Scan cancelled'), { cancelled: true }));
                return;
            }

            report(1, 'Reading attribute values…');
            worker = new Worker(new URL('../workers/stream-import.worker.js', import.meta.url), {
                type: 'module'
            });
            untrack = trackImportScanWorker(worker);
            const jobId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.id !== jobId) return;

                if (msg.type === 'progress') {
                    const pct = msg.totalBytes
                        ? Math.round((msg.bytesProcessed / msg.totalBytes) * 95)
                        : 5;
                    report(pct, msg.sampled ? 'Sampling attribute values…' : 'Reading attribute values…');
                    return;
                }

                if (msg.type === 'scan-done') {
                    settled = true;
                    untrack?.();
                    untrack = null;
                    worker = null;
                    report(100, 'Attribute values ready');
                    const result = {
                        fields: msg.fields || [],
                        rowCount: msg.rowCount || 0,
                        supported: true,
                        sampled: msg.sampled === true,
                        message: msg.sampled
                            ? `Sampled the first ${(msg.rowCount || 0).toLocaleString()} features for filter suggestions.`
                            : undefined
                    };
                    if (!cancelled) setImportScanCache(cacheKey, result);
                    resolve(result);
                    return;
                }

                if (msg.type === 'error') {
                    void failFn?.(new Error(msg.message || 'Attribute value scan failed'));
                }
            };

            worker.onerror = (event) => {
                void failFn?.(new Error(event.message || 'Attribute value scan worker failed'));
            };

            worker.postMessage({
                type: 'scan-values',
                id: jobId,
                file,
                format: streamFormat,
                options: {
                    fieldNames,
                    valueCap,
                    sampleMaxFeatures,
                    sampleMaxBytes
                }
            });
        })().catch((e) => void failFn?.(e));
    });

    const cancel = () => {
        if (settled || cancelled) return;
        cancelled = true;
        try {
            worker?.postMessage({ type: 'cancel' });
        } catch { /* ignore */ }
        untrack?.();
        untrack = null;
        worker = null;
        void failFn?.(Object.assign(new Error('Scan cancelled'), { cancelled: true }));
    };

    return { promise, cancel };
}

export default { scanImportFieldValues };
