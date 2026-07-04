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
        const ctx = {
            getLayers: () => [{
                id: 'layer-1',
                type: 'spatial',
                name: 'Fiber Route',
                geojson: { type: 'FeatureCollection', features: [pointFeature, lineFeature] }
            }],
            getDrawnFeature: () => null,
            mapService: {
                getSelectionCount: vi.fn(() => 2),
                getSelectedFeatures: vi.fn(() => ({
                    type: 'FeatureCollection',
                    features: [pointFeature, lineFeature]
                })),
                getPresentationSourceFeatures: vi.fn(async () => ({ type: 'FeatureCollection', features: [] }))
            }
        };

        const features = await collectSourceFeaturesForLayer(ctx, 'layer-1');
        expect(features.features).toHaveLength(2);
        expect(ctx.mapService.getSelectedFeatures).toHaveBeenCalledWith(
            'layer-1',
            ctx.getLayers()[0].geojson
        );
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
