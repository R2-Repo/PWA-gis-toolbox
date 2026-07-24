/**
 * Canonical data model + schema metadata
 * All importers normalize into these forms
 */
import { processInChunks } from './task-runner.js';
import { DEFAULT_SCALE_RANGE } from '../map/scale-range.js';

/** Feature count above which explode uses chunked async processing when a task is provided. */
export const EXPLODE_CHUNK_THRESHOLD = 100;
export const EXPLODE_CHUNK_SIZE = 50;

/** Schema analysis sampling — avoids retaining every property value in memory. */
export const SCHEMA_SAMPLE_VALUES = 100;
export const SCHEMA_UI_SAMPLES = 5;
export const SCHEMA_ASYNC_THRESHOLD = 500;
export const SCHEMA_CHUNK_SIZE = 200;

const UNIQUE_CAP = 10000;

/**
 * @typedef {Object} FieldMeta
 * @property {string} name
 * @property {string} type - 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'null'
 * @property {number} nullCount
 * @property {number} uniqueCount
 * @property {any[]} sampleValues
 * @property {number|null} min
 * @property {number|null} max
 * @property {boolean} selected - for export field selection
 * @property {string} outputName - for rename
 * @property {number} order
 */

/**
 * @typedef {Object} LayerSchema
 * @property {FieldMeta[]} fields
 * @property {string|null} geometryType - 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon' | 'GeometryCollection' | null
 * @property {number} featureCount
 * @property {string} crs - default 'EPSG:4326'
 */

/**
 * Create a canonical spatial dataset
 * @param {string} name
 * @param {object} geojson
 * @param {object} [source]
 * @param {{ crs?: string, crsWkt?: string }} [schemaOpts]
 */
export function createSpatialDataset(name, geojson, source = {}, schemaOpts = {}) {
    const schema = analyzeSchema(geojson, schemaOpts);
    return {
        id: generateId(),
        name,
        type: 'spatial',
        geojson, // FeatureCollection
        schema,
        source: { file: source.file || name, format: source.format || 'unknown', ...source },
        visible: true,
        active: true,
        created: new Date().toISOString(),
        ...DEFAULT_SCALE_RANGE
    };
}

/**
 * Lightweight layer handle for IndexedDB workspace-backed spatial data.
 * @param {string} name
 * @param {object} meta - { id, schema, source, featureCount }
 */
export function createChunkedSpatialDataset(name, meta, source = {}) {
    return {
        id: meta.id || generateId(),
        name,
        type: 'spatial-chunked',
        storage: 'workspace',
        workspaceLayerId: meta.id || meta.workspaceLayerId,
        geojson: { type: 'FeatureCollection', features: [] },
        schema: meta.schema,
        source: { file: source.file || name, format: source.format || 'unknown', ...source },
        visible: true,
        active: true,
        created: new Date().toISOString(),
        _viewportCache: true,
        ...DEFAULT_SCALE_RANGE
    };
}

/** @param {object} layer */
export function isWorkspaceLayer(layer) {
    return layer?.storage === 'workspace' || layer?.type === 'spatial-chunked';
}

/** @param {object} layer */
export function isSpatialLayer(layer) {
    return layer?.type === 'spatial' || isWorkspaceLayer(layer) || isPmTilesLayer(layer);
}

/**
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.url
 * @param {string} options.kind
 * @param {number} [options.refreshMs]
 * @param {number} [options.opacity]
 * @param {string} [options.attribution]
 * @param {string} [options.presetId]
 * @param {object} [options.style]
 */
export function createServiceLayer({
    name,
    url,
    kind,
    refreshMs = 300000,
    opacity = 1,
    attribution = '',
    presetId = null,
    style = null
}) {
    return {
        id: generateId(),
        name,
        type: 'service',
        visible: true,
        active: true,
        created: new Date().toISOString(),
        geojson: { type: 'FeatureCollection', features: [] },
        service: {
            presetId,
            kind,
            url: String(url || '').trim().replace(/\/+$/, '').split('?')[0],
            refreshMs,
            opacity,
            attribution,
            ...(style ? { style } : {})
        },
        source: {
            format: 'live-service',
            presetId,
            url: String(url || '').trim().replace(/\/+$/, '').split('?')[0]
        }
    };
}

/** @param {object} layer */
export function isServiceLayer(layer) {
    return layer?.type === 'service';
}

