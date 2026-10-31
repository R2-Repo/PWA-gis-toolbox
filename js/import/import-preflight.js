/**
 * Pre-import checks — format-aware file size warnings before heavy parse work.
 */
import {
    LIMITS,
    BINARY_PREFLIGHT_FORMATS,
    preflightByteBands
} from './import-limits.js';

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

export const TEXT_SOFT_BYTES = LIMITS.textSoftBytes;
export const TEXT_STRONG_BYTES = LIMITS.textStrongBytes;
export const TEXT_HARD_BYTES = LIMITS.textHardBytes;
export const BINARY_SOFT_BYTES = LIMITS.binarySoftBytes;
export const BINARY_STRONG_BYTES = LIMITS.binaryStrongBytes;
export const BINARY_HARD_BYTES = LIMITS.binaryHardBytes;
export const MAX_IMPORT_FEATURES = LIMITS.maxImportFeatures;

/** @deprecated use TEXT_SOFT_BYTES */
export const PREFLIGHT_SOFT_BYTES = TEXT_SOFT_BYTES;
/** @deprecated use TEXT_HARD_BYTES */
export const PREFLIGHT_HARD_BYTES = TEXT_HARD_BYTES;
/** @deprecated use TEXT_STRONG_BYTES */
export const PREFLIGHT_STRONG_BYTES = TEXT_STRONG_BYTES;

const BINARY_FORMATS = BINARY_PREFLIGHT_FORMATS;

export const PREFLIGHT_LEVEL = {
    OK: 'ok',
    SOFT: 'soft',
    STRONG: 'strong',
    REJECT: 'reject'
};

/**
 * @param {string|null} format
 * @returns {{ soft: number, strong: number, hard: number, binary: boolean }}
 */
export function getPreflightLimits(format) {
    return preflightByteBands(format, LIMITS);
}

/**
 * @param {File} file
 * @param {{ format?: string|null }} [options]
 * @returns {{ level: string, message?: string, sizeBytes: number, format?: string|null }}
 */
export function preflightFile(file, options = {}) {
    const format = options.format !== undefined ? options.format : _detectFormatFromName(file.name);
    const sizeBytes = file.size ?? 0;
    const { soft, strong, hard, binary } = getPreflightLimits(format);

    if (sizeBytes >= hard) {
        const hint = binary
            ? ' Archives and spreadsheets expand heavily in memory when unpacked.'
            : ' Try a smaller export, or simplify/split the data in QGIS, GDAL, or similar.';
        return {
            level: PREFLIGHT_LEVEL.REJECT,
            sizeBytes,
            format,
            message: `"${file.name}" is ${formatBytes(sizeBytes)} — exceeds the ${formatBytes(hard)} limit for ${binary ? 'archives/spreadsheets' : 'text'} imports.${hint}`
        };
    }
    if (sizeBytes >= strong) {
        return {
            level: PREFLIGHT_LEVEL.REJECT,
            sizeBytes,
            format,
            message: `"${file.name}" is ${formatBytes(sizeBytes)} — too large to import safely in the browser (limit ~${formatBytes(strong)}). Split or simplify externally.`
        };
    }
    if (sizeBytes >= soft) {
        return {
            level: PREFLIGHT_LEVEL.SOFT,
            sizeBytes,
            format,
            message: `"${file.name}" is ${formatBytes(sizeBytes)} — above the recommended size for a simple browser import. Large files use streaming import into local storage (up to about 1,000,000 stored features; some GIS tools still need a smaller working set).`
        };
    }
    return { level: PREFLIGHT_LEVEL.OK, sizeBytes, format };
}

/**
 * @param {File[]} files
 * @returns {{ level: string, messages: string[], reject: boolean, files: Array<{ name: string, sizeBytes: number, level: string, format?: string|null }> }}
 */
export function preflightFiles(files) {
    const results = files.map((f) => ({ file: f, ...preflightFile(f) }));
    const messages = results.filter((r) => r.message).map((r) => r.message);
    const reject = results.some((r) => r.level === PREFLIGHT_LEVEL.REJECT);
    const level = reject
        ? PREFLIGHT_LEVEL.REJECT
        : results.some((r) => r.level === PREFLIGHT_LEVEL.STRONG)
            ? PREFLIGHT_LEVEL.STRONG
            : results.some((r) => r.level === PREFLIGHT_LEVEL.SOFT)
                ? PREFLIGHT_LEVEL.SOFT
                : PREFLIGHT_LEVEL.OK;

    return {
        level,
        messages,
        reject,
        files: results.map((r) => ({
            name: r.file.name,
            sizeBytes: r.sizeBytes,
            level: r.level,
            format: r.format
        }))
    };
}

/**
 * Human-readable size with both KB and MB (binary, 1024-based).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '0 B';
    if (n < 1024) return `${Math.round(n)} B`;

    const kb = n / 1024;
    const mb = n / (1024 * 1024);
    const kbLabel = kb >= 100 ? kb.toFixed(0) : kb.toFixed(1);
    const mbLabel = mb >= 1 ? mb.toFixed(1) : mb >= 0.1 ? mb.toFixed(2) : mb.toFixed(3);
    return `${kbLabel} KB / ${mbLabel} MB`;
}

export default {
    preflightFile,
    preflightFiles,
    formatBytes,
    getPreflightLimits,
    PREFLIGHT_LEVEL,
    MAX_IMPORT_FEATURES
};
