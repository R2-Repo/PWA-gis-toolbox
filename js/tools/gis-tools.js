/**
 * GIS tools using Turf.js (client-side geospatial ops)
 */
import logger from '../core/logger.js';
import { createSpatialDataset } from '../core/data-model.js';
import { TaskRunner, processInChunks, yieldToUI } from '../core/task-runner.js';
import { assertDisplayReady } from '../crs/layer-crs.js';

const GIS_FEATURE_CHUNK_SIZE = 50;
import { computeFeatureDistance, metersToDisplayUnits } from './feature-distance.js';
import { pointToLineDistanceAny, nearestPointOnLineAny } from './line-geojson.js';
import {
    getFeatureBBox,
    getBBoxAny,
    bboxOverlap,
    minBBoxSeparationMeters,
    NEAREST_JOIN_SORT_THRESHOLD
} from './spatial-bbox.js';

const LARGE_DATASET_WARNING = 50000;

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
 * Desktop: large layers / library disk paths use the Python sidecar when available.
 */
export async function bufferFeatures(dataset, distance, units = 'kilometers') {
    _requireDisplayReady(dataset, 'Buffer');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            bufferLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Buffer via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            return bufferLayerNative(dataset, distance, units);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native buffer unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    if (dataset.geojson.features.length > LARGE_DATASET_WARNING) {
        logger.warn('GISTools', 'Large dataset — buffer may be slow', { count: dataset.geojson.features.length });
    }

    const task = new TaskRunner(`Buffer ${distance} ${units}`, 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const buffered = [];
        let failures = 0;
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Buffering ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            if (features[i].geometry) {
                try {
                    const b = turf.buffer(features[i], distance, { units });
                    if (b) {
                        b.properties = { ...features[i].properties };
                        buffered.push(b);
                    }
                } catch (e) {
                    failures++;
                }
            }
        }
        warnIfFeatureFailures('Buffer', failures, features.length);
        const fc = { type: 'FeatureCollection', features: buffered };
        return createSpatialDataset(`${dataset.name}_buffer_${distance}${units}`, fc, { format: 'derived' });
    });
}

/**
 * Simplify geometries
 */
export async function simplifyFeatures(dataset, tolerance = 0.001) {
    _requireDisplayReady(dataset, 'Simplify');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            simplifyLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Simplify via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            const datasetOut = await simplifyLayerNative(dataset, tolerance);
            return { dataset: datasetOut, stats: { verticesBefore: null, verticesAfter: null, provider: 'python' } };
        }
    } catch (err) {
        logger.warn('GISTools', 'Native simplify unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Simplify', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(10, 'Simplifying geometries...');
        t.throwIfCancelled();

        const features = dataset.geojson.features;
        const verticesBefore = countVertices(dataset.geojson);
        let simplifyFailures = 0;

        const simplifiedFeatures = await processInChunks(
            features,
            GIS_FEATURE_CHUNK_SIZE,
            (f) => {
                if (!f?.geometry) return f;
                try {
                    return turf.simplify(f, { tolerance, highQuality: true });
                } catch (e) {
                    simplifyFailures++;
                    return f;
                }
            },
            t
        );
        warnIfFeatureFailures('Simplify', simplifyFailures, features.length);

        const simplified = { type: 'FeatureCollection', features: simplifiedFeatures };
        t.throwIfCancelled();
        const verticesAfter = countVertices(simplified);

        logger.info('GISTools', 'Simplify complete', { verticesBefore, verticesAfter, reduction: `${Math.round((1 - verticesAfter / verticesBefore) * 100)}%` });

        return {
            dataset: createSpatialDataset(`${dataset.name}_simplified`, simplified, { format: 'derived' }),
            stats: { verticesBefore, verticesAfter }
        };
    });
}

/**
 * Clip features to a bounding box or polygon.
 * Desktop: large layers / library disk paths use the Python sidecar when available.
 */
