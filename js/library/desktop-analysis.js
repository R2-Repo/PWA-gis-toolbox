/**
 * Desktop path-based analysis helpers (shared JS — no Tauri imports).
 * Used by dual-path widgets/tools when pythonCompute is available.
 */
import { getPlatformBundle } from '../platform/create-platform.js';
import { hasCapability } from '../platform/contracts.js';
import { NATIVE_OPERATIONS } from '../platform/jobs/allowed-operations.js';
import { createSpatialDataset } from '../core/data-model.js';
import { ingestGisLibraryItem, isGisLibraryAvailable } from './gis-library.js';

/** Prefer native sidecar above this in-memory feature count. */
export const NATIVE_ANALYSIS_MIN_FEATURES = 5000;

/**
 * @param {object} layer
 * @returns {string|null} absolute path suitable for sidecar ops
 */
export function resolveLayerNativePath(layer) {
    return (
        layer?.source?.workingPath
        || layer?.source?.managedOriginalPath
        || layer?.source?.libraryWorkingPath
        || layer?.source?.originalPath
        || layer?.pmtiles?.path
        || null
    );
}

/**
 * @param {number} featureCount
 * @param {boolean} pythonAvailable
 * @param {string|null} nativePath
 * @param {boolean} [preferNative=true]
 * @returns {'javascript'|'python'}
 */
export function chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, preferNative = true) {
    if (!pythonAvailable || !preferNative) return 'javascript';
    if (nativePath) return 'python';
    if (featureCount >= NATIVE_ANALYSIS_MIN_FEATURES) return 'python';
    return 'javascript';
}

/**
 * Register a sidecar analysis output as a Local GIS Library derived item (desktop).
 *
 * @param {object} opts
 * @param {string} opts.outputPath
 * @param {string} opts.displayName
 * @param {string} opts.derivedOp
 * @param {string[]} [opts.parentIds]
 * @param {object} [opts.previewGeojson]
 * @param {number} [opts.featureCount]
 * @param {object} [opts.geometryTypes]
 * @returns {Promise<object|null>}
 */
export async function registerDerivedLibraryItem(opts) {
    if (!isGisLibraryAvailable()) return null;
    const preview = opts.previewGeojson
        ? JSON.stringify(opts.previewGeojson)
        : undefined;
    return ingestGisLibraryItem({
        sourcePath: opts.outputPath,
        displayName: opts.displayName,
        format: 'geojson',
        featureCount: opts.featureCount,
        sampledFeatureCount: opts.previewGeojson?.features?.length,
        geometryTypes: opts.geometryTypes,
        previewOnly: false,
        previewGeojson: preview,
        mode: 'copy',
        description: `Derived via ${opts.derivedOp}`,
        parentIds: opts.parentIds || [],
        derivedOp: opts.derivedOp,
        restorable: true
    });
}

/**
 * @param {object} result - sidecar op result with previewGeojson / featureCount
 * @param {string} name
 * @param {object} [sourceExtra]
 */
export function datasetFromAnalysisResult(result, name, sourceExtra = {}) {
    const fc = result?.previewGeojson?.type === 'FeatureCollection'
        ? result.previewGeojson
        : { type: 'FeatureCollection', features: result?.previewGeojson?.features || [] };
    return createSpatialDataset(name, fc, {
        format: 'derived',
        importRoute: 'desktop-analysis',
        nativeOutputPath: result?.outputPath,
        fullFeatureCount: result?.featureCount,
        ...sourceExtra
    });
}

/**
 * Run buffer_vector via sidecar. Materializes layer to temp GeoJSON when no native path.
 *
 * @param {object} layer
 * @param {number} distance
 * @param {string} units
 * @param {{ onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
export async function bufferLayerNative(layer, distance, units = 'meters', opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Native buffer requires the Windows Python sidecar');
    }

    let path = resolveLayerNativePath(layer);
    let tempPath = null;
    if (!path) {
        if (!layer?.geojson) throw new Error('Layer has no geometry to buffer');
        path = await services.files.writeTempGeoJson(JSON.stringify(layer.geojson));
        tempPath = path;
    }

    try {
        const result = await services.compute.run(
            NATIVE_OPERATIONS.BUFFER_VECTOR,
            { path, distance, units },
            { onProgress: opts.onProgress, signal: opts.signal }
        );
        if (opts.registerLibrary !== false && isGisLibraryAvailable()) {
            try {
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: `${layer.name || 'layer'}_buffer`,
                    derivedOp: 'buffer_vector',
                    parentIds: layer.source?.libraryItemId ? [layer.source.libraryItemId] : [],
                    previewGeojson: result.previewGeojson,
                    featureCount: result.featureCount,
                    geometryTypes: result.geometryTypes
                });
            } catch {
                /* non-fatal */
            }
        }
        return datasetFromAnalysisResult(
            result,
            `${layer.name || 'layer'}_buffer_${distance}${units}`,
            { libraryItemId: layer.source?.libraryItemId }
        );
    } finally {
        if (tempPath) {
            try {
                await services.files.removeTempFile(tempPath);
            } catch {
                /* best-effort */
            }
        }
    }
}

