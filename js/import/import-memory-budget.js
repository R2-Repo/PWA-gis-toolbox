/**
 * Estimated peak memory for imports — file bytes expand during parse, schema, and map render.
 */
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { formatBytes, MAX_IMPORT_FEATURES } from './import-preflight.js';

const PEAK_FACTOR = {
    geojson: 12,
    json: 12,
    csv: 14,
    kml: 14,
    gpx: 14,
    xml: 14,
    zip: 16,
    kmz: 16,
    xlsx: 12,
    xls: 12
};

/** Reject when estimated single-file peak exceeds this (bytes). */
export const ESTIMATED_PEAK_REJECT_BYTES = 24 * 1024 * 1024;

/** Never read more than this many bytes into a string/buffer for import. */
export const MAX_READ_BYTES_TEXT = 6 * 1024 * 1024;
export const MAX_READ_BYTES_BINARY = 8 * 1024 * 1024;

/** After read, reject text payloads larger than this before parse. */
export const MAX_TEXT_PARSE_CHARS = 6 * 1024 * 1024;

/** Block import when less than this heap headroom remains (Chrome performance.memory). */
export const MIN_HEAP_HEADROOM_BYTES = 64 * 1024 * 1024;

/** Feature estimate above this blocks import (density sniff). */
export const SNIFF_FEATURE_REJECT = 100_000;

/** Coordinate count estimate above this blocks import (pathological geometry). */
export const SNIFF_COORDINATE_REJECT = 2_000_000;

export const IMPORT_GUARD_VERSION = '2026-06-07d';

function _detectFormatFromName(fileName) {
    const name = (fileName || '').toLowerCase();
    const ext = name.split('.').pop();
    if (ext === 'geojson') return 'geojson';
    if (ext === 'json') return 'json';
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
    if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
    if (ext === 'kml') return 'kml';
    if (ext === 'gpx') return 'gpx';
    if (ext === 'kmz') return 'kmz';
    if (ext === 'zip') return 'zip';
    if (ext === 'xml') return 'xml';
    return null;
}

function _maxReadBytes(format) {
    const binary = format === 'zip' || format === 'kmz' || format === 'xlsx' || format === 'xls';
    return binary ? MAX_READ_BYTES_BINARY : MAX_READ_BYTES_TEXT;
}

function _oomError(message, details = {}) {
    return new AppError(message, ErrorCategory.OUT_OF_MEMORY, details);
}

/**
 * @param {File} file
 * @returns {number}
 */
export function estimateImportPeakBytes(file) {
    const format = _detectFormatFromName(file.name);
    const factor = PEAK_FACTOR[format] || 12;
    return (file.size ?? 0) * factor;
}

/**
 * @returns {{ available: number, used: number, limit: number }|null}
 */
export function getBrowserHeapInfo() {
    const mem = typeof performance !== 'undefined' ? performance.memory : null;
    if (!mem?.jsHeapSizeLimit) return null;
    return {
        available: mem.jsHeapSizeLimit - mem.usedJSHeapSize,
        used: mem.usedJSHeapSize,
        limit: mem.jsHeapSizeLimit
    };
}

/**
 * @param {File} file
 * @param {string|null} [format]
 */
export function assertFileReadable(file, format = null) {
    const fmt = format ?? _detectFormatFromName(file.name);
    const sizeBytes = file.size ?? 0;
    const maxRead = _maxReadBytes(fmt);

    if (sizeBytes > maxRead) {
        throw _oomError(
            `"${file.name}" is ${formatBytes(sizeBytes)} — exceeds the ${formatBytes(maxRead)} read limit. Split or simplify the file before importing.`,
            { fileName: file.name, sizeBytes, maxRead, format: fmt }
        );
    }
}

/**
 * @param {string} text
 * @param {string} fileName
 */
export function assertTextPayloadSize(text, fileName) {
    const len = text?.length ?? 0;
    if (len > MAX_TEXT_PARSE_CHARS) {
        throw _oomError(
            `"${fileName}" expands to ${formatBytes(len)} of text in memory — too large to parse safely. Simplify or split the file.`,
            { fileName, charLength: len }
        );
    }
}

/**
 * Sniff feature density from the first slice without loading the whole file.
 * @param {File} file
 * @returns {Promise<number|null>} estimated feature count, or null if unknown
 */
export async function sniffFeatureCountEstimate(file) {
    const format = _detectFormatFromName(file.name);
    if (!format || !['geojson', 'json', 'kml', 'gpx', 'xml', 'csv'].includes(format)) {
        return null;
    }
    if ((file.size ?? 0) < 512 * 1024) return null;

    const sampleLen = Math.min(file.size, 384 * 1024);
    let head;
    try {
        head = await file.slice(0, sampleLen).text();
    } catch {
        return null;
    }

    let hits = 0;
    if (format === 'csv') {
        hits = (head.match(/\n/g) || []).length;
    } else if (format === 'kml' || format === 'xml') {
        hits = (head.match(/<Placemark[\s>]/gi) || []).length;
    } else if (format === 'gpx') {
        hits = (head.match(/<(?:trkpt|rtept|wpt)[\s/>]/gi) || []).length;
    } else {
        hits = (head.match(/"type"\s*:\s*"Feature"/gi) || []).length;
    }

    if (hits < 3) return null;
    const estimated = Math.max(hits, Math.round((hits / sampleLen) * file.size));
    return estimated;
}

/**
 * Estimate coordinate density from a text sample (GeoJSON/KML/GPX).
 * @param {string} head
 * @param {number} fileSize
 * @param {string|null} [format]
 * @returns {number|null}
 */