/**
 * Local PMTiles vector layer (desktop GIS Library). Empty geojson; map uses vector tiles.
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.tilePath - absolute path under gis-library
 * @param {string} [options.libraryItemId]
 * @param {number[]|null} [options.bbox]
 * @param {string} [options.sourceLayer]
 * @param {number} [options.minZoom]
 * @param {number} [options.maxZoom]
 * @param {number} [options.featureCount]
 */
export function createPmTilesLayer({
    name,
    tilePath,
    libraryItemId = null,
    bbox = null,
    sourceLayer = 'default',
    minZoom = 0,
    maxZoom = 22,
    featureCount = null
}) {
    return {
        id: generateId(),
        name,
        type: 'pmtiles',
        visible: true,
        active: true,
        created: new Date().toISOString(),
        geojson: { type: 'FeatureCollection', features: [] },
        pmtiles: {
            path: String(tilePath || '').trim(),
            sourceLayer: sourceLayer || 'default',
            minZoom,
            maxZoom,
            bbox: Array.isArray(bbox) ? bbox : null,
            libraryItemId,
            featureCount
        },
        source: {
            format: 'pmtiles',
            file: name,
            libraryItemId,
            adapter: 'pmtiles',
            importRoute: 'gis-library'
        },
        ...DEFAULT_SCALE_RANGE
    };
}

/** @param {object} layer */
export function isPmTilesLayer(layer) {
    return layer?.type === 'pmtiles' || layer?.source?.format === 'pmtiles';
}

/**
 * Desktop COG / large raster layer — MapLibre image overview + disk COG path.
 * @param {object} opts
 */
export function createCogLayer({
    name,
    cogPath,
    libraryItemId = null,
    bbox = null,
    overviewDataUrl = null,
    overviewCoordinates = null,
    byteSize = null
}) {
    const coordinates = Array.isArray(overviewCoordinates) && overviewCoordinates.length === 4
        ? overviewCoordinates
        : null;
    const rasters = overviewDataUrl && coordinates
        ? [{
            dataUrl: overviewDataUrl,
            coordinates,
            bbox: Array.isArray(bbox) ? bbox : null
        }]
        : [];
    return {
        id: generateId(),
        name,
        type: 'spatial',
        visible: true,
        active: true,
        created: new Date().toISOString(),
        geojson: { type: 'FeatureCollection', features: [] },
        source: {
            format: 'cog',
            file: name,
            libraryItemId,
            adapter: 'cog',
            importRoute: 'gis-library',
            workingPath: cogPath || null,
            coverageType: 'raster',
            coverageRasters: rasters,
            readOnly: true,
            byteSize
        },
        ...DEFAULT_SCALE_RANGE
    };
}

/** @param {object} layer */
export function isCogLayer(layer) {
    return layer?.source?.format === 'cog' || layer?.source?.adapter === 'cog';
}

const LIVE_VECTOR_KINDS = new Set([
    'arcgis-featureserver',
    'arcgis-mapserver-vector',
    'geojson-feed',
    'wfs'
]);

/** Live service layers that stream vector features (viewport-scoped). */
export function isLiveVectorLayer(layer) {
    return isServiceLayer(layer) && LIVE_VECTOR_KINDS.has(layer.service?.kind);
}

/** Layers that support spatial analysis (in-memory / viewport features). */
export function isAnalyzableLayer(layer) {
    return isSpatialLayer(layer) || isLiveVectorLayer(layer);
}

/** Feature/row count for UI labels — workspace layers use schema.featureCount, not in-memory geojson length. */
export function getLayerFeatureCount(layer) {
    if (!layer) return 0;
    if (isWorkspaceLayer(layer)) {
        return layer.schema?.featureCount ?? 0;
    }
    if (isPmTilesLayer(layer)) {
        return layer.pmtiles?.featureCount ?? layer.schema?.featureCount ?? 0;
    }
    if (isLiveVectorLayer(layer)) {
        return layer.geojson?.features?.length ?? layer.schema?.featureCount ?? 0;
    }
    if (layer.type === 'spatial') {
        return layer.geojson?.features?.length ?? layer.schema?.featureCount ?? 0;
    }
    return layer.rows?.length ?? 0;
}

/**
 * Create a canonical table dataset (no geometry)
 */
export function createTableDataset(name, rows, fieldNames = null, source = {}) {
    const fields = fieldNames || (rows.length > 0 ? Object.keys(rows[0]) : []);
    const schema = analyzeTableSchema(rows, fields);
    return {
        id: generateId(),
        name,
        type: 'table',
        rows,
        schema,
        source: { file: source.file || name, format: source.format || 'unknown', ...source },
        visible: true,
        active: true,
        created: new Date().toISOString()
    };
}

