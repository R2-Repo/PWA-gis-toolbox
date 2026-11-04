/**
 * Turn a filter-builder rule list into a MapLibre filter expression.
 * Tile and service layers keep their geometry filter and add this on top.
 */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numericValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} field
 */
function readField(field) {
    return ['get', field];
}

/**
 * Match a number or the same digits stored as text in an MVT property.
 * @param {string} field
 * @param {unknown} value
 */
function equalsExpr(field, value) {
    const get = readField(field);
    /** @type {unknown[]} */
    const alts = [['==', get, value]];
    if (value != null) alts.push(['==', ['to-string', get], String(value)]);
    return alts.length === 1 ? alts[0] : ['any', ...alts];
}

/**
 * @param {{ field?: string, operator?: string, value?: unknown }} rule
 * @returns {unknown[] | null}
 */
export function attributeRuleToMapFilter(rule) {
    const field = String(rule?.field || '').trim();
    const op = rule?.operator;
    if (!field || !op) return null;
    const get = readField(field);
    if (op === 'equals') return equalsExpr(field, rule.value);
    if (op === 'not_equals') return ['!', equalsExpr(field, rule.value)];
    if (op === 'contains' || op === 'not_contains') {
        const needle = String(rule.value ?? '').trim().toLowerCase();
        const hit = ['>=', ['index-of', needle, ['downcase', ['to-string', get]]], 0];
        return op === 'contains' ? hit : ['!', hit];
    }
    if (op === 'starts_with' || op === 'ends_with') {
        const needle = String(rule.value ?? '').trim().toLowerCase();
        const text = ['downcase', ['to-string', get]];
        if (op === 'starts_with') return ['==', ['index-of', needle, text], 0];
        return ['==', ['index-of', needle, text], ['-', ['length', text], needle.length]];
    }
    if (op === 'greater_than' || op === 'less_than' || op === 'gte' || op === 'lte') {
        const right = numericValue(rule.value);
        if (right == null) return null;
        const left = ['to-number', get];
        if (op === 'greater_than') return ['>', left, right];
        if (op === 'less_than') return ['<', left, right];
        if (op === 'gte') return ['>=', left, right];
        return ['<=', left, right];
    }
    if (op === 'is_null') {
        return ['any', ['!', ['has', field]], ['==', ['to-string', get], '']];
    }
    if (op === 'is_not_null') {
        return ['all', ['has', field], ['!=', ['to-string', get], '']];
    }
    return null;
}

/**
 * @param {Array<{ field?: string, operator?: string, value?: unknown }> | null | undefined} rules
 * @param {string} [logic]
 * @returns {unknown[] | null}
 */
export function attributeRulesToMapFilter(rules, logic = 'AND') {
    const parts = [];
    for (const rule of rules || []) {
        const expr = attributeRuleToMapFilter(rule);
        if (expr) parts.push(expr);
    }
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    return [String(logic).toUpperCase() === 'OR' ? 'any' : 'all', ...parts];
}

/**
 * @param {object | null | undefined} dataset
 * @returns {{ rules: object[], logic: string } | null}
 */
export function attributeFilterDefinition(dataset) {
    const def = dataset?.workspaceAttributeFilter?.rules?.length
        ? dataset.workspaceAttributeFilter
        : dataset?._activeFilter;
    if (!def?.rules?.length) return null;
    return {
        rules: def.rules,
        logic: String(def.logic || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    };
}
