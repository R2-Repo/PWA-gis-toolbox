/**
 * Plan Set Callouts — shared engine foundation (Phase 4).
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const CALLOUT_SHAPES = {
    TRIANGLE: 'triangle',
    SQUARE: 'square',
    OCTAGON: 'octagon',
    CIRCLE: 'circle',
    DIAMOND: 'diamond',
    HEXAGON: 'hexagon'
};

/**
 * @param {object} input
 * @returns {object}
 */
export function createCalloutDefinition(input = {}) {
    return {
        calloutId: input.calloutId || createStableId('callout'),
        code: input.code || '',
        shape: input.shape || CALLOUT_SHAPES.TRIANGLE,
        category: input.category || '',
        shortDescription: input.shortDescription || '',
        fullDescription: input.fullDescription || '',
        symbolKey: input.symbolKey || '',
        displayOrder: Number(input.displayOrder ?? 0),
        defaultSize: Number(input.defaultSize ?? 1),
        defaultTextStyle: input.defaultTextStyle || {},
        optionalProcurementItemId: input.optionalProcurementItemId || '',
        optionalSpecificationReference: input.optionalSpecificationReference || '',
        active: input.active !== false,
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createCalloutRule(input = {}) {
    return {
        ruleId: input.ruleId || createStableId('rule'),
        calloutId: input.calloutId,
        conditions: Array.isArray(input.conditions) ? [...input.conditions] : [],
        matchMode: input.matchMode || 'all',
        active: input.active !== false
    };
}

/**
 * @param {object} feature
 * @param {object} condition
 * @returns {boolean}
 */
export function evaluateCalloutCondition(feature, condition = {}) {
    const props = feature?.properties || {};
    const fieldValue = props[condition.field];

    switch (condition.operator) {
        case 'equals':
            return String(fieldValue) === String(condition.value);
        case 'not_equals':
            return String(fieldValue) !== String(condition.value);
        case 'contains':
            return String(fieldValue || '').includes(String(condition.value || ''));
        case 'blank':
            return fieldValue == null || fieldValue === '';
        case 'populated':
            return fieldValue != null && fieldValue !== '';
        case 'geometry_type_equals':
            return feature?.geometry?.type === condition.value;
        case 'numeric_range': {
            const num = Number(fieldValue);
            const min = Number(condition.min);
            const max = Number(condition.max);
            if (!Number.isFinite(num)) return false;
            if (Number.isFinite(min) && num < min) return false;
            if (Number.isFinite(max) && num > max) return false;
            return true;
        }
        default:
            return false;
    }
}

/**
 * @param {object} feature
 * @param {object} rule
 * @returns {boolean}
 */
export function evaluateCalloutRule(feature, rule) {
    const conditions = rule?.conditions || [];
    if (!conditions.length) return false;
    if (rule.matchMode === 'any') {
        return conditions.some((condition) => evaluateCalloutCondition(feature, condition));
    }
    return conditions.every((condition) => evaluateCalloutCondition(feature, condition));
}

/**
 * @param {object[]} features
 * @param {object[]} rules
 * @param {object[]} definitions
 * @returns {object[]}
 */
export function generateFeatureAssignments(features = [], rules = [], definitions = []) {
    const definitionMap = new Map(definitions.map((def) => [def.calloutId, def]));
    const assignments = [];

    for (const feature of features) {
        const featureId = feature.id || feature.properties?.feature_id || feature.properties?.segment_id;
        const matchedCalloutIds = [];

        for (const rule of rules) {
            if (!rule.active) continue;
            if (evaluateCalloutRule(feature, rule)) {
                matchedCalloutIds.push(rule.calloutId);
            }
        }

        if (!matchedCalloutIds.length) continue;

        assignments.push({
            assignmentId: createStableId('assign'),
            featureId,
            calloutIds: [...new Set(matchedCalloutIds)],
            callouts: matchedCalloutIds
                .map((id) => definitionMap.get(id))
                .filter(Boolean)
        });
    }

    return assignments;
}

/**
 * @param {object[]} placements
 * @returns {object[]}
 */
export function buildSheetCalloutTable(placements = []) {
    const seen = new Map();
    for (const placement of placements) {
        for (const callout of placement.callouts || []) {
            if (!seen.has(callout.calloutId)) {
                seen.set(callout.calloutId, callout);
            }
        }
    }
    return [...seen.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

/**
 * @param {object[]} tables
 * @returns {object[]}
 */
export function buildMasterCalloutLegend(tables = []) {
    const legend = new Map();
    for (const table of tables) {
        for (const callout of table) {
            legend.set(callout.calloutId, callout);
        }
    }
    return [...legend.values()];
}
