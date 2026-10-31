/**
 * Worker-safe registry run adapters over js/tools/compute (no UI / TaskRunner).
 */
import { createSpatialDataset } from '../../core/data-model.js';
import { computeFilterRows } from '../compute/filter-rows.js';
import { computeDeduplicate } from '../compute/deduplicate.js';
import { computeSimplify } from '../compute/simplify.js';
import {
    computeRenameFields,
    computeDeleteFields,
    computeSort,
    computeFindReplace,
    computeAddUniqueId,
    computeCombineFields,
    computeSplitColumn,
    computeTemplateBuilder,
    computeTypeConvert,
    computeJoinLookup,
    computeCalculateField,
    computeConditionalValue,
    computeUnitConvert,
    computeAddField
} from '../compute/transform-operations.js';
import {
    computeBuffer,
    computeLineOffset,
    computeDissolve,
    computeClip,
    computeUnion,
    computeCombine,
    computeSpatialJoin,
    computeNearestJoin,
    computeIntersect,
    computeMergeLayers,
    computeDifference,
    computeSummarizeWithin,
    computeSplitByGeometry,
    computeSample,
    computeExplode,
    computePolygonToLine,
    computeFillHoles,
    computeSplitByLine,
    computeSplitByPolygon,
    computeReproject
} from '../compute/spatial-operations.js';

/** @typedef {import('../tool-registry.js').ToolRegistryContext} ToolRegistryContext */

function cloneFeatureCollection(fc) {
    return structuredClone(fc);
}

function spatialInput(name, fc) {
    return createSpatialDataset(name, cloneFeatureCollection(fc), { format: 'derived' });
}

function tableInput(name, rows, schema) {
    return {
        type: 'table',
        name,
        rows: structuredClone(rows),
        schema: schema ? structuredClone(schema) : { fields: [] }
    };
}

function layerInputFromPort(value, fallbackName) {
    if (Array.isArray(value)) {
        return tableInput(fallbackName, value, { fields: [] });
    }
    return spatialInput(fallbackName, value);
}

function countFeatures(value) {
    if (Array.isArray(value)) return value.length;
    return value?.features?.length ?? 0;
}

function adaptContext(ctx) {
    const signal = ctx?.signal;
    const progress = ctx?.progress;
    return {
        signal,
        reportProgress: progress
            ? (p) => {
                  progress(p.progress ?? 0, p.message);
              }
            : undefined,
        progress
    };
}

function spatialResult(dataset, inCount) {
    const fc = dataset.geojson;
    const outCount = fc.features.length;
    return {
        layers: [{ geojson: fc }],
        stats: {
            inCount,
            outCount,
            failed: Math.max(0, inCount - outCount)
        }
    };
}

function makeSingleSpatialRun(computeFn, inputKey = 'in') {
    return async (inputs, params, ctx) => {
        const raw = inputs[inputKey];
        const inCount = countFeatures(raw);
        const wfInputs = [spatialInput('input', raw)];
        const result = await computeFn(wfInputs, params, adaptContext(ctx));
        return spatialResult(result, inCount);
    };
}

function makeDualSpatialRun(computeFn, keys) {
    return async (inputs, params, ctx) => {
        const inCount = keys.reduce((n, k) => n + countFeatures(inputs[k]), 0);
        const wfInputs = keys.map((k, i) => spatialInput(`input${i}`, inputs[k]));
        const result = await computeFn(wfInputs, params, adaptContext(ctx));
        return spatialResult(result, inCount);
    };
}

function makeTableRun(computeFn) {
    return async (inputs, params, ctx) => {
        const raw = inputs.in;
        const wfInputs = [layerInputFromPort(raw, 'input')];
        const inCount = countFeatures(raw);
        const result = await computeFn(wfInputs, params, adaptContext(ctx));
        if (result.type === 'table') {
            return {
                layers: [{ rows: result.rows }],
                stats: { inCount, outCount: result.rows.length, failed: 0 }
            };
        }
        return spatialResult(result, inCount);
    };
}

export const WORKER_RUNS = {
    'filter-rows': makeTableRun(computeFilterRows),
    deduplicate: makeTableRun(computeDeduplicate),
    'rename-fields': makeTableRun(computeRenameFields),
    'delete-fields': makeTableRun(computeDeleteFields),
    sort: makeTableRun(computeSort),
    'find-replace': makeTableRun(computeFindReplace),
    'add-unique-id': makeTableRun(computeAddUniqueId),
    'combine-fields': makeTableRun(computeCombineFields),
    'split-column': makeTableRun(computeSplitColumn),
    'template-builder': makeTableRun(computeTemplateBuilder),
    'type-convert': makeTableRun(computeTypeConvert),
    'join-lookup': async (inputs, params, ctx) => {
        const inCount = countFeatures(inputs.in) + countFeatures(inputs.lookup);
        const wfInputs = [
            layerInputFromPort(inputs.in, 'main'),
            layerInputFromPort(inputs.lookup, 'lookup')
        ];
        const result = await computeJoinLookup(wfInputs, params, adaptContext(ctx));
        if (result.type === 'table') {
            return {
                layers: [{ rows: result.rows }],
                stats: { inCount, outCount: result.rows.length, failed: 0 }
            };
        }
        return spatialResult(result, inCount);
    },
    'calculate-field': makeTableRun(computeCalculateField),
    'conditional-value': makeTableRun(computeConditionalValue),
    'unit-convert': makeTableRun(computeUnitConvert),
    'add-field': makeTableRun(computeAddField),
    buffer: makeSingleSpatialRun(computeBuffer),
    'line-offset': makeSingleSpatialRun(computeLineOffset),
    simplify: makeSingleSpatialRun(computeSimplify),
    dissolve: makeSingleSpatialRun(computeDissolve),
    clip: makeDualSpatialRun(computeClip, ['in', 'clip']),
    union: makeSingleSpatialRun(computeUnion),
    combine: makeSingleSpatialRun(computeCombine),
    'spatial-join': makeDualSpatialRun(computeSpatialJoin, ['points', 'polygons']),
    'nearest-join': makeDualSpatialRun(computeNearestJoin, ['target', 'join']),
    intersect: makeDualSpatialRun(computeIntersect, ['layerA', 'layerB']),
    'merge-layers': makeDualSpatialRun(computeMergeLayers, ['layerA', 'layerB']),
    difference: makeDualSpatialRun(computeDifference, ['layerA', 'subtract']),
    'summarize-within': makeDualSpatialRun(computeSummarizeWithin, ['polygons', 'points']),
    'split-by-geometry': makeSingleSpatialRun(computeSplitByGeometry),
    sample: makeSingleSpatialRun(computeSample),
    explode: makeSingleSpatialRun(computeExplode),
    'polygon-to-line': makeSingleSpatialRun(computePolygonToLine),
    'fill-holes': makeSingleSpatialRun(computeFillHoles),
    'split-by-line': makeDualSpatialRun(computeSplitByLine, ['polygons', 'lines']),
    'split-by-polygon': makeDualSpatialRun(computeSplitByPolygon, ['polygons', 'splitters']),
    reproject: makeSingleSpatialRun(computeReproject)
};
