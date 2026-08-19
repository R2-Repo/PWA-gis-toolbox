/**
 * Shared post-import pipeline — normalize importer output, expand mixed geometry,
 * apply fence/style prep before map render. Used by main import, workflow, dual-screen.
 */
import logger from '../core/logger.js';
import { analyzeSchema, splitByGeometryType, isSpatialLayer } from '../core/data-model.js';
import { processInChunks } from '../core/task-runner.js';
import { isSmartStyleActive } from '../map/style-engine.js';
import { getLayerDefaultColor } from '../map/layer-palette.js';
import { detectEmbeddedSimpleStyle, convertLayerSimpleStyleToSmart } from '../map/style-import.js';
import { resolveUdotFiberStyleForDataset } from '../symbology/udot-fiber/resolve-style.js';
import {
    filterFeaturesByImportFilters,
    hasActiveFeatureFilter
} from './import-feature-filter.js';
import { featureIntersectsImportFence } from './import-fence.js';

/**
 * @param {object|object[]|null|undefined} result
 * @returns {object[]}
 */
export function normalizeImporterResult(result) {
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
}

/**
 * @param {object[]} datasets
 * @returns {object[]}
 */
export function expandMixedGeometryDatasets(datasets) {
    const expanded = [];
    for (const ds of datasets) {
        if (ds.type === 'spatial' && ds.schema?.geometryType === 'Mixed') {
            expanded.push(...splitByGeometryType(ds));
        } else {
            expanded.push(ds);
        }
    }
    return expanded;
}

export const FENCE_CHUNK_SIZE = 200;
export const FENCE_CHUNK_THRESHOLD = 500;

/**
 * @param {object} dataset
 * @param {[number, number, number, number]|null} bbox [west, south, east, north]
 * @param {import('../core/task-runner.js').TaskRunner|null} [task]
 */
export async function filterDatasetByFenceAsync(dataset, bbox, task = null) {
    if (!bbox || dataset.type !== 'spatial' || !dataset.geojson?.features?.length) return dataset;

    const features = dataset.geojson.features;
    const before = features.length;

    const testFeature = (f) => featureIntersectsImportFence(f, bbox);

    let kept;
    if (!task || features.length < FENCE_CHUNK_THRESHOLD) {
        kept = features.filter(testFeature);
    } else {
        const flags = await processInChunks(
            features,
            FENCE_CHUNK_SIZE,
            (f) => testFeature(f),
            task
        );
        kept = features.filter((_, i) => flags[i]);
    }

    dataset.geojson.features = kept;
    const after = kept.length;

    if (before !== after) {
        logger.info('ImportFence', `Filtered ${before} → ${after} features (${before - after} outside fence)`);
        dataset.schema = analyzeSchema(dataset.geojson);
    }

    return dataset;
}

/**
 * @param {object} dataset
 * @param {[number, number, number, number]|null} bbox [west, south, east, north]
 */
export function filterDatasetByFence(dataset, bbox) {
    if (!bbox || dataset.type !== 'spatial' || !dataset.geojson?.features?.length) return dataset;

    const before = dataset.geojson.features.length;
    dataset.geojson.features = dataset.geojson.features.filter((f) => (
        featureIntersectsImportFence(f, bbox)
    ));
    const after = dataset.geojson.features.length;

    if (before !== after) {
        logger.info('ImportFence', `Filtered ${before} → ${after} features (${before - after} outside fence)`);
        dataset.schema = analyzeSchema(dataset.geojson);
    }

    return dataset;
}

/**
 * Revoke blob: URLs created during KMZ asset rewriting.
 * @param {object} dataset
 */
export function revokeKmzBlobUrls(dataset) {
    const urls = dataset?._blobUrls;
    if (!Array.isArray(urls)) return;
    for (const url of urls) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* ignore */
        }
    }
    delete dataset._blobUrls;
}

/**
 * Copy import-time metadata from a full dataset onto a target (e.g. workflow cache).
 * @param {object} source
 * @returns {object}
 */
export function extractImportMetadata(source) {
    const meta = {};
    if (source._kmlStyle) meta._kmlStyle = { ...source._kmlStyle };
    if (source._arcgisStyle) meta._arcgisStyle = source._arcgisStyle;
    if (source._importWarning) meta._importWarning = source._importWarning;
    if (source._networkLinkHrefs?.length) meta._networkLinkHrefs = [...source._networkLinkHrefs];
    if (source._blobUrls?.length) meta._blobUrls = [...source._blobUrls];
    return meta;
}

/**
 * @param {object} target
 * @param {object} meta
 */
export function applyImportMetadata(target, meta) {
    if (!meta) return target;
    if (meta._kmlStyle) target._kmlStyle = meta._kmlStyle;
    if (meta._arcgisStyle) target._arcgisStyle = meta._arcgisStyle;
    if (meta._importWarning) target._importWarning = meta._importWarning;
    if (meta._networkLinkHrefs) target._networkLinkHrefs = meta._networkLinkHrefs;
    if (meta._blobUrls) target._blobUrls = meta._blobUrls;
    return target;
}

/**
 * Build a workflow-safe cache object from an imported dataset.
 * @param {object} dataset
 */
export function serializeImportedDataset(dataset) {
    if (dataset.type === 'spatial') {
        return {
            type: 'spatial',
            geojson: dataset.geojson,
            schema: dataset.schema,
            name: dataset.name,
            ...extractImportMetadata(dataset)
        };
    }
    return {
        type: 'table',
        rows: dataset.rows,
        schema: dataset.schema,
        name: dataset.name
    };
}

