/**
 * Count-only filter estimate — streams the file in a worker and returns how
 * many features would match the current feature filter (no IndexedDB write).
 *
 * Build 10: caches exact counts by file + filter + fence identity.
 */
import { detectFormat } from './importer.js';
import { STREAM_FORMATS, sniffJsonIsFeatureCollection, sniffXmlIsKml } from './stream/stream-policy.js';
import {
    estimateCacheKey,
    getImportScanCache,
    setImportScanCache,
    trackImportScanWorker
} from './import-scan-cache.js';

/**
 * @param {File} file
 * @param {{
 *   featureFilter?: object|null,
 *   fenceBbox?: number[]|null,
 *   format?: string,
 *   onProgress?: (percent: number, step: string) => void,
 *   bypassCache?: boolean
 * }} [options]
 * @returns {{
 *   promise: Promise<{
 *     matchCount: number,
 *     totalCount: number,
 *     featureFiltered: number,
 *     fenceFiltered: number,
 *     supported: boolean,
 *     fromCache?: boolean,
 *     message?: string
 *   }>,
 *   cancel: () => void
 * }}
 */
export function estimateImportFilterMatches(file, options = {}) {
    const {
        featureFilter = null,
        fenceBbox = null,
        format: formatHint = null,
        onProgress,
        bypassCache = false
    } = options;

    const cacheKey = estimateCacheKey(file, { featureFilter, fenceBbox });
    if (!bypassCache) {
        const cached = getImportScanCache(cacheKey);
        if (cached) {
            return {
                promise: Promise.resolve({ ...cached, fromCache: true }),
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
                        matchCount: 0,
                        totalCount: 0,
                        featureFiltered: 0,
                        fenceFiltered: 0,
                        supported: false,
                        message: 'Filter estimate is not available for this JSON type.'
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
                        matchCount: 0,
                        totalCount: 0,
                        featureFiltered: 0,
                        fenceFiltered: 0,
                        supported: false,
                        message: 'Filter estimate is not available for this XML type.'
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
                    matchCount: 0,
                    totalCount: 0,
                    featureFiltered: 0,
                    fenceFiltered: 0,
                    supported: false,
                    message: 'Filter estimate is not available for this format.'
                };
                setImportScanCache(cacheKey, unsupported);
                resolve(unsupported);
                return;
            }

            if (cancelled) {
                reject(Object.assign(new Error('Estimate cancelled'), { cancelled: true }));
                return;
            }

            report(1, 'Updating estimate…');
            worker = new Worker(new URL('../workers/stream-import.worker.js', import.meta.url), {
                type: 'module'
            });
            untrack = trackImportScanWorker(worker);
            const jobId = `est_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.id !== jobId) return;

                if (msg.type === 'progress') {
                    const pct = msg.totalBytes
                        ? Math.round((msg.bytesProcessed / msg.totalBytes) * 95)
                        : 5;
                    report(pct, 'Updating estimate…');
                    return;
                }

                if (msg.type === 'estimate-done') {
                    settled = true;
                    untrack?.();
                    untrack = null;
                    worker = null;
                    report(100, 'Estimate ready');
                    const result = {
                        matchCount: msg.matchCount || 0,
                        totalCount: msg.totalCount || 0,
                        featureFiltered: msg.featureFiltered || 0,
                        fenceFiltered: msg.fenceFiltered || 0,
                        supported: true
                    };
                    if (!cancelled) setImportScanCache(cacheKey, result);
                    resolve(result);
                    return;
                }

                if (msg.type === 'error') {
                    void failFn?.(new Error(msg.message || 'Filter estimate failed'));
                }
            };

            worker.onerror = (event) => {
                void failFn?.(new Error(event.message || 'Filter estimate worker failed'));
            };

            worker.postMessage({
                type: 'estimate-filter',
                id: jobId,
                file,
                format: streamFormat,
                options: {
                    featureFilter,
                    fenceBbox
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
        void failFn?.(Object.assign(new Error('Estimate cancelled'), { cancelled: true }));
    };

    return { promise, cancel };
}

export default { estimateImportFilterMatches };
