/**
 * Web Worker — streaming parse for high-capacity imports (large GeoJSON / CSV).
 *
 * The File handle is cloned into the worker; bytes are read incrementally and
 * features are posted back in small batches. After each batch the worker waits
 * for an "ack" from the main thread (backpressure), so memory stays flat on
 * both sides no matter how large the file is.
 */
import './xml-worker-globals.js';
import Papa from 'papaparse';
import proj4 from 'proj4';
import { DOMParser } from '@xmldom/xmldom';
import toGeoJSON from '@mapbox/togeojson';
import { GeoJSONFeatureStreamParser } from '../import/stream/geojson-stream-parser.js';
import { KmlPlacemarkStreamParser } from '../import/stream/kml-stream-parser.js';
import { createKmlBlockConverter } from '../import/stream/kml-stream-convert.js';
import { streamShapefileFeatures } from '../import/stream/shapefile-stream.js';
import {
    readZipEntries,
    openZipEntryStream,
    readZipEntryHead,
    chooseMainKmlZipEntry
} from '../import/stream/zip-central-directory.js';
import {
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES,
    STREAM_MAX_FEATURES
} from '../import/stream/stream-constants.js';
import { createSchemaAccumulator, flattenFeatureGeometryCollections } from '../core/data-model.js';
import { filterProperties, shouldFilterFields } from '../import/import-field-filter.js';
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

