import { describe, it, expect } from 'vitest';
import {
    gatherProjectPressure,
    storagePressureFromRatio,
    heapPressureFromDevice,
    computeCapacityModifiers,
    getAdaptiveMaterializeLimit,
    getAdaptiveStoredSoftLimit,
    PROJECT_FEATURE_HIGH,
    RESIDENT_FEATURE_HIGH
} from '../js/import/import-capacity-context.js';
import {
    MATERIALIZE_FEATURE_LIMIT,
    STORED_FEATURE_SOFT_LIMIT
} from '../js/import/import-limit-taxonomy.js';

function workspaceLayer(featureCount) {
    return {
        id: `ws-${featureCount}`,
        name: 'Workspace',
        type: 'spatial-chunked',
        storage: 'workspace',
        schema: { featureCount, fields: [] }
    };
}

function residentLayer(featureCount) {
    return {
        id: `mem-${featureCount}`,
        name: 'In memory',
        type: 'spatial',
        geojson: {
            type: 'FeatureCollection',
            features: Array.from({ length: Math.min(featureCount, 3) }, (_, i) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, i] },
                properties: {}
            }))
        },
        schema: { featureCount, fields: [] }
    };
}

describe('import-capacity-context', () => {
    it('labels project feature pressure by band', () => {
        const low = gatherProjectPressure([workspaceLayer(10_000)]);
        expect(low.feature).toBe('low');
        expect(low.workspaceLayerCount).toBe(1);

        const high = gatherProjectPressure([workspaceLayer(PROJECT_FEATURE_HIGH)]);
        expect(high.feature).toBe('high');
        expect(high.totalFeatures).toBe(PROJECT_FEATURE_HIGH);
    });

    it('counts resident (non-workspace) features separately', () => {
        const pressure = gatherProjectPressure([
            workspaceLayer(100_000),
            residentLayer(RESIDENT_FEATURE_HIGH)
        ]);
        expect(pressure.memoryResident).toBe('high');
        expect(pressure.residentFeatures).toBe(RESIDENT_FEATURE_HIGH);
    });

    it('maps storage and heap ratios to pressure bands', () => {
        expect(storagePressureFromRatio(0.2)).toBe('low');
        expect(storagePressureFromRatio(0.6)).toBe('moderate');
        expect(storagePressureFromRatio(0.9)).toBe('high');
        expect(heapPressureFromDevice({ heap: null })).toBe('unknown');
        expect(heapPressureFromDevice({ heap: { usedRatio: 0.8 } })).toBe('high');
    });

    it('only tightens soft ceilings under pressure', () => {
        const baseline = computeCapacityModifiers({
            device: { heap: null, cores: 8, deviceMemoryGb: 16 },
            project: { feature: 'low', memoryResident: 'low', storage: 'low' }
        });
        expect(baseline.storedFeatureSoftLimit).toBe(STORED_FEATURE_SOFT_LIMIT);
        expect(baseline.materializeFeatureLimit).toBe(MATERIALIZE_FEATURE_LIMIT);
        expect(baseline.tightened).toBe(false);

        const tight = computeCapacityModifiers({
            device: {
                heap: { usedRatio: 0.9 },
                heapPressure: 'high',
                cores: 2,
                deviceMemoryGb: 4,
                storage: { usageRatio: 0.9 }
            },
            project: { feature: 'high', memoryResident: 'high', storage: 'high' }
        });
        expect(tight.storedFeatureSoftLimit).toBeLessThan(STORED_FEATURE_SOFT_LIMIT);
        expect(tight.materializeFeatureLimit).toBeLessThan(MATERIALIZE_FEATURE_LIMIT);
        expect(tight.materializeVertexLimit).toBeLessThan(5_000_000);
        expect(tight.tightened).toBe(true);
        expect(tight.reasons.length).toBeGreaterThan(0);
        expect(tight.streamStorageMultiplier).toBeGreaterThanOrEqual(2);
    });

    it('exposes sync adaptive getters that never exceed taxonomy maxima', () => {
        const layers = [workspaceLayer(PROJECT_FEATURE_HIGH), residentLayer(RESIDENT_FEATURE_HIGH)];
        expect(getAdaptiveStoredSoftLimit(layers)).toBeLessThanOrEqual(STORED_FEATURE_SOFT_LIMIT);
        expect(getAdaptiveMaterializeLimit(layers)).toBeLessThanOrEqual(MATERIALIZE_FEATURE_LIMIT);
        expect(getAdaptiveStoredSoftLimit([])).toBeLessThanOrEqual(STORED_FEATURE_SOFT_LIMIT);
    });
});