export async function clipFeatures(dataset, clipGeometry) {
    _requireDisplayReady(dataset, 'Clip');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            clipLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Clip via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            return clipLayerNative(dataset, clipGeometry);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native clip unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Clip', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const clipped = [];
        const clipBox = getBBoxAny(clipGeometry);

        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Clipping ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const f = features[i];
            if (!f.geometry) continue;

            const fb = getFeatureBBox(f);
            if (clipBox && fb && !bboxOverlap(clipBox, fb)) {
                continue;
            }

            try {
                if (f.geometry.type === 'Point') {
                    if (turf.booleanPointInPolygon(f, clipGeometry)) {
                        clipped.push(f);
                    }
                } else {
                    const intersection = turf.intersect(
                        turf.featureCollection([turf.feature(clipGeometry), f])
                    );
                    if (intersection) {
                        intersection.properties = { ...f.properties };
                        clipped.push(intersection);
                    }
                }
            } catch (e) {
                // For complex geometries or errors, include if centroid is inside
                try {
                    const centroid = turf.centroid(f);
                    if (turf.booleanPointInPolygon(centroid, clipGeometry)) {
                        clipped.push(f);
                    }
                } catch (_) { }
            }
        }

        const fc = { type: 'FeatureCollection', features: clipped };
        return createSpatialDataset(`${dataset.name}_clipped`, fc, { format: 'derived' });
    });
}

/**
 * Dissolve by field
 */
export async function dissolveFeatures(dataset, field) {
    _requireDisplayReady(dataset, 'Dissolve');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            dissolveLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Dissolve via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            return dissolveLayerNative(dataset, field);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native dissolve unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Dissolve', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(10, 'Dissolving...');
        t.throwIfCancelled();
        const trimmed = field != null ? String(field).trim() : '';
        const features = dataset.geojson.features.filter((f) => f?.geometry);

        const groups = new Map();
        if (trimmed) {
            for (const f of features) {
                const key = String(f.properties?.[trimmed] ?? '');
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(f);
            }
        } else {
            groups.set('__all__', features);
        }

        const dissolvedFeatures = [];
        let gi = 0;
        const groupCount = groups.size;
        for (const [, groupFeatures] of groups) {
            t.throwIfCancelled();
            t.updateProgress(
                Math.round((gi / Math.max(groupCount, 1)) * 90),
                `Dissolving group ${gi + 1}/${groupCount}...`
            );
            const fc = { type: 'FeatureCollection', features: groupFeatures };
            const part = trimmed
                ? turf.dissolve(fc, { propertyName: trimmed })
                : turf.dissolve(fc);
            if (part?.features) dissolvedFeatures.push(...part.features);
            gi++;
            if (gi % 3 === 0) await yieldToUI();
        }

        t.throwIfCancelled();
        const dissolved = { type: 'FeatureCollection', features: dissolvedFeatures };
        return createSpatialDataset(`${dataset.name}_dissolved`, dissolved, { format: 'derived' });
    });
}

function countVertices(geojson) {
    let count = 0;
    const countCoords = (coords) => {
        if (typeof coords[0] === 'number') return 1;
        return coords.reduce((sum, c) => sum + countCoords(c), 0);
    };
    for (const f of (geojson.features || [])) {
        if (f.geometry?.coordinates) {
            count += countCoords(f.geometry.coordinates);
        }
    }
    return count;
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
        const features = dataset.geojson.features;
        const results = [];
        let failures = 0;
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Offsetting ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            const f = features[i];
            if (!f.geometry) continue;
            if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
                try {
                    const offset = turf.lineOffset(f, offsetDistance, { units });
                    if (offset) {
                        offset.properties = { ...f.properties };
                        results.push(offset);
                    }
                } catch (e) {
                    failures++;
                    results.push(f);
                }
            } else {
                results.push(f);
            }
        }
        warnIfFeatureFailures('Line offset', failures, features.length);
        const fc = { type: 'FeatureCollection', features: results };
        return createSpatialDataset(`${dataset.name}_offset`, fc, { format: 'derived' });
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
    const combined = turf.combine(dataset.geojson);
    return createSpatialDataset(`${dataset.name}_combined`, combined, { format: 'derived' });
}