export function estimateCoordinateCountFromSample(head, fileSize, format = null) {
    if (!head || fileSize < 256 * 1024) return null;
    const sampleLen = head.length;
    let coordHits;
    if (format === 'gpx') {
        coordHits = (head.match(/\blat="/gi) || []).length;
    } else {
        coordHits = (head.match(/\[\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*/g) || []).length;
    }
    if (coordHits < 5) return null;
    return Math.max(coordHits, Math.round((coordHits / sampleLen) * fileSize));
}

/**
 * @param {File} file
 * @returns {Promise<number|null>}
 */
export async function sniffCoordinateCountEstimate(file) {
    const format = _detectFormatFromName(file.name);
    if (!format || !['geojson', 'json', 'kml', 'gpx', 'xml'].includes(format)) return null;
    if ((file.size ?? 0) < 256 * 1024) return null;

    const sampleLen = Math.min(file.size, 384 * 1024);
    let head;
    try {
        head = await file.slice(0, sampleLen).text();
    } catch {
        return null;
    }
    return estimateCoordinateCountFromSample(head, file.size, format);
}

/**
 * @param {File} file
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function _checkZipExpansion(file) {
    const format = _detectFormatFromName(file.name);
    if (format !== 'zip' && format !== 'kmz') return { ok: true };

    const sizeBytes = file.size ?? 0;
    if (sizeBytes > MAX_READ_BYTES_BINARY) return { ok: true };

    try {
        const buffer = await file.arrayBuffer();
        const { loadJSZip } = await import('../core/libs.js');
        const { measureZipUncompressedBytes, MAX_ZIP_UNCOMPRESSED_BYTES } = await import('./zip-utils.js');
        const JSZipLib = await loadJSZip();
        const uncompressed = await measureZipUncompressedBytes(buffer, JSZipLib);
        if (uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
            return {
                ok: false,
                message: `"${file.name}" would expand to ${formatBytes(uncompressed)} uncompressed (limit ${formatBytes(MAX_ZIP_UNCOMPRESSED_BYTES)}). Split or simplify the archive before importing.`
            };
        }
    } catch {
        /* if sniff fails, rely on later assert during import */
    }
    return { ok: true };
}

/**
 * @param {File[]} files
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function checkEstimatedMemoryBudget(files) {
    for (const file of files) {
        assertFileReadable(file);

        const peak = estimateImportPeakBytes(file);
        if (peak > ESTIMATED_PEAK_REJECT_BYTES) {
            const mb = (peak / (1024 * 1024)).toFixed(0);
            const cap = (ESTIMATED_PEAK_REJECT_BYTES / (1024 * 1024)).toFixed(0);
            return {
                ok: false,
                message: `"${file.name}" would need ~${mb} MB memory (limit ~${cap} MB). Split or simplify it externally before importing.`
            };
        }

        const featureEst = await sniffFeatureCountEstimate(file);
        if (featureEst != null && featureEst > SNIFF_FEATURE_REJECT) {
            return {
                ok: false,
                message: `"${file.name}" appears to contain ~${featureEst.toLocaleString()} features — too dense for browser import. Simplify or split the file (limit ~${SNIFF_FEATURE_REJECT.toLocaleString()} features).`
            };
        }

        const coordEst = await sniffCoordinateCountEstimate(file);
        if (coordEst != null && coordEst > SNIFF_COORDINATE_REJECT) {
            return {
                ok: false,
                message: `"${file.name}" appears to contain ~${coordEst.toLocaleString()} coordinates — geometry is too dense for browser import. Simplify or split the file.`
            };
        }

        const zipCheck = await _checkZipExpansion(file);
        if (!zipCheck.ok) return zipCheck;
    }

    const totalPeak = files.reduce((sum, f) => sum + estimateImportPeakBytes(f), 0);
    const heap = getBrowserHeapInfo();
    if (heap && totalPeak > heap.available * 0.35) {
        const availMb = (heap.available / (1024 * 1024)).toFixed(0);
        return {
            ok: false,
            message: `Not enough free browser memory (~${availMb} MB available). Close other tabs and try a smaller file.`
        };
    }

    if (heap && heap.available < MIN_HEAP_HEADROOM_BYTES) {
        const availMb = (heap.available / (1024 * 1024)).toFixed(0);
        return {
            ok: false,
            message: `Browser memory is already low (~${availMb} MB free). Close other tabs before importing.`
        };
    }

    return { ok: true };
}

/**
 * @param {() => Array} getLayers
 */
export function checkExistingLayerMemory(getLayers) {
    if (typeof getLayers !== 'function') return { ok: true };
    const layers = getLayers() || [];
    let featureCount = 0;
    for (const layer of layers) {
        if (layer.type === 'spatial-chunked' || layer.storage === 'workspace') {
            // Disk-backed workspace layers render viewport packets only — they
            // don't hold decoded features in memory, so they don't count here.
            continue;
        }
        if (layer.type === 'spatial') {
            featureCount += layer.geojson?.features?.length || 0;
        } else if (layer.type === 'table') {
            featureCount += layer.rows?.length || 0;
        }
    }
    if (featureCount > MAX_IMPORT_FEATURES * 0.5) {
        return {
            ok: false,
            message: `The map already has ${featureCount.toLocaleString()} features/rows loaded. Remove layers or refresh before importing more data.`
        };
    }
    return { ok: true };
}

export default {
    estimateImportPeakBytes,
    getBrowserHeapInfo,
    checkEstimatedMemoryBudget,
    checkExistingLayerMemory,
    assertFileReadable,
    assertTextPayloadSize,
    sniffFeatureCountEstimate,
    sniffCoordinateCountEstimate,
    estimateCoordinateCountFromSample,
    IMPORT_GUARD_VERSION,
    ESTIMATED_PEAK_REJECT_BYTES,
    MAX_READ_BYTES_TEXT,
    MAX_READ_BYTES_BINARY
};
