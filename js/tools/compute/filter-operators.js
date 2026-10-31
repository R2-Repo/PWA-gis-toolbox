/** Map legacy/camelCase filter operator names to canonical snake_case keys. */
export const FILTER_OPERATOR_ALIASES = {
    greaterThan: 'greater_than',
    lessThan: 'less_than',
    notEquals: 'not_equals',
    notContains: 'not_contains',
    startsWith: 'starts_with',
    endsWith: 'ends_with',
    isNull: 'is_null',
    isNotNull: 'is_not_null'
};

export function normalizeFilterOperator(operator) {
    if (!operator) return operator;
    return FILTER_OPERATOR_ALIASES[operator] || operator;
}

export function evalFilterRule(props, rule) {
    const raw = props[rule.field];
    const val = raw == null ? '' : String(raw);
    const cmp = String(rule.value ?? '');

    switch (normalizeFilterOperator(rule.operator)) {
        case 'equals': return val === cmp;
        case 'not_equals': return val !== cmp;
        case 'contains': return val.toLowerCase().includes(cmp.toLowerCase());
        case 'not_contains': return !val.toLowerCase().includes(cmp.toLowerCase());
        case 'starts_with': return val.toLowerCase().startsWith(cmp.toLowerCase());
        case 'ends_with': return val.toLowerCase().endsWith(cmp.toLowerCase());
        case 'greater_than': return parseFloat(raw) > parseFloat(cmp);
        case 'less_than': return parseFloat(raw) < parseFloat(cmp);
        case 'gte': return parseFloat(raw) >= parseFloat(cmp);
        case 'lte': return parseFloat(raw) <= parseFloat(cmp);
        case 'is_null': return raw == null || val === '';
        case 'is_not_null': return raw != null && val !== '';
        case 'in': {
            const list = cmp.split(',').map(s => s.trim().toLowerCase());
            return list.includes(val.toLowerCase());
        }
        default: return true;
    }
}
