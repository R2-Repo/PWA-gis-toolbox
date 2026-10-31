import * as turf from '@turf/turf';
import { createSpatialDataset } from '../../core/data-model.js';
import { reprojectDataset } from '../../crs/reproject.js';
import {
    getFeatureBBox,
    getBBoxAny,
    bboxOverlap,
    bboxToLngSegments,
    minBBoxSeparationMeters,
    NEAREST_JOIN_SORT_THRESHOLD
} from '../spatial-bbox.js';
import { computeFeatureDistance, metersToDisplayUnits } from '../feature-distance.js';
import {
    polygonsToLineFeatures,
    fillHoleFeatures,
    splitPolygonFeaturesByLines,
    splitPolygonFeaturesByPolygons,
    listPolygonFeatures
} from '../polygon-ops.js';
import { createLoopProgress, throwIfAbortedPeriodic } from './ctx.js';

function fcStats(inCount, outCount, failed = 0) {
    return { inCount, outCount, failed };
}

function cloneFeature(f) {
    return structuredClone(f);
}

/** @param {import('geojson').Geometry} clipGeometry */
function clipGeometryForAntimeridian(clipGeometry) {
    const clipBox = getBBoxAny(clipGeometry);
    if (!clipBox || bboxToLngSegments(clipBox).length <= 1) {
        return clipGeometry;
    }
    if (typeof turf === 'undefined') return clipGeometry;
    const segments = bboxToLngSegments(clipBox);
    if (segments.length === 1) return clipGeometry;
    return {
        type: 'MultiPolygon',
        coordinates: segments.map(([w, s, e, n]) =>
            turf.bboxPolygon([w, s, e, n]).geometry.coordinates
        )
    };
}

function requireSpatial(data, label) {
    if (!data || data.type !== 'spatial') throw new Error(`${label}: spatial input required`);
}

/**
 * @param {import('geojson').FeatureCollection} inputFc
 * @param {{ distance: number, units?: string }} params
 * @param {object} [ctx]
 */
export function bufferFeatureCollection(inputFc, params, ctx) {
    const distance = params.distance;
    const units = params.units ?? 'kilometers';
    const features = inputFc.features || [];
    const buffered = [];
    let failures = 0;
    const tick = createLoopProgress(ctx, features.length);

    for (let i = 0; i < features.length; i++) {
        tick(i, 'Buffering');
        const f = features[i];
        if (f?.geometry) {
            try {
                const b = turf.buffer(f, distance, { units });
                if (b) {
                    b.properties = { ...f.properties };
                    buffered.push(b);
                }
            } catch {
                failures++;
            }
        }
    }

    return {
        geojson: { type: 'FeatureCollection', features: buffered },
        stats: fcStats(features.length, buffered.length, failures)
    };
}

/**
 * Clip input features to a clip polygon geometry (gis-tools clipFeatures semantics).
 * @param {import('geojson').FeatureCollection} inputFc
 * @param {import('geojson').Geometry} clipGeometry
 * @param {object} [ctx]
 */
export function clipFeatureCollection(inputFc, clipGeometry, ctx) {
    const features = inputFc.features || [];
    const clipped = [];
    let clipFailures = 0;
    const clipBox = getBBoxAny(clipGeometry);
    const activeClip = clipGeometryForAntimeridian(clipGeometry);
    const tick = createLoopProgress(ctx, features.length);

    for (let i = 0; i < features.length; i++) {
        tick(i, 'Clipping');
        const f = features[i];
        if (!f?.geometry) continue;

        const fb = getFeatureBBox(f);
        if (clipBox && fb && !bboxOverlap(clipBox, fb)) {
            continue;
        }

        try {
            if (f.geometry.type === 'Point') {
                if (turf.booleanPointInPolygon(f, activeClip)) {
                    clipped.push(cloneFeature(f));
                }
            } else if (f.geometry.type === 'MultiPoint') {
                const inside = f.geometry.coordinates.filter((c) =>
                    turf.booleanPointInPolygon(turf.point(c), activeClip)
                );
                if (inside.length > 0) {
                    clipped.push({
                        type: 'Feature',
                        properties: { ...f.properties },
                        geometry: { type: 'MultiPoint', coordinates: inside }
                    });
                }
            } else {
                const intersection = turf.intersect(
                    turf.featureCollection([turf.feature(activeClip), f])
                );
                if (intersection) {
                    intersection.properties = { ...f.properties };
                    clipped.push(intersection);
                }
            }
        } catch {
            clipFailures++;
        }
    }

    return {
        geojson: { type: 'FeatureCollection', features: clipped },
        stats: fcStats(features.length, clipped.length, clipFailures)
    };
}

