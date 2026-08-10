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
import {
    featureMatchesImportFilters,
    hasActiveFeatureFilter,
    IMPORT_VALUE_SCAN_CAP
} from '../import/import-feature-filter.js';
import {
    createProfileAccumulator,
    observeFeatureForProfile
} from '../import/dataset-profile.js';
import {
    createValueAccumulator,
    extractKmlPlacemarkProperties
} from '../import/import-value-accumulator.js';
import {
    VALUE_SCAN_MAX_FEATURES,
    VALUE_SCAN_MAX_BYTES
} from '../import/import-scan-cache.js';
import { createByteReader } from '../import/stream/byte-reader.js';
import { geometryIntersectsImportFence } from '../import/import-fence.js';
import { csvDynamicTypingForField } from '../import/csv-typing.js';
import { looksProjected } from '../crs/detect.js';
import { sampleLayerCoordinate } from '../crs/layer-crs.js';
import { iterateDbfRecords, decoderFromCpg } from '../import/stream/dbf-stream-parser.js';
import { detectAnyCoordinateColumns, parseCoordValue } from '../import/coord-detect.js';

const PROGRESS_INTERVAL_MS = 200;

let cancelled = false;
let ackResolve = null;
let activeCsvParser = null;

self.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === 'start') {
        void runImport(msg);
    } else if (msg.type === 'scan-values') {
        void runValueScan(msg);
    } else if (msg.type === 'estimate-filter') {
        void runEstimate(msg);
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

function createImportContext(msg, overrides = {}) {
    const { id, file, options = {} } = msg;
    const estimateOnly = options.estimateOnly === true;
    const batchFeatures = options.batchFeatures ?? STREAM_BATCH_FEATURES;
    const batchMaxBytes = options.batchMaxBytes ?? STREAM_BATCH_MAX_BYTES;
    const maxFeatures = options.maxFeatures ?? STREAM_MAX_FEATURES;
    let skipFeatures = Math.max(0, Math.floor(Number(options.skipFeatures) || 0));
    const totalBytes = overrides.totalBytes ?? file.size;
    const selectedFields = shouldFilterFields(options.selectedFields)
        ? options.selectedFields
        : null;
    const fence = Array.isArray(options.fenceBbox) && options.fenceBbox.length === 4
        ? options.fenceBbox
        : null;
    const featureFilter = hasActiveFeatureFilter(options.featureFilter)
        ? options.featureFilter
        : null;

    const schema = estimateOnly ? null : createSchemaAccumulator();
    const profileAcc = estimateOnly ? null : createProfileAccumulator();
    let features = [];
    let batchBytes = 0;
    let emitted = 0;
    let totalSeen = 0;
    let noGeometryCount = 0;
    let fenceFiltered = 0;
    let featureFiltered = 0;
    let lastProgressAt = 0;

    const flush = async (bytesProcessed) => {
        if (estimateOnly || !features.length) return;
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
                totalSeen++;
                if (fence) {
                    if (!part.geometry || !geometryIntersectsImportFence(part.geometry, fence)) {
                        fenceFiltered++;
                        continue;
                    }
                }
                if (featureFilter && !featureMatchesImportFilters(part, featureFilter)) {
                    featureFiltered++;
                    continue;
                }
                if (estimateOnly) {
                    emitted++;
                    continue;
                }
                if (skipFeatures > 0) {
                    skipFeatures--;
                    emitted++;
                    continue;
                }
                if (selectedFields) {
                    part = { ...part, properties: filterProperties(part.properties, selectedFields) };
                }
                if (!part.geometry) noGeometryCount++;
                emitted++;
                if (emitted > maxFeatures) {
                    const err = new Error(
                        `File would store more than ${maxFeatures.toLocaleString()} features — over the import limit. Use a filter or fence to keep ≤ ${maxFeatures.toLocaleString()} features.`
                    );
                    err.code = 'TOO_MANY_FEATURES';
                    throw err;
                }
                schema.addFeature(part);
                observeFeatureForProfile(profileAcc, part);
                features.push(part);
                batchBytes += approxBytes;
                if (features.length >= batchFeatures || batchBytes >= batchMaxBytes) {
                    await flush(bytesProcessed);
                }
            }
        },
        async finish(bytesProcessed, extra = {}) {
            if (estimateOnly) {
                self.postMessage({
                    id,
                    type: 'estimate-done',
                    matchCount: emitted,
                    totalCount: totalSeen,
                    featureFiltered,
                    fenceFiltered,
                    bytesProcessed,
                    ...extra
                });
                return;
            }
            await flush(bytesProcessed);
            const geometryTypes = profileAcc?.geometryTypes instanceof Set
                ? [...profileAcc.geometryTypes]
                : [];
            self.postMessage({
                id,
                type: 'done',
                schema: schema.build(),
                stats: {
                    featureCount: emitted,
                    noGeometryCount,
                    fenceFiltered,
                    featureFiltered,
                    bytesProcessed,
                    coordCount: profileAcc?.coordCount || 0,
                    maxCoordsInFeature: profileAcc?.maxCoordsInFeature || 0,
                    bbox: profileAcc?.bbox || null,
                    geometryClassCounts: profileAcc?.geometryClassCounts
                        ? { ...profileAcc.geometryClassCounts }
                        : {},
                    geometryTypes
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

/** Count-only pass — same parsers/filters as import, no IndexedDB batches. */
async function runEstimate(msg) {
    const { id } = msg;
    cancelled = false;
    const estimateMsg = {
        ...msg,
        options: {
            ...(msg.options || {}),
            estimateOnly: true,
            maxFeatures: Number.MAX_SAFE_INTEGER,
            selectedFields: null
        }
    };
    try {
        const format = estimateMsg.format;
        if (format === 'geojson' || format === 'json') {
            await runGeoJSON(estimateMsg);
        } else if (format === 'csv') {
            await runCSV(estimateMsg);
        } else if (format === 'kml' || format === 'xml' || format === 'kmz') {
            await runKML(estimateMsg);
        } else if (format === 'zip') {
            await runZip(estimateMsg);
        } else {
            throw new Error(`Filter estimate does not support format: ${format}`);
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
    const { file, options = {} } = msg;
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
    const sourceCrs = options.sourceCrs || null;

    if (!prjWkt && !sourceCrs?.def) {
        // Peek the first geometry via a short stream to decide if coords look projected.
        // Full import restarts from a fresh stream below.
        const peek = streamShapefileFeatures({
            shpStream: await openZipEntryStream(file, shpEntry),
            dbfStream: null,
            prjWkt: null,
            cpgText: null,
            proj4Lib: null
        });
        let first = null;
        for await (const feature of peek.features) {
            first = feature;
            break;
        }
        const sample = sampleLayerCoordinate({
            type: 'FeatureCollection',
            features: first ? [first] : []
        });
        if (sample && looksProjected(sample[0], sample[1])) {
            const err = new Error(
                'This shapefile has no .prj and coordinates look projected — pick the source coordinate system to import it.'
            );
            err.code = 'PROJECTED_SHAPEFILE_NEEDS_CRS';
            throw err;
        }
    }

    const totalBytes = (shpEntry.uncompressedSize || 0) + (dbfEntry?.uncompressedSize || 0);
    const ctx = createImportContext(msg, { totalBytes });

    const source = streamShapefileFeatures({
        shpStream: await openZipEntryStream(file, shpEntry),
        dbfStream: dbfEntry ? await openZipEntryStream(file, dbfEntry) : null,
        prjWkt,
        cpgText,
        proj4Lib: proj4,
        sourceCrsDef: sourceCrs?.def || null
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

    const crsDetected = prjWkt ? 'prj' : (sourceCrs ? 'user' : 'extent');
    await ctx.finish(source.getBytesConsumed(), {
        warnings: source.warnings,
        sourceMeta: {
            crsDetected,
            ...(sourceCrs?.code ? { originalCrs: sourceCrs.code } : {})
        }
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
            dynamicTyping: csvDynamicTypingForField,
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

// ---------------------------------------------------------------------------
// Pre-import distinct-value scan (properties only)
// ---------------------------------------------------------------------------

async function runValueScan(msg) {
    const { id, format } = msg;
    cancelled = false;
    try {
        if (format === 'geojson' || format === 'json') {
            await scanGeoJSONValues(msg);
        } else if (format === 'csv') {
            await scanCsvValues(msg);
        } else if (format === 'kml' || format === 'xml' || format === 'kmz') {
            await scanKmlValues(msg);
        } else if (format === 'zip') {
            await scanZipValues(msg);
        } else {
            throw new Error(`Attribute value scan does not support format: ${format}`);
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

function _createScanState(msg) {
    const { id, file, options = {} } = msg;
    const fieldNames = Array.isArray(options.fieldNames) ? options.fieldNames.filter(Boolean) : [];
    const valueCap = options.valueCap ?? IMPORT_VALUE_SCAN_CAP;
    const sampleMaxFeatures = Number.isFinite(options.sampleMaxFeatures)
        ? options.sampleMaxFeatures
        : VALUE_SCAN_MAX_FEATURES;
    const sampleMaxBytes = Number.isFinite(options.sampleMaxBytes)
        ? options.sampleMaxBytes
        : VALUE_SCAN_MAX_BYTES;
    const acc = createValueAccumulator(valueCap);
    if (fieldNames.length) acc.ensureFields(fieldNames);
    let lastProgressAt = 0;
    let sampled = false;
    return {
        id,
        file,
        fieldNames: fieldNames.length ? fieldNames : null,
        acc,
        sampleMaxFeatures,
        sampleMaxBytes,
        get sampled() {
            return sampled;
        },
        /**
         * @param {number} [bytesProcessed]
         * @returns {boolean} true when the sample budget is exhausted
         */
        shouldStop(bytesProcessed = 0) {
            if (acc.rowCount >= sampleMaxFeatures) {
                sampled = true;
                return true;
            }
            if (bytesProcessed >= sampleMaxBytes) {
                sampled = true;
                return true;
            }
            return false;
        },
        progress(bytesProcessed, totalBytes) {
            const now = Date.now();
            if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
            lastProgressAt = now;
            self.postMessage({
                id,
                type: 'progress',
                bytesProcessed,
                totalBytes,
                sampled
            });
        },
        done() {
            const built = acc.build();
            self.postMessage({
                id,
                type: 'scan-done',
                fields: built.fields,
                rowCount: built.rowCount,
                sampled
            });
        }
    };
}

async function scanGeoJSONValues(msg) {
    const state = _createScanState(msg);
    const { file } = msg;
    const pending = [];
    const parser = new GeoJSONFeatureStreamParser({
        onFeature: (feature) => {
            pending.push(feature?.properties || {});
        }
    });
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let bytesProcessed = 0;
    try {
        while (true) {
            if (cancelled) throw _cancelError();
            if (state.shouldStop(bytesProcessed)) break;
            const { done, value } = await reader.read();
            if (done) break;
            bytesProcessed += value.byteLength;
            parser.push(decoder.decode(value, { stream: true }));
            for (const props of pending) {
                state.acc.addProperties(props, state.fieldNames);
                if (state.shouldStop(bytesProcessed)) break;
            }
            pending.length = 0;
            state.progress(bytesProcessed, file.size);
            if (state.shouldStop(bytesProcessed)) break;
        }
        if (!state.sampled) {
            const tail = decoder.decode();
            if (tail) parser.push(tail);
            parser.finish();
            for (const props of pending) {
                state.acc.addProperties(props, state.fieldNames);
                if (state.shouldStop(bytesProcessed)) break;
            }
        }
        state.done();
    } finally {
        try {
            await reader.cancel();
        } catch { /* ignore */ }
        try {
            reader.releaseLock();
        } catch { /* ignore */ }
    }
}

async function scanCsvValues(msg) {
    const state = _createScanState(msg);
    const { file } = msg;
    await new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: csvDynamicTypingForField,
            skipEmptyLines: 'greedy',
            transformHeader: (h) => h.trim(),
            chunkSize: 4 * 1024 * 1024,
            chunk: (results, parser) => {
                activeCsvParser = parser;
                if (cancelled) {
                    parser.abort();
                    return;
                }
                const rows = results.data || [];
                const meta = results.meta;
                const cursor = meta?.cursor ?? 0;
                for (let i = 0; i < rows.length; i++) {
                    state.acc.addProperties(rows[i], state.fieldNames);
                    if (state.shouldStop(cursor)) {
                        parser.abort();
                        break;
                    }
                }
                state.progress(cursor, file.size);
                if (state.shouldStop(cursor)) {
                    parser.abort();
                }
            },
            complete: () => {
                activeCsvParser = null;
                if (cancelled) {
                    reject(_cancelError());
                    return;
                }
                state.done();
                resolve();
            },
            error: (err) => {
                activeCsvParser = null;
                // PapaParse reports abort as an error in some environments — treat sample stop as success.
                if (state.sampled && !cancelled) {
                    state.done();
                    resolve();
                    return;
                }
                reject(new Error('CSV scan failed: ' + (err?.message || String(err))));
            }
        });
    });
}

async function scanKmlValues(msg) {
    const state = _createScanState(msg);
    const { file, format } = msg;

    let byteStream;
    let totalBytes;
    if (format === 'kmz' || format === 'zip') {
        const entries = await readZipEntries(file);
        const main = chooseMainKmlZipEntry(entries);
        if (!main) throw new Error(`"${file.name}" contains no KML document.`);
        byteStream = await openZipEntryStream(file, main.entry);
        totalBytes = main.entry.uncompressedSize || file.size;
    } else {
        byteStream = file.stream();
        totalBytes = file.size;
    }

    let bytesProcessed = 0;
    const parser = new KmlPlacemarkStreamParser({
        onPlacemark: (text) => {
            state.acc.addProperties(extractKmlPlacemarkProperties(text), state.fieldNames);
        }
    });
    const reader = byteStream.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            if (cancelled) throw _cancelError();
            if (state.shouldStop(bytesProcessed)) break;
            const { done, value } = await reader.read();
            if (done) break;
            bytesProcessed += value.byteLength;
            parser.push(decoder.decode(value, { stream: true }));
            state.progress(bytesProcessed, totalBytes);
            if (state.shouldStop(bytesProcessed)) break;
        }
        if (!state.sampled) {
            const tail = decoder.decode();
            if (tail) parser.push(tail);
            parser.finish();
        }
        state.done();
    } finally {
        try {
            await reader.cancel();
        } catch { /* ignore */ }
        try {
            reader.releaseLock();
        } catch { /* ignore */ }
    }
}

async function scanZipValues(msg) {
    const entries = await readZipEntries(msg.file);
    const shpEntries = entries.filter(
        (e) => _isRealEntry(e) && _normalZipName(e.name).toLowerCase().endsWith('.shp')
    );
    if (shpEntries.length) {
        await scanShapefileDbfValues(msg, entries, shpEntries);
        return;
    }
    await scanKmlValues({ ...msg, format: 'zip' });
}

async function scanShapefileDbfValues(msg, entries, shpEntries) {
    const state = _createScanState(msg);
    const { file } = msg;
    if (shpEntries.length > 1) {
        throw new Error(
            `"${file.name}" contains ${shpEntries.length} shapefiles — scan one shapefile per archive.`
        );
    }
    const shpEntry = shpEntries[0];
    const baseName = _normalZipName(shpEntry.name).replace(/\.shp$/i, '').toLowerCase();
    const dbfEntry = entries.find(
        (e) => _isRealEntry(e) && _normalZipName(e.name).toLowerCase() === `${baseName}.dbf`
    );
    if (!dbfEntry) {
        state.done();
        return;
    }
    const cpgEntry = entries.find(
        (e) => _isRealEntry(e) && _normalZipName(e.name).toLowerCase() === `${baseName}.cpg`
    );
    const cpgText = cpgEntry ? (await readZipEntryHead(file, cpgEntry, 1024)).trim() : null;
    const totalBytes = dbfEntry.uncompressedSize || file.size;
    const dbfStream = await openZipEntryStream(file, dbfEntry);
    const byteReader = createByteReader(dbfStream);
    for await (const props of iterateDbfRecords(byteReader, decoderFromCpg(cpgText))) {
        if (cancelled) throw _cancelError();
        state.acc.addProperties(props, state.fieldNames);
        state.progress(byteReader.bytesConsumed, totalBytes);
        if (state.shouldStop(byteReader.bytesConsumed)) break;
    }
    state.done();
}