/**
 * Apply KML uniform style, then ArcGIS drawingInfo, then smart categorical style
 * when per-feature SimpleStyle colors vary. Call after the layer is in app state
 * (restyleLayer re-renders if the map layer already exists).
 *
 * @param {object} ds spatial dataset
 * @param {{ mapService: object, getLayers: () => object[], layerIndex?: number }} options
 */
export function applyImportLayerStyles(ds, options) {
    const { mapService, getLayers, layerIndex } = options;
    if (!isSpatialLayer(ds)) return ds;

    if (ds._kmlStyle && !mapService.getLayerStyle(ds.id)) {
        mapService.setLayerStyle(ds.id, { ...ds._kmlStyle });
    }

    // UDOT Fiber Network MapServer — apply shared ArcGIS/Bentley style pack
    const udotStyle = resolveUdotFiberStyleForDataset(ds);
    if (udotStyle && !isSmartStyleActive(mapService.getLayerStyle(ds.id))) {
        if (udotStyle.labels?.enabled) {
            ds._mapLabels = {
                field: udotStyle.labels.field,
                placement: udotStyle.labels.placement,
                minZoom: udotStyle.labels.minZoom,
                maxZoom: udotStyle.labels.maxZoom,
                size: udotStyle.labels.size,
                color: udotStyle.labels.color,
                haloColor: udotStyle.labels.haloColor,
                haloWidth: udotStyle.labels.haloWidth
            };
        }
        mapService.restyleLayer(ds.id, ds, udotStyle);
        return ds;
    }

    if (ds._arcgisStyle && !isSmartStyleActive(mapService.getLayerStyle(ds.id))) {
        const arcgisStyle = ds._arcgisStyle;
        if (arcgisStyle.labels?.enabled) {
            ds._mapLabels = {
                field: arcgisStyle.labels.field,
                placement: arcgisStyle.labels.placement,
                minZoom: arcgisStyle.labels.minZoom,
                maxZoom: arcgisStyle.labels.maxZoom,
                size: arcgisStyle.labels.size,
                color: arcgisStyle.labels.color,
                haloColor: arcgisStyle.labels.haloColor,
                haloWidth: arcgisStyle.labels.haloWidth
            };
        }
        mapService.restyleLayer(ds.id, ds, arcgisStyle);
        return ds;
    }

    if (ds.geojson?.features?.length) {
        const detection = detectEmbeddedSimpleStyle(ds.geojson.features);
        if (detection?.hasSimpleStyle && detection.varyingProperty) {
            const existing = mapService.getLayerStyle(ds.id);
            if (!isSmartStyleActive(existing)) {
                const idx = layerIndex ?? getLayers().indexOf(ds);
                const defaultColor = getLayerDefaultColor(idx);
                const converted = convertLayerSimpleStyleToSmart(ds, defaultColor);
                if (converted) {
                    mapService.restyleLayer(ds.id, ds, converted);
                }
            }
        }
    }

    return ds;
}

/** @deprecated alias — use applyImportLayerStyles after map add */
export const prepareSpatialDatasetForMap = applyImportLayerStyles;

/**
 * @param {object[]} datasets
 * @param {{
 *   fenceBbox?: [number,number,number,number]|null,
 *   featureFilter?: object|null,
 *   task?: import('../core/task-runner.js').TaskRunner|null
 * }} [options]
 * @returns {Promise<{ expanded: object[], totalFiltered: number, featureFiltered: number }>}
 */
export async function finalizeImportedDatasets(datasets, options = {}) {
    const { fenceBbox, featureFilter = null, task } = options;
    const expanded = expandMixedGeometryDatasets(datasets);
    let totalFiltered = 0;
    let featureFiltered = 0;

    for (const ds of expanded) {
        task?.throwIfCancelled?.();
        if (fenceBbox && ds.type === 'spatial') {
            const before = ds.geojson?.features?.length || 0;
            if (task) {
                await filterDatasetByFenceAsync(ds, fenceBbox, task);
            } else {
                filterDatasetByFence(ds, fenceBbox);
            }
            totalFiltered += before - (ds.geojson?.features?.length || 0);
        }
        if (hasActiveFeatureFilter(featureFilter) && ds.type === 'spatial' && ds.geojson?.features?.length) {
            const before = ds.geojson.features.length;
            const { features, filtered } = filterFeaturesByImportFilters(ds.geojson.features, featureFilter);
            ds.geojson.features = features;
            featureFiltered += filtered;
            if (filtered > 0) {
                logger.info('ImportFilter', `Filtered ${before} → ${features.length} features (${filtered} excluded by pre-import filter)`);
                ds.schema = analyzeSchema(ds.geojson);
            }
        }
        if (ds.type === 'spatial') {
            ds._geometryExploded = true;
        }
    }

    return { expanded, totalFiltered, featureFiltered };
}

export default {
    normalizeImporterResult,
    expandMixedGeometryDatasets,
    filterDatasetByFence,
    filterDatasetByFenceAsync,
    revokeKmzBlobUrls,
    extractImportMetadata,
    applyImportMetadata,
    serializeImportedDataset,
    applyImportLayerStyles,
    prepareSpatialDatasetForMap,
    finalizeImportedDatasets
};
