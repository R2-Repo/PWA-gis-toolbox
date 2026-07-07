import { describe, expect, it } from 'vitest';
import {
    inferServiceKind,
    validateCatalog,
    resolveMapPreset,
    presetToAppUrlConfig,
    resolveLiveLayer
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

    it('resolves preset to app URL config', () => {
        const config = resolveMapPreset('utah-overview');
        expect(config?.map).toBe('utah-overview');
        expect(config?.live).toContain('utah-counties');
        expect(config?.view?.zoom).toBe(6);
    });

    it('converts preset object to URL config', () => {
        const config = presetToAppUrlConfig({
            id: 'demo',
            name: 'Demo',
            layers: ['utah-counties'],
            basemap: 'voyager',
            dim: '2d',
            panel: 'both',
            viewport: { center: [-111, 40], zoom: 5 }
        });
        expect(config.map).toBe('demo');
        expect(config.live).toEqual(['utah-counties']);
        expect(config.view?.center).toEqual([-111, 40]);
    });

    it('resolves firewatch preset and styled live layer', () => {
        const config = resolveMapPreset('firewatch');
        expect(config?.map).toBe('firewatch');
        expect(config?.live).toContain('noaa-fire-detections');
        expect(config?.basemap).toBe('satellite');

        const layer = resolveLiveLayer('noaa-fire-detections');
        expect(layer?.style).toBeDefined();
        expect(layer?.style?.mode).toBe('smart');
    });

    it('compiles firewatch style to data-driven point paint', () => {
        const style = resolveServiceLayerStyle({ presetId: 'noaa-fire-detections' });
        const paint = compilePaint(style, 'point');
        expect(paint.hasDataDriven).toBe(true);
        expect(Array.isArray(paint.circleRadius)).toBe(true);
        expect(Array.isArray(paint.fillColor)).toBe(true);
        expect(FIREWATCH_STYLE.smart.visualVariables).toHaveLength(2);
    });
});
