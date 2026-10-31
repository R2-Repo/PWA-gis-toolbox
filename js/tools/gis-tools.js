/**
 * GIS tools using Turf.js (client-side geospatial ops)
 */
import logger from '../core/logger.js';
import { createSpatialDataset } from '../core/data-model.js';
import { TaskRunner, processInChunks, yieldToUI } from '../core/task-runner.js';
import { assertDisplayReady } from '../crs/layer-crs.js';

const GIS_FEATURE_CHUNK_SIZE = 50;
import { pointToLineDistanceAny, nearestPointOnLineAny } from './line-geojson.js';
import {
    getFeatureBBox,
    getBBoxAny,
    bboxOverlap
} from './spatial-bbox.js';
import { computeWorkflowSimplify } from '../workflow/compute/simplify-units.js';
import {
    bufferFeatureCollection,
    clipFeatureCollection,
    dissolveFeatureCollection,
    lineOffsetFeatureCollection,
    unionFeatureCollection,
    combineFeatureCollection,
    spatialJoinFeatureCollections,
    nearestJoinFeatureCollections,
    intersectFeatureCollections,
    mergeFeatureCollections,
    differenceFeatureCollections,
    summarizeWithinFeatureCollections,
    sampleFeatureCollection,
    explodeFeatureCollection,
    polygonToLineFeatureCollection,
    fillHolesFeatureCollection,
    splitByLineFeatureCollections,
    splitByPolygonFeatureCollections
} from './compute/spatial-operations.js';

const LARGE_DATASET_WARNING = 50000;

function taskProgressCtx(t, scale = 0.9) {
    return {
        signal: t.signal,
        progress: (fraction, msg) => {
            t.throwIfCancelled();
            t.updateProgress(Math.round(fraction * scale * 100), msg ?? '');
        }
    };
}

function warnIfFeatureFailures(action, failed, total) {
    if (failed > 0) {
        logger.warn('GISTools', `${action} feature failures`, { failed, total });
    }
}

function _requireDisplayReady(dataset, context) {
    assertDisplayReady(dataset, context);
}

/**
 * Buffer features by distance.
 */
export async function bufferFeatures(dataset, distance, units = 'kilometers') {
    _requireDisplayReady(dataset, 'Buffer');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    if (dataset.geojson.features.length > LARGE_DATASET_WARNING) {
        logger.warn('GISTools', 'Large dataset — buffer may be slow', { count: dataset.geojson.features.length });
    }

    const task = new TaskRunner(`Buffer ${distance} ${units}`, 'GISTools');
    return task.run(async (t) => {
        const { geojson, stats } = bufferFeatureCollection(
            dataset.geojson,
            { distance, units },
            taskProgressCtx(t)
        );
        warnIfFeatureFailures('Buffer', stats.failed, stats.inCount);
        return createSpatialDataset(`${dataset.name}_buffer_${distance}${units}`, geojson, { format: 'derived' });
    });
}

/**
 * Simplify geometries. `tolerance` is in the unit given by `options.toleranceUnit`
 * (`m`, `ft`, or legacy `deg`); defaults to degrees for backward compatibility.
 */
export async function simplifyFeatures(dataset, tolerance = 0.001, options = {}) {
    _requireDisplayReady(dataset, 'Simplify');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const toleranceUnit = options.toleranceUnit ?? 'deg';

    const task = new TaskRunner('Simplify', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(10, 'Simplifying geometries...');
        t.throwIfCancelled();

        const spatialInput = {
            type: 'spatial',
            name: dataset.name,
            geojson: dataset.geojson,
            schema: dataset.schema || {}
        };

        const simplified = computeWorkflowSimplify(
            [spatialInput],
            { tolerance, toleranceUnit },
            taskProgressCtx(t)
        );

        const stats = {
            inCount: spatialInput.geojson?.features?.length ?? 0,
            outCount: simplified.geojson?.features?.length ?? 0,
            failed: 0,
            verticesBefore: countSimplifyVertices(spatialInput.geojson),
            verticesAfter: countSimplifyVertices(simplified.geojson)
        };

        warnIfFeatureFailures('Simplify', stats.failed, stats.inCount);

        t.throwIfCancelled();
        logger.info('GISTools', 'Simplify complete', {
            verticesBefore: stats.verticesBefore,
            verticesAfter: stats.verticesAfter,
            reduction: stats.verticesBefore
                ? `${Math.round((1 - stats.verticesAfter / stats.verticesBefore) * 100)}%`
                : '0%'
        });

        return {
            dataset: createSpatialDataset(simplified.name || `${dataset.name}_simplified`, simplified.geojson, {
                format: 'derived'
            }),
            stats: { verticesBefore: stats.verticesBefore, verticesAfter: stats.verticesAfter }
        };
    });
}

