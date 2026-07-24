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
 * Absolute path suitable for sidecar analysis (full file on disk).
 * Prefer library working copies, then originals / path-import nativePath.
 *
 * @param {object} layer
 * @returns {string|null}
 */
export function resolveLayerNativePath(layer) {
    // Selection subsets must stay in-memory — analysisPath points at the full file.
    if (layer?._isSelection) return null;
    return (
        layer?.source?.analysisPath
        || layer?.source?.workingPath
        || layer?.source?.managedOriginalPath
        || layer?.source?.libraryWorkingPath
        || layer?.source?.originalPath
        || layer?.source?.nativePath
        || layer?.source?.nativeOutputPath
        || layer?.pmtiles?.path
        || null
    );
}

/**
 * Feature count for provider selection — prefer full catalog count over preview FC length.
 *
 * @param {object} layer
 * @returns {number}
 */
export function getLayerAnalysisFeatureCount(layer) {
    const full = Number(
        layer?.source?.fullFeatureCount
        ?? layer?.schema?.featureCount
        ?? layer?.pmtiles?.featureCount
    );
    if (Number.isFinite(full) && full > 0) return full;
    return layer?.geojson?.features?.length || 0;
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
    // Any disk-backed layer uses Python — ignore tiny preview feature counts.
    if (nativePath) return 'python';
    if (featureCount >= NATIVE_ANALYSIS_MIN_FEATURES) return 'python';
    return 'javascript';
}

/**
 * Attach desktop workstation paths onto a layer source (mutates + returns source).
 *
 * @param {object} layer
 * @param {{
 *   analysisPath?: string|null,
 *   workingPath?: string|null,
 *   managedOriginalPath?: string|null,
 *   originalPath?: string|null,
 *   nativePath?: string|null,
 *   libraryItemId?: string|null,
 *   fullFeatureCount?: number|null,
 *   tilePath?: string|null,
 *   displayMode?: 'pmtiles'|'geojson-preview'|'cog'
 * }} paths
 */