/**
 * Convert a table dataset with lat/lon to a spatial dataset
 */
export function tableToSpatial(dataset, latField, lonField) {
    const features = dataset.rows.map(row => {
        const lat = parseFloat(row[latField]);
        const lon = parseFloat(row[lonField]);
        const props = { ...row };
        if (isNaN(lat) || isNaN(lon)) {
            return { type: 'Feature', geometry: null, properties: props };
        }
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: props
        };
    });
    const geojson = { type: 'FeatureCollection', features };
    return createSpatialDataset(dataset.name, geojson, dataset.source);
}

/**
 * Convert spatial dataset to table (drop geometry)
 */
export function spatialToTable(dataset) {
    const rows = dataset.geojson.features.map(f => ({ ...f.properties }));
    return createTableDataset(dataset.name, rows, null, dataset.source);
}

/**
 * Analyze GeoJSON FeatureCollection to produce schema
 * @param {object} geojson
 * @param {{ crs?: string, crsWkt?: string }} [opts]
 */
export function analyzeSchema(geojson, opts = {}) {
    const features = geojson?.features || [];
    const fieldMap = new Map();
    const geomTypes = new Set();

    for (const f of features) {
        if (f.geometry?.type) geomTypes.add(f.geometry.type);
        const props = f.properties || {};
        for (const [key, val] of Object.entries(props)) {
            if (!fieldMap.has(key)) {
                fieldMap.set(key, _newFieldAccumulator());
            }
            _accumulateFieldValue(fieldMap.get(key), val);
        }
    }

    return _buildSchemaFromFieldMap(fieldMap, geomTypes, features.length, opts);
}

/**
 * Chunked schema analysis for large feature collections.
 * @param {object} geojson
 * @param {import('./task-runner.js').TaskRunner|null} [task]
 */
export async function analyzeSchemaAsync(geojson, task = null) {
    const features = geojson?.features || [];
    if (!task || features.length < SCHEMA_ASYNC_THRESHOLD) {
        return analyzeSchema(geojson);
    }

    const fieldMap = new Map();
    const geomTypes = new Set();

    await processInChunks(
        features,
        SCHEMA_CHUNK_SIZE,
        (f) => {
            if (f.geometry?.type) geomTypes.add(f.geometry.type);
            const props = f.properties || {};
            for (const [key, val] of Object.entries(props)) {
                if (!fieldMap.has(key)) {
                    fieldMap.set(key, _newFieldAccumulator());
                }
                _accumulateFieldValue(fieldMap.get(key), val);
            }
            return null;
        },
        task
    );

    return _buildSchemaFromFieldMap(fieldMap, geomTypes, features.length);
}

function _newFieldAccumulator() {
    return {
        values: [],
        nulls: 0,
        uniques: new Set(),
        numMin: Infinity,
        numMax: -Infinity,
        numCount: 0
    };
}

function _accumulateFieldValue(fm, val) {
    if (val == null || val === '') {
        fm.nulls++;
        return;
    }
    if (fm.values.length < SCHEMA_SAMPLE_VALUES) {
        fm.values.push(val);
    }
    if (fm.uniques.size < UNIQUE_CAP) {
        fm.uniques.add(String(val));
    }
    const n = typeof val === 'number' ? val : Number(val);
    if (typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(n))) {
        if (isFinite(n)) {
            fm.numCount++;
            if (n < fm.numMin) fm.numMin = n;
            if (n > fm.numMax) fm.numMax = n;
        }
    }
}

function _buildSchemaFromFieldMap(fieldMap, geomTypes, featureCount, opts = {}) {
    const fields = [];
    let order = 0;
    for (const [name, data] of fieldMap) {
        const type = inferType(data.values);
        const isNumeric = type === 'number' && data.numCount > 0;
        fields.push({
            name,
            type,
            nullCount: data.nulls,
            uniqueCount: data.uniques.size >= UNIQUE_CAP ? UNIQUE_CAP : data.uniques.size,
            sampleValues: data.values.slice(0, SCHEMA_UI_SAMPLES),
            min: isNumeric ? data.numMin : null,
            max: isNumeric ? data.numMax : null,
            selected: true,
            outputName: name,
            order: order++
        });
    }

    const geometryType = geomTypes.size === 1 ? [...geomTypes][0] :
        geomTypes.size > 1 ? 'Mixed' : null;

    return {
        fields,
        geometryType,
        featureCount,
        crs: opts.crs || 'EPSG:4326',
        ...(opts.crsWkt ? { crsWkt: opts.crsWkt } : {})
    };
}

