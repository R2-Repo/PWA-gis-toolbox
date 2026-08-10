import { describe, it, expect } from 'vitest';
import {
    estimateStoredImport,
    IMPORT_LIMIT_BYTES,
    IMPORT_LIMIT_FEATURES
} from '../js/import/import-store-estimate.js';
import { MATERIALIZE_FEATURE_LIMIT, STORED_FEATURE_LIMIT } from '../js/import/import-admission.js';

describe('estimateStoredImport', () => {
    it('blocks when over the stored soft ceiling with no cuts', () => {
        const est = estimateStoredImport({
            sourceBytes: 100_000_000,
            totalFeatures: 1_200_000,
            fieldNames: ['a', 'b', 'c'],
            selectedFields: ['a', 'b', 'c']
        });
        expect(est.hasReduction).toBe(false);
        expect(est.canImport).toBe(false);
        expect(est.status).toBe('red');
        expect(est.estimatedFeatures).toBe(1_200_000);
        expect(est.needsFeatureCut).toBe(true);
    });

    it('unlocks large sources under the stored soft ceiling without ritual reduction', () => {
        const est = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 100_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: false
        });
        expect(est.hasReduction).toBe(false);
        expect(est.canImport).toBe(true);
        expect(est.status).toBe('green');
        expect(est.needsFeatureCut).toBe(false);
    });

    it('marks amber when over materialize budget but under stored ceiling', () => {
        const est = estimateStoredImport({
            sourceBytes: 80_000_000,
            totalFeatures: 400_000,
            fieldNames: ['a'],
            selectedFields: ['a']
        });
        expect(est.canImport).toBe(true);
        expect(est.exceedsMaterializeLimit).toBe(true);
        expect(est.status).toBe('amber');
        expect(est.limitFeatures).toBe(STORED_FEATURE_LIMIT);
        expect(est.materializeLimit).toBe(MATERIALIZE_FEATURE_LIMIT);
    });

    it('unlocks when filter brings features under the stored ceiling', () => {
        const est = estimateStoredImport({
            sourceBytes: 100_000_000,
            totalFeatures: 1_200_000,
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
        expect(est.status).toBe('green');
        expect(est.estimatedBytes).toBeLessThan(100_000_000);
    });

    it('is green when under the materialize budget', () => {
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
        expect(est.status).toBe('green');
        expect(est.limitFeatures).toBe(IMPORT_LIMIT_FEATURES);
    });

    it('does not require a no-op fence to unlock under-limit imports', () => {
        const withFence = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 100_000,
            matchedFeatures: 100_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true
        });
        const withoutFence = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 100_000,
            matchedFeatures: 100_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: false
        });
        expect(withFence.canImport).toBe(true);
        expect(withoutFence.canImport).toBe(true);
    });

    it('does not unlock when matched features still exceed the stored ceiling', () => {
        const est = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 1_500_000,
            matchedFeatures: 1_200_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true
        });
        expect(est.underFeatureLimit).toBe(false);
        expect(est.canImport).toBe(false);
        expect(est.status).toBe('red');
    });

    it('uses amber while waiting on a recount', () => {
        const est = estimateStoredImport({
            sourceBytes: 10_000_000,
            totalFeatures: 100_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true,
            waitingOnRecount: true
        });
        expect(est.status).toBe('amber');
    });
});
