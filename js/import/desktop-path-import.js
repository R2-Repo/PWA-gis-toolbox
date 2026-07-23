/**
 * Desktop path-based import — inspect/sample via sidecar; add preview layer (not full JS ingest).
 */
import { createSpatialDataset } from '../core/data-model.js';
import { NATIVE_OPERATIONS } from '../platform/jobs/allowed-operations.js';
import { getNativeFilePath } from './import-policy.js';

const PATH_IMPORT_FORMATS = new Set(['geojson', 'json']);

/**
 * @param {string} fileName
 * @returns {string|null}
 */
function detectPathFormat(fileName) {
    const ext = String(fileName || '').toLowerCase().split('.').pop();
    if (ext === 'geojson' || ext === 'json') return ext === 'json' ? 'json' : 'geojson';
    return null;
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
    if (!format || !PATH_IMPORT_FORMATS.has(format)) {
        throw new Error(
            `"${fileName}" path preview currently supports GeoJSON only. ` +
            'Shapefile/GPKG/other formats arrive with the GDAL sidecar phase.'
        );
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
        format: 'geojson',
        nativePath: path,
        previewOnly: sampled < total,
        fullFeatureCount: total,
        importRoute: 'desktop-path'
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

export { detectPathFormat, PATH_IMPORT_FORMATS };
