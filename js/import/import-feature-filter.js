/**
 * Pre-import feature filters — geometry type allow-list + attribute rules.
 * Shared by stream worker and standard post-import path.
 */
import { evaluateRule, FILTER_OPERATORS } from '../dataprep/transforms.js';
import { VALUE_SCAN_VALUE_CAP } from './import-scan-cache.js';

/** @typedef {'Point'|'MultiPoint'|'LineString'|'MultiLineString'|'Polygon'|'MultiPolygon'} GeomType */

/** Distinct values kept per field in the filter UI scan. */
export const IMPORT_VALUE_SCAN_CAP = VALUE_SCAN_VALUE_CAP;

export const DEFAULT_GEOMETRY_TYPES = Object.freeze({
    point: true,
    line: true,
    polygon: true
});

export const IMPORT_FILTER_OPERATORS = [
    ...FILTER_OPERATORS,
    { value: 'not_in', label: 'Not in' }
];

/**
 * Normalize a GeoJSON geometry type into point | line | polygon.
 * @param {string|null|undefined} geometryType
 * @returns {'point'|'line'|'polygon'|null}
 */
export function geometryTypeClass(geometryType) {
    if (!geometryType || typeof geometryType !== 'string') return null;
    switch (geometryType) {
        case 'Point':
        case 'MultiPoint':
            return 'point';
        case 'LineString':
        case 'MultiLineString':
            return 'line';
        case 'Polygon':
        case 'MultiPolygon':
            return 'polygon';
        default:
            return null;
    }
}

/**
 * @param {{ point?: boolean, line?: boolean, polygon?: boolean }|null|undefined} geometryTypes
 * @returns {boolean} true when at least one class is allowed
 */
export function hasAllowedGeometryType(geometryTypes) {
    const g = normalizeGeometryTypes(geometryTypes);
    return !!(g.point || g.line || g.polygon);
}

/**
 * @param {{ point?: boolean, line?: boolean, polygon?: boolean }|null|undefined} geometryTypes
 */
export function normalizeGeometryTypes(geometryTypes) {
    if (!geometryTypes || typeof geometryTypes !== 'object') {
        return { ...DEFAULT_GEOMETRY_TYPES };
    }
    return {
        point: geometryTypes.point !== false,
        line: geometryTypes.line !== false,
        polygon: geometryTypes.polygon !== false
    };
}

/**
 * Rule is ready to apply (not an empty draft row).
 * @param {{ field?: string, operator?: string, value?: unknown }|null|undefined} rule
 * @returns {boolean}
 */
export function isCompleteImportFilterRule(rule) {
    if (!rule?.field || !rule?.operator) return false;
    if (rule.operator === 'is_null' || rule.operator === 'is_not_null') return true;
    const v = rule.value;
    if (v == null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
}

/**
 * @param {object|null|undefined} featureFilter
 * @returns {boolean}
 */
export function hasActiveFeatureFilter(featureFilter) {
    if (!featureFilter || typeof featureFilter !== 'object') return false;
    const g = normalizeGeometryTypes(featureFilter.geometryTypes);
    const allGeom = g.point && g.line && g.polygon;
    const rules = Array.isArray(featureFilter.rules)
        ? featureFilter.rules.filter(isCompleteImportFilterRule)
        : [];
    return !allGeom || rules.length > 0;
}

/**
 * Normalize a rule value for evaluateRule (`in` accepts comma-separated strings).
 * @param {unknown} value
 * @param {string} operator
 */
export function normalizeRuleValue(value, operator) {
    if (operator === 'is_null' || operator === 'is_not_null') return '';
    if (Array.isArray(value)) {
        return value.map((v) => String(v)).join(',');
    }
    return value ?? '';
}

/**
 * @param {object} props
 * @param {{ field: string, operator: string, value?: unknown }} rule
 */
export function evaluateImportRule(props, rule) {
    if (!rule?.field || !rule?.operator) return true;
    const normalized = {
        field: rule.field,
        operator: rule.operator,
        value: normalizeRuleValue(rule.value, rule.operator)
    };
    if (rule.operator === 'not_in') {
        const val = props?.[rule.field];
        const target = String(normalized.value);
        if (!target.trim()) return true;
        const set = new Set(target.split(',').map((s) => s.trim()));
        return !set.has(String(val));
    }
    return evaluateRule(props || {}, normalized);
}

/**
 * @param {import('geojson').Feature|object} feature
 * @param {{
 *   geometryTypes?: { point?: boolean, line?: boolean, polygon?: boolean },
 *   rules?: Array<{ field: string, operator: string, value?: unknown }>,
 *   logic?: 'AND'|'OR'
 * }|null|undefined} featureFilter
 * @returns {boolean}
 */
export function featureMatchesImportFilters(feature, featureFilter) {
    if (!featureFilter || typeof featureFilter !== 'object') return true;

    const geometryTypes = normalizeGeometryTypes(featureFilter.geometryTypes);
    const geomClass = geometryTypeClass(feature?.geometry?.type);
    if (geomClass && !geometryTypes[geomClass]) {
        return false;
    }
    // Features with no geometry still pass geometry-type filter (counted separately).

    const rules = Array.isArray(featureFilter.rules)
        ? featureFilter.rules.filter(isCompleteImportFilterRule)
        : [];
    if (!rules.length) return true;

    const props = feature?.properties || {};
    const logic = featureFilter.logic === 'OR' ? 'OR' : 'AND';
    const results = rules.map((rule) => evaluateImportRule(props, rule));
    return logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Filter an in-memory feature array; returns kept features + drop count.
 * @param {object[]} features
 * @param {object|null|undefined} featureFilter
 */
export function filterFeaturesByImportFilters(features, featureFilter) {
    if (!Array.isArray(features) || !features.length || !hasActiveFeatureFilter(featureFilter)) {
        return { features: features || [], filtered: 0 };
    }
    const kept = [];
    let filtered = 0;
    for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (featureMatchesImportFilters(f, featureFilter)) {
            kept.push(f);
        } else {
            filtered++;
        }
    }
    return { features: kept, filtered };
}

/**
 * Validate filter config before starting import.
 * @param {object|null|undefined} featureFilter
 * @returns {string|null} error message or null
 */
export function validateFeatureFilter(featureFilter) {
    if (!featureFilter) return null;
    if (!hasAllowedGeometryType(featureFilter.geometryTypes)) {
        return 'Select at least one geometry type (Points, Lines, or Polygons).';
    }
    const rules = Array.isArray(featureFilter.rules) ? featureFilter.rules : [];
    for (const rule of rules) {
        if (!isCompleteImportFilterRule(rule) && rule?.field && rule?.operator) {
            // Incomplete draft row (empty value) — ignore, do not block import.
            continue;
        }
        if (!rule?.field || !rule?.operator) continue;
        if (rule.operator === 'is_null' || rule.operator === 'is_not_null') continue;
        const v = rule.value;
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
            return `Enter a value for filter on "${rule.field}".`;
        }
    }
    return null;
}

/**
 * Empty filter config for UI defaults.
 */
export function createEmptyFeatureFilter() {
    return {
        geometryTypes: { ...DEFAULT_GEOMETRY_TYPES },
        rules: [],
        logic: 'AND'
    };
}