/**
 * Analyze table rows to produce schema
 */
export function analyzeTableSchema(rows, fieldNames) {
    const fields = fieldNames.map((name, order) => {
        const acc = _newFieldAccumulator();
        for (const row of rows) {
            _accumulateFieldValue(acc, row[name]);
        }
        const type = inferType(acc.values);
        const isNumeric = type === 'number' && acc.numCount > 0;
        return {
            name,
            type,
            nullCount: acc.nulls,
            uniqueCount: acc.uniques.size >= UNIQUE_CAP ? UNIQUE_CAP : acc.uniques.size,
            sampleValues: acc.values.slice(0, SCHEMA_UI_SAMPLES),
            min: isNumeric ? acc.numMin : null,
            max: isNumeric ? acc.numMax : null,
            selected: true,
            outputName: name,
            order
        };
    });
    return { fields, geometryType: null, featureCount: rows.length, crs: null };
}

function inferType(values) {
    if (values.length === 0) return 'string';
    // Check for attachment objects
    if (values.some(v => v && typeof v === 'object' && v._att)) return 'attachment';
    let numCount = 0, boolCount = 0, dateCount = 0;
    const sample = values.slice(0, 100);
    for (const v of sample) {
        if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))) numCount++;
        if (typeof v === 'boolean' || v === 'true' || v === 'false') boolCount++;
        if (v instanceof Date || (typeof v === 'string' && !isNaN(Date.parse(v)) && v.length > 6)) dateCount++;
    }
    const threshold = sample.length * 0.7;
    if (numCount >= threshold) return 'number';
    if (boolCount >= threshold) return 'boolean';
    // Date detection can be noisy, require higher threshold
    if (dateCount >= sample.length * 0.9 && numCount < threshold) return 'date';
    return 'string';
}

function generateId() {
    return 'ds_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

/**
 * Get selected fields from schema
 */
export function getSelectedFields(schema) {
    if (!schema?.fields) return [];
    return schema.fields.filter(f => f.selected).sort((a, b) => a.order - b.order);
}

/**
 * Apply field selection to features (returns new features with only selected fields, optionally renamed)
 */
export function applyFieldSelection(features, schema) {
    const selected = getSelectedFields(schema);
    return features.map(f => {
        const newProps = {};
        for (const field of selected) {
            newProps[field.outputName] = f.properties?.[field.name] ?? null;
        }
        return { ...f, properties: newProps };
    });
}

function _isGeometryCollection(geom) {
    return !!(geom && typeof geom.type === 'string' && geom.type.toLowerCase() === 'geometrycollection');
}

/**
 * Expand a feature whose geometry is a GeometryCollection into one feature per child geometry.
 * Nested GeometryCollections are flattened recursively. When a Placemark splits into multiple
 * parts (typical KML MultiGeometry), the GeoJSON `id` is omitted on those parts so MapLibre does
 * not receive many features with the same id (which can suppress line rendering).
 * @param {import('geojson').Feature} feature
 * @returns {import('geojson').Feature[]}
 */
export function flattenFeatureGeometryCollections(feature) {
    const g = feature.geometry;
    if (!_isGeometryCollection(g)) return [feature];
    const parts = g.geometries || [];
    if (parts.length === 0) return [];
    // One child: unwrap but keep a single GeoJSON id (still one map feature).
    if (parts.length === 1) {
        const only = parts[0];
        if (!only) return [];
        if (_isGeometryCollection(only)) {
            return flattenFeatureGeometryCollections({ ...feature, geometry: only });
        }
        return [{ ...feature, geometry: only }];
    }
    // KML MultiGeometry → many parts share the same Placemark id. MapLibre's GeoJSON
    // tiling treats duplicate feature ids badly (lines can disappear); drop id here.
    const { id: _dropDuplicatePlacemarkId, ...featureSansId } = feature;
    return parts.flatMap(child => {
        if (!child) return [];
        if (_isGeometryCollection(child)) {
            return flattenFeatureGeometryCollections({ ...featureSansId, geometry: child });
        }
        return [{ ...featureSansId, geometry: child }];
    });
}

/**
 * Explode every GeometryCollection in a FeatureCollection into simple geometries (one feature per part).
 * @param {import('geojson').FeatureCollection} fc
 * @returns {import('geojson').FeatureCollection}
 */
export function explodeGeometryCollectionsInFeatureCollection(fc) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return fc;
    const features = fc.features.flatMap(f => flattenFeatureGeometryCollections(f));
    return { ...fc, features };
}

