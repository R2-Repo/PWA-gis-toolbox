import { describe, expect, it } from 'vitest';
import {
    applyRenderLimits,
    pruneSelectionToViewport,
    resolveStableFeatureIndex,
    tagServiceFeatures,
    isVectorServiceKind
} from '../js/live-layers/live-layer-viewport.js';
import {
    expandCatalogEntry,
    validateCatalog
} from '../js/live-layers/catalog-schema.js';
import {
    isAnalyzableLayer,
    isLiveVectorLayer,
    getLayerFeatureCount
} from '../js/core/data-model.js';
import { RENDER_LIMITS } from '../js/map/render-limits.js';

describe('live-layer viewport tagging', () => {
    it('uses OBJECTID when present', () => {
        const features = [
            { type: 'Feature', properties: { OBJECTID: 42, name: 'a' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', properties: { OBJECTID: 99, name: 'b' }, geometry: { type: 'Point', coordinates: [1, 1] } }
        ];
        const tagged = tagServiceFeatures('layer-1', features, 'OBJECTID');
        expect(tagged[0].properties._featureIndex).toBe(42);
        expect(tagged[0].properties._datasetId).toBe('layer-1');
        expect(tagged[1].properties._featureIndex).toBe(99);
    });

    it('falls back to positional index without object id', () => {
        const features = [
            { type: 'Feature', properties: { name: 'a' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', properties: { name: 'b' }, geometry: { type: 'Point', coordinates: [1, 1] } }
        ];
        const tagged = tagServiceFeatures('layer-1', features);
        expect(tagged.map((f) => f.properties._featureIndex)).toEqual([0, 1]);
    });

    it('resolveStableFeatureIndex prefers configured field', () => {
        const feature = {
            type: 'Feature',
            properties: { FID: 7, OBJECTID: 3 },
            geometry: { type: 'Point', coordinates: [0, 0] }
        };
        expect(resolveStableFeatureIndex(feature, 'FID', 0)).toBe(7);
        expect(resolveStableFeatureIndex(feature, 'OBJECTID', 0)).toBe(3);
        expect(resolveStableFeatureIndex({ properties: {} }, 'OBJECTID', 5)).toBe(5);
    });

    it('prunes selection indices that left the viewport', () => {
        const features = tagServiceFeatures('l', [
            { type: 'Feature', properties: { OBJECTID: 10 }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', properties: { OBJECTID: 20 }, geometry: { type: 'Point', coordinates: [1, 1] } }
        ]);
        expect(pruneSelectionToViewport([10, 15, 20], features)).toEqual([10, 20]);
        expect(pruneSelectionToViewport(['10', '99'], features)).toEqual([10]);
    });

    it('applies render feature limits', () => {
        const features = Array.from({ length: RENDER_LIMITS.maxFeaturesPerSource + 5 }, (_, i) => ({
            type: 'Feature',
            properties: { OBJECTID: i },
            geometry: { type: 'Point', coordinates: [i, i] }
        }));
        const limited = applyRenderLimits(features);
        expect(limited.features).toHaveLength(RENDER_LIMITS.maxFeaturesPerSource);
        expect(limited.truncated).toBe(true);
    });
});

describe('live-layer analyzability', () => {
    it('treats vector services as analyzable and raster as not', () => {
        const vector = {
            type: 'service',
            service: { kind: 'arcgis-featureserver', url: 'https://example.com/FeatureServer/0' },
            geojson: {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }
                ]
            }
        };
        const raster = {
            type: 'service',
            service: { kind: 'arcgis-mapserver', url: 'https://example.com/MapServer' }
        };

        expect(isLiveVectorLayer(vector)).toBe(true);
        expect(isAnalyzableLayer(vector)).toBe(true);
        expect(getLayerFeatureCount(vector)).toBe(1);

        expect(isLiveVectorLayer(raster)).toBe(false);
        expect(isAnalyzableLayer(raster)).toBe(false);
        expect(isVectorServiceKind('wms')).toBe(false);
        expect(isVectorServiceKind('geojson-feed')).toBe(true);
    });
});

describe('composite catalog expansion', () => {
    it('expands single-service entries', () => {
        const services = expandCatalogEntry({
            id: 'solo',
            name: 'Solo',
            kind: 'arcgis-featureserver',
            url: 'https://example.com/FeatureServer/0',
            style: { mode: 'flat' }
        });
        expect(services).toHaveLength(1);
        expect(services[0].id).toBe('solo');
        expect(services[0].url).toContain('FeatureServer');
    });

    it('expands composite subLayers', () => {
        const services = expandCatalogEntry({
            id: 'bundle',
            name: 'Bundle',
            subLayers: [
                {
                    id: 'a',
                    name: 'A',
                    kind: 'arcgis-featureserver',
                    url: 'https://example.com/FeatureServer/0'
                },
                {
                    id: 'b',
                    name: 'B',
                    kind: 'geojson-feed',
                    url: 'https://example.com/data.geojson'
                }
            ]
        });
        expect(services).toHaveLength(2);
        expect(services.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('seed catalog still validates', () => {
        expect(validateCatalog()).toEqual([]);
    });
});