export function dissolveFeatureCollection(inputFc, params, ctx) {
    const trimmed = params.field != null ? String(params.field).trim() : '';
    const features = (inputFc.features || []).filter(f => f?.geometry);

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
    const groupEntries = [...groups.values()];
    const tick = createLoopProgress(ctx, groupEntries.length);
    let gi = 0;
    for (const groupFeatures of groupEntries) {
        tick(gi, 'Dissolving');
        const fc = { type: 'FeatureCollection', features: groupFeatures };
        const part = trimmed
            ? turf.dissolve(fc, { propertyName: trimmed })
            : turf.dissolve(fc);
        if (part?.features) dissolvedFeatures.push(...part.features);
        gi++;
    }

    return {
        geojson: { type: 'FeatureCollection', features: dissolvedFeatures },
        stats: fcStats(features.length, dissolvedFeatures.length, 0)
    };
}

export function lineOffsetFeatureCollection(inputFc, params, ctx) {
    const offsetDistance = params.distance;
    const units = params.units ?? 'kilometers';
    const features = inputFc.features || [];
    const results = [];
    let failures = 0;
    const tick = createLoopProgress(ctx, features.length);

    for (let i = 0; i < features.length; i++) {
        tick(i, 'Offsetting lines');
        const f = features[i];
        if (!f?.geometry) continue;
        if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
            try {
                const offset = turf.lineOffset(f, offsetDistance, { units });
                if (offset) {
                    offset.properties = { ...f.properties };
                    results.push(offset);
                }
            } catch {
                failures++;
                results.push(cloneFeature(f));
            }
        } else {
            results.push(cloneFeature(f));
        }
    }

    return {
        geojson: { type: 'FeatureCollection', features: results },
        stats: fcStats(features.length, results.length, failures)
    };
}

/**
 * Union polygon features. Turf union drops properties; keep the first input polygon's
 * attribute row on the merged feature (same convention as a single-feature dissolve group).
 */
export function unionFeatureCollection(inputFc, ctx) {
    const polygons = (inputFc.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polygons.length === 0) throw new Error('No polygon features to union');
    const firstProps = { ...(polygons[0].properties ?? {}) };
    if (polygons.length === 1) {
        return {
            geojson: { type: 'FeatureCollection', features: [cloneFeature(polygons[0])] },
            stats: { ...fcStats(polygons.length, 1, 0), unionInputCount: 1 }
        };
    }

    let result = cloneFeature(polygons[0]);
    let unionFailures = 0;
    const tick = createLoopProgress(ctx, polygons.length);
    for (let i = 1; i < polygons.length; i++) {
        tick(i, 'Union merge');
        try {
            const merged = turf.union(turf.featureCollection([result, polygons[i]]));
            if (merged) result = merged;
        } catch {
            unionFailures++;
        }
    }

    result.properties = { ...firstProps };
    return {
        geojson: { type: 'FeatureCollection', features: [result] },
        stats: { ...fcStats(polygons.length, 1, unionFailures), unionInputCount: polygons.length }
    };
}

export function combineFeatureCollection(inputFc) {
    const combined = turf.combine(inputFc);
    const outCount = combined.features?.length ?? 0;
    return {
        geojson: combined,
        stats: fcStats(inputFc.features?.length ?? 0, outCount, 0)
    };
}

export function spatialJoinFeatureCollections(pointsFc, polygonsFc, params, ctx) {
    const joinFields = params.joinFields
        ? (Array.isArray(params.joinFields)
            ? params.joinFields
            : params.joinFields.split(',').map(f => f.trim()).filter(Boolean))
        : [];
    const prefix = params.prefix ?? '';

    const points = pointsFc.features || [];
    const polygons = (polygonsFc.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

    const polyFields = joinFields.length > 0
        ? joinFields
        : Object.keys(polygons[0]?.properties || {});

    const polyBoxes = polygons.map(p => getFeatureBBox(p));
    const enriched = [];
    const tick = createLoopProgress(ctx, points.length);

    for (let i = 0; i < points.length; i++) {
        tick(i, 'Spatial join');
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
                } catch { /* skip invalid polygons */ }
            }
        }

        if (!matched) {
            for (const field of polyFields) {
                if (!(prefix + field in props)) props[prefix + field] = null;
            }
        }

        enriched.push({ ...pt, properties: props });
    }

    return {
        geojson: { type: 'FeatureCollection', features: enriched },
        stats: fcStats(points.length, enriched.length, 0),
        schemaFields: polyFields.map(field => prefix + field)
    };
}