/**
 * Union: merge multiple polygons into one polygon
 */
export async function unionFeatures(dataset) {
    _requireDisplayReady(dataset, 'Union');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            unionLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Union via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            return unionLayerNative(dataset);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native union unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Union', 'GISTools');
    return task.run(async (t) => {
        const polygons = dataset.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polygons.length === 0) throw new Error('No polygon features to union');
        if (polygons.length === 1) {
            return createSpatialDataset(`${dataset.name}_union`, {
                type: 'FeatureCollection', features: [polygons[0]]
            }, { format: 'derived' });
        }

        t.updateProgress(10, `Merging ${polygons.length} polygons...`);
        let result = polygons[0];
        let unionFailures = 0;
        for (let i = 1; i < polygons.length; i++) {
            t.throwIfCancelled();
            if (i % 20 === 0) {
                t.updateProgress(Math.round((i / polygons.length) * 90), `Merging ${i}/${polygons.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            try {
                const merged = turf.union(turf.featureCollection([result, polygons[i]]));
                if (merged) result = merged;
            } catch (e) {
                unionFailures++;
            }
        }
        warnIfFeatureFailures('Union', unionFailures, polygons.length - 1);

        const fc = { type: 'FeatureCollection', features: [result] };
        return createSpatialDataset(`${dataset.name}_union`, fc, { format: 'derived' });
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

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            spatialJoinLayersNative,
            datasetFromAnalysisResult
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(pointsDataset);
        const nativePath = resolveLayerNativePath(pointsDataset)
            || resolveLayerNativePath(polygonsDataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Spatial join via Python sidecar', {
                count: featureCount,
                nativePath: Boolean(nativePath)
            });
            const raw = await spatialJoinLayersNative(pointsDataset, polygonsDataset, {
                predicate: 'within'
            });
            const fc = raw?.geojson?.features?.length
                ? raw.geojson
                : raw?.previewGeojson;
            if (fc?.type === 'FeatureCollection') {
                // Map join_* props onto requested fields when specified
                if (joinFields.length) {
                    for (const f of fc.features) {
                        const props = { ...(f.properties || {}) };
                        for (const field of joinFields) {
                            const key = prefix + field;
                            if (props[key] == null && props[`join_${field}`] != null) {
                                props[key] = props[`join_${field}`];
                            }
                        }
                        f.properties = props;
                    }
                }
                return createSpatialDataset(
                    `${pointsDataset.name}_spatial_join`,
                    fc,
                    {
                        format: 'derived',
                        importRoute: 'desktop-analysis',
                        nativeOutputPath: raw?.outputPath,
                        fullFeatureCount: raw?.featureCount
                    }
                );
            }
            return datasetFromAnalysisResult(raw, `${pointsDataset.name}_spatial_join`);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native spatial join unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Spatial Join', 'GISTools');
    return task.run(async (t) => {
        const points = pointsDataset.geojson.features;
        const polygons = polygonsDataset.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

        const polyFields = joinFields.length > 0
            ? joinFields
            : Object.keys(polygons[0]?.properties || {});

        const polyBoxes = polygons.map(p => getFeatureBBox(p));

        const enriched = [];
        for (let i = 0; i < points.length; i++) {
            t.throwIfCancelled();
            if (i % 200 === 0) {
                t.updateProgress(Math.round((i / points.length) * 90), `Joining ${i}/${points.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const pt = points[i];
            const props = { ...pt.properties };
            let matched = false;

            if (pt.geometry && pt.geometry.type === 'Point') {
                const [lng, lat] = pt.geometry.coordinates;
                for (let pi = 0; pi < polygons.length; pi++) {
                    const pb = polyBoxes[pi];
                    if (pb && (lng < pb[0] || lng > pb[2] || lat < pb[1] || lat > pb[3])) {
                        continue;
                    }
                    const poly = polygons[pi];
                    try {
                        if (turf.booleanPointInPolygon(pt, poly)) {
                            for (const field of polyFields) {
                                props[prefix + field] = poly.properties?.[field] ?? null;
                            }
                            matched = true;
                            break;
                        }
                    } catch (_) { /* skip invalid polygons */ }
                }
            }

            if (!matched) {
                for (const field of polyFields) {
                    if (!(prefix + field in props)) props[prefix + field] = null;
                }
            }

            enriched.push({ ...pt, properties: props });
        }

        // Build updated schema
        const schema = JSON.parse(JSON.stringify(pointsDataset.schema));
        for (const field of polyFields) {
            const name = prefix + field;
            if (!schema.fields.find(f => f.name === name)) {
                const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: typeof vals[0] === 'number' ? 'number' : 'string',
                    nullCount: enriched.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        const fc = { type: 'FeatureCollection', features: enriched };
        return createSpatialDataset(`${pointsDataset.name}_spatialJoin`, fc, { format: 'derived', schema });
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
        const featuresA = datasetA.geojson.features;
        const featuresB = datasetB.geojson.features;
        if (featuresB.length === 0) throw new Error('Join layer has no features');

        const bFields = joinFields.length > 0
            ? joinFields
            : Object.keys(featuresB[0]?.properties || {});

        const bboxB = featuresB.map(f => getFeatureBBox(f));

        const enriched = [];
        for (let i = 0; i < featuresA.length; i++) {
            t.throwIfCancelled();
            if (i % 200 === 0) {
                t.updateProgress(Math.round((i / featuresA.length) * 90), `Joining ${i}/${featuresA.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const fA = featuresA[i];
            const props = { ...fA.properties };

            if (fA.geometry) {
                const ba = getFeatureBBox(fA);
                let indices = featuresB.map((_, j) => j);
                const useSortedEarlyExit = ba && featuresB.length >= NEAREST_JOIN_SORT_THRESHOLD;
                if (useSortedEarlyExit) {
                    indices.sort((j1, j2) => {
                        const b1 = bboxB[j1];
                        const b2 = bboxB[j2];
                        const s1 = b1 ? minBBoxSeparationMeters(ba, b1) : 0;
                        const s2 = b2 ? minBBoxSeparationMeters(ba, b2) : 0;
                        return s1 - s2;
                    });
                }

                let minDm = Infinity;
                let nearestIdx = -1;

                for (const j of indices) {
                    const fB = featuresB[j];
                    if (!fB?.geometry) continue;
                    const bb = bboxB[j];
                    if (ba && bb && minDm !== Infinity && minBBoxSeparationMeters(ba, bb) >= minDm) {
                        if (useSortedEarlyExit) break;
                        continue;
                    }
                    const { distanceMeters } = computeFeatureDistance(fA, fB, 'centroid');
                    if (distanceMeters < minDm) {
                        minDm = distanceMeters;
                        nearestIdx = j;
                    }
                }

                if (nearestIdx >= 0 && minDm !== Infinity) {
                    const distDisplay = metersToDisplayUnits(minDm, units);
                    for (const field of bFields) {
                        props['nearest_' + field] = featuresB[nearestIdx].properties?.[field] ?? null;
                    }
                    props['nearest_distance'] = Math.round(distDisplay * 1000) / 1000;
                    props['nearest_distance_units'] = units;
                }
            }

            enriched.push({ ...fA, properties: props });
        }

        // Build updated schema
        const schema = JSON.parse(JSON.stringify(datasetA.schema));
        const addedFields = [...bFields.map(f => 'nearest_' + f), 'nearest_distance', 'nearest_distance_units'];
        for (const name of addedFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: name === 'nearest_distance' ? 'number' : 'string',
                    nullCount: enriched.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        const fc = { type: 'FeatureCollection', features: enriched };
        return createSpatialDataset(`${datasetA.name}_nearestJoin`, fc, { format: 'derived', schema });
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
        const polysA = datasetA.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        const polysB = datasetB.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polysA.length === 0 || polysB.length === 0) {
            throw new Error('Both layers must have polygon features');
        }

        const results = [];
        let pairVisited = 0;
        const total = polysA.length * polysB.length;
        const bboxB = polysB.map(p => getFeatureBBox(p));

        for (let i = 0; i < polysA.length; i++) {
            const ba = getFeatureBBox(polysA[i]);
            for (let j = 0; j < polysB.length; j++) {
                t.throwIfCancelled();
                pairVisited++;
                if (pairVisited % 500 === 0) {
                    t.updateProgress(Math.round((pairVisited / total) * 90), `Intersect pairs ${pairVisited}/${total}`);
                    await new Promise(r => setTimeout(r, 0));
                }
                if (ba && bboxB[j] && !bboxOverlap(ba, bboxB[j])) {
                    continue;
                }
                try {
                    const ix = turf.intersect(turf.featureCollection([polysA[i], polysB[j]]));
                    if (ix) {
                        ix.properties = {
                            ...polysA[i].properties,
                            ...Object.fromEntries(
                                Object.entries(polysB[j].properties || {}).map(([k, v]) => ['B_' + k, v])
                            )
                        };
                        results.push(ix);
                    }
                } catch (_) { /* skip invalid geometry pairs */ }
            }
        }

        const fc = { type: 'FeatureCollection', features: results };
        return createSpatialDataset(
            `${datasetA.name}_intersect_${datasetB.name}`, fc, { format: 'derived' }
        );
    });
}

/**
 * Merge two feature collections into one combined dataset.
 */
export function mergeLayers(datasetA, datasetB) {
    _requireDisplayReady(datasetA, 'Merge');
    _requireDisplayReady(datasetB, 'Merge');
    const featuresA = datasetA.geojson?.features || [];
    const featuresB = datasetB.geojson?.features || [];
    const merged = [...featuresA.map(f => ({ ...f, properties: { ...f.properties } })),
                    ...featuresB.map(f => ({ ...f, properties: { ...f.properties } }))];
    const fc = { type: 'FeatureCollection', features: merged };
    return createSpatialDataset(`${datasetA.name}_merged_${datasetB.name}`, fc, { format: 'derived' });
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
        const polysA = datasetA.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        const polysB = datasetB.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polysA.length === 0) throw new Error('Layer A has no polygon features');

        const results = [];
        const bboxBList = polysB.map(p => getFeatureBBox(p));

        for (let i = 0; i < polysA.length; i++) {
            t.throwIfCancelled();
            if (i % 50 === 0) {
                t.updateProgress(Math.round((i / polysA.length) * 90), `Differencing ${i}/${polysA.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            let current = polysA[i];
            for (let j = 0; j < polysB.length; j++) {
                if (!current) break;
                const cb = getFeatureBBox(current);
                const bb = bboxBList[j];
                if (cb && bb && !bboxOverlap(cb, bb)) {
                    continue;
                }
                try {
                    current = turf.difference(turf.featureCollection([current, polysB[j]]));
                } catch (_) { /* skip on error */ }
            }

            if (current && current.geometry) {
                current.properties = { ...polysA[i].properties };
                results.push(current);
            }
        }

        const fc = { type: 'FeatureCollection', features: results };
        return createSpatialDataset(
            `${datasetA.name}_diff_${datasetB.name}`, fc, { format: 'derived' }
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
        const polygons = polygonsDataset.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        const points = pointsDataset.geojson.features.filter(f =>
            f.geometry && f.geometry.type === 'Point'
        );

        if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

        const polyBoxes = polygons.map(p => getFeatureBBox(p));
        const ptBoxes = points.map(p => getFeatureBBox(p));

        const enriched = [];
        for (let i = 0; i < polygons.length; i++) {
            t.throwIfCancelled();
            if (i % 50 === 0) {
                t.updateProgress(Math.round((i / polygons.length) * 90), `Summarizing ${i}/${polygons.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const poly = polygons[i];
            const pb = polyBoxes[i];
            const contained = [];

            for (let k = 0; k < points.length; k++) {
                const pt = points[k];
                const tb = ptBoxes[k];
                if (pb && tb && !bboxOverlap(pb, tb)) {
                    continue;
                }
                try {
                    if (turf.booleanPointInPolygon(pt, poly)) contained.push(pt);
                } catch (_) { /* skip */ }
            }

            const props = { ...poly.properties, point_count: contained.length };

            if (sumField && contained.length > 0) {
                const vals = contained.map(p => parseFloat(p.properties?.[sumField])).filter(v => !isNaN(v));
                props['sum_' + sumField] = vals.reduce((a, b) => a + b, 0);
            }
            if (avgField && contained.length > 0) {
                const vals = contained.map(p => parseFloat(p.properties?.[avgField])).filter(v => !isNaN(v));
                props['avg_' + avgField] = vals.length > 0
                    ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000
                    : null;
            }

            enriched.push({ ...poly, properties: props });
        }

        // Build updated schema
        const schema = JSON.parse(JSON.stringify(polygonsDataset.schema));
        const newFields = ['point_count'];
        if (sumField) newFields.push('sum_' + sumField);
        if (avgField) newFields.push('avg_' + avgField);
        for (const name of newFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: 'number',
                    nullCount: enriched.length - vals.length,
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

        const fc = { type: 'FeatureCollection', features: enriched };
        return createSpatialDataset(`${polygonsDataset.name}_summary`, fc, { format: 'derived', schema });
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

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            sampleLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Sample via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            return sampleLayerNative(dataset, count);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native sample unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const features = dataset.geojson.features.filter((f) => f.geometry);
    if (features.length === 0) throw new Error('No features to sample');

    const sampleCount = Math.min(count, features.length);
    const sampled = turf.sample(turf.featureCollection(features), sampleCount);
    return createSpatialDataset(`${dataset.name}_sample_${sampleCount}`, sampled, { format: 'derived' });
}

/**
 * Extract every coordinate vertex as a point feature.
 * @param {object} dataset
 * @returns {Promise<object>}
 */
export async function explodeFeatures(dataset) {
    _requireDisplayReady(dataset, 'Explode');

    try {
        const { getPlatformBundle } = await import('../platform/create-platform.js');
        const { hasCapability } = await import('../platform/contracts.js');
        const {
            chooseAnalysisProvider,
            resolveLayerNativePath,
            getLayerAnalysisFeatureCount,
            explodeLayerNative
        } = await import('../library/desktop-analysis.js');
        const { platform } = getPlatformBundle();
        const pythonAvailable = hasCapability(platform, 'pythonCompute');
        const featureCount = getLayerAnalysisFeatureCount(dataset);
        const nativePath = resolveLayerNativePath(dataset);
        if (chooseAnalysisProvider(featureCount, pythonAvailable, nativePath, true) === 'python') {
            logger.info('GISTools', 'Explode via Python sidecar', { count: featureCount, nativePath: Boolean(nativePath) });
            return explodeLayerNative(dataset);
        }
    } catch (err) {
        logger.warn('GISTools', 'Native explode unavailable — falling back to Turf', {
            message: err?.message || String(err)
        });
    }

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const features = dataset.geojson.features.filter((f) => f.geometry);
    if (features.length === 0) throw new Error('No features to explode');

    const task = new TaskRunner('Explode', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(50, 'Extracting vertices');
        await yieldToUI();
        const exploded = turf.explode(turf.featureCollection(features));
        if (!exploded.features.length) throw new Error('No vertices extracted');
        return createSpatialDataset(`${dataset.name}_exploded`, exploded, { format: 'derived' });
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
    sampleFeatures, explodeFeatures
};