function countSimplifyVertices(geojson) {
    let count = 0;
    const walk = (coords) => {
        if (typeof coords[0] === 'number') return 1;
        return coords.reduce((sum, c) => sum + walk(c), 0);
    };
    for (const f of geojson?.features || []) {
        if (f.geometry?.coordinates) count += walk(f.geometry.coordinates);
    }
    return count;
}

/**
 * Clip features to a bounding box or polygon.
 */
export async function clipFeatures(dataset, clipGeometry) {
    _requireDisplayReady(dataset, 'Clip');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Clip', 'GISTools');
    return task.run(async (t) => {
        const { geojson, stats } = clipFeatureCollection(
            dataset.geojson,
            clipGeometry,
            taskProgressCtx(t)
        );
        warnIfFeatureFailures('Clip', stats.failed, stats.inCount);
        return createSpatialDataset(`${dataset.name}_clipped`, geojson, { format: 'derived' });
    });
}

/**
 * Dissolve by field
 */
export async function dissolveFeatures(dataset, field) {
    _requireDisplayReady(dataset, 'Dissolve');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Dissolve', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(10, 'Dissolving...');
        t.throwIfCancelled();
        const { geojson } = dissolveFeatureCollection(
            dataset.geojson,
            { field },
            taskProgressCtx(t)
        );
        t.throwIfCancelled();
        return createSpatialDataset(`${dataset.name}_dissolved`, geojson, { format: 'derived' });
    });
}

// ============================
// Measurement Tools
// ============================

/**
 * Get a point at a specified distance along a line
 */
export function pointAlong(lineFeature, distance, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.along(lineFeature, distance, { units });
}

/**
 * Calculate bearing between two points (in degrees, -180 to 180)
 */
export function bearing(point1, point2) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.bearing(point1, point2);
}

/**
 * Calculate destination point given start, distance, and bearing
 */
export function destination(origin, distance, bearingAngle, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.destination(origin, distance, bearingAngle, { units });
}

/**
 * Calculate distance between two points
 */
export function distance(point1, point2, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.distance(point1, point2, { units });
}

/**
 * Calculate shortest distance from a point to a line
 */
export function pointToLineDistance(point, line, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = line.geometry;
    if (g && (g.type === 'LineString' || g.type === 'MultiLineString')) {
        return pointToLineDistanceAny(point, line, units);
    }
    return turf.pointToLineDistance(point, line, { units });
}

// ============================
// Transformation Tools
// ============================

/**
 * Clip features to a bounding box
 */
export async function bboxClipFeatures(dataset, bbox) {
    _requireDisplayReady(dataset, 'BBox clip');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('BBox Clip', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const clipped = [];
        const clipBox = Array.isArray(bbox) && bbox.length >= 4 ? bbox : null;
        let failures = 0;

        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Clipping ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            if (!features[i].geometry) continue;

            const fb = getFeatureBBox(features[i]);
            if (clipBox && fb && !bboxOverlap(clipBox, fb)) {
                continue;
            }

            try {
                const c = turf.bboxClip(features[i], bbox);
                if (c && c.geometry && c.geometry.coordinates && c.geometry.coordinates.length > 0) {
                    c.properties = { ...features[i].properties };
                    clipped.push(c);
                }
            } catch (e) {
                failures++;
            }
        }
        warnIfFeatureFailures('BBox clip', failures, features.length);
        const fc = { type: 'FeatureCollection', features: clipped };
        return createSpatialDataset(`${dataset.name}_bboxclip`, fc, { format: 'derived' });
    });
}

/**
 * Smooth lines into bezier splines
 */