export function nearestJoinFeatureCollections(fcA, fcB, params, ctx) {
    const joinFields = params.joinFields
        ? (Array.isArray(params.joinFields)
            ? params.joinFields
            : params.joinFields.split(',').map(f => f.trim()).filter(Boolean))
        : [];
    const units = params.units ?? 'kilometers';

    const featuresA = fcA.features || [];
    const featuresB = fcB.features || [];
    if (featuresB.length === 0) throw new Error('Join layer has no features');

    const bFields = joinFields.length > 0
        ? joinFields
        : Object.keys(featuresB[0]?.properties || {});

    const bboxB = featuresB.map(f => getFeatureBBox(f));
    const enriched = [];
    const tick = createLoopProgress(ctx, featuresA.length);

    for (let i = 0; i < featuresA.length; i++) {
        tick(i, 'Nearest join');
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
                props.nearest_distance = Math.round(distDisplay * 1000) / 1000;
                props.nearest_distance_units = units;
            }
        }

        enriched.push({ ...fA, properties: props });
    }

    return {
        geojson: { type: 'FeatureCollection', features: enriched },
        stats: fcStats(featuresA.length, enriched.length, 0),
        bFields
    };
}

export function intersectFeatureCollections(fcA, fcB, ctx) {
    const polysA = (fcA.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    const polysB = (fcB.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polysA.length === 0 || polysB.length === 0) {
        throw new Error('Both layers must have polygon features');
    }

    const results = [];
    const total = polysA.length * polysB.length;
    const bboxB = polysB.map(p => getFeatureBBox(p));
    let pairVisited = 0;

    for (let i = 0; i < polysA.length; i++) {
        const ba = getFeatureBBox(polysA[i]);
        for (let j = 0; j < polysB.length; j++) {
            throwIfAbortedPeriodic(ctx?.signal, pairVisited);
            pairVisited++;
            if (pairVisited % 500 === 0 && ctx?.progress) {
                ctx.progress(pairVisited / total, `Intersect pairs ${pairVisited}/${total}`);
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
            } catch { /* skip invalid geometry pairs */ }
        }
    }

    return {
        geojson: { type: 'FeatureCollection', features: results },
        stats: fcStats(polysA.length + polysB.length, results.length, 0)
    };
}

export function mergeFeatureCollections(fcA, fcB) {
    const featuresA = fcA.features || [];
    const featuresB = fcB.features || [];
    const merged = [
        ...featuresA.map(f => ({ ...f, properties: { ...f.properties } })),
        ...featuresB.map(f => ({ ...f, properties: { ...f.properties } }))
    ];
    return {
        geojson: { type: 'FeatureCollection', features: merged },
        stats: fcStats(featuresA.length + featuresB.length, merged.length, 0)
    };
}

export function differenceFeatureCollections(fcA, fcB, ctx) {
    const polysA = (fcA.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    const polysB = (fcB.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polysA.length === 0) throw new Error('Layer A has no polygon features');

    const results = [];
    const bboxBList = polysB.map(p => getFeatureBBox(p));
    const tick = createLoopProgress(ctx, polysA.length);

    for (let i = 0; i < polysA.length; i++) {
        tick(i, 'Difference');
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
            } catch { /* skip on error */ }
        }

        if (current && current.geometry) {
            current.properties = { ...polysA[i].properties };
            results.push(current);
        }
    }

    return {
        geojson: { type: 'FeatureCollection', features: results },
        stats: fcStats(polysA.length, results.length, 0)
    };
}