export function attachDesktopLayerPaths(layer, paths = {}) {
    if (!layer) return null;
    const analysisPath = paths.analysisPath
        || paths.workingPath
        || paths.managedOriginalPath
        || paths.originalPath
        || paths.nativePath
        || resolveLayerNativePath(layer);
    layer.source = {
        ...(layer.source || {}),
        ...(paths.workingPath ? { workingPath: paths.workingPath } : {}),
        ...(paths.managedOriginalPath ? { managedOriginalPath: paths.managedOriginalPath } : {}),
        ...(paths.originalPath ? { originalPath: paths.originalPath } : {}),
        ...(paths.nativePath ? { nativePath: paths.nativePath } : {}),
        ...(paths.libraryItemId ? { libraryItemId: paths.libraryItemId } : {}),
        ...(paths.fullFeatureCount != null ? { fullFeatureCount: paths.fullFeatureCount } : {}),
        ...(paths.tilePath ? { tilePath: paths.tilePath } : {}),
        ...(paths.displayMode ? { displayMode: paths.displayMode } : {}),
        analysisPath: analysisPath || layer.source?.analysisPath || null
    };
    return layer.source;
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

/**
 * Native spatial_join via sidecar.
 *
 * @param {object} leftLayer
 * @param {object} rightLayer
 * @param {{ predicate?: string }} [config]
 * @param {{ onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
export async function spatialJoinLayersNative(leftLayer, rightLayer, config = {}, opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Native spatial join requires the Windows Python sidecar');
    }

    let leftPath = resolveLayerNativePath(leftLayer);
    let rightPath = resolveLayerNativePath(rightLayer);
    const temps = [];

    try {
        if (!leftPath) {
            if (!leftLayer?.geojson) throw new Error('Left layer has no geometry');
            leftPath = await services.files.writeTempGeoJson(JSON.stringify(leftLayer.geojson));
            temps.push(leftPath);
        }
        if (!rightPath) {
            if (!rightLayer?.geojson) throw new Error('Right layer has no geometry');
            rightPath = await services.files.writeTempGeoJson(JSON.stringify(rightLayer.geojson));
            temps.push(rightPath);
        }

        const result = await services.compute.run(
            NATIVE_OPERATIONS.SPATIAL_JOIN,
            {
                path: leftPath,
                rightPath,
                predicate: config.predicate || 'intersects'
            },
            { onProgress: opts.onProgress, signal: opts.signal }
        );

        if (opts.registerLibrary !== false && isGisLibraryAvailable() && result?.outputPath) {
            try {
                const parents = [leftLayer.source?.libraryItemId, rightLayer.source?.libraryItemId]
                    .filter(Boolean);
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: `${leftLayer.name || 'layer'}_spatial_join`,
                    derivedOp: 'spatial_join',
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
 * Native reproject_vector via sidecar.
 *
 * @param {object} layer
 * @param {{ fromCrs?: string, toCrs?: string, name?: string }} [config]
 * @param {{ onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
export async function reprojectLayerNative(layer, config = {}, opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Native reproject requires the Windows Python sidecar');
    }

    let path = resolveLayerNativePath(layer);
    let tempPath = null;
    if (!path) {
        if (!layer?.geojson) throw new Error('Layer has no geometry to reproject');
        path = await services.files.writeTempGeoJson(JSON.stringify(layer.geojson));
        tempPath = path;
    }

    try {
        const result = await services.compute.run(
            NATIVE_OPERATIONS.REPROJECT_VECTOR,
            {
                path,
                sourceCrs: config.fromCrs || undefined,
                targetCrs: config.toCrs || 'EPSG:4326'
            },
            { onProgress: opts.onProgress, signal: opts.signal }
        );
        if (opts.registerLibrary !== false && isGisLibraryAvailable() && result?.outputPath) {
            try {
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: config.name || `${layer.name || 'layer'}_reproject`,
                    derivedOp: 'reproject_vector',
                    parentIds: layer.source?.libraryItemId ? [layer.source.libraryItemId] : [],
                    previewGeojson: result.previewGeojson || result.geojson,
                    featureCount: result.featureCount,
                    geometryTypes: result.geometryTypes
                });
            } catch {
                /* non-fatal */
            }
        }
        const fc = result?.geojson?.features?.length
            ? result.geojson
            : result?.previewGeojson;
        if (fc?.type === 'FeatureCollection') {
            return createSpatialDataset(
                config.name || `${layer.name || 'layer'}_reproject`,
                fc,
                {
                    format: 'derived',
                    importRoute: 'desktop-analysis',
                    nativeOutputPath: result?.outputPath,
                    fullFeatureCount: result?.featureCount,
                    crs: config.toCrs || 'EPSG:4326',
                    libraryItemId: layer.source?.libraryItemId
                }
            );
        }
        return datasetFromAnalysisResult(
            result,
            config.name || `${layer.name || 'layer'}_reproject`,
            { libraryItemId: layer.source?.libraryItemId, crs: config.toCrs || 'EPSG:4326' }
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
 * @param {object} layer
 * @param {string} operation
 * @param {object} input
 * @param {string} derivedOp
 * @param {string} nameSuffix
 * @param {{ onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
async function runSimpleNativeVectorOp(layer, operation, input, derivedOp, nameSuffix, opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error(`Native ${derivedOp} requires the Windows Python sidecar`);
    }

    let path = resolveLayerNativePath(layer);
    let tempPath = null;
    if (!path) {
        if (!layer?.geojson) throw new Error(`Layer has no geometry for ${derivedOp}`);
        path = await services.files.writeTempGeoJson(JSON.stringify(layer.geojson));
        tempPath = path;
    }

    try {
        const result = await services.compute.run(
            operation,
            { path, ...input },
            { onProgress: opts.onProgress, signal: opts.signal }
        );
        if (opts.registerLibrary !== false && isGisLibraryAvailable() && result?.outputPath) {
            try {
                await registerDerivedLibraryItem({
                    outputPath: result.outputPath,
                    displayName: `${layer.name || 'layer'}_${nameSuffix}`,
                    derivedOp,
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
            `${layer.name || 'layer'}_${nameSuffix}`,
            { libraryItemId: layer.source?.libraryItemId, analysisPath: result?.outputPath }
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

/** @param {object} layer @param {number} [tolerance] @param {object} [opts] */
export async function simplifyLayerNative(layer, tolerance = 0.001, opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.SIMPLIFY_VECTOR,
        { tolerance },
        'simplify_vector',
        'simplified',
        opts
    );
}

/** @param {object} layer @param {string} [field] @param {object} [opts] */
export async function dissolveLayerNative(layer, field, opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.DISSOLVE_VECTOR,
        { field: field || undefined },
        'dissolve_vector',
        'dissolved',
        opts
    );
}

/** @param {object} layer @param {object} [opts] */
export async function unionLayerNative(layer, opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.UNION_VECTOR,
        {},
        'union_vector',
        'union',
        opts
    );
}

/** @param {object} layer @param {object} [opts] */
export async function explodeLayerNative(layer, opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.EXPLODE_VECTOR,
        {},
        'explode_vector',
        'exploded',
        opts
    );
}

/** @param {object} layer @param {number} count @param {object} [opts] */
export async function sampleLayerNative(layer, count, opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.SAMPLE_FEATURES,
        { count },
        'sample_features',
        `sample_${count}`,
        opts
    );
}

/**
 * Path-based attribute filter → derived layer.
 * @param {object} layer
 * @param {object[]} rules
 * @param {string} [logic]
 * @param {object} [opts]
 */
export async function filterAttributesLayerNative(layer, rules, logic = 'AND', opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.FILTER_ATTRIBUTES,
        { rules, logic },
        'filter_attributes',
        'filtered',
        opts
    );
}

/**
 * Path-based bulk attribute update → derived layer (full file).
 * @param {object} layer
 * @param {Record<string, unknown>} updates
 * @param {{ whereField?: string, whereValue?: unknown, onProgress?: Function, signal?: AbortSignal, registerLibrary?: boolean }} [opts]
 */
export async function updateAttributesLayerNative(layer, updates, opts = {}) {
    return runSimpleNativeVectorOp(
        layer,
        NATIVE_OPERATIONS.UPDATE_ATTRIBUTES,
        {
            updates,
            whereField: opts.whereField,
            whereValue: opts.whereValue
        },
        'update_attributes',
        'updated',
        opts
    );
}

/**
 * Save edited viewport/selection GeoJSON back to library (GPKG / Parquet / GeoJSON).
 *
 * @param {object} layer - layer with current (possibly edited) geojson
 * @param {{ format?: 'geojson'|'gpkg'|'parquet', displayName?: string, onProgress?: Function, signal?: AbortSignal }} [opts]
 */
export async function saveLayerEditsNative(layer, opts = {}) {
    const { platform, services } = getPlatformBundle();
    if (!hasCapability(platform, 'pythonCompute') || !services.compute?.run) {
        throw new Error('Save to library requires the Windows Python sidecar');
    }
    if (!layer?.geojson?.features?.length) {
        throw new Error('No features to save');
    }

    const format = opts.format || 'gpkg';
    const tempPath = await services.files.writeTempGeoJson(JSON.stringify(layer.geojson));
    try {
        const result = await services.compute.run(
            NATIVE_OPERATIONS.SAVE_VECTOR,
            { path: tempPath, format },
            { onProgress: opts.onProgress, signal: opts.signal }
        );
        if (isGisLibraryAvailable() && result?.outputPath) {
            await registerDerivedLibraryItem({
                outputPath: result.outputPath,
                displayName: opts.displayName || `${layer.name || 'layer'}_edits`,
                derivedOp: 'save_vector',
                parentIds: layer.source?.libraryItemId ? [layer.source.libraryItemId] : [],
                previewGeojson: result.previewGeojson,
                featureCount: result.featureCount || result.savedFeatureCount || layer.geojson.features.length,
                geometryTypes: result.geometryTypes
            });
        }
        if (layer.source) {
            layer.source.dirty = false;
            layer.source.editsSavedAt = new Date().toISOString();
        }
        return result;
    } finally {
        try {
            await services.files.removeTempFile(tempPath);
        } catch {
            /* best-effort */
        }
    }
}

/**
 * Mark a desktop layer dirty after in-memory edits (viewport/selection).
 * @param {object} layer
 */
export function markLayerEditsDirty(layer) {
    if (!layer) return;
    layer.source = { ...(layer.source || {}), dirty: true };
}