export async function bezierSplineFeatures(dataset, resolution = 10000, sharpness = 0.85) {
    _requireDisplayReady(dataset, 'Bezier spline');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Bezier Spline', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const smoothed = [];
        let failures = 0;
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 50 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Smoothing ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            const f = features[i];
            if (!f.geometry) continue;
            if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
                try {
                    const lines = f.geometry.type === 'MultiLineString'
                        ? f.geometry.coordinates.map(c => turf.lineString(c))
                        : [f];
                    for (const line of lines) {
                        const spline = turf.bezierSpline(line, { resolution, sharpness });
                        if (spline) {
                            spline.properties = { ...f.properties };
                            smoothed.push(spline);
                        }
                    }
                } catch (e) {
                    failures++;
                    smoothed.push(f); // keep original
                }
            } else {
                smoothed.push(f); // non-line features pass through
            }
        }
        warnIfFeatureFailures('Bezier spline', failures, features.length);
        const fc = { type: 'FeatureCollection', features: smoothed };
        return createSpatialDataset(`${dataset.name}_spline`, fc, { format: 'derived' });
    });
}

/**
 * Smooth polygon edges
 */
export async function polygonSmoothFeatures(dataset, iterations = 1) {
    _requireDisplayReady(dataset, 'Polygon smooth');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Polygon Smooth', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(10, 'Smoothing polygons...');
        t.throwIfCancelled();
        const features = dataset.geojson.features;
        let smoothFailures = 0;

        const smoothedFeatures = await processInChunks(
            features,
            GIS_FEATURE_CHUNK_SIZE,
            (f) => {
                if (!f?.geometry) return f;
                const gt = f.geometry.type;
                if (gt !== 'Polygon' && gt !== 'MultiPolygon') return f;
                try {
                    const part = turf.polygonSmooth(
                        { type: 'FeatureCollection', features: [f] },
                        { iterations }
                    );
                    return part.features[0] || f;
                } catch (e) {
                    smoothFailures++;
                    return f;
                }
            },
            t
        );
        warnIfFeatureFailures('Polygon smooth', smoothFailures, features.length);

        t.throwIfCancelled();
        const smoothed = { type: 'FeatureCollection', features: smoothedFeatures };
        return createSpatialDataset(`${dataset.name}_smooth`, smoothed, { format: 'derived' });
    });
}

/**
 * Offset a line by a specified distance (creates a parallel line)
 */
export async function lineOffsetFeatures(dataset, offsetDistance, units = 'kilometers') {
    _requireDisplayReady(dataset, 'Line offset');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Line Offset', 'GISTools');
    return task.run(async (t) => {
        const { geojson, stats } = lineOffsetFeatureCollection(
            dataset.geojson,
            { distance: offsetDistance, units },
            taskProgressCtx(t)
        );
        warnIfFeatureFailures('Line offset', stats.failed, stats.inCount);
        return createSpatialDataset(`${dataset.name}_offset`, geojson, { format: 'derived' });
    });
}

/**
 * Slice a line at start/stop distances along it
 */
export function lineSliceAlong(lineFeature, startDist, stopDist, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.lineSliceAlong(lineFeature, startDist, stopDist, { units });
}

/**
 * Slice a line between two points (nearest vertices)
 */
export function lineSlice(startPoint, stopPoint, lineFeature) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.lineSlice(startPoint, stopPoint, lineFeature);
}

/**
 * Create a sector (pie slice) polygon from center, radius, and two bearings
 */
export function createSector(center, radius, bearing1, bearing2, units = 'kilometers', steps = 64) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.sector(center, radius, bearing1, bearing2, { units, steps });
}

// ============================
// Analysis / Classification
// ============================

/**
 * Find intersection points where two line layers cross
 */
export function lineIntersect(line1, line2) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.lineIntersect(line1, line2);
}

/**
 * Find self-intersections (kinks) in a polygon or line dataset
 */
export async function findKinks(dataset) {
    _requireDisplayReady(dataset, 'Find kinks');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Find Kinks', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const allKinks = [];
        let failures = 0;
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Checking ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            const f = features[i];
            if (!f.geometry) continue;
            try {
                const kinks = turf.kinks(f);
                if (kinks && kinks.features && kinks.features.length > 0) {
                    kinks.features.forEach(k => {
                        k.properties = {
                            sourceIndex: i,
                            sourceName: f.properties?.name || f.properties?.NAME || `Feature ${i}`,
                            ...k.properties
                        };
                        allKinks.push(k);
                    });
                }
            } catch (e) {
                failures++;
            }
        }
        warnIfFeatureFailures('Kinks check', failures, features.length);
        const fc = { type: 'FeatureCollection', features: allKinks };
        logger.info('GISTools', `Found ${allKinks.length} self-intersections`);
        return createSpatialDataset(`${dataset.name}_kinks`, fc, { format: 'derived' });
    });
}

