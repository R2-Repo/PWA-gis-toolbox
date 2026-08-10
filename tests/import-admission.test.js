import { describe, it, expect } from 'vitest';
import {
    STORED_FEATURE_LIMIT,
    STREAM_STORAGE_FEATURE_LIMIT,
    MATERIALIZE_FEATURE_LIMIT,
    canAdmitStoredImport,
    hasImportReduction,
    isUnderStoredFeatureLimit,
    needsFeatureCut,
    exceedsMaterializeLimit,
    createAdmissionPolicy,
    isActiveFenceBbox
} from '../js/import/import-admission.js';
import { estimateStoredImport } from '../js/import/import-store-estimate.js';
import { STREAM_MAX_FEATURES } from '../js/import/stream/stream-constants.js';
import { MAX_IMPORT_FEATURES } from '../js/import/import-preflight.js';
import {
    STORED_FEATURE_SOFT_LIMIT,
    MATERIALIZE_FEATURE_LIMIT as TAXONOMY_MATERIALIZE
} from '../js/import/import-limit-taxonomy.js';

describe('import-admission (Phase 1 adaptive)', () => {
    it('separates 1M stored soft ceiling from 250k materialize budget', () => {
        expect(STORED_FEATURE_LIMIT).toBe(1_000_000);
        expect(STORED_FEATURE_LIMIT).toBe(STREAM_MAX_FEATURES);
        expect(STORED_FEATURE_LIMIT).toBe(STORED_FEATURE_SOFT_LIMIT);
        expect(STREAM_STORAGE_FEATURE_LIMIT).toBe(1_000_000);
        expect(MATERIALIZE_FEATURE_LIMIT).toBe(250_000);
        expect(MATERIALIZE_FEATURE_LIMIT).toBe(MAX_IMPORT_FEATURES);
        expect(MATERIALIZE_FEATURE_LIMIT).toBe(TAXONOMY_MATERIALIZE);
        expect(MATERIALIZE_FEATURE_LIMIT).toBeLessThan(STORED_FEATURE_LIMIT);
    });

    it('unlocks on feature count alone — no ritual reduction required', () => {
        expect(canAdmitStoredImport({
            estimatedFeatures: 10_000,
            hasFence: false,
            hasFieldReduction: false,
            hasFeatureReduction: false
        })).toBe(true);
        expect(needsFeatureCut(10_000)).toBe(false);
        expect(needsFeatureCut(250_001)).toBe(false);
        expect(needsFeatureCut(1_000_001)).toBe(true);
        expect(exceedsMaterializeLimit(250_001)).toBe(true);
        expect(exceedsMaterializeLimit(200_000)).toBe(false);
    });

    it('allows storing between materialize and soft ceilings', () => {
        expect(canAdmitStoredImport({
            estimatedFeatures: 400_000,
            hasFence: false
        })).toBe(true);

        const est = estimateStoredImport({
            sourceBytes: 50_000_000,
            totalFeatures: 400_000,
            matchedFeatures: 400_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: false
        });
        expect(est.canImport).toBe(true);
        expect(est.exceedsMaterializeLimit).toBe(true);
        expect(est.status).toBe('amber');
    });

    it('blocks when estimated features exceed the stored soft ceiling', () => {
        expect(canAdmitStoredImport({
            estimatedFeatures: 1_200_000,
            hasFence: true
        })).toBe(false);

        const est = estimateStoredImport({
            sourceBytes: 50_000_000,
            totalFeatures: 1_200_000,
            matchedFeatures: 1_200_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true
        });
        expect(est.underFeatureLimit).toBe(false);
        expect(est.canImport).toBe(false);
        expect(est.status).toBe('red');
    });

    it('allows import when matched features are under the stored ceiling', () => {
        expect(canAdmitStoredImport({
            estimatedFeatures: 12_000,
            hasFence: true
        })).toBe(true);

        const est = estimateStoredImport({
            sourceBytes: 50_000_000,
            totalFeatures: 400_000,
            matchedFeatures: 12_000,
            fieldNames: ['a'],
            selectedFields: ['a'],
            hasFence: true
        });
        expect(est.canImport).toBe(true);
        expect(est.status).toBe('green');
    });

    it('treats hasImportReduction as a hint helper only', () => {
        expect(hasImportReduction({ hasFence: true })).toBe(true);
        expect(hasImportReduction({ hasFieldReduction: true })).toBe(true);
        expect(hasImportReduction({})).toBe(false);
    });

    it('validates fence bbox shape', () => {
        expect(isActiveFenceBbox([-111, 40, -110, 41])).toBe(true);
        expect(isActiveFenceBbox([-111, 40, -110])).toBe(false);
        expect(isActiveFenceBbox(null)).toBe(false);
    });

    it('builds a normalized admission policy object', () => {
        const policy = createAdmissionPolicy({
            route: 'stream-workspace',
            requiresReduction: true,
            fenceBbox: [-111, 40, -110, 41],
            reasons: ['feature_count']
        });
        expect(policy.maxStoredFeatures).toBe(STORED_FEATURE_LIMIT);
        expect(policy.maxStreamFeatures).toBe(STREAM_STORAGE_FEATURE_LIMIT);
        expect(policy.maxMaterializeFeatures).toBe(MATERIALIZE_FEATURE_LIMIT);
        expect(policy.useWorkspace).toBe(false);
        expect(policy.requiresReduction).toBe(true);
        expect(policy.fenceBbox).toEqual([-111, 40, -110, 41]);
        expect(isUnderStoredFeatureLimit(1_000_000)).toBe(true);
        expect(isUnderStoredFeatureLimit(1_000_001)).toBe(false);
    });
});
