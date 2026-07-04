import { describe, expect, it, vi } from 'vitest';
import {
    collectSourceFeaturesAsync,
    getLayerGeojson,
    pickFeaturesByIndices,
    summarizeSourceContext
} from '../js/widgets/presentation-link-builder/source-features.js';

const pointFeature = {
    type: 'Feature',
    properties: { _featureIndex: 3, name: 'Tower' },
    geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
};

describe('presentation source features', () => {
    it('prefers map layer geojson over empty workspace state geojson', () => {
        const layer = {
            id: 'layer-1',
            type: 'spatial',
            storage: 'workspace',
            geojson: { type: 'FeatureCollection', features: [] }
        };
        const ctx = {
            getLayers: () => [layer],
            mapService: {
                getLayerRecord: () => ({
                    geojson: { type: 'FeatureCollection', features: [pointFeature] }
                }),
                getSelectedIndices: () => [3],
                getTotalSelectionCount: () => 1
            }
        };

        const geojson = getLayerGeojson(ctx, layer);
        expect(geojson.features).toHaveLength(1);
        expect(pickFeaturesByIndices(geojson, [3])).toHaveLength(1);
    });

    it('collects selected features from map-backed layers', async () => {
        const layer = {
            id: 'layer-1',
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features: [] }
        };
        const ctx = {
            getLayers: () => [layer],
            getActiveLayer: () => layer,
            getDrawnFeature: () => null,
            mapService: {
                getLayerRecord: () => ({
                    geojson: { type: 'FeatureCollection', features: [pointFeature] }
                }),
                getSelectedIndices: () => [3],
                getTotalSelectionCount: () => 1,
                getHighlightedFeature: () => null
            }
        };

        const features = await collectSourceFeaturesAsync(ctx, 'selection');
        expect(features.features).toHaveLength(1);
        expect(features.features[0].properties.name).toBe('Tower');
    });

    it('falls back to highlighted feature when nothing is selected', async () => {
        const ctx = {
            getLayers: () => [],
            getActiveLayer: () => null,
            getDrawnFeature: () => null,
            mapService: {
                getTotalSelectionCount: () => 0,
                getHighlightedFeature: () => ({ feature: pointFeature })
            }
        };

        const features = await collectSourceFeaturesAsync(ctx, 'selection');
        expect(features.features).toHaveLength(1);
    });

    it('summarizes spatial layer counts from app state and map records', () => {
        const ctx = {
            getLayers: () => [
                { id: 'a', type: 'spatial' },
                { id: 'b', type: 'table' },
                { id: 'c', type: 'spatial' }
            ],
            getDrawnFeature: () => null,
            mapService: {
                getLayerRecord: (id) => (id === 'a' ? { geojson: { features: [pointFeature] } } : null),
                getTotalSelectionCount: () => 2,
                getHighlightedFeature: () => null
            }
        };

        expect(summarizeSourceContext(ctx)).toEqual({
            spatialLayerCount: 2,
            mapLayerCount: 1,
            selectedCount: 2,
            hasHighlightedFeature: false,
            hasDrawnFeature: false
        });
    });
});
