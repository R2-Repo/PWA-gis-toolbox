import { describe, it, expect } from 'vitest';
import {
    estimateWorkingSetCoords,
    evaluateGeometryBudget,
    readLayerGeometryStats
} from '../js/import/geometry-budget.js';
import {
    MATERIALIZE_VERTEX_LIMIT,
    MATERIALIZE_MAX_COORDS_PER_FEATURE
} from '../js/import/import-limit-taxonomy.js';

function denseLayer(overrides = {}) {
    return {
        id: 'dense-1',
        name: 'Dense Roads',
        type: 'spatial-chunked',
        storage: 'workspace',
        schema: { featureCount: 120_000 },
        datasetProfile: {
            featureCount: 120_000,
            coordCount: 12_000_000,
            avgCoordsPerFeature: 100,
            maxCoordsInFeature: 4_000,
            pressures: { feature: 'moderate', geometry: 'high', attribute: 'low', storage: 'high' }
        },
        geojson: { type: 'FeatureCollection', features: [] },
        ...overrides
    };
}

describe('geometry-budget', () => {
    it('reads profile geometry stats', () => {
        const stats = readLayerGeometryStats(denseLayer());
        expect(stats.coordCount).toBe(12_000_000);
        expect(stats.avgCoordsPerFeature).toBe(100);
        expect(stats.maxCoordsInFeature).toBe(4_000);
    });

    it('estimates whole-layer coords from profile', () => {
        const estimate = estimateWorkingSetCoords(denseLayer(), {
            mode: 'layer',
            count: 120_000,
            totalCount: 120_000
        });
        expect(estimate.estimatedCoords).toBe(12_000_000);
        expect(estimate.exact).toBe(true);
        expect(estimate.source).toBe('profile');
    });

    it('estimates selection coords from avg density', () => {
        const estimate = estimateWorkingSetCoords(denseLayer(), {
            mode: 'selection',
            count: 10_000,
            selectionCount: 10_000
        });
        expect(estimate.estimatedCoords).toBe(1_000_000);
        expect(estimate.exact).toBe(false);
    });

    it('counts viewport coords exactly', () => {
        const layer = denseLayer({
            geojson: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: Array.from({ length: 50 }, (_, i) => [i, 0])
                        },
                        properties: {}
                    },
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: Array.from({ length: 30 }, (_, i) => [0, i])
                        },
                        properties: {}
                    }
                ]
            }
        });
        const estimate = estimateWorkingSetCoords(layer, {
            mode: 'viewport',
            count: 2,
            viewportCount: 2
        });
        expect(estimate.estimatedCoords).toBe(80);
        expect(estimate.exact).toBe(true);
        expect(estimate.source).toBe('viewport');
    });

    it('blocks when estimated coords exceed the vertex budget', () => {
        const check = evaluateGeometryBudget({
            estimatedCoords: 12_000_000,
            maxCoordsInFeature: 4_000,
            vertexLimit: MATERIALIZE_VERTEX_LIMIT,
            mode: 'layer'
        });
        expect(check.ok).toBe(false);
        expect(check.reason).toMatch(/coordinates/i);
    });

    it('blocks mega single-feature layers', () => {
        const check = evaluateGeometryBudget({
            estimatedCoords: 600_000,
            maxCoordsInFeature: MATERIALIZE_MAX_COORDS_PER_FEATURE + 1,
            vertexLimit: MATERIALIZE_VERTEX_LIMIT,
            mode: 'layer'
        });
        expect(check.ok).toBe(false);
        expect(check.reason).toMatch(/per-feature/i);
    });

    it('allows low-geometry working sets', () => {
        const check = evaluateGeometryBudget({
            estimatedCoords: 50_000,
            maxCoordsInFeature: 200,
            vertexLimit: MATERIALIZE_VERTEX_LIMIT,
            mode: 'layer'
        });
        expect(check.ok).toBe(true);
    });
});