/**
 * Combine: merge features into multi-geometry types
 */
export function combineFeatures(dataset) {
    _requireDisplayReady(dataset, 'Combine');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const { geojson } = combineFeatureCollection(dataset.geojson);
    return createSpatialDataset(`${dataset.name}_combined`, geojson, { format: 'derived' });
}

/**
 * Union: merge multiple polygons into one polygon
 */
export async function unionFeatures(dataset) {
    _requireDisplayReady(dataset, 'Union');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Union', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(10, 'Merging polygons...');
        const { geojson, stats } = unionFeatureCollection(dataset.geojson, taskProgressCtx(t));
        warnIfFeatureFailures('Union', stats.failed, Math.max(0, stats.inCount - 1));
        return createSpatialDataset(`${dataset.name}_union`, geojson, { format: 'derived' });
    });
}

/**
 * Find the nearest point in a point dataset to a reference point
 */
export function nearestPoint(targetPoint, pointsDataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.nearestPoint(targetPoint, pointsDataset.geojson);
}

/**
 * Find the nearest point on a line to a given point
 */
export function nearestPointOnLine(lineFeature, point, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = lineFeature.geometry;
    if (g && g.type === 'MultiLineString') {
        return nearestPointOnLineAny(point, lineFeature, units);
    }
    return turf.nearestPointOnLine(lineFeature, point, { units });
}

/**
 * Find the nearest point feature to a line
 */
export function nearestPointToLine(pointsFC, lineFeature, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = lineFeature.geometry;
    if (g?.type === 'MultiLineString') {
        let best = null;
        let bestD = Infinity;
        for (const coords of g.coordinates) {
            const seg = turf.lineString(coords);
            const cand = turf.nearestPointToLine(pointsFC, seg, { units });
            const d = cand.properties.dist ?? Infinity;
            if (d < bestD) {
                bestD = d;
                best = cand;
            }
        }
        if (!best) throw new Error('Empty MultiLineString');
        return best;
    }
    return turf.nearestPointToLine(pointsFC, lineFeature, { units });
}

/**
 * Nearest neighbor analysis on a point dataset
 * Returns statistical measures of point distribution
 */
export function nearestNeighborAnalysis(dataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const pointFeatures = dataset.geojson.features.filter(f =>
        f.geometry && f.geometry.type === 'Point'
    );
    if (pointFeatures.length < 3) throw new Error('Need at least 3 point features for nearest neighbor analysis');
    const fc = { type: 'FeatureCollection', features: pointFeatures };
    return turf.nearestNeighborAnalysis(fc);
}

// ============================
// Multi-Layer Spatial Analysis
// ============================

/**
 * Spatial Join — assign polygon attributes to points that fall within them.
 * For each point, finds the containing polygon and copies specified fields.
 * @param {object} pointsDataset  - spatial dataset of points
 * @param {object} polygonsDataset - spatial dataset of polygons
 * @param {string[]} joinFields   - polygon field names to copy (empty = all)
 * @param {string} prefix         - prefix for joined field names (default '')
 * @returns {object} enriched points dataset
 */
