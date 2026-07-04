import { describe, expect, it, vi } from 'vitest';
import {
    buildLimitSummary,
    collectSourceFeaturesAsync,
    collectSourceFeaturesForLayer,
    describePresentationSource
} from '../js/widgets/presentation-link-builder/source-features.js';
import { buildLimitSummary as buildLimitSummaryFromEngine } from '../js/widgets/presentation-link-builder/engine.js';
import { validatePresentationFeatures } from '../js/presentation/scene-validation.js';

const pointFeature = {
    type: 'Feature',
    properties: { _featureIndex: 3, name: 'Tower' },
    geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
};

const lineFeature = {
    type: 'Feature',
    properties: { _featureIndex: 1, name: 'Route' },
    geometry: {
        type: 'LineString',
        coordinates: [[-111.9, 40.7], [-111.89, 40.71], [-111.88, 40.72]]
    }
};

describe('presentation source features', () => {
    it('uses mapService presentation source features first', async () => {
        const ctx = {
            getLayers: () => [{ id: 'layer-1', type: 'spatial' }],
            getDrawnFeature: () => null,
            mapService: {
                getPresentationSourceFeatures: vi.fn(async () => ({
                    type: 'FeatureCollection',
                    features: [pointFeature]
                })),
                getPresentationAnchor: () => ({ layerName: 'Sites' }),
                getTotalSelectionCount: () => 1
            }
        };

        const features = await collectSourceFeaturesAsync(ctx);
        expect(features.features).toHaveLength(1);
        expect(ctx.mapService.getPresentationSourceFeatures).toHaveBeenCalled();
    });

    it('falls back to drawn feature when map source is empty', async () => {
        const ctx = {
            getLayers: () => [],
            getDrawnFeature: () => ({ feature: pointFeature }),
            mapService: {
                getPresentationSourceFeatures: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))
            }
        };

        const features = await collectSourceFeaturesAsync(ctx);
        expect(features.features).toHaveLength(1);
    });

    it('collects selected features for a target layer', async () => {
        const layerGeojson = { type: 'FeatureCollection', features: [pointFeature, lineFeature] };
        const ctx = {
            getLayers: () => [{
                id: 'layer-1',
                type: 'spatial',
                name: 'Fiber Route',
                geojson: layerGeojson
            }],
            getDrawnFeature: () => null,
            mapService: {
                dataLayers: new Map([['layer-1', { geojson: layerGeojson }]]),
                getSelectionCount: vi.fn(() => 2),
                getSelectedFeatures: vi.fn((_layerId, geojson) => ({
                    type: 'FeatureCollection',
                    features: geojson.features
                })),
                getPresentationSourceFeatures: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))
            }
        };

        const features = await collectSourceFeaturesForLayer(ctx, 'layer-1');
        expect(features.features).toHaveLength(2);
        expect(ctx.mapService.getSelectedFeatures).toHaveBeenCalledWith(
            'layer-1',
            layerGeojson
        );
    });

    it('prefers map dataLayers geojson when resolving selected features', async () => {
        const stateGeojson = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: pointFeature.geometry }]
        };
        const mapGeojson = {
            type: 'FeatureCollection',
            features: [{ ...pointFeature, properties: { ...pointFeature.properties, _featureIndex: 0 } }]
        };
        const ctx = {
            getLayers: () => [{
                id: 'layer-1',
                type: 'spatial',
                name: 'Sites',
                geojson: stateGeojson
            }],
            getDrawnFeature: () => null,
            mapService: {
                dataLayers: new Map([['layer-1', { geojson: mapGeojson }]]),
                getSelectionCount: vi.fn(() => 1),
                getSelectedFeatures: vi.fn((_layerId, geojson) => ({
                    type: 'FeatureCollection',
                    features: geojson.features.filter((f) => f.properties?._featureIndex === 0)
                })),
                getPresentationSourceFeatures: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))
            }
        };

        const features = await collectSourceFeaturesForLayer(ctx, 'layer-1');
        expect(features.features).toHaveLength(1);
        expect(ctx.mapService.getSelectedFeatures).toHaveBeenCalledWith('layer-1', mapGeojson);
    });

    it('collects all selected features across layers', async () => {
        const layerOneGeojson = { type: 'FeatureCollection', features: [pointFeature] };
        const layerTwoGeojson = { type: 'FeatureCollection', features: [lineFeature] };
        const ctx = {
            getLayers: () => [
                { id: 'layer-1', type: 'spatial', name: 'Sites', geojson: layerOneGeojson },
                { id: 'layer-2', type: 'spatial', name: 'Routes', geojson: layerTwoGeojson },
                { id: 'layer-3', type: 'spatial', name: 'Empty', geojson: { type: 'FeatureCollection', features: [] } }
            ],
            getDrawnFeature: () => null,
            mapService: {
                dataLayers: new Map([
                    ['layer-1', { geojson: layerOneGeojson }],
                    ['layer-2', { geojson: layerTwoGeojson }]
                ]),
                getSelectionCount: vi.fn((layerId) => (layerId === 'layer-3' ? 0 : 1)),
                getSelectedFeatures: vi.fn((_layerId, geojson) => ({
                    type: 'FeatureCollection',
                    features: geojson.features
                })),
                getPresentationSourceFeatures: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))
            }
        };

        const { collectAllSelectedPresentationFeatures } = await import('../js/widgets/presentation-link-builder/source-features.js');
        const features = await collectAllSelectedPresentationFeatures(ctx);
        expect(features.features).toHaveLength(2);
    });

    it('collects selected features from multiple layers', async () => {
        const layerOneGeojson = { type: 'FeatureCollection', features: [pointFeature] };
        const layerTwoGeojson = { type: 'FeatureCollection', features: [lineFeature] };
        const ctx = {
            getLayers: () => [
                {
                    id: 'layer-1',
                    type: 'spatial',
                    name: 'Sites',
                    geojson: layerOneGeojson
                },
                {
                    id: 'layer-2',
                    type: 'spatial',
                    name: 'Routes',
                    geojson: layerTwoGeojson
                }
            ],
            getDrawnFeature: () => null,
            mapService: {
                dataLayers: new Map([
                    ['layer-1', { geojson: layerOneGeojson }],
                    ['layer-2', { geojson: layerTwoGeojson }]
                ]),
                getSelectionCount: vi.fn((layerId) => (layerId === 'layer-1' ? 1 : 1)),
                getSelectedFeatures: vi.fn((layerId, geojson) => ({
                    type: 'FeatureCollection',
                    features: geojson.features
                })),
                getPresentationSourceFeatures: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))
            }
        };

        const { collectSourceFeaturesForLayers } = await import('../js/widgets/presentation-link-builder/source-features.js');
        const features = await collectSourceFeaturesForLayers(ctx, ['layer-1', 'layer-2']);
        expect(features.features).toHaveLength(2);
        expect(features.features[0].properties._plLayer).toBe('layer-1');
        expect(features.features[1].properties._plLayer).toBe('layer-2');
    });

    it('describes multi-layer sources', () => {
        const summary = describePresentationSource({
            getLayers: () => [
                { id: 'layer-1', type: 'spatial', name: 'Sites' },
                { id: 'layer-2', type: 'spatial', name: 'Routes' }
            ],
            mapService: {
                getSelectionCount: (id) => (id === 'layer-1' ? 1 : 1),
                getTotalSelectionCount: () => 2
            }
        }, { type: 'FeatureCollection', features: [pointFeature, lineFeature] }, {
            layerIds: ['layer-1', 'layer-2']
        });

        expect(summary.featureCount).toBe(2);
        expect(summary.sourceLabel).toBe('2 features from 2 layers');
    });

    it('describes multi-feature sources with layer name', () => {
        const summary = describePresentationSource({
            getLayers: () => [{ id: 'layer-1', type: 'spatial', name: 'Fiber Route' }],
            mapService: {
                getSelectionCount: () => 2,
                getTotalSelectionCount: () => 2
            }
        }, { type: 'FeatureCollection', features: [pointFeature, lineFeature] }, {
            layerId: 'layer-1',
            layerName: 'Fiber Route'
        });

        expect(summary.featureCount).toBe(2);
        expect(summary.sourceLabel).toBe('2 features from Fiber Route');
        expect(summary.isEmpty).toBe(false);
    });

    it('buildLimitSummary reports blocked state when over feature cap', () => {
        const many = {
            type: 'FeatureCollection',
            features: Array.from({ length: 30 }, (_, i) => ({
                type: 'Feature',
                properties: { id: i },
                geometry: { type: 'Point', coordinates: [-111 + i * 0.01, 40.7] }
            }))
        };
        const validation = validatePresentationFeatures(many);
        const limits = buildLimitSummary(validation);

        expect(validation.ok).toBe(false);
        expect(limits.featuresOk).toBe(false);
        expect(limits.featureCount).toBe(30);
        expect(limits.maxFeatures).toBe(25);
    });

    it('engine re-exports buildLimitSummary', () => {
        const limits = buildLimitSummaryFromEngine({
            summary: { featureCount: 2, vertexCount: 10 },
            estimatedUrlLength: 1200
        });
        expect(limits.featuresOk).toBe(true);
        expect(limits.verticesOk).toBe(true);
        expect(limits.urlOk).toBe(true);
    });
});
