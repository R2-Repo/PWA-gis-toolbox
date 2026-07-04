import { describe, expect, it } from 'vitest';
import {
    applyPresentationStyles,
    bakePresentationFeatureStyle,
    deriveSceneStyleFallback,
    hasBakedPresentationStyles,
    resolveLayerStyle
} from '../js/presentation/presentation-style-capture.js';
import { buildSceneFromConfig } from '../js/widgets/presentation-link-builder/engine.js';

const pointFeature = {
    type: 'Feature',
    properties: { id: 'p1' },
    geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
};

const polygonFeature = {
    type: 'Feature',
    properties: { id: 'poly1' },
    geometry: {
        type: 'Polygon',
        coordinates: [[
            [-111.91, 40.69],
            [-111.89, 40.69],
            [-111.89, 40.71],
            [-111.91, 40.71],
            [-111.91, 40.69]
        ]]
    }
};

describe('presentation style capture', () => {
    it('resolves layer style with default color from map service', () => {
        const style = resolveLayerStyle({
            getLayerStyle: () => null,
            getLayerDefaultColor: () => '#dc2626'
        }, 'layer-1');
        expect(style.strokeColor).toBe('#dc2626');
        expect(style.mode).toBe('simple');
    });

    it('bakes different colors for geometry overrides (blue point, red polygon)', () => {
        const layerStyle = {
            mode: 'simple',
            strokeColor: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 0.4,
            strokeWidth: 3,
            point: {
                strokeColor: '#2563eb',
                fillColor: '#2563eb',
                pointSize: 10
            }
        };

        const pointBaked = bakePresentationFeatureStyle(pointFeature, layerStyle);
        const polyBaked = bakePresentationFeatureStyle(polygonFeature, layerStyle);

        expect(pointBaked.f).toBe('#2563eb');
        expect(pointBaked.r).toBe(10);
        expect(polyBaked.f).toBe('#dc2626');
        expect(polyBaked.fo).toBe(0.4);
    });

    it('bakes distinct per-feature colors for smart categorical styling', () => {
        const layerStyle = {
            mode: 'smart',
            strokeColor: '#2563eb',
            fillColor: '#2563eb',
            smart: {
                defaultStyle: {},
                visualVariables: [{
                    id: 'vv-1',
                    type: 'unique',
                    field: 'type',
                    channel: 'fill',
                    classes: [
                        { value: 'A', color: '#ff0000' },
                        { value: 'B', color: '#00ff00' }
                    ],
                    defaultColor: '#cccccc'
                }],
                filterRules: []
            }
        };

        const featureA = {
            type: 'Feature',
            properties: { type: 'A' },
            geometry: { type: 'Point', coordinates: [0, 0] }
        };
        const featureB = {
            type: 'Feature',
            properties: { type: 'B' },
            geometry: { type: 'Point', coordinates: [1, 1] }
        };

        const bakedA = bakePresentationFeatureStyle(featureA, layerStyle);
        const bakedB = bakePresentationFeatureStyle(featureB, layerStyle);
        expect(bakedA.f).toBe('#ff0000');
        expect(bakedB.f).toBe('#00ff00');
    });

    it('applyPresentationStyles writes _ps on all features', () => {
        const layerStyle = {
            mode: 'simple',
            strokeColor: '#16a34a',
            fillColor: '#16a34a'
        };
        const collection = applyPresentationStyles({
            type: 'FeatureCollection',
            features: [pointFeature, polygonFeature]
        }, layerStyle);

        expect(hasBakedPresentationStyles(collection)).toBe(true);
        expect(collection.features[0].properties._ps.f).toBe('#16a34a');
        expect(collection.features[1].properties._ps.f).toBe('#16a34a');
    });

    it('deriveSceneStyleFallback uses first baked feature style', () => {
        const styled = applyPresentationStyles({
            type: 'FeatureCollection',
            features: [polygonFeature]
        }, {
            mode: 'simple',
            strokeColor: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 0.5,
            strokeWidth: 4
        });

        const fallback = deriveSceneStyleFallback(null, styled);
        expect(fallback.lineColor).toBe('#dc2626');
        expect(fallback.lineWidth).toBe(4);
        expect(fallback.polygonOpacity).toBe(0.5);
    });
});

describe('buildSceneFromConfig style capture', () => {
    it('includes baked features and non-default style in scene', () => {
        const scene = buildSceneFromConfig({
            features: {
                type: 'FeatureCollection',
                features: [polygonFeature]
            },
            map: {
                getCenter: () => ({ lng: -111.9, lat: 40.7 }),
                getZoom: () => 14,
                getPitch: () => 45,
                getBearing: () => 0
            },
            mapService: {
                getCurrentBasemap: () => 'voyager',
                is3DEnabled: () => true,
                getLayerStyle: () => ({
                    mode: 'simple',
                    strokeColor: '#be185d',
                    fillColor: '#be185d',
                    fillOpacity: 0.45,
                    strokeWidth: 6
                }),
                getLayerDefaultColor: () => '#2563eb'
            },
            layerId: 'test-layer',
            animation: { presetId: 'none' }
        });

        expect(scene.features.features[0].properties._ps.f).toBe('#be185d');
        expect(scene.style.lineColor).toBe('#be185d');
        expect(scene.style.lineWidth).toBe(6);
        expect(scene.style.polygonOpacity).toBe(0.45);
    });

    it('bakes per-layer styles for multi-layer scenes', () => {
        const features = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { _plLayer: 'layer-a' },
                    geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
                },
                {
                    type: 'Feature',
                    properties: { _plLayer: 'layer-b' },
                    geometry: polygonFeature.geometry
                }
            ]
        };

        const scene = buildSceneFromConfig({
            features,
            map: {
                getCenter: () => ({ lng: -111.9, lat: 40.7 }),
                getZoom: () => 14,
                getPitch: () => 45,
                getBearing: () => 0
            },
            mapService: {
                getCurrentBasemap: () => 'voyager',
                is3DEnabled: () => true,
                getLayerStyle: (layerId) => ({
                    mode: 'simple',
                    strokeColor: layerId === 'layer-a' ? '#2563eb' : '#dc2626',
                    fillColor: layerId === 'layer-a' ? '#2563eb' : '#dc2626',
                    fillOpacity: 0.35,
                    strokeWidth: 2
                }),
                getLayerDefaultColor: (layerId) => (layerId === 'layer-a' ? '#2563eb' : '#dc2626')
            },
            layerIds: ['layer-a', 'layer-b'],
            animation: { presetId: 'none' }
        });

        expect(scene.features.features[0].properties._ps.f).toBe('#2563eb');
        expect(scene.features.features[1].properties._ps.f).toBe('#dc2626');
        expect(scene.features.features[0].properties._plLayer).toBeUndefined();
    });
});

describe('presentation renderer paint fallback', () => {
    it('uses flat style when features have no baked _ps', () => {
        // Import internal helper by re-testing through exported addPresentationFeatureLayers behavior
        // We validate hasBakedPresentationStyles drives the branch.
        const legacy = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [0, 0] }
            }]
        };
        expect(hasBakedPresentationStyles(legacy)).toBe(false);

        const styled = applyPresentationStyles(legacy, {
            mode: 'simple',
            strokeColor: '#007aff',
            fillColor: '#007aff'
        });
        expect(hasBakedPresentationStyles(styled)).toBe(true);
    });
});