/**
 * Explode GeometryCollections with cooperative scheduling (yields between chunks).
 * @param {import('geojson').FeatureCollection} fc
 * @param {import('./task-runner.js').TaskRunner|null} [task]
 */
export async function explodeGeometryCollectionsInFeatureCollectionAsync(fc, task = null) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return fc;
    if (!task || fc.features.length < EXPLODE_CHUNK_THRESHOLD) {
        return explodeGeometryCollectionsInFeatureCollection(fc);
    }
    const parts = await processInChunks(
        fc.features,
        EXPLODE_CHUNK_SIZE,
        (f) => flattenFeatureGeometryCollections(f),
        task
    );
    return { ...fc, features: parts.flat() };
}

/**
 * Merge multiple spatial datasets into one
 */
export function mergeDatasets(datasets, addSourceField = true) {
    const allFeatures = [];
    for (const ds of datasets) {
        if (ds.type === 'spatial') {
            for (const f of ds.geojson.features) {
                const props = { ...f.properties };
                if (addSourceField) props.source_file = ds.source?.file || ds.name;
                allFeatures.push({ ...f, properties: props });
            }
        } else if (ds.type === 'table') {
            for (const row of ds.rows) {
                const props = { ...row };
                if (addSourceField) props.source_file = ds.source?.file || ds.name;
                allFeatures.push({ type: 'Feature', geometry: null, properties: props });
            }
        }
    }
    const geojson = { type: 'FeatureCollection', features: allFeatures };
    const name = 'Merged_' + datasets.map(d => d.name).join('_').slice(0, 50);
    return createSpatialDataset(name, geojson, { format: 'merge' });
}

/**
 * Split a mixed-geometry spatial dataset into separate datasets by geometry category.
 * Returns an array of datasets (one per category present: Points, Lines, Polygons).
 * If the dataset has only one geometry category, returns [dataset] unchanged.
 */
export function splitByGeometryType(dataset) {
    if (dataset.type !== 'spatial') return [dataset];
    const features = dataset.geojson?.features || [];
    if (features.length === 0) return [dataset];

    const groups = { point: [], line: [], polygon: [] };
    const labels = { point: 'Points', line: 'Lines', polygon: 'Polygons' };

    const flatFeatures = features.flatMap(f => flattenFeatureGeometryCollections(f));
    for (const f of flatFeatures) {
        const t = f.geometry?.type;
        if (!t) continue;
        if (t === 'Point' || t === 'MultiPoint') groups.point.push(f);
        else if (t === 'LineString' || t === 'MultiLineString') groups.line.push(f);
        else if (t === 'Polygon' || t === 'MultiPolygon') groups.polygon.push(f);
        // Unknown types (e.g. future GeoJSON extensions) are skipped rather than mis-bucketed.
    }

    const populated = Object.entries(groups).filter(([, feats]) => feats.length > 0);
    if (populated.length <= 1) return [dataset]; // Already homogeneous

    return populated.map(([gtype, feats]) => {
        const fc = { type: 'FeatureCollection', features: feats };
        const child = createSpatialDataset(
            `${dataset.name} - ${labels[gtype]}`,
            fc,
            { ...dataset.source }
        );
        if (dataset._kmlStyle) child._kmlStyle = dataset._kmlStyle;
        if (dataset._importWarning) child._importWarning = dataset._importWarning;
        if (dataset._kmzLinkResolver) child._kmzLinkResolver = dataset._kmzLinkResolver;
        if (dataset._networkLinkHrefs) child._networkLinkHrefs = dataset._networkLinkHrefs;
        return child;
    });
}

export default {
    createSpatialDataset, createTableDataset, createChunkedSpatialDataset,
    isWorkspaceLayer, isSpatialLayer, getLayerFeatureCount,
    tableToSpatial, spatialToTable,
    analyzeSchema, analyzeSchemaAsync, analyzeTableSchema, getSelectedFields, applyFieldSelection,
    mergeDatasets, splitByGeometryType, flattenFeatureGeometryCollections,
    explodeGeometryCollectionsInFeatureCollection,
    explodeGeometryCollectionsInFeatureCollectionAsync
};
