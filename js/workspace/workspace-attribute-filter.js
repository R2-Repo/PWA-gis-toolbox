/**
 * Attribute filters for workspace layers.
 * Rules run against full stored attributes (hot + cold), never the viewport batch.
 * String identity values such as route "0015P" are not coerced to numbers.
 */
import {
    attributeValueToSearchText,
    normalizeAttributeTableQuery,
    rowMatchesAttributeQuery
} from './attribute-table.js';

const STRING_QUERY_OPS = {
    equals: 'equals',
    contains: 'contains',
    starts_with: 'starts_with',
    is_null: 'is_empty',
    is_not_null: 'is_not_empty'
};

/**
 * Pure numeric literal. Leading zeros and mixed tokens (route "0015", "0015P")
 * stay identifiers and do not participate in numeric comparisons.
 * @param {unknown} value
 * @returns {number|null}
 */
export function numericFilterValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} row full attribute row
 * @param {{ field?: string, operator?: string, value?: unknown }} rule
 * @returns {boolean}
 */
export function rowMatchesFilterRule(row, rule) {
    const op = rule?.operator;
    const field = rule?.field;
    if (!op || !field) return true;

    const mapped = STRING_QUERY_OPS[op];
    if (mapped) {
        const query = normalizeAttributeTableQuery({
            field,
            fieldOp: mapped,
            fieldValue: rule.value == null ? '' : String(rule.value)
        });
        return rowMatchesAttributeQuery(row, query);
    }
    if (op === 'not_equals') {
        return !rowMatchesFilterRule(row, { ...rule, operator: 'equals' });
    }
    if (op === 'not_contains') {
        return !rowMatchesFilterRule(row, { ...rule, operator: 'contains' });
    }
    if (op === 'ends_with') {
        const text = attributeValueToSearchText(row?.[field]).toLowerCase();
        return text.endsWith(String(rule.value ?? '').trim().toLowerCase());
    }
    if (op === 'in') {
        const text = attributeValueToSearchText(row?.[field]).toLowerCase();
        const list = String(rule.value ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
        return list.includes(text);
    }
    if (op === 'greater_than' || op === 'less_than' || op === 'gte' || op === 'lte') {
        const left = numericFilterValue(row?.[field]);
        const right = numericFilterValue(rule.value);
        if (left == null || right == null) return false;
        if (op === 'greater_than') return left > right;
        if (op === 'less_than') return left < right;
        if (op === 'gte') return left >= right;
        return left <= right;
    }
    return true;
}

/**
 * @param {object} row
 * @param {Array<{ field?: string, operator?: string, value?: unknown }>} rules
 * @param {string} [logic]
 * @returns {boolean}
 */
export function rowMatchesWorkspaceFilter(row, rules, logic = 'AND') {
    if (!rules?.length) return true;
    const results = rules.map((rule) => rowMatchesFilterRule(row, rule));
    return String(logic).toUpperCase() === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Persist a filter definition and its matching storage indices on the layer.
 * Does not replace layer.geojson (that packet is only the current viewport).
 * @param {object} layer
 * @param {{ rules: object[], logic?: string }} filter
 */
export async function commitWorkspaceAttributeFilter(layer, { rules, logic = 'AND' } = {}) {
    const { scanWorkspaceFilterIndices } = await import('./workspace-store.js');
    const layerId = layer.workspaceLayerId || layer.id;
    const definition = {
        rules: Array.isArray(rules) ? rules : [],
        logic: String(logic).toUpperCase() === 'OR' ? 'OR' : 'AND'
    };
    const { matchIndices } = await scanWorkspaceFilterIndices(layerId, definition, {
        includeCold: true
    });
    layer.workspaceAttributeFilter = definition;
    layer._activeFilter = definition;
    layer._workspaceFilterIndices = matchIndices;
    delete layer._preFilterSnapshot;
    return { matchIndices };
}

/**
 * @param {object} layer
 */
export function clearWorkspaceAttributeFilter(layer) {
    if (!layer) return;
    delete layer.workspaceAttributeFilter;
    delete layer._activeFilter;
    delete layer._workspaceFilterIndices;
    delete layer._preFilterSnapshot;
}
