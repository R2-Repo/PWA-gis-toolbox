import * as turf from '@turf/turf';
import { createSpatialDataset } from '../../core/data-model.js';
import { reprojectDataset } from '../../crs/reproject.js';
import {
    getFeatureBBox,
    getBBoxAny,
    bboxOverlap,
    minBBoxSeparationMeters,
    NEAREST_JOIN_SORT_THRESHOLD
} from '../../tools/spatial-bbox.js';
import { computeFeatureDistance, metersToDisplayUnits } from '../../tools/feature-distance.js';
import {
    polygonsToLineFeatures,
    fillHoleFeatures,
    splitPolygonFeaturesByLines,
    splitPolygonFeaturesByPolygons,
    listPolygonFeatures
} from '../../tools/polygon-ops.js';
import { cloneSchema, createLoopProgress, throwIfAbortedPeriodic } from '../workflow-run-helpers.js';
export { computeSimplify } from './simplify.js';

function requireSpatial(data, label) {
    if (!data || data.type !== 'spatial') throw new Error(`${label}: spatial input required`);
}

export function computeBuffer(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Buffer');
    const distance = config.distance;
    const units = config.units ?? 'kilometers';
    const features = data.geojson.features;
    const buffered = [];
    let failures = 0;
    const tick = createLoopProgress(context, features.length);
    for (let i = 0; i < features.length; i++) {
        tick(i, 'Buffering');
        const f = features[i];
        if (f.geometry) {
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
    if (failures > 0) {
        /* feature-level failures are skipped */
    }
    const fc = { type: 'FeatureCollection', features: buffered };
    return createSpatialDataset(`${data.name}_buffer_${distance}${units}`, fc, { format: 'derived' });
}

export function computeLineOffset(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Line offset');
    const offsetDistance = config.distance;
    const units = config.units ?? 'kilometers';
    const features = data.geojson.features;
    const results = [];
    const tick = createLoopProgress(context, features.length);
    for (let i = 0; i < features.length; i++) {
        tick(i, 'Offsetting lines');
        const f = features[i];
        if (!f.geometry) continue;
        if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
            try {
                const offset = turf.lineOffset(f, offsetDistance, { units });
                if (offset) {
                    offset.properties = { ...f.properties };
                    results.push(offset);
                }
            } catch {
                results.push(f);
            }
        } else {
            results.push(f);
        }
    }
    const fc = { type: 'FeatureCollection', features: results };
    return createSpatialDataset(`${data.name}_offset`, fc, { format: 'derived' });
}

export function computeDissolve(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Dissolve');
    const trimmed = config.field != null ? String(config.field).trim() : '';
    const features = data.geojson.features.filter(f => f?.geometry);

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
    const tick = createLoopProgress(context, groupEntries.length);
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

    const dissolved = { type: 'FeatureCollection', features: dissolvedFeatures };
    return createSpatialDataset(`${data.name}_dissolved`, dissolved, { format: 'derived' });
}

export function computeClip(inputs, config, context) {
    const data = inputs[0];
    const clipData = inputs[1];
    requireSpatial(data, 'Clip');
    requireSpatial(clipData, 'Clip area');
    const clipGeom = clipData.geojson.features[0]?.geometry;
    if (!clipGeom) throw new Error('Clip layer has no geometry');

    const features = data.geojson.features;
    const clipped = [];
    const clipBox = getBBoxAny(clipGeom);
    const tick = createLoopProgress(context, features.length);

    for (let i = 0; i < features.length; i++) {
        tick(i, 'Clipping');
        const f = features[i];
        if (!f.geometry) continue;

        const fb = getFeatureBBox(f);
        if (clipBox && fb && !bboxOverlap(clipBox, fb)) {
            continue;
        }

        try {
            if (f.geometry.type === 'Point') {
                if (turf.booleanPointInPolygon(f, clipGeom)) {
                    clipped.push(f);
                }
            } else {
                const intersection = turf.intersect(
                    turf.featureCollection([turf.feature(clipGeom), f])
                );
                if (intersection) {
                    intersection.properties = { ...f.properties };
                    clipped.push(intersection);
                }
            }
        } catch {
            try {
                const centroid = turf.centroid(f);
                if (turf.booleanPointInPolygon(centroid, clipGeom)) {
                    clipped.push(f);
                }
            } catch { /* skip */ }
        }
    }

    const fc = { type: 'FeatureCollection', features: clipped };
    return createSpatialDataset(`${data.name}_clipped`, fc, { format: 'derived' });
}

export function computeUnion(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Union');
    const polygons = data.geojson.features.filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polygons.length === 0) throw new Error('No polygon features to union');
    if (polygons.length === 1) {
        return createSpatialDataset(`${data.name}_union`, {
            type: 'FeatureCollection',
            features: [polygons[0]]
        }, { format: 'derived' });
    }

    let result = polygons[0];
    const tick = createLoopProgress(context, polygons.length);
    for (let i = 1; i < polygons.length; i++) {
        tick(i, 'Union merge');
        try {
            const merged = turf.union(turf.featureCollection([result, polygons[i]]));
            if (merged) result = merged;
        } catch { /* skip failed pair */ }
    }

    const fc = { type: 'FeatureCollection', features: [result] };
    return createSpatialDataset(`${data.name}_union`, fc, { format: 'derived' });
}

