/**
 * Web Worker — streaming parse for high-capacity imports (large GeoJSON / CSV).
 *
 * The File handle is cloned into the worker; bytes are read incrementally and
 * features are posted back in small batches. After each batch the worker waits
 * for an "ack" from the main thread (backpressure), so memory stays flat on
 * both sides no matter how large the file is.
 */
import Papa from 'papaparse';
import { GeoJSONFeatureStreamParser } from '../import/stream/geojson-stream-parser.js';
import {
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES,
    STREAM_MAX_FEATURES
} from '../import/stream/stream-constants.js';
import { createSchemaAccumulator, flattenFeatureGeometryCollections } from '../core/data-model.js';
import { detectAnyCoordinateColumns, parseCoordValue } from '../import/coord-detect.js';

const PROGRESS_INTERVAL_MS = 200;

let cancelled = false;
let ackResolve = null;
let activeCsvParser = null;

self.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === 'start') {
        void runImport(msg);
    } else if (msg.type === 'ack') {
        const resolve = ackResolve;
        ackResolve = null;
        resolve?.();
    } else if (msg.type === 'cancel') {
        cancelled = true;
        try {
            activeCsvParser?.abort();
        } catch { /* ignore */ }
        const resolve = ackResolve;
        ackResolve = null;
        resolve?.();
    }
};

function _cancelError() {
    const err = new Error('Import cancelled');
    err.cancelled = true;
    return err;
}

function _waitForAck() {
    return new Promise((resolve) => {
        ackResolve = resolve;
    });
}