/**
 * Run clip_vector via sidecar (clip layer written to a temp GeoJSON path).
 *
 * @param {object} layer
 * @param {object} clipGeometry - GeoJSON geometry or Feature
 * @param {{ onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
export async function clipLayerNative(layer, clipGeometry, opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Native clip requires the Windows Python sidecar');
    }

    let path = resolveLayerNativePath(layer);
    let tempPath = null;
    let clipTemp = null;
    if (!path) {
        if (!layer?.geojson) throw new Error('Layer has no geometry to clip');
        path = await services.files.writeTempGeoJson(JSON.stringify(layer.geojson));
        tempPath = path;
    }

    const clipFeature = clipGeometry?.type === 'Feature'
        ? clipGeometry
        : { type: 'Feature', properties: {}, geometry: clipGeometry };
    const clipFc = { type: 'FeatureCollection', features: [clipFeature] };

    try {
        clipTemp = await services.files.writeTempGeoJson(JSON.stringify(clipFc));
        const result = await services.compute.run(
            NATIVE_OPERATIONS.CLIP_VECTOR,
            { path, clipPath: clipTemp },
            { onProgress: opts.onProgress, signal: opts.signal }
        );
        if (opts.registerLibrary !== false && isGisLibraryAvailable()) {
            try {
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: `${layer.name || 'layer'}_clip`,
                    derivedOp: 'clip_vector',
                    parentIds: layer.source?.libraryItemId ? [layer.source.libraryItemId] : [],
                    previewGeojson: result.previewGeojson,
                    featureCount: result.featureCount,
                    geometryTypes: result.geometryTypes
                });
            } catch {
                /* non-fatal */
            }
        }
        return datasetFromAnalysisResult(
            result,
            `${layer.name || 'layer'}_clipped`,
            { libraryItemId: layer.source?.libraryItemId }
        );
    } finally {
        for (const p of [tempPath, clipTemp]) {
            if (!p) continue;
            try {
                await services.files.removeTempFile(p);
            } catch {
                /* best-effort */
            }
        }
    }
}

/**
 * Native nearest-neighbor attribute join (Proximity Join dual-path).
 *
 * @param {object} sourceLayer
 * @param {object} targetLayer
 * @param {object} config
 * @param {{ onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
export async function nearestJoinLayersNative(sourceLayer, targetLayer, config = {}, opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Native proximity join requires the Windows Python sidecar');
    }

    let leftPath = resolveLayerNativePath(sourceLayer);
    let rightPath = resolveLayerNativePath(targetLayer);
    const temps = [];

    try {
        if (!leftPath) {
            if (!sourceLayer?.geojson) throw new Error('Source layer has no geometry');
            leftPath = await services.files.writeTempGeoJson(JSON.stringify(sourceLayer.geojson));
            temps.push(leftPath);
        }
        if (!rightPath) {
            if (!targetLayer?.geojson) throw new Error('Target layer has no geometry');
            rightPath = await services.files.writeTempGeoJson(JSON.stringify(targetLayer.geojson));
            temps.push(rightPath);
        }

        const result = await services.compute.run(
            NATIVE_OPERATIONS.NEAREST_JOIN,
            {
                path: leftPath,
                rightPath,
                fieldMappings: config.fieldMappings || [],
                maxRadius: config.maxRadius === '' || config.maxRadius == null
                    ? undefined
                    : config.maxRadius,
                units: config.units || 'meters',
                writeDistance: config.writeDistance !== false,
                writeMatchId: Boolean(config.writeMatchId),
                matchIdField: config.matchIdField || '',
                writeMatchLayer: Boolean(config.writeMatchLayer),
                targetLayerName: targetLayer.name || ''
            },
            { onProgress: opts.onProgress, signal: opts.signal }
        );

        if (opts.registerLibrary !== false && isGisLibraryAvailable() && result?.outputPath) {
            try {
                const parents = [sourceLayer.source?.libraryItemId, targetLayer.source?.libraryItemId]
                    .filter(Boolean);
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: `${sourceLayer.name || 'layer'}_nearest_join`,
                    derivedOp: 'nearest_join',
                    parentIds: parents,
                    previewGeojson: result.previewGeojson || result.geojson,
                    featureCount: result.featureCount,
                    geometryTypes: result.geometryTypes
                });
            } catch {
                /* non-fatal */
            }
        }
        return result;
    } finally {
        for (const p of temps) {
            try {
                await services.files.removeTempFile(p);
            } catch {
                /* best-effort */
            }
        }
    }
}

/**
 * Native spatial filter for Find Features in Area.
 *
 * @param {object} layer
 * @param {object} analysisArea - GeoJSON Feature or geometry
 * @param {string} relation
 * @param {{ onProgress?: Function, signal?: AbortSignal }} [opts]
 */
export async function spatialFilterLayerNative(layer, analysisArea, relation = 'intersects', opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Native spatial filter requires the Windows Python sidecar');
    }

    let path = resolveLayerNativePath(layer);
    let tempPath = null;
    if (!path) {
        if (!layer?.geojson) throw new Error('Layer has no geometry');
        path = await services.files.writeTempGeoJson(JSON.stringify(layer.geojson));
        tempPath = path;
    }

    const areaFeature = analysisArea?.type === 'Feature'
        ? analysisArea
        : { type: 'Feature', properties: {}, geometry: analysisArea };

    try {
        const result = await services.compute.run(
            NATIVE_OPERATIONS.SPATIAL_FILTER,
            {
                path,
                relation,
                areaGeojson: areaFeature
            },
            { onProgress: opts.onProgress, signal: opts.signal }
        );
        if (opts.registerLibrary !== false && isGisLibraryAvailable() && result?.outputPath) {
            try {
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: `${layer.name || 'layer'}_spatial_filter`,
                    derivedOp: 'spatial_filter',
                    parentIds: layer.source?.libraryItemId ? [layer.source.libraryItemId] : [],
                    previewGeojson: result.previewGeojson,
                    featureCount: result.featureCount,
                    geometryTypes: result.geometryTypes
                });
            } catch {
                /* non-fatal */
            }
        }
        return result;
    } finally {
        if (tempPath) {
            try {
                await services.files.removeTempFile(tempPath);
            } catch {
                /* best-effort */
            }
        }
    }
}
