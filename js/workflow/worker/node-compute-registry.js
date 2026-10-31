import { adaptComputeContext } from '../compute-run-context.js';
import { computeFilterRows } from '../../tools/compute/filter-rows.js';
import { computeDeduplicate } from '../../tools/compute/deduplicate.js';
import { computeSimplify } from '../../tools/compute/simplify.js';
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
} from '../../tools/compute/transform-operations.js';
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
} from '../../tools/compute/spatial-operations.js';

/** @type {Map<string, (inputs: object[], config: object, context: object) => *>} */
export const NODE_COMPUTE_BY_TYPE = new Map([
    ['filter-rows', computeFilterRows],
    ['deduplicate', computeDeduplicate],
    ['rename-fields', computeRenameFields],
    ['delete-fields', computeDeleteFields],
    ['sort', computeSort],
    ['find-replace', computeFindReplace],
    ['add-unique-id', computeAddUniqueId],
    ['combine-fields', computeCombineFields],
    ['split-column', computeSplitColumn],
    ['template-builder', computeTemplateBuilder],
    ['type-convert', computeTypeConvert],
    ['join-lookup', computeJoinLookup],
    ['calculate-field', computeCalculateField],
    ['conditional-value', computeConditionalValue],
    ['unit-convert', computeUnitConvert],
    ['add-field', computeAddField],
    ['buffer', computeBuffer],
    ['line-offset', computeLineOffset],
    ['simplify', computeSimplify],
    ['dissolve', computeDissolve],
    ['clip', computeClip],
    ['union', computeUnion],
    ['combine', computeCombine],
    ['spatial-join', computeSpatialJoin],
    ['nearest-join', computeNearestJoin],
    ['intersect', computeIntersect],
    ['merge-layers', computeMergeLayers],
    ['difference', computeDifference],
    ['summarize-within', computeSummarizeWithin],
    ['split-by-geometry', computeSplitByGeometry],
    ['sample', computeSample],
    ['explode', computeExplode],
    ['polygon-to-line', computePolygonToLine],
    ['fill-holes', computeFillHoles],
    ['split-by-line', computeSplitByLine],
    ['split-by-polygon', computeSplitByPolygon],
    ['reproject', computeReproject]
]);

export const WORKER_CAPABLE_NODE_TYPES = new Set(NODE_COMPUTE_BY_TYPE.keys());

export function runNodeCompute(nodeType, inputs, config, context) {
    const fn = NODE_COMPUTE_BY_TYPE.get(nodeType);
    if (!fn) throw new Error(`No worker compute for node type "${nodeType}"`);
    return fn(inputs, config, adaptComputeContext(context));
}