export function computeCombine(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Combine');
    const combined = turf.combine(data.geojson);
    return createSpatialDataset(`${data.name}_combined`, combined, { format: 'derived' });
}

export function computeSpatialJoin(inputs, config, context) {
    const pointsData = inputs[0];
    const polygonsData = inputs[1];
    requireSpatial(pointsData, 'Spatial join points');
    requireSpatial(polygonsData, 'Spatial join polygons');

    const joinFields = config.joinFields
        ? config.joinFields.split(',').map(f => f.trim()).filter(Boolean)
        : [];
    const prefix = config.prefix ?? '';

    const points = pointsData.geojson.features;
    const polygons = polygonsData.geojson.features.filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

    const polyFields = joinFields.length > 0
        ? joinFields
        : Object.keys(polygons[0]?.properties || {});

    const polyBoxes = polygons.map(p => getFeatureBBox(p));
    const enriched = [];
    const tick = createLoopProgress(context, points.length);

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

    const schema = JSON.parse(JSON.stringify(pointsData.schema));
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
    return createSpatialDataset(`${pointsData.name}_spatialJoin`, fc, { format: 'derived', schema });
}

export function computeNearestJoin(inputs, config, context) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Nearest join target');
    requireSpatial(datasetB, 'Nearest join source');

    const joinFields = config.joinFields
        ? config.joinFields.split(',').map(f => f.trim()).filter(Boolean)
        : [];
    const units = config.units ?? 'kilometers';

    const featuresA = datasetA.geojson.features;
    const featuresB = datasetB.geojson.features;
    if (featuresB.length === 0) throw new Error('Join layer has no features');

    const bFields = joinFields.length > 0
        ? joinFields
        : Object.keys(featuresB[0]?.properties || {});

    const bboxB = featuresB.map(f => getFeatureBBox(f));
    const enriched = [];
    const tick = createLoopProgress(context, featuresA.length);

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
}

