import { describe, expect, it } from 'vitest';
import {
    inferServiceKind,
    validateCatalog,
    resolveLiveLayer,
    listCatalogLiveLayers
} from '../js/live-layers/catalog-schema.js';
import { compilePaint } from '../js/map/style-engine.js';
import { FIREWATCH_STYLE, resolveServiceLayerStyle } from '../js/live-layers/live-layer-styles.js';

describe('live-layer catalog', () => {
    it('infers ArcGIS and GeoJSON kinds from URLs', () => {
        expect(inferServiceKind('https://x/arcgis/rest/services/Layer/FeatureServer/0')).toBe('arcgis-featureserver');
        expect(inferServiceKind('https://x/arcgis/rest/services/Layer/MapServer')).toBe('arcgis-mapserver');
        expect(inferServiceKind('https://example.com/data.geojson')).toBe('geojson-feed');
    });

    it('validates seed catalog without errors', () => {
        expect(validateCatalog()).toEqual([]);
    });

    it('lists catalog layers for Import UI', () => {
        const layers = listCatalogLiveLayers();
        expect(layers.some((entry) => entry.id === 'firewatch')).toBe(true);
        expect(layers.find((entry) => entry.id === 'firewatch')?.name).toBe('Firewatch');
    });

    it('resolves firewatch layer with smart style', () => {
        const layer = resolveLiveLayer('firewatch');
        expect(layer?.name).toBe('Firewatch');
        expect(layer?.kind).toBe('arcgis-featureserver');
        expect(layer?.style?.mode).toBe('smart');
    });

    it('compiles firewatch style to data-driven point paint', () => {
        const style = resolveServiceLayerStyle({ presetId: 'firewatch' });
        const paint = compilePaint(style, 'point');
        expect(paint.hasDataDriven).toBe(true);
        expect(Array.isArray(paint.circleRadius)).toBe(true);
        expect(Array.isArray(paint.fillColor)).toBe(true);
        expect(FIREWATCH_STYLE.smart.visualVariables).toHaveLength(2);
    });
});
