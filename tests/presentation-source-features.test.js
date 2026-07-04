import { describe, expect, it, vi } from 'vitest';
import {
    collectSourceFeaturesAsync,
    describePresentationSource
} from '../js/widgets/presentation-link-builder/source-features.js';

const pointFeature = {
    type: 'Feature',
    properties: { _featureIndex: 3, name: 'Tower' },
    geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
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

    it('describes the resolved source for the simplified UI', () => {
        const summary = describePresentationSource({
            getLayers: () => [{ id: 'layer-1', type: 'spatial' }],
            mapService: {
                getPresentationAnchor: () => ({ layerName: 'Fiber Route' }),
                getTotalSelectionCount: () => 1
            }
        }, { type: 'FeatureCollection', features: [pointFeature] });

        expect(summary.featureCount).toBe(1);
        expect(summary.sourceLabel).toContain('Fiber Route');
        expect(summary.isEmpty).toBe(false);
    });
});
