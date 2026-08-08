import { describe, expect, it } from 'vitest';
import {
    inferServiceKind,
    validateCatalog,
    resolveLiveLayer,
    expandCatalogEntry,
    listCatalogLiveLayers
} from '../js/live-layers/catalog-schema.js';
import { FIREWATCH_KIND } from '../js/live-layers/firewatch/constants.js';

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
        expect(layers.find((entry) => entry.id === 'firewatch')?.subLayerCount).toBe(5);
        expect(layers.some((entry) => entry.id === 'udot-fiber-network')).toBe(false);
    });

    it('resolves firewatch as Utah composite with five firewatch parts', () => {
        const layer = resolveLiveLayer('firewatch');
        expect(layer?.name).toBe('Firewatch');
        expect(layer?.region).toBe('utah');
        const services = expandCatalogEntry(layer);
        expect(services).toHaveLength(5);
        expect(services.every((s) => s.kind === FIREWATCH_KIND)).toBe(true);
        expect(services.map((s) => s.firewatchPart)).toEqual([
            'incidents',
            'perimeters',
            'viirs',
            'modis',
            'noaa'
        ]);
    });
});
