/**
 * Single authoritative import / admission limit table.
 * All numeric gates for import admission must be defined here only.
 *
 * @see docs/IMPORT_LARGE_FILES.md
 */

/** @typedef {typeof LIMITS} ImportLimits */

export const LIMITS = Object.freeze({
    // Gate A — text preflight (bytes)
    textSoftBytes: 2 * 1024 * 1024,
    textStrongBytes: 4 * 1024 * 1024,
    textHardBytes: 6 * 1024 * 1024,
    // Gate A — binary / archive preflight (bytes)
    binarySoftBytes: 3 * 1024 * 1024,
    binaryStrongBytes: 5 * 1024 * 1024,
    binaryHardBytes: 8 * 1024 * 1024,
    // Gate A in-memory features (OPERATION)
    maxImportFeatures: 250_000,
    // Gate B stored-feature soft ceiling
    storedFeatureSoftLimit: 1_000_000,
    // Workspace routing — standard / ArcGIS path
    workspaceFeatureThreshold: 15_000,
    workspaceChunkSize: 1000,
    // Stream reader (SAFETY + tuning)
    streamMaxBytes: 2 * 1024 * 1024 * 1024,
    streamBatchFeatures: 1000,
    streamBatchMaxBytes: 8 * 1024 * 1024,
    // Standard zip inflate guard (in-memory zip path)
    maxZipUncompressedBytes: 80 * 1024 * 1024,
    // Import optimizer routing heuristics
    optimizerPeakBytes: 16 * 1024 * 1024,
    optimizerCoordinateThreshold: 500_000,
    kmlHeavyBytes: 4 * 1024 * 1024,
    // ArcGIS REST download
    arcgisMaxFeatures: 250_000,
    // Materialize / heavy-tool budgets
    materializeVertexLimit: 5_000_000,
    materializeMaxCoordsPerFeature: 500_000,
    // Live GeoJSON feed fetch (network)
    geojsonFeedMaxBytes: 32 * 1024 * 1024,
    geojsonFeedTimeoutMs: 30_000,
    // Excel parse cap before SheetJS (binary preflight hard band)
    xlsxMaxParseBytes: 8 * 1024 * 1024
});

/** Formats treated as binary for Gate A byte bands. */
export const BINARY_PREFLIGHT_FORMATS = Object.freeze(
    new Set(['zip', 'kmz', 'xlsx', 'xls'])
);

/** Formats eligible for the streaming import worker path. */
export const STREAM_ADMISSION_FORMATS = Object.freeze(
    new Set(['geojson', 'json', 'csv', 'kml', 'xml', 'kmz', 'zip'])
);

/**
 * @param {string|null|undefined} format
 * @param {ImportLimits} [limits]
 */
export function preflightByteBands(format, limits = LIMITS) {
    const binary = format != null && BINARY_PREFLIGHT_FORMATS.has(format);
    if (binary) {
        return {
            soft: limits.binarySoftBytes,
            strong: limits.binaryStrongBytes,
            hard: limits.binaryHardBytes,
            binary: true
        };
    }
    return {
        soft: limits.textSoftBytes,
        strong: limits.textStrongBytes,
        hard: limits.textHardBytes,
        binary: false
    };
}

/**
 * @param {number} sizeBytes
 * @param {string|null|undefined} format
 * @param {ImportLimits} [limits]
 * @returns {'ok'|'soft'|'reject'}
 */
export function classifyPreflightSize(sizeBytes, format, limits = LIMITS) {
    const { soft, strong, hard } = preflightByteBands(format, limits);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return 'reject';
    if (sizeBytes >= hard || sizeBytes >= strong) return 'reject';
    if (sizeBytes >= soft) return 'soft';
    return 'ok';
}

/**
 * Sum bytes and feature estimates across import files.
 * @param {Array<{ bytes?: number|null, featureEstimate?: number|null }>|undefined} files
 */
export function aggregateImportFiles(files) {
    let totalBytes = 0;
    let bytesUnknown = false;
    let totalFeatures = 0;
    let featuresUnknown = false;

    for (const f of files || []) {
        if (f.bytes == null || !Number.isFinite(f.bytes)) {
            bytesUnknown = true;
        } else {
            totalBytes += f.bytes;
        }
        if (f.featureEstimate == null || !Number.isFinite(f.featureEstimate)) {
            featuresUnknown = true;
        } else {
            totalFeatures += f.featureEstimate;
        }
    }

    return {
        totalBytes: bytesUnknown ? null : totalBytes,
        totalFeatures: featuresUnknown ? null : totalFeatures,
        bytesUnknown,
        featuresUnknown
    };
}

export default LIMITS;