function createImportContext(msg, overrides = {}) {
    const { id, file, options = {} } = msg;
    const batchFeatures = options.batchFeatures ?? STREAM_BATCH_FEATURES;
    const batchMaxBytes = options.batchMaxBytes ?? STREAM_BATCH_MAX_BYTES;
    const maxFeatures = options.maxFeatures ?? STREAM_MAX_FEATURES;
    const totalBytes = overrides.totalBytes ?? file.size;
    const selectedFields = shouldFilterFields(options.selectedFields)
        ? options.selectedFields
        : null;
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
            totalBytes
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
            for (let part of parts) {
                if (fence && part.geometry && !_bboxIntersectsFence(part.geometry, fence)) {
                    fenceFiltered++;
                    continue;
                }
                if (selectedFields) {
                    part = { ...part, properties: filterProperties(part.properties, selectedFields) };
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
                totalBytes
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
        } else if (format === 'kml' || format === 'xml' || format === 'kmz') {
            await runKML(msg);
        } else if (format === 'zip') {
            await runZip(msg);
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

function _normalZipName(name) {
    return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function _isRealEntry(entry) {
    const name = _normalZipName(entry.name);
    return !entry.isDir && !name.startsWith('__MACOSX/') && !name.split('/').pop().startsWith('.');
}

/** Dispatch a .zip archive: KML inside → KML pipeline, shapefile → SHP pipeline. */
async function runZip(msg) {
    const entries = await readZipEntries(msg.file);
    const shpEntries = entries.filter(
        (e) => _isRealEntry(e) && _normalZipName(e.name).toLowerCase().endsWith('.shp')
    );
    if (shpEntries.length) {
        await runShapefile(msg, entries, shpEntries);
        return;
    }
    await runKML(msg);
}

async function runShapefile(msg, entries, shpEntries) {
    const { file } = msg;
    if (shpEntries.length > 1) {
        throw new Error(
            `"${file.name}" contains ${shpEntries.length} shapefiles — high-capacity import supports one shapefile per archive. Split the archive and import separately.`
        );
    }
    const shpEntry = shpEntries[0];
    const baseName = _normalZipName(shpEntry.name).replace(/\.shp$/i, '').toLowerCase();
    const companion = (ext) => entries.find(
        (e) => _isRealEntry(e) && _normalZipName(e.name).toLowerCase() === `${baseName}${ext}`
    ) || null;

    const dbfEntry = companion('.dbf');
    const prjEntry = companion('.prj');
    const cpgEntry = companion('.cpg');

    const prjWkt = prjEntry ? (await readZipEntryHead(file, prjEntry, 64 * 1024)).trim() : null;
    const cpgText = cpgEntry ? (await readZipEntryHead(file, cpgEntry, 1024)).trim() : null;

    const totalBytes = (shpEntry.uncompressedSize || 0) + (dbfEntry?.uncompressedSize || 0);
    const ctx = createImportContext(msg, { totalBytes });

    const source = streamShapefileFeatures({
        shpStream: await openZipEntryStream(file, shpEntry),
        dbfStream: dbfEntry ? await openZipEntryStream(file, dbfEntry) : null,
        prjWkt,
        cpgText,
        proj4Lib: proj4
    });

    let approxBytes = 128;
    if (shpEntry.uncompressedSize) {
        approxBytes = Math.max(64, Math.round(totalBytes / Math.max((shpEntry.uncompressedSize - 100) / 30, 1)));
    }

    for await (const feature of source.features) {
        if (cancelled) throw _cancelError();
        await ctx.addFeature(feature, approxBytes, source.getBytesConsumed());
        ctx.progress(source.getBytesConsumed());
    }

    await ctx.finish(source.getBytesConsumed(), {
        warnings: source.warnings,
        sourceMeta: { crsDetected: prjWkt ? 'prj' : 'default' }
    });
}

/** Placemark blocks parsed per synthetic document (amortizes DOMParser cost). */
const KML_BATCH_BLOCKS = 50;
/** Flush a placemark batch early when accumulated text passes this. */
const KML_BATCH_MAX_CHARS = 4 * 1024 * 1024;

async function runKML(msg) {
    const { file, format, options = {} } = msg;
    const importMode = options.importMode || 'gis';

    let byteStream;
    let totalBytes;
    if (format === 'kmz' || format === 'zip') {
        const entries = await readZipEntries(file);
        const main = chooseMainKmlZipEntry(entries);
        if (!main) {
            throw new Error(`"${file.name}" contains no KML document.`);
        }
        byteStream = await openZipEntryStream(file, main.entry);
        totalBytes = main.entry.uncompressedSize || 0;
    } else {
        byteStream = file.stream();
        totalBytes = file.size;
    }

    const ctx = createImportContext(msg, { totalBytes });
    const converter = createKmlBlockConverter({
        DOMParserImpl: DOMParser,
        toGeoJsonLib: toGeoJSON,
        importMode
    });

    const pendingBlocks = [];
    let pendingChars = 0;
    let failedPlacemarks = 0;
    const parser = new KmlPlacemarkStreamParser({
        onPlacemark: (text) => {
            pendingBlocks.push(text);
            pendingChars += text.length;
        },
        onSharedBlock: (kind, id, text) => converter.addShared(kind, id, text)
    });

    let bytesProcessed = 0;

    const drain = async (force) => {
        while (
            pendingBlocks.length >= KML_BATCH_BLOCKS
            || pendingChars >= KML_BATCH_MAX_CHARS
            || (force && pendingBlocks.length)
        ) {
            const blocks = pendingBlocks.splice(0, KML_BATCH_BLOCKS);
            pendingChars = pendingBlocks.reduce((s, b) => s + b.length, 0);
            converter.setRootTag(parser.rootTag);
            const { features, failed } = converter.convert(blocks);
            failedPlacemarks += failed;
            const totalChars = blocks.reduce((s, b) => s + b.length, 0);
            const approx = Math.ceil(totalChars / Math.max(features.length, 1));
            for (const feature of features) {
                await ctx.addFeature(feature, approx, bytesProcessed);
            }
        }
    };

    const reader = byteStream.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            if (cancelled) throw _cancelError();
            const { done, value } = await reader.read();
            if (done) break;
            bytesProcessed += value.byteLength;
            parser.push(decoder.decode(value, { stream: true }));
            await drain(false);
            ctx.progress(bytesProcessed);
        }
        const tail = decoder.decode();
        if (tail) parser.push(tail);
        parser.finish();
        await drain(true);
        await ctx.finish(bytesProcessed, {
            warnings: failedPlacemarks
                ? [`${failedPlacemarks.toLocaleString()} placemark(s) could not be parsed and were skipped.`]
                : []
        });
    } finally {
        try {
            reader.releaseLock();
        } catch { /* ignore */ }
    }
}

const CSV_ROW_APPROX_BYTES = 256;

async function runCSV(msg) {
    const ctx = createImportContext(msg);
    const { id, file, options = {} } = msg;
    const sourceCrs = options.sourceCrs || null;

    let fields = null;
    let coordInfo = null;
    let coordChecked = false;
    let projTransform = null;
    const headRows = [];

    const rowToFeature = (row) => {
        const y = parseCoordValue(row[coordInfo.latField]);
        const x = parseCoordValue(row[coordInfo.lonField]);
        let geometry = null;
        if (!isNaN(y) && !isNaN(x)) {
            if (projTransform) {
                const [lon, lat] = projTransform.forward([x, y]);
                geometry = (Number.isFinite(lon) && Number.isFinite(lat))
                    ? { type: 'Point', coordinates: [lon, lat] }
                    : null;
            } else {
                geometry = { type: 'Point', coordinates: [x, y] };
            }
        }
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
            if (!sourceCrs?.def) {
                const err = new Error(
                    'This CSV uses projected easting/northing coordinates — pick the source coordinate system to import it.'
                );
                err.code = 'PROJECTED_CSV_NEEDS_CRS';
                throw err;
            }
            try {
                projTransform = proj4(sourceCrs.def, '+proj=longlat +datum=WGS84 +no_defs');
            } catch (e) {
                const err = new Error(`Could not initialize reprojection from ${sourceCrs.code || 'the chosen CRS'}: ${e.message}`);
                err.code = 'PROJECTED_CSV_BAD_CRS';
                throw err;
            }
        }
    };

    let failed = false;

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
                            failed = true;
                            parser.abort();
                            reject(_cancelError());
                            return;
                        }
                        parser.resume();
                    })
                    .catch((err) => {
                        // Papa still fires complete() after abort — flag the
                        // failure so complete() cannot post a stale "done".
                        failed = true;
                        try {
                            parser.abort();
                        } catch { /* ignore */ }
                        reject(err);
                    });
            },
            complete: () => {
                if (failed || cancelled) return;
                (async () => {
                    // Small files may finish before the 20-row head buffer filled.
                    if (!coordChecked) {
                        ensureCoordInfo();
                        for (const row of headRows) {
                            await ctx.addFeature(rowToFeature(row), CSV_ROW_APPROX_BYTES, file.size);
                        }
                        headRows.length = 0;
                    }
                    await ctx.finish(file.size, {
                        coordInfo,
                        ...(projTransform
                            ? { sourceMeta: { originalCrs: sourceCrs.code || 'CUSTOM', crsDetected: 'user' } }
                            : {})
                    });
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