export async function spatialJoinPointsInPolygons(pointsDataset, polygonsDataset, joinFields = [], prefix = '') {
    _requireDisplayReady(pointsDataset, 'Spatial join');
    _requireDisplayReady(polygonsDataset, 'Spatial join');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Spatial Join', 'GISTools');
    return task.run(async (t) => {
        const { geojson, schemaFields } = spatialJoinFeatureCollections(
            pointsDataset.geojson,
            polygonsDataset.geojson,
            { joinFields, prefix },
            taskProgressCtx(t)
        );

        const schema = JSON.parse(JSON.stringify(pointsDataset.schema));
        for (const name of schemaFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = geojson.features.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: typeof vals[0] === 'number' ? 'number' : 'string',
                    nullCount: geojson.features.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        return createSpatialDataset(`${pointsDataset.name}_spatialJoin`, geojson, { format: 'derived', schema });
    });
}

/**
 * Nearest Join — for each feature in A, find the nearest feature in B
 * and copy specified fields + add a distance field.
 * @param {object} datasetA     - target dataset
 * @param {object} datasetB     - join dataset
 * @param {string[]} joinFields - B field names to copy (empty = all)
 * @param {string} units        - distance units
 * @returns {object} enriched dataset A
 */
export async function nearestJoin(datasetA, datasetB, joinFields = [], units = 'kilometers') {
    _requireDisplayReady(datasetA, 'Nearest join');
    _requireDisplayReady(datasetB, 'Nearest join');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Nearest Join', 'GISTools');
    return task.run(async (t) => {
        const { geojson, bFields } = nearestJoinFeatureCollections(
            datasetA.geojson,
            datasetB.geojson,
            { joinFields, units },
            taskProgressCtx(t)
        );

        const schema = JSON.parse(JSON.stringify(datasetA.schema));
        const addedFields = [...bFields.map(f => 'nearest_' + f), 'nearest_distance', 'nearest_distance_units'];
        for (const name of addedFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = geojson.features.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: name === 'nearest_distance' ? 'number' : 'string',
                    nullCount: geojson.features.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        return createSpatialDataset(`${datasetA.name}_nearestJoin`, geojson, { format: 'derived', schema });
    });
}

/**
 * Intersect two polygon layers — produces features where they overlap,
 * with merged attributes from both layers.
 */
export async function intersectLayers(datasetA, datasetB) {
    _requireDisplayReady(datasetA, 'Intersect');
    _requireDisplayReady(datasetB, 'Intersect');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Intersect Layers', 'GISTools');
    return task.run(async (t) => {
        const { geojson } = intersectFeatureCollections(
            datasetA.geojson,
            datasetB.geojson,
            taskProgressCtx(t)
        );
        return createSpatialDataset(
            `${datasetA.name}_intersect_${datasetB.name}`,
            geojson,
            { format: 'derived' }
        );
    });
}

/**
 * Merge two feature collections into one combined dataset.
 */
export function mergeLayers(datasetA, datasetB) {
    _requireDisplayReady(datasetA, 'Merge');
    _requireDisplayReady(datasetB, 'Merge');
    const { geojson } = mergeFeatureCollections(datasetA.geojson, datasetB.geojson);
    return createSpatialDataset(`${datasetA.name}_merged_${datasetB.name}`, geojson, { format: 'derived' });
}

/**
 * Difference — subtract polygon layer B from polygon layer A.
 * For each polygon in A, removes overlapping areas from all polygons in B.
 */
export async function differenceLayers(datasetA, datasetB) {
    _requireDisplayReady(datasetA, 'Difference');
    _requireDisplayReady(datasetB, 'Difference');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Difference', 'GISTools');
    return task.run(async (t) => {
        const { geojson } = differenceFeatureCollections(
            datasetA.geojson,
            datasetB.geojson,
            taskProgressCtx(t)
        );
        return createSpatialDataset(
            `${datasetA.name}_diff_${datasetB.name}`,
            geojson,
            { format: 'derived' }
        );
    });
}

/**
 * Summarize Within — count and summarize point features within each polygon.
 * Adds count + optional numeric field aggregation to polygon properties.
 * @param {object} polygonsDataset
 * @param {object} pointsDataset
 * @param {string} [sumField]   - optional numeric field to sum
 * @param {string} [avgField]   - optional numeric field to average
 * @returns {object} enriched polygons dataset
 */
export async function summarizeWithin(polygonsDataset, pointsDataset, sumField, avgField) {
    _requireDisplayReady(polygonsDataset, 'Summarize within');
    _requireDisplayReady(pointsDataset, 'Summarize within');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Summarize Within', 'GISTools');
    return task.run(async (t) => {
        const { geojson, sumField: sumF, avgField: avgF } = summarizeWithinFeatureCollections(
            polygonsDataset.geojson,
            pointsDataset.geojson,
            { sumField, avgField },
            taskProgressCtx(t)
        );

        const schema = JSON.parse(JSON.stringify(polygonsDataset.schema));
        const newFields = ['point_count'];
        if (sumF) newFields.push('sum_' + sumF);
        if (avgF) newFields.push('avg_' + avgF);
        for (const name of newFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = geojson.features.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: 'number',
                    nullCount: geojson.features.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    min: vals.length ? Math.min(...vals) : null,
                    max: vals.length ? Math.max(...vals) : null,
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        return createSpatialDataset(`${polygonsDataset.name}_summary`, geojson, { format: 'derived', schema });
    });
}

/**
 * Randomly sample N features from a layer.
 * @param {object} dataset
 * @param {number} num
 * @returns {Promise<object>}
 */
export async function sampleFeatures(dataset, num) {
    _requireDisplayReady(dataset, 'Sample');

    const count = Math.floor(Number(num));
    if (!Number.isFinite(count) || count <= 0) {
        throw new Error('Sample count must be a positive number');
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const { geojson } = sampleFeatureCollection(dataset.geojson, { num: count });
    const sampleCount = geojson.features.length;
    return createSpatialDataset(`${dataset.name}_sample_${sampleCount}`, geojson, { format: 'derived' });
}

/**
 * Extract every coordinate vertex as a point feature.
 * @param {object} dataset
 * @returns {Promise<object>}
 */
export async function explodeFeatures(dataset) {
    _requireDisplayReady(dataset, 'Explode');

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Explode', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(50, 'Extracting vertices');
        await yieldToUI();
        const { geojson } = explodeFeatureCollection(dataset.geojson);
        return createSpatialDataset(`${dataset.name}_exploded`, geojson, { format: 'derived' });
    });
}

/**
 * Convert polygons to outline lines.
 * @param {object} dataset
 * @returns {Promise<object>}
 */
export async function polygonToLineFeatures(dataset) {
    _requireDisplayReady(dataset, 'Polygon to line');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Polygon to Line', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(40, 'Converting polygons to lines');
        await yieldToUI();
        const { geojson } = polygonToLineFeatureCollection(dataset.geojson);
        t.updateProgress(90, 'Building layer');
        return createSpatialDataset(`${dataset.name}_outlines`, geojson, { format: 'derived' });
    });
}

