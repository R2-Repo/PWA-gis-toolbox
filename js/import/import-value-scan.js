/**
 * Pre-import distinct-value scan — streams the file in a worker and returns
 * capped value lists per field for the filter UI.
 */
import { detectFormat } from './importer.js';
import { IMPORT_VALUE_SCAN_CAP } from './import-feature-filter.js';
import { STREAM_FORMATS, sniffJsonIsFeatureCollection, sniffXmlIsKml } from './stream/stream-policy.js';

/**
 * @param {File} file
 * @param {{
 *   fieldNames?: string[],
 *   format?: string,
 *   onProgress?: (percent: number, step: string) => void,
 *   valueCap?: number
 * }} [options]
 * @returns {{ promise: Promise<{ fields: object[], rowCount: number, supported: boolean, message?: string }>, cancel: () => void }}
 */
export function scanImportFieldValues(file, options = {}) {
    const {
        fieldNames = [],
        format: formatHint = null,
        onProgress,
        valueCap = IMPORT_VALUE_SCAN_CAP
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
                        fields: fieldNames.map((name) => ({
                            name, values: [], truncated: false, uniqueCount: 0
                        })),
                        rowCount: 0,
                        supported: false,
                        message: 'Value lists are not available for this JSON type — enter filter values manually.'
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
                        fields: fieldNames.map((name) => ({
                            name, values: [], truncated: false, uniqueCount: 0
                        })),
                        rowCount: 0,
                        supported: false,
                        message: 'Value lists are not available for this XML type — enter filter values manually.'
                    });
                    return;
                }
                streamFormat = 'kml';
            }

            if (!STREAM_FORMATS.has(streamFormat) && streamFormat !== 'geojson') {
                settled = true;
                resolve({
                    fields: fieldNames.map((name) => ({
                        name, values: [], truncated: false, uniqueCount: 0
                    })),
                    rowCount: 0,
                    supported: false,
                    message: 'Value lists are not available for this format — enter filter values manually.'
                });
                return;
            }

            report(1, 'Reading attribute values…');
            worker = new Worker(new URL('../workers/stream-import.worker.js', import.meta.url), {
                type: 'module'
            });
            const jobId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

            worker.onmessage = (event) => {
                const msg = event.data || {};
                if (msg.id !== jobId) return;

                if (msg.type === 'progress') {
                    const pct = msg.totalBytes
                        ? Math.round((msg.bytesProcessed / msg.totalBytes) * 95)
                        : 5;
                    report(pct, 'Reading attribute values…');
                    return;
                }

                if (msg.type === 'scan-done') {
                    settled = true;
                    try {
                        worker?.terminate();
                    } catch { /* ignore */ }
                    worker = null;
                    report(100, 'Attribute values ready');
                    resolve({
                        fields: msg.fields || [],
                        rowCount: msg.rowCount || 0,
                        supported: true
                    });
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
                    valueCap
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
        void failFn?.(Object.assign(new Error('Scan cancelled'), { cancelled: true }));
    };

    return { promise, cancel };
}

export default { scanImportFieldValues };
