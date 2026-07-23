/**
 * Desktop path-based import — inspect/sample via sidecar; add preview layer (not full JS ingest).
 */
import { createSpatialDataset } from '../core/data-model.js';
import { hasCapability } from '../platform/contracts.js';
import { getPlatformBundle } from '../platform/create-platform.js';
import { NATIVE_OPERATIONS } from '../platform/jobs/allowed-operations.js';
import { getNativeFilePath } from './import-policy.js';

/** Always allowed via stdlib sidecar path. */
const PATH_IMPORT_FORMATS_BASE = new Set(['geojson', 'json']);
/** Extra formats when pyogrio/GDAL is available in the sidecar. */
const PATH_IMPORT_FORMATS_GDAL = new Set([
    'geojson',
    'json',
    'gpkg',
    'shp',
    'parquet',
    'geoparquet',
    'kml',
    'gml',
    'fgb'
]);

/**
 * @param {import('../platform/contracts.js').PlatformInfo|null|undefined} [platform]
 * @returns {Set<string>}
 */
export function getPathImportFormats(platform) {
    const p = platform || getPlatformBundle().platform;
    return hasCapability(p, 'localGdal') ? PATH_IMPORT_FORMATS_GDAL : PATH_IMPORT_FORMATS_BASE;
}

/** @deprecated use getPathImportFormats() */
const PATH_IMPORT_FORMATS = PATH_IMPORT_FORMATS_BASE;

/**
 * @param {string} fileName
 * @returns {string|null}
 */
function detectPathFormat(fileName) {
    const ext = String(fileName || '').toLowerCase().split('.').pop();
    if (!ext) return null;
    if (ext === 'geoparquet') return 'parquet';
    return ext;
}

/**
 * @param {string} path
 * @returns {string}
 */
function baseName(path) {
    const parts = String(path).replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'layer';
}

/**
 * @param {import('../platform/contracts.js').ComputeService} compute
 * @param {string} path
 * @param {{ onProgress?: Function, signal?: AbortSignal, maxFeatures?: number }} [opts]
 * @returns {Promise<{
 *   dataset: ReturnType<typeof createSpatialDataset>,
 *   inspect: object,
 *   sample: object
 * }>}
 */
export async function importVectorPreviewByPath(compute, path, opts = {}) {
    if (!compute?.run) {
        throw new Error('Desktop path import requires compute service');
    }
    if (!path || typeof path !== 'string') {
        throw new Error('Desktop path import requires a filesystem path');
    }

    const fileName = baseName(path);
    const format = detectPathFormat(fileName);
    const allowed = getPathImportFormats();
    if (!format || !allowed.has(format)) {
        const hint = hasCapability(getPlatformBundle().platform, 'localGdal')
            ? 'Unsupported format for path import.'
            : 'Path preview supports GeoJSON by default. Install sidecar GIS deps (pyogrio) for GPKG/Shapefile/Parquet.';
        throw new Error(`"${fileName}" cannot use desktop path import. ${hint}`);
    }

    const maxFeatures = Number.isFinite(opts.maxFeatures) ? opts.maxFeatures : 500;

    const inspect = await compute.run(
        NATIVE_OPERATIONS.INSPECT_VECTOR,
        { path },
        { onProgress: opts.onProgress, signal: opts.signal }
    );

    const sample = await compute.run(
        NATIVE_OPERATIONS.SAMPLE_VECTOR,
        { path, maxFeatures },
        { onProgress: opts.onProgress, signal: opts.signal }
    );

    const geojson = sample?.geojson;
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        throw new Error('Sidecar sample_vector did not return a FeatureCollection');
    }

    const total = Number(inspect?.featureCount ?? sample?.featureCount ?? geojson.features.length);
    const sampled = geojson.features.length;
    const name = sampled < total
        ? `${fileName} (preview ${sampled.toLocaleString()} of ${total.toLocaleString()})`
        : fileName;

    const dataset = createSpatialDataset(name, geojson, {
        file: fileName,
        format: inspect?.format || format || 'geojson',
        nativePath: path,
        previewOnly: sampled < total,
        fullFeatureCount: total,
        importRoute: 'desktop-path',
        engine: sample?.engine || inspect?.engine
    });

    return { dataset, inspect, sample };
}

/**
 * @param {File} file
 * @param {import('../platform/contracts.js').ComputeService} compute
 * @param {{ onProgress?: Function, signal?: AbortSignal }} [opts]
 */
export async function importVectorPreviewFromFile(file, compute, opts = {}) {
    const path = getNativeFilePath(file);
    if (!path) {
        throw new Error(
            `"${file?.name || 'File'}" is too large for in-memory import and has no filesystem path. ` +
            'Drag from Explorer or use a native Open dialog so the desktop app can read it from disk.'
        );
    }
    return importVectorPreviewByPath(compute, path, opts);
}

export { detectPathFormat, PATH_IMPORT_FORMATS, PATH_IMPORT_FORMATS_BASE, PATH_IMPORT_FORMATS_GDAL };
