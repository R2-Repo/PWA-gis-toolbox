/**
 * Count-only filter estimate — streams the file in a worker and returns how
 * many features would match the current feature filter (no IndexedDB write).
 */
import { detectFormat } from './importer.js';
import { STREAM_FORMATS, sniffJsonIsFeatureCollection, sniffXmlIsKml } from './stream/stream-policy.js';

/**
 * @param {File} file
 * @param {{
 *   featureFilter?: object|null,
 *   fenceBbox?: number[]|null,
 *   format?: string,
 *   onProgress?: (percent: number, step: string) => void
 * }} [options]
 * @returns {{
 *   promise: Promise<{
 *     matchCount: number,
 *     totalCount: number,
 *     featureFiltered: number,
 *     fenceFiltered: number,
 *     supported: boolean,
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
        onProgress
    } = options;

    let worker = null;
    let cancelled = false;
    let settled = false;
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
            try {
                worker?.terminate();
            } catch { /* ignore */ }
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
                    resolve({
                        matchCount: 0,
                        totalCount: 0,
                        featureFiltered: 0,
                        fenceFiltered: 0,
                        supported: false,
                        message: 'Filter estimate is not available for this JSON type.'
                    });
                    return;
                }
                streamFormat = 'geojson';
            }
            if (format === 'xml') {
                const ok = await sniffXmlIsKml(file);
                if (!ok) {
                    settled = true;
                    resolve({
                        matchCount: 0,
                        totalCount: 0,
                        featureFiltered: 0,
                        fenceFiltered: 0,
                        supported: false,
                        message: 'Filter estimate is not available for this XML type.'
                    });
                    return;
                }
                streamFormat = 'kml';
            }

            if (!STREAM_FORMATS.has(streamFormat) && streamFormat !== 'geojson') {
                settled = true;
                resolve({
                    matchCount: 0,
                    totalCount: 0,
                    featureFiltered: 0,
                    fenceFiltered: 0,
                    supported: false,
                    message: 'Filter estimate is not available for this format.'
                });
                return;
            }

            report(1, 'Updating estimate…');
            worker = new Worker(new URL('../workers/stream-import.worker.js', import.meta.url), {
                type: 'module'
            });
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
                    try {
                        worker?.terminate();
                    } catch { /* ignore */ }
                    worker = null;
                    report(100, 'Estimate ready');
                    resolve({
                        matchCount: msg.matchCount || 0,
                        totalCount: msg.totalCount || 0,
                        featureFiltered: msg.featureFiltered || 0,
                        fenceFiltered: msg.fenceFiltered || 0,
                        supported: true
                    });
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
        void failFn?.(Object.assign(new Error('Estimate cancelled'), { cancelled: true }));
    };

    return { promise, cancel };
}

export default { estimateImportFilterMatches };