function _bboxIntersectsFence(geometry, fence) {
    if (!geometry?.coordinates) return true;
    const [west, south, east, north] = fence;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const stack = [geometry.coordinates];
    while (stack.length) {
        const coords = stack.pop();
        if (typeof coords[0] === 'number') {
            const x = coords[0];
            const y = coords[1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            continue;
        }
        for (let i = 0; i < coords.length; i++) stack.push(coords[i]);
    }
    if (!isFinite(minX)) return true;
    return !(maxX < west || minX > east || maxY < south || minY > north);
}

function createImportContext(msg) {
    const { id, file, options = {} } = msg;
    const batchFeatures = options.batchFeatures ?? STREAM_BATCH_FEATURES;
    const batchMaxBytes = options.batchMaxBytes ?? STREAM_BATCH_MAX_BYTES;
    const maxFeatures = options.maxFeatures ?? STREAM_MAX_FEATURES;
    const fence = Array.isArray(options.fenceBbox) && options.fenceBbox.length === 4
        ? options.fenceBbox
        : null;

    const schema = createSchemaAccumulator();
    let features = [];
    let batchBytes = 0;
    let emitted = 0;
    let noGeometryCount = 0;
    let fenceFiltered = 0;
    let lastProgressAt = 0;

    const flush = async (bytesProcessed) => {
        if (!features.length) return;
        if (cancelled) throw _cancelError();
        const batch = features;
        features = [];
        batchBytes = 0;
        self.postMessage({
            id,
            type: 'batch',
            features: batch,
            bytesProcessed,
            totalBytes: file.size
        });
        await _waitForAck();
        if (cancelled) throw _cancelError();
    };

    return {
        /**
         * @param {object} rawFeature
         * @param {number} approxBytes
         * @param {number} bytesProcessed
         */
        async addFeature(rawFeature, approxBytes, bytesProcessed) {
            if (cancelled) throw _cancelError();
            const parts = flattenFeatureGeometryCollections({
                type: 'Feature',
                geometry: rawFeature.geometry || null,
                properties: rawFeature.properties || {},
                ...(rawFeature.id != null ? { id: rawFeature.id } : {})
            });
            for (const part of parts) {
                if (fence && part.geometry && !_bboxIntersectsFence(part.geometry, fence)) {
                    fenceFiltered++;
                    continue;
                }
                if (!part.geometry) noGeometryCount++;
                emitted++;
                if (emitted > maxFeatures) {
                    const err = new Error(
                        `File contains more than ${maxFeatures.toLocaleString()} features — exceeds the high-capacity import limit.`
                    );
                    err.code = 'TOO_MANY_FEATURES';
                    throw err;
                }
                schema.addFeature(part);
                features.push(part);
                batchBytes += approxBytes;
                if (features.length >= batchFeatures || batchBytes >= batchMaxBytes) {
                    await flush(bytesProcessed);
                }
            }
        },
        async finish(bytesProcessed, extra = {}) {
            await flush(bytesProcessed);
            self.postMessage({
                id,
                type: 'done',
                schema: schema.build(),
                stats: {
                    featureCount: emitted,
                    noGeometryCount,
                    fenceFiltered,
                    bytesProcessed
                },
                ...extra
            });
        },
        progress(bytesProcessed) {
            const now = Date.now();
            if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
            lastProgressAt = now;
            self.postMessage({
                id,
                type: 'progress',
                bytesProcessed,
                totalBytes: file.size
            });
        }
    };
}

async function runImport(msg) {
    const { id, format } = msg;
    cancelled = false;
    try {
        if (format === 'geojson' || format === 'json') {
            await runGeoJSON(msg);
        } else if (format === 'csv') {
            await runCSV(msg);
        } else {
            throw new Error(`Streaming import does not support format: ${format}`);
        }
    } catch (error) {
        if (error?.cancelled) return;
        self.postMessage({
            id,
            type: 'error',
            message: error?.message || String(error),
            code: error?.code || null
        });
    }
}

async function runGeoJSON(msg) {
    const ctx = createImportContext(msg);
    const { file } = msg;

    /** @type {Array<{ feature: object, chars: number }>} */
    const pending = [];
    const parser = new GeoJSONFeatureStreamParser({
        onFeature: (feature, chars) => {
            pending.push({ feature, chars });
        }
    });

    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let bytesProcessed = 0;

    const drain = async () => {
        for (const item of pending) {
            await ctx.addFeature(item.feature, item.chars || 512, bytesProcessed);
        }
        pending.length = 0;
    };

    try {
        while (true) {
            if (cancelled) throw _cancelError();
            const { done, value } = await reader.read();
            if (done) break;
            bytesProcessed += value.byteLength;
            parser.push(decoder.decode(value, { stream: true }));
            await drain();
            ctx.progress(bytesProcessed);
        }
        const tail = decoder.decode();
        if (tail) parser.push(tail);
        parser.finish();
        await drain();
        await ctx.finish(bytesProcessed);
    } finally {
        try {
            reader.releaseLock();
        } catch { /* ignore */ }
    }
}

const CSV_ROW_APPROX_BYTES = 256;

async function runCSV(msg) {
    const ctx = createImportContext(msg);
    const { id, file } = msg;

    let fields = null;
    let coordInfo = null;
    let coordChecked = false;
    const headRows = [];

    const rowToFeature = (row) => {
        const lat = parseCoordValue(row[coordInfo.latField]);
        const lon = parseCoordValue(row[coordInfo.lonField]);
        const geometry = (!isNaN(lat) && !isNaN(lon))
            ? { type: 'Point', coordinates: [lon, lat] }
            : null;
        return { type: 'Feature', geometry, properties: { ...row } };
    };

    const ensureCoordInfo = () => {
        if (coordChecked) return;
        coordChecked = true;
        coordInfo = detectAnyCoordinateColumns(fields || [], headRows);
        if (!coordInfo) {
            const err = new Error(
                'No coordinate columns detected — a file this large can only be imported as map data (latitude/longitude columns required).'
            );
            err.code = 'LARGE_TABLE_UNSUPPORTED';
            throw err;
        }
        if (coordInfo.projected) {
            const err = new Error(
                'This CSV uses projected easting/northing coordinates. Convert it to latitude/longitude externally before importing a file this large.'
            );
            err.code = 'PROJECTED_CSV_UNSUPPORTED';
            throw err;
        }
    };

    await new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: 'greedy',
            transformHeader: (h) => h.trim(),
            chunkSize: 4 * 1024 * 1024,
            chunk: (results, parser) => {
                activeCsvParser = parser;
                parser.pause();
                (async () => {
                    if (cancelled) throw _cancelError();
                    if (!fields) {
                        fields = results.meta?.fields || null;
                    }
                    const rows = results.data || [];
                    const bytesProcessed = results.meta?.cursor ?? 0;

                    if (!coordChecked) {
                        // Buffer the first rows (possibly across chunks) before
                        // committing to a coordinate-column decision.
                        let consumed = 0;
                        while (headRows.length < 20 && consumed < rows.length) {
                            headRows.push(rows[consumed++]);
                        }
                        if (headRows.length < 20) return; // keep buffering — complete() decides for tiny files
                        ensureCoordInfo();
                        for (const row of headRows) {
                            await ctx.addFeature(rowToFeature(row), CSV_ROW_APPROX_BYTES, bytesProcessed);
                        }
                        headRows.length = 0;
                        for (let i = consumed; i < rows.length; i++) {
                            await ctx.addFeature(rowToFeature(rows[i]), CSV_ROW_APPROX_BYTES, bytesProcessed);
                        }
                        ctx.progress(bytesProcessed);
                        return;
                    }

                    for (const row of rows) {
                        await ctx.addFeature(rowToFeature(row), CSV_ROW_APPROX_BYTES, bytesProcessed);
                    }
                    ctx.progress(bytesProcessed);
                })()
                    .then(() => {
                        if (cancelled) {
                            parser.abort();
                            reject(_cancelError());
                            return;
                        }
                        parser.resume();
                    })
                    .catch((err) => {
                        try {
                            parser.abort();
                        } catch { /* ignore */ }
                        reject(err);
                    });
            },
            complete: () => {
                (async () => {
                    // Small files may finish before the 20-row head buffer filled.
                    if (!coordChecked) {
                        ensureCoordInfo();
                        for (const row of headRows) {
                            await ctx.addFeature(rowToFeature(row), CSV_ROW_APPROX_BYTES, file.size);
                        }
                        headRows.length = 0;
                    }
                    await ctx.finish(file.size, { coordInfo });
                })().then(resolve, reject);
            },
            error: (err) => {
                reject(new Error('CSV parsing failed: ' + (err?.message || String(err))));
            }
        });
    });

    activeCsvParser = null;
    void id;
}