export function summarizeWithinFeatureCollections(polygonsFc, pointsFc, params, ctx) {
    const sumField = params.sumField || undefined;
    const avgField = params.avgField || undefined;

    const polygons = (polygonsFc.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    const points = (pointsFc.features || []).filter(f =>
        f.geometry && f.geometry.type === 'Point'
    );

    if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

    const polyBoxes = polygons.map(p => getFeatureBBox(p));
    const ptBoxes = points.map(p => getFeatureBBox(p));
    const enriched = [];
    const tick = createLoopProgress(ctx, polygons.length);

    for (let i = 0; i < polygons.length; i++) {
        tick(i, 'Summarize within');
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
            } catch { /* skip */ }
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

    return {
        geojson: { type: 'FeatureCollection', features: enriched },
        stats: fcStats(polygons.length, enriched.length, 0),
        sumField,
        avgField
    };
}

export function sampleFeatureCollection(inputFc, params) {
    const count = Math.floor(Number(params.num));
    if (!Number.isFinite(count) || count <= 0) {
        throw new Error('Sample count must be a positive number');
    }

    const features = (inputFc.features || []).filter(f => f.geometry);
    if (features.length === 0) throw new Error('No features to sample');

    const sampleCount = Math.min(count, features.length);
    const sampled = turf.sample(turf.featureCollection(features), sampleCount);
    return {
        geojson: sampled,
        stats: fcStats(features.length, sampled.features.length, 0)
    };
}

export function explodeFeatureCollection(inputFc) {
    const features = (inputFc.features || []).filter(f => f.geometry);
    if (features.length === 0) throw new Error('No features to explode');

    const exploded = turf.explode(turf.featureCollection(features));
    if (!exploded.features.length) throw new Error('No vertices extracted');
    return {
        geojson: exploded,
        stats: fcStats(features.length, exploded.features.length, 0)
    };
}

export function polygonToLineFeatureCollection(inputFc) {
    const features = (inputFc.features || []).filter(f => f.geometry);
    if (listPolygonFeatures(features).length === 0) {
        throw new Error('No polygon features to convert');
    }
    const lines = polygonsToLineFeatures(features);
    if (!lines.length) throw new Error('Could not convert polygons to lines');
    return {
        geojson: { type: 'FeatureCollection', features: lines },
        stats: fcStats(features.length, lines.length, 0)
    };
}

export function fillHolesFeatureCollection(inputFc) {
    const features = (inputFc.features || []).filter(f => f.geometry);
    if (listPolygonFeatures(features).length === 0) {
        throw new Error('No polygon features to fill');
    }
    const { features: filled, holesRemoved } = fillHoleFeatures(features);
    return {
        geojson: { type: 'FeatureCollection', features: filled },
        stats: fcStats(features.length, filled.length, 0),
        holesRemoved
    };
}

export function splitByLineFeatureCollections(polygonFc, lineFc) {
    const polygons = listPolygonFeatures(polygonFc.features || []);
    if (!polygons.length) throw new Error('Polygon layer has no polygon features');
    const lines = (lineFc.features || []).filter(f => (
        f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
    ));
    if (!lines.length) throw new Error('Line layer has no line features');

    const pieces = splitPolygonFeaturesByLines(polygons, lines);
    if (!pieces.length) throw new Error('Split produced no polygons');
    return {
        geojson: { type: 'FeatureCollection', features: pieces },
        stats: fcStats(polygons.length, pieces.length, 0)
    };
}

export function splitByPolygonFeatureCollections(polygonFc, splitterFc) {
    const polygons = listPolygonFeatures(polygonFc.features || []);
    if (!polygons.length) throw new Error('Polygon layer has no polygon features');
    const splitters = listPolygonFeatures(splitterFc.features || []);
    if (!splitters.length) throw new Error('Splitter layer has no polygon features');

    const pieces = splitPolygonFeaturesByPolygons(polygons, splitters);
    if (!pieces.length) throw new Error('Split produced no polygons');
    return {
        geojson: { type: 'FeatureCollection', features: pieces },
        stats: fcStats(polygons.length, pieces.length, 0)
    };
}

function cloneSchema(schema) {
    return JSON.parse(JSON.stringify(schema));
}

export function splitByGeometryFeatureCollection(inputFc, ctx) {
    const dataFeatures = inputFc.features || [];
    const tick = createLoopProgress(ctx, dataFeatures.length);
    const pointTypes = new Set(['Point', 'MultiPoint']);
    const lineTypes = new Set(['LineString', 'MultiLineString']);
    const polyTypes = new Set(['Polygon', 'MultiPolygon']);

    const pointFeats = [];
    const lineFeats = [];
    const polyFeats = [];
    for (let i = 0; i < dataFeatures.length; i++) {
        tick(i, 'Splitting by geometry');
        const f = dataFeatures[i];
        if (!f.geometry) continue;
        if (pointTypes.has(f.geometry.type)) pointFeats.push(f);
        else if (lineTypes.has(f.geometry.type)) lineFeats.push(f);
        else if (polyTypes.has(f.geometry.type)) polyFeats.push(f);
    }

    return {
        pointFeats,
        lineFeats,
        polyFeats,
        stats: fcStats(dataFeatures.length, pointFeats.length + lineFeats.length + polyFeats.length, 0)
    };
}

function appendSchemaFields(schema, enriched, fieldNames) {
    const s = cloneSchema(schema);
    for (const name of fieldNames) {
        if (!s.fields.find(f => f.name === name)) {
            const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
            s.fields.push({
                name,
                type: typeof vals[0] === 'number' ? 'number' : 'string',
                nullCount: enriched.length - vals.length,
                uniqueCount: new Set(vals).size,
                sampleValues: vals.slice(0, 5),
                selected: true,
                outputName: name,
                order: s.fields.length
            });
        }
    }
    return s;
}

function appendNumericSchemaFields(schema, enriched, fieldNames) {
    const s = cloneSchema(schema);
    for (const name of fieldNames) {
        if (!s.fields.find(f => f.name === name)) {
            const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
            s.fields.push({
                name,
                type: 'number',
                nullCount: enriched.length - vals.length,
                uniqueCount: new Set(vals).size,
                sampleValues: vals.slice(0, 5),
                min: vals.length ? Math.min(...vals) : null,
                max: vals.length ? Math.max(...vals) : null,
                selected: true,
                outputName: name,
                order: s.fields.length
            });
        }
    }
    return s;
}

// --- Workflow-shaped adapters (inputs = spatial datasets) ---

export function computeBuffer(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Buffer');
    const { geojson, stats } = bufferFeatureCollection(data.geojson, config, context);
    return createSpatialDataset(
        `${data.name}_buffer_${config.distance}${config.units ?? 'kilometers'}`,
        geojson,
        { format: 'derived' }
    );
}

export function computeLineOffset(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Line offset');
    const { geojson } = lineOffsetFeatureCollection(data.geojson, config, context);
    return createSpatialDataset(`${data.name}_offset`, geojson, { format: 'derived' });
}

export function computeDissolve(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Dissolve');
    const { geojson } = dissolveFeatureCollection(data.geojson, { field: config.field }, context);
    return createSpatialDataset(`${data.name}_dissolved`, geojson, { format: 'derived' });
}

export function computeClip(inputs, config, context) {
    const data = inputs[0];
    const clipData = inputs[1];
    requireSpatial(data, 'Clip');
    requireSpatial(clipData, 'Clip area');
    const clipGeom = clipData.geojson.features[0]?.geometry;
    if (!clipGeom) throw new Error('Clip layer has no geometry');
    const { geojson } = clipFeatureCollection(data.geojson, clipGeom, context);
    return createSpatialDataset(`${data.name}_clipped`, geojson, { format: 'derived' });
}

export function computeUnion(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Union');
    const { geojson } = unionFeatureCollection(data.geojson, context);
    return createSpatialDataset(`${data.name}_union`, geojson, { format: 'derived' });
}

export function computeCombine(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Combine');
    const { geojson } = combineFeatureCollection(data.geojson);
    return createSpatialDataset(`${data.name}_combined`, geojson, { format: 'derived' });
}

export function computeSpatialJoin(inputs, config, context) {
    const pointsData = inputs[0];
    const polygonsData = inputs[1];
    requireSpatial(pointsData, 'Spatial join points');
    requireSpatial(polygonsData, 'Spatial join polygons');

    const { geojson, schemaFields } = spatialJoinFeatureCollections(
        pointsData.geojson,
        polygonsData.geojson,
        config,
        context
    );
    const schema = appendSchemaFields(pointsData.schema, geojson.features, schemaFields);
    return createSpatialDataset(`${pointsData.name}_spatialJoin`, geojson, { format: 'derived', schema });
}

export function computeNearestJoin(inputs, config, context) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Nearest join target');
    requireSpatial(datasetB, 'Nearest join source');

    const { geojson, bFields } = nearestJoinFeatureCollections(
        datasetA.geojson,
        datasetB.geojson,
        config,
        context
    );
    const addedFields = [...bFields.map(f => 'nearest_' + f), 'nearest_distance', 'nearest_distance_units'];
    const schema = appendSchemaFields(datasetA.schema, geojson.features, addedFields);
    return createSpatialDataset(`${datasetA.name}_nearestJoin`, geojson, { format: 'derived', schema });
}

