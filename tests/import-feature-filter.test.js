// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
    createEmptyFeatureFilter,
    featureMatchesImportFilters,
    filterFeaturesByImportFilters,
    geometryTypeClass,
    hasActiveFeatureFilter,
    hasAllowedGeometryType,
    normalizeRuleValue,
    validateFeatureFilter
} from '../js/import/import-feature-filter.js';

describe('import-feature-filter', () => {
    it('classifies geometry types', () => {
        expect(geometryTypeClass('Point')).toBe('point');
        expect(geometryTypeClass('MultiLineString')).toBe('line');
        expect(geometryTypeClass('Polygon')).toBe('polygon');
        expect(geometryTypeClass('GeometryCollection')).toBe(null);
    });

    it('rejects features outside geometry allow-list', () => {
        const line = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { kind: 'freeway' }
        };
        expect(featureMatchesImportFilters(line, {
            geometryTypes: { point: true, line: false, polygon: true }
        })).toBe(false);
        expect(featureMatchesImportFilters(line, {
            geometryTypes: { point: true, line: true, polygon: true }
        })).toBe(true);
    });

    it('applies attribute rules with AND/OR', () => {
        const feature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { kind: 'Ramp', class: 'A' }
        };
        expect(featureMatchesImportFilters(feature, {
            rules: [{ field: 'kind', operator: 'equals', value: 'Freeway' }],
            logic: 'AND'
        })).toBe(false);
        expect(featureMatchesImportFilters(feature, {
            rules: [
                { field: 'kind', operator: 'equals', value: 'Ramp' },
                { field: 'class', operator: 'equals', value: 'B' }
            ],
            logic: 'AND'
        })).toBe(false);
        expect(featureMatchesImportFilters(feature, {
            rules: [
                { field: 'kind', operator: 'equals', value: 'Ramp' },
                { field: 'class', operator: 'equals', value: 'B' }
            ],
            logic: 'OR'
        })).toBe(true);
    });

    it('supports in and not_in with multi-select arrays', () => {
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { kind: 'Freeway' }
        };
        expect(featureMatchesImportFilters(feature, {
            rules: [{ field: 'kind', operator: 'in', value: ['Ramp', 'Freeway'] }]
        })).toBe(true);
        expect(featureMatchesImportFilters(feature, {
            rules: [{ field: 'kind', operator: 'not_in', value: ['Ramp', 'Collector'] }]
        })).toBe(true);
        expect(featureMatchesImportFilters(feature, {
            rules: [{ field: 'kind', operator: 'not_in', value: ['Freeway'] }]
        })).toBe(false);
    });

    it('filterFeaturesByImportFilters counts drops', () => {
        const features = [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { k: 'a' } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { k: 'b' } }
        ];
        const result = filterFeaturesByImportFilters(features, {
            rules: [{ field: 'k', operator: 'equals', value: 'a' }]
        });
        expect(result.features).toHaveLength(1);
        expect(result.filtered).toBe(1);
    });

    it('validateFeatureFilter blocks empty geometry types and empty rule values', () => {
        expect(validateFeatureFilter({
            geometryTypes: { point: false, line: false, polygon: false }
        })).toMatch(/geometry type/i);
        expect(validateFeatureFilter({
            geometryTypes: { point: true, line: true, polygon: true },
            rules: [{ field: 'kind', operator: 'equals', value: '' }]
        })).toMatch(/value/i);
        expect(validateFeatureFilter(createEmptyFeatureFilter())).toBe(null);
    });

    it('hasActiveFeatureFilter detects geom or rules', () => {
        expect(hasActiveFeatureFilter(createEmptyFeatureFilter())).toBe(false);
        expect(hasActiveFeatureFilter({
            geometryTypes: { point: true, line: false, polygon: true }
        })).toBe(true);
        expect(hasActiveFeatureFilter({
            rules: [{ field: 'a', operator: 'equals', value: '1' }]
        })).toBe(true);
    });

    it('hasAllowedGeometryType and normalizeRuleValue helpers', () => {
        expect(hasAllowedGeometryType({ point: false, line: false, polygon: false })).toBe(false);
        expect(normalizeRuleValue(['a', 'b'], 'in')).toBe('a,b');
        expect(normalizeRuleValue('x', 'is_null')).toBe('');
    });
});
