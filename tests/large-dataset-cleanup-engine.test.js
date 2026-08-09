import { describe, expect, it } from 'vitest';
import {
    validateLayerSelection,
    validateCleanupPlan,
    planCleanupOrder,
    buildFootprintSummary,
    listDetachableFieldNames
} from '../js/widgets/large-dataset-cleanup/engine.js';

describe('large-dataset-cleanup engine', () => {
    it('accepts workspace layers with features', () => {
        expect(validateLayerSelection(null).valid).toBe(false);
        expect(validateLayerSelection({ type: 'spatial', featureCount: 10 }).valid).toBe(false);
        expect(validateLayerSelection({
            type: 'spatial-chunked',
            storage: 'workspace',
            schema: { featureCount: 1000 }
        }).valid).toBe(true);
    });

    it('requires at least one cleanup action and orders detach before remove', () => {
        expect(validateCleanupPlan({}).valid).toBe(false);
        expect(validateCleanupPlan({ deleteSource: true }).valid).toBe(false);
        expect(validateCleanupPlan({ detachFields: ['notes'] }).valid).toBe(true);
        expect(planCleanupOrder({
            detachFields: ['a', 'b'],
            removeLayer: true,
            deleteSource: true
        }).map((s) => s.type)).toEqual(['detach', 'removeLayer', 'deleteSource']);
    });

    it('builds footprint summary and lists detachable fields', () => {
        const summary = buildFootprintSummary({
            layerName: 'Poles',
            featureCount: 300000,
            hotFieldCount: 4,
            coldFieldCount: 2,
            storageUsage: 50,
            storageQuota: 100,
            tiled: true
        });
        expect(summary.usageRatio).toBe(0.5);
        expect(summary.tiled).toBe(true);
        expect(listDetachableFieldNames([
            { name: 'owner' },
            { name: 'notes', cold: true },
            { name: '_featureIndex' }
        ])).toEqual(['owner']);
    });
});