export function computeIntersect(inputs, config, context) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Intersect layer A');
    requireSpatial(datasetB, 'Intersect layer B');
    const { geojson } = intersectFeatureCollections(datasetA.geojson, datasetB.geojson, context);
    return createSpatialDataset(
        `${datasetA.name}_intersect_${datasetB.name}`,
        geojson,
        { format: 'derived' }
    );
}

export function computeMergeLayers(inputs, config) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Merge layer A');
    requireSpatial(datasetB, 'Merge layer B');
    const { geojson } = mergeFeatureCollections(datasetA.geojson, datasetB.geojson);
    return createSpatialDataset(`${datasetA.name}_merged_${datasetB.name}`, geojson, { format: 'derived' });
}

export function computeDifference(inputs, config, context) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Difference layer A');
    requireSpatial(datasetB, 'Difference subtract');
    const { geojson } = differenceFeatureCollections(datasetA.geojson, datasetB.geojson, context);
    return createSpatialDataset(
        `${datasetA.name}_diff_${datasetB.name}`,
        geojson,
        { format: 'derived' }
    );
}

export function computeSummarizeWithin(inputs, config, context) {
    const polygonsDataset = inputs[0];
    const pointsDataset = inputs[1];
    requireSpatial(polygonsDataset, 'Summarize polygons');
    requireSpatial(pointsDataset, 'Summarize points');

    const { geojson, sumField, avgField } = summarizeWithinFeatureCollections(
        polygonsDataset.geojson,
        pointsDataset.geojson,
        config,
        context
    );
    const newFields = ['point_count'];
    if (sumField) newFields.push('sum_' + sumField);
    if (avgField) newFields.push('avg_' + avgField);
    const schema = appendNumericSchemaFields(polygonsDataset.schema, geojson.features, newFields);
    return createSpatialDataset(`${polygonsDataset.name}_summary`, geojson, { format: 'derived', schema });
}