export function computeIntersect(inputs, config, context) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Intersect layer A');
    requireSpatial(datasetB, 'Intersect layer B');

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
    const total = polysA.length * polysB.length;
    const bboxB = polysB.map(p => getFeatureBBox(p));
    let pairVisited = 0;

    for (let i = 0; i < polysA.length; i++) {
        const ba = getFeatureBBox(polysA[i]);
        for (let j = 0; j < polysB.length; j++) {
            throwIfAbortedPeriodic(context?.signal, pairVisited);
            pairVisited++;
            if (pairVisited % 500 === 0 && context?.reportProgress) {
                context.reportProgress({
                    progress: pairVisited / total,
                    processed: pairVisited,
                    total,
                    message: `Intersect pairs ${pairVisited}/${total}`
                });
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

    const fc = { type: 'FeatureCollection', features: results };
    return createSpatialDataset(
        `${datasetA.name}_intersect_${datasetB.name}`,
        fc,
        { format: 'derived' }
    );
}

export function computeMergeLayers(inputs, config) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Merge layer A');
    requireSpatial(datasetB, 'Merge layer B');
    const featuresA = datasetA.geojson?.features || [];
    const featuresB = datasetB.geojson?.features || [];
    const merged = [
        ...featuresA.map(f => ({ ...f, properties: { ...f.properties } })),
        ...featuresB.map(f => ({ ...f, properties: { ...f.properties } }))
    ];
    const fc = { type: 'FeatureCollection', features: merged };
    return createSpatialDataset(`${datasetA.name}_merged_${datasetB.name}`, fc, { format: 'derived' });
}

export function computeDifference(inputs, config, context) {
    const datasetA = inputs[0];
    const datasetB = inputs[1];
    requireSpatial(datasetA, 'Difference layer A');
    requireSpatial(datasetB, 'Difference subtract');

    const polysA = datasetA.geojson.features.filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    const polysB = datasetB.geojson.features.filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (polysA.length === 0) throw new Error('Layer A has no polygon features');

    const results = [];
    const bboxBList = polysB.map(p => getFeatureBBox(p));
    const tick = createLoopProgress(context, polysA.length);

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

    const fc = { type: 'FeatureCollection', features: results };
    return createSpatialDataset(
        `${datasetA.name}_diff_${datasetB.name}`,
        fc,
        { format: 'derived' }
    );
}

export function computeSummarizeWithin(inputs, config, context) {
    const polygonsDataset = inputs[0];
    const pointsDataset = inputs[1];
    requireSpatial(polygonsDataset, 'Summarize polygons');
    requireSpatial(pointsDataset, 'Summarize points');

    const sumField = config.sumField || undefined;
    const avgField = config.avgField || undefined;

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
    const tick = createLoopProgress(context, polygons.length);

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
}

export function computeSplitByGeometry(inputs, config, context) {
    const data = inputs[0];
    requireSpatial(data, 'Split by geometry');

    const features = data.geojson.features || [];
    const tick = createLoopProgress(context, features.length);
    const pointTypes = new Set(['Point', 'MultiPoint']);
    const lineTypes = new Set(['LineString', 'MultiLineString']);
    const polyTypes = new Set(['Polygon', 'MultiPolygon']);

    const pointFeats = [];
    const lineFeats = [];
    const polyFeats = [];
    for (let i = 0; i < features.length; i++) {
        tick(i, 'Splitting by geometry');
        const f = features[i];
        if (!f.geometry) continue;
        if (pointTypes.has(f.geometry.type)) pointFeats.push(f);
        else if (lineTypes.has(f.geometry.type)) lineFeats.push(f);
        else if (polyTypes.has(f.geometry.type)) polyFeats.push(f);
    }

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
    const count = Math.floor(Number(config.num));
    if (!Number.isFinite(count) || count <= 0) {
        throw new Error('Sample count must be a positive number');
    }

    const features = data.geojson.features.filter(f => f.geometry);
    if (features.length === 0) throw new Error('No features to sample');

    const sampleCount = Math.min(count, features.length);
    const sampled = turf.sample(turf.featureCollection(features), sampleCount);
    return createSpatialDataset(`${data.name}_sample_${sampleCount}`, sampled, { format: 'derived' });
}

export function computeExplode(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Explode');
    const features = data.geojson.features.filter(f => f.geometry);
    if (features.length === 0) throw new Error('No features to explode');

    const exploded = turf.explode(turf.featureCollection(features));
    if (!exploded.features.length) throw new Error('No vertices extracted');
    return createSpatialDataset(`${data.name}_exploded`, exploded, { format: 'derived' });
}

export function computePolygonToLine(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Polygon to line');
    const features = data.geojson.features.filter(f => f.geometry);
    if (listPolygonFeatures(features).length === 0) {
        throw new Error('No polygon features to convert');
    }
    const lines = polygonsToLineFeatures(features);
    if (!lines.length) throw new Error('Could not convert polygons to lines');
    return createSpatialDataset(`${data.name}_outlines`, {
        type: 'FeatureCollection',
        features: lines
    }, { format: 'derived' });
}

export function computeFillHoles(inputs, config) {
    const data = inputs[0];
    requireSpatial(data, 'Fill holes');
    const features = data.geojson.features.filter(f => f.geometry);
    if (listPolygonFeatures(features).length === 0) {
        throw new Error('No polygon features to fill');
    }
    const { features: filled } = fillHoleFeatures(features);
    return createSpatialDataset(`${data.name}_filled`, {
        type: 'FeatureCollection',
        features: filled
    }, { format: 'derived' });
}

export function computeSplitByLine(inputs, config) {
    const polygonDataset = inputs[0];
    const lineDataset = inputs[1];
    requireSpatial(polygonDataset, 'Split by line polygons');
    requireSpatial(lineDataset, 'Split by line lines');

    const polygons = listPolygonFeatures(polygonDataset.geojson.features);
    if (!polygons.length) throw new Error('Polygon layer has no polygon features');
    const lines = (lineDataset.geojson.features || []).filter(f => (
        f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
    ));
    if (!lines.length) throw new Error('Line layer has no line features');

    const pieces = splitPolygonFeaturesByLines(polygons, lines);
    if (!pieces.length) throw new Error('Split produced no polygons');
    return createSpatialDataset(`${polygonDataset.name}_split_line`, {
        type: 'FeatureCollection',
        features: pieces
    }, { format: 'derived' });
}

export function computeSplitByPolygon(inputs, config) {
    const polygonDataset = inputs[0];
    const splitterDataset = inputs[1];
    requireSpatial(polygonDataset, 'Split by polygon target');
    requireSpatial(splitterDataset, 'Split by polygon splitters');

    const polygons = listPolygonFeatures(polygonDataset.geojson.features);
    if (!polygons.length) throw new Error('Polygon layer has no polygon features');
    const splitters = listPolygonFeatures(splitterDataset.geojson.features);
    if (!splitters.length) throw new Error('Splitter layer has no polygon features');

    const pieces = splitPolygonFeaturesByPolygons(polygons, splitters);
    if (!pieces.length) throw new Error('Split produced no polygons');
    return createSpatialDataset(`${polygonDataset.name}_split_poly`, {
        type: 'FeatureCollection',
        features: pieces
    }, { format: 'derived' });
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
