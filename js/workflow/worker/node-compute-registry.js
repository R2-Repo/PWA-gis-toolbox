import { computeFilterRows } from '../compute/filter-rows.js';
import { computeDeduplicate } from '../compute/deduplicate.js';
import { computeSimplify } from '../compute/simplify.js';

/** @type {Map<string, (inputs: object[], config: object, context: object) => *>} */
export const NODE_COMPUTE_BY_TYPE = new Map([
    ['filter-rows', computeFilterRows],
    ['deduplicate', computeDeduplicate],
    ['simplify', computeSimplify]
]);

export function runNodeCompute(nodeType, inputs, config, context) {
    const fn = NODE_COMPUTE_BY_TYPE.get(nodeType);
    if (!fn) throw new Error(`No worker compute for node type "${nodeType}"`);
    return fn(inputs, config, context);
}