export function computeSplitByGeometry(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Split by geometry');
    const { pointFeats, lineFeats, polyFeats } = splitByGeometryFeatureCollection(data.geojson, context);

    const buildOutput = (feats, geomType, suffix) => {
        const fc = { type: 'FeatureCollection', features: feats };
        const schema = cloneSchema(data.schema);
        schema.geometryType = feats.length > 0 ? geomType : null;
        schema.featureCount = feats.length;
        return {
            type: 'spatial',
            geojson: fc,
            schema,
            name: `${data.name}_${suffix}`
        };
    };

    return {
        _multiOutput: true,
        ports: {
            points: buildOutput(pointFeats, 'Point', 'points'),
            lines: buildOutput(lineFeats, 'LineString', 'lines'),
            polygons: buildOutput(polyFeats, 'Polygon', 'polygons')
        }
    };
}

export function computeSample(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Sample');
    const { geojson } = sampleFeatureCollection(data.geojson, config);
    const sampleCount = geojson.features.length;
    return createSpatialDataset(`${data.name}_sample_${sampleCount}`, geojson, { format: 'derived' });
}

export function computeExplode(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Explode');
    const { geojson } = explodeFeatureCollection(data.geojson);
    return createSpatialDataset(`${data.name}_exploded`, geojson, { format: 'derived' });
}

export function computePolygonToLine(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Polygon to line');
    const { geojson } = polygonToLineFeatureCollection(data.geojson);
    return createSpatialDataset(`${data.name}_outlines`, geojson, { format: 'derived' });
}

export function computeFillHoles(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Fill holes');
    const { geojson } = fillHolesFeatureCollection(data.geojson);
    return createSpatialDataset(`${data.name}_filled`, geojson, { format: 'derived' });
}

export function computeSplitByLine(inputs, config) {
    const polygonDataset = inputs[0];
    const lineDataset = inputs[1];
    requireSpatial(polygonDataset, 'Split by line polygons');
    requireSpatial(lineDataset, 'Split by line lines');
    const { geojson } = splitByLineFeatureCollections(polygonDataset.geojson, lineDataset.geojson);
    return createSpatialDataset(`${polygonDataset.name}_split_line`, geojson, { format: 'derived' });
}

export function computeSplitByPolygon(inputs, config) {
    const polygonDataset = inputs[0];
    const splitterDataset = inputs[1];
    requireSpatial(polygonDataset, 'Split by polygon target');
    requireSpatial(splitterDataset, 'Split by polygon splitters');
    const { geojson } = splitByPolygonFeatureCollections(polygonDataset.geojson, splitterDataset.geojson);
    return createSpatialDataset(`${polygonDataset.name}_split_poly`, geojson, { format: 'derived' });
}

export async function computeReproject(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Reproject');
    const fromCrs = config.fromCrs || data.schema?.crs || 'EPSG:4326';
    return reprojectDataset(data, {
        fromCrs,
        toCrs: config.toCrs,
        name: `${data.name}_reproject`
    });
}
