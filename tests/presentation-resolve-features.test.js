/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/workspace/workspace-store.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getWorkspaceFeaturesByIndices: vi.fn(async (_id, indices) =>
            indices.map((idx) => ({
                type: 'Feature',
                properties: { _featureIndex: idx, name: `F${idx}` },
                geometry: { type: 'Point', coordinates: [idx, idx] }
            }))
        ),
        iterateWorkspaceFeatures: vi.fn(async () => [
            // Old resolve path scanned this API; it does not stamp _featureIndex.
            {
                type: 'Feature',
                properties: { name: 'broken' },
                geometry: { type: 'Point', coordinates: [0, 0] }
            }
        ])
    };
});

vi.mock('../js/core/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import mapManager from '../js/map/map-manager.js';
import { getWorkspaceFeaturesByIndices, iterateWorkspaceFeatures } from '../js/workspace/workspace-store.js';

describe('mapManager.resolveFeaturesByIndices (presentation)', () => {
    /** @type {Map|undefined} */
    let previousDataLayers;
    /** @type {Map|undefined} */
    let previousWorkspaceDatasets;

    beforeEach(() => {
        previousDataLayers = mapManager.dataLayers;
        previousWorkspaceDatasets = mapManager._workspaceDatasets;
        mapManager.dataLayers = new Map();
        mapManager._workspaceDatasets = new Map();
        getWorkspaceFeaturesByIndices.mockClear();
        iterateWorkspaceFeatures.mockClear();
    });

    afterEach(() => {
        mapManager.dataLayers = previousDataLayers;
        mapManager._workspaceDatasets = previousWorkspaceDatasets;
    });

    it('loads tiled/workspace selections via getWorkspaceFeaturesByIndices', async () => {
        mapManager.dataLayers.set('layer-1', {
            workspace: true,
            tiled: true,
            geojson: { type: 'FeatureCollection', features: [] }
        });

        const features = await mapManager.resolveFeaturesByIndices('layer-1', [4, 9]);
        expect(getWorkspaceFeaturesByIndices).toHaveBeenCalledWith('layer-1', expect.arrayContaining([4, 9]), {
            includeCold: false
        });
        expect(iterateWorkspaceFeatures).not.toHaveBeenCalled();
        expect(features.map((f) => f.properties._featureIndex)).toEqual([4, 9]);
    });

    it('fills missing indices from the store when the viewport packet is partial', async () => {
        mapManager.dataLayers.set('layer-1', {
            workspace: true,
            geojson: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { _featureIndex: 1, name: 'visible' },
                    geometry: { type: 'Point', coordinates: [1, 1] }
                }]
            }
        });

        const features = await mapManager.resolveFeaturesByIndices('layer-1', [1, 7]);
        expect(features).toHaveLength(2);
        expect(features[0].properties.name).toBe('visible');
        expect(features[1].properties._featureIndex).toBe(7);
        expect(getWorkspaceFeaturesByIndices).toHaveBeenCalledWith('layer-1', [7], { includeCold: false });
        expect(iterateWorkspaceFeatures).not.toHaveBeenCalled();
    });
});
