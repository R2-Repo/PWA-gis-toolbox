import { describe, it, expect } from 'vitest';
import {
    estimateStoredImport,
    IMPORT_LIMIT_BYTES,
    IMPORT_LIMIT_FEATURES
} from '../js/import/import-store-estimate.js';

describe('estimateStoredImport', () => {
    it('keeps full size when nothing is reduced', () => {
        const est = estimateStoredImport({
            sourceBytes: 100_000_000,
            totalFeatures: 400_000,
            fieldNames: ['a', 'b', 'c'],
            selectedFields: ['a', 'b', 'c']
        });
        expect(est.hasReduction).toBe(false);
        expect(est.canImport).toBe(false);
        expect(est.status).toBe('red');
        expect(est.estimatedFeatures).toBe(400_000);
    });

    it('unlocks when filter brings features under the limit', () => {
        const est = estimateStoredImport({
            sourceBytes: 100_000_000,
            totalFeatures: 400_000,
            matchedFeatures: 50_000,
            fieldNames: ['a', 'b'],
            selectedFields: ['a', 'b'],
            featureFilter: {
                geometryTypes: { point: true, line: true, polygon: true },
                rules: [{ field: 'COUNTY', operator: 'equals', value: 'Utah' }],
                logic: 'AND'
            }
        });
        expect(est.hasReduction).toBe(true);
        expect(est.estimatedFeatures).toBe(50_000);
        expect(est.underFeatureLimit).toBe(true);
        expect(est.canImport).toBe(true);
        expect(est.status).toBe('amber'); // still over size
        expect(est.estimatedBytes).toBeLessThan(100_000_000);
        expect(est.estimatedBytes).toBeGreaterThan(IMPORT_LIMIT_BYTES);
    });

    it('is green when under both limits', () => {
        const est = estimateStoredImport({
            sourceBytes: 80_000_000,
            totalFeatures: 200_000,
            matchedFeatures: 1_000,
            fieldNames: ['a', 'b', 'c', 'd'],
            selectedFields: ['a'],
            featureFilter: {
                geometryTypes: { point: true, line: false, polygon: false },
                rules: [],
                logic: 'AND'
            }
        });
        expect(est.canImport).toBe(true);
        expect(est.underFeatureLimit).toBe(true);
        expect(est.underSizeLimit).toBe(true);
        expect(est.status).toBe('green');
        expect(est.limitFeatures).toBe(IMPORT_LIMIT_FEATURES);
    });

    it('treats fence as reduction', () => {
        const est = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 100_000,
            matchedFeatures: 100_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true
        });
        expect(est.hasReduction).toBe(true);
        expect(est.canImport).toBe(true);
    });

    it('does not unlock fence when matched features still exceed the limit', () => {
        const est = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 500_000,
            matchedFeatures: 300_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true
        });
        expect(est.hasReduction).toBe(true);
        expect(est.underFeatureLimit).toBe(false);
        expect(est.canImport).toBe(false);
    });
});