/**
 * Remove interior rings (holes) from polygons.
 * @param {object} dataset
 * @returns {Promise<object>}
 */
export async function fillHolesFeatures(dataset) {
    _requireDisplayReady(dataset, 'Fill holes');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Fill Holes', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(40, 'Removing holes');
        await yieldToUI();
        const { geojson, holesRemoved } = fillHolesFeatureCollection(dataset.geojson);
        t.updateProgress(90, 'Building layer');
        return createSpatialDataset(`${dataset.name}_filled`, geojson, { format: 'derived', holesRemoved });
    });
}

/**
 * Split polygons with a line layer.
 * @param {object} polygonDataset
 * @param {object} lineDataset
 * @returns {Promise<object>}
 */
export async function splitPolygonsByLine(polygonDataset, lineDataset) {
    _requireDisplayReady(polygonDataset, 'Split by line');
    _requireDisplayReady(lineDataset, 'Split by line');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Split by Line', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(20, 'Splitting polygons');
        await yieldToUI();
        const { geojson } = splitByLineFeatureCollections(polygonDataset.geojson, lineDataset.geojson);
        t.updateProgress(90, 'Building layer');
        return createSpatialDataset(`${polygonDataset.name}_split_line`, geojson, { format: 'derived' });
    });
}

/**
 * Split polygons with another polygon layer.
 * @param {object} polygonDataset
 * @param {object} splitterDataset
 * @returns {Promise<object>}
 */
export async function splitPolygonsByPolygon(polygonDataset, splitterDataset) {
    _requireDisplayReady(polygonDataset, 'Split by polygon');
    _requireDisplayReady(splitterDataset, 'Split by polygon');
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Split by Polygon', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(20, 'Splitting polygons');
        await yieldToUI();
        const { geojson } = splitByPolygonFeatureCollections(polygonDataset.geojson, splitterDataset.geojson);
        t.updateProgress(90, 'Building layer');
        return createSpatialDataset(`${polygonDataset.name}_split_poly`, geojson, { format: 'derived' });
    });
}

export default {
    bufferFeatures, simplifyFeatures, clipFeatures, dissolveFeatures,
    pointAlong, bearing, destination, distance, pointToLineDistance,
    bboxClipFeatures, bezierSplineFeatures, polygonSmoothFeatures,
    lineOffsetFeatures, lineSliceAlong, lineSlice, createSector,
    lineIntersect, findKinks, combineFeatures, unionFeatures,
    nearestPoint, nearestPointOnLine, nearestPointToLine,
    nearestNeighborAnalysis,
    spatialJoinPointsInPolygons, nearestJoin, intersectLayers,
    mergeLayers, differenceLayers, summarizeWithin,
    sampleFeatures, explodeFeatures,
    polygonToLineFeatures, fillHolesFeatures,
    splitPolygonsByLine, splitPolygonsByPolygon
};
