import { describe, it, expect } from 'vitest';
import {
    evaluateOperation,
    resolveWorkingSet,
    formatOperationBlockMessage,
    layerNeedsWorkingSet
} from '../js/tools/operation-budget.js';
import { MATERIALIZE_FEATURE_LIMIT } from '../js/import/import-limit-taxonomy.js';
import { getAdaptiveMaterializeLimit } from '../js/import/import-capacity-context.js';

function fakeLayer(overrides = {}) {
    return {
        id: 'layer-1',
        name: 'Roads',
        type: 'spatial-chunked',
        storage: 'workspace',
        schema: { featureCount: 400_000, fields: [] },
        geojson: { type: 'FeatureCollection', features: [] },
        datasetProfile: {
            pressures: { feature: 'high', geometry: 'moderate', attribute: 'low', storage: 'high' }
        },
        ...overrides
    };
}

describe('operation-budget', () => {
    it('blocks whole-layer ops over the materialize limit', () => {
        const evaluation = evaluateOperation({
            operation: 'buffer',
            layer: fakeLayer(),
            applyTo: 'layer',
            mapApi: { getSelectionCount: () => 0 },
            limitFeatures: MATERIALIZE_FEATURE_LIMIT
        });
        expect(evaluation.ok).toBe(false);
        expect(evaluation.kind).toBe('OPERATION');
        expect(evaluation.workingSet.count).toBe(400_000);
        expect(evaluation.limit).toBe(MATERIALIZE_FEATURE_LIMIT);
        expect(evaluation.suggestions).toContain('selection');
        expect(formatOperationBlockMessage(evaluation)).toMatch(/too many to load/i);
    });

    it('uses adaptive materialize limit when limitFeatures is omitted', () => {
        const evaluation = evaluateOperation({
            operation: 'buffer',
            layer: fakeLayer(),
            applyTo: 'layer',
            mapApi: { getSelectionCount: () => 0 },
            projectLayers: [fakeLayer()]
        });
        expect(evaluation.limit).toBe(getAdaptiveMaterializeLimit([fakeLayer()]));
        expect(evaluation.limit).toBeLessThanOrEqual(MATERIALIZE_FEATURE_LIMIT);
        expect(evaluation.ok).toBe(false);
    });

    it('allows selection working sets under the limit', () => {
        const evaluation = evaluateOperation({
            operation: 'buffer',
            layer: fakeLayer(),
            applyTo: 'auto',
            mapApi: { getSelectionCount: () => 1200 }
        });
        expect(evaluation.ok).toBe(true);
        expect(evaluation.workingSet.mode).toBe('selection');
        expect(evaluation.workingSet.count).toBe(1200);
    });

    it('prefers viewport in auto mode when layer is oversized and viewport fits', () => {
        const layer = fakeLayer({
            geojson: {
                type: 'FeatureCollection',
                features: Array.from({ length: 80 }, () => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [0, 0] },
                    properties: {}
                }))
            }
        });
        const ws = resolveWorkingSet({
            layer,
            applyTo: 'auto',
            mapApi: { getSelectionCount: () => 0 },
            limitFeatures: MATERIALIZE_FEATURE_LIMIT
        });
        expect(ws.mode).toBe('viewport');
        expect(ws.count).toBe(80);
        expect(ws.underLimit).toBe(true);
    });

    it('requires a non-empty selection when applyTo is selection', () => {
        const evaluation = evaluateOperation({
            operation: 'dissolve',
            layer: fakeLayer({ schema: { featureCount: 10_000 } }),
            applyTo: 'selection',
            mapApi: { getSelectionCount: () => 0 }
        });
        expect(evaluation.ok).toBe(false);
        expect(evaluation.suggestions).toContain('selection');
    });

    it('flags layers that need a bounded working set', () => {
        expect(layerNeedsWorkingSet(fakeLayer())).toBe(true);
        expect(layerNeedsWorkingSet(fakeLayer({
            schema: { featureCount: 10_000 },
            type: 'spatial',
            storage: undefined
        }))).toBe(false);
    });
});
