import { describe, expect, it } from 'vitest';
import { compilePaint } from '../js/map/style-engine.js';
import { validateCatalog, resolveLiveLayer, expandCatalogEntry } from '../js/live-layers/catalog-schema.js';
import { isVectorServiceKind } from '../js/live-layers/live-layer-viewport.js';
import {
    UDOT_FIBER_CATALOG_ID,
    matchUdotFiberLayerUrl
} from '../js/symbology/udot-fiber/constants.js';
import {
    buildUdotFiberLayerStyle,
    resolveStyle,
    lookupBentleyColor,
    requiredStyleFieldsForUdotFiberLayer,
    mergeUdotFiberStyleFields,
    markDatasetForUdotFiberStyle,
    resolveUdotFiberStyleForDataset
} from '../js/symbology/udot-fiber/resolve-style.js';
import { applyUdotFiberDisplayOffsets } from '../js/symbology/udot-fiber/display-offsets.js';
import { makeUdotGlyphSvg, resolvePointGlyph } from '../js/symbology/udot-fiber/glyphs.js';
import { applyImportLayerStyles } from '../js/import/post-import.js';
import { isSmartStyleActive } from '../js/map/style-engine.js';

describe('UDOT Fiber symbology', () => {
    it('matches MapServer layer URLs', () => {
        const hit = matchUdotFiberLayerUrl(
            'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6'
        );
        expect(hit).toEqual({ key: 'fiber', id: 6 });
        expect(matchUdotFiberLayerUrl('https://example.com/MapServer/0')).toBeNull();
    });

    it('builds fiber smart style with FIBER_SYMBOLS + Fiber_Label', () => {
        const style = buildUdotFiberLayerStyle('fiber');
        expect(style.mode).toBe('smart');
        expect(style.smart.visualVariables[0].field).toBe('FIBER_SYMBOLS');
        expect(style.smart.visualVariables[0].classes.length).toBeGreaterThan(5);
        expect(style.labels.enabled).toBe(true);
        expect(style.labels.field).toBe('Fiber_Label');
        expect(style.labels.placement).toBe('line');
        expect(style._udotFiber.layerKey).toBe('fiber');

        const paint = compilePaint(style, 'line');
        expect(paint.hasDataDriven).toBe(true);
        expect(Array.isArray(paint.strokeColor)).toBe(true);
    });

    it('builds conduit style from CONDUIT_SYM', () => {
        const style = buildUdotFiberLayerStyle('conduit');
        expect(style.smart.visualVariables[0].field).toBe('CONDUIT_SYM');
        expect(style.labels.field).toBe('CustNameRight');
    });

    it('resolves per-feature color from ArcGIS class and Bentley label', () => {
        const byClass = resolveStyle('fiber', { FIBER_SYMBOLS: '72', Fiber_Label: '' });
        expect(byClass.color).toMatch(/^#/);

        const bentley = lookupBentleyColor('Syringa 72 SMF');
        expect(bentley).toBeTruthy();
    });

    it('registers UDOT Fiber Network in live catalog as vector MapServer', () => {
        expect(validateCatalog()).toEqual([]);
        const entry = resolveLiveLayer(UDOT_FIBER_CATALOG_ID);
        expect(entry?.name).toBe('UDOT Fiber Network');
        const services = expandCatalogEntry(entry);
        expect(services).toHaveLength(6);
        expect(services.every((s) => s.kind === 'arcgis-mapserver-vector')).toBe(true);
        expect(isVectorServiceKind('arcgis-mapserver-vector')).toBe(true);
        expect(services.every((s) => s.style?.mode === 'smart')).toBe(true);
    });

    it('applies display offsets for multi-sheath lines', () => {
        const features = [
            {
                type: 'Feature',
                properties: { MULTISHEATH: 3 },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-111.9, 40.7], [-111.89, 40.71]]
                }
            },
            {
                type: 'Feature',
                properties: { MULTISHEATH: 3 },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-111.9, 40.7], [-111.89, 40.71]]
                }
            }
        ];
        const out = applyUdotFiberDisplayOffsets(features);
        expect(out[1].properties._udotDisplayOffsetM).toBeGreaterThan(0);
        expect(out[1].geometry.coordinates[0][0]).not.toBe(features[1].geometry.coordinates[0][0]);
    });

    it('builds procedural glyph SVG and resolves seed rules', () => {
        const svg = makeUdotGlyphSvg('square-x', '#00ff00', '#00ff00', 18);
        expect(svg).toContain('<svg');
        expect(svg).toContain('rect');
        const hit = resolvePointGlyph('building', { MODEL: 'UEN Building' });
        expect(hit?.glyph).toBe('square-x');
    });

    it('keeps Fiber class/label fields on a partial ArcGIS field pick', () => {
        expect(requiredStyleFieldsForUdotFiberLayer('fiber')).toEqual(['FIBER_SYMBOLS', 'Fiber_Label']);
        const url = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
        expect(mergeUdotFiberStyleFields(null, url)).toBeNull();
        expect(mergeUdotFiberStyleFields(['OBJECTID', 'Route'], url, ['OBJECTID', 'Route', 'FIBER_SYMBOLS', 'Fiber_Label']))
            .toEqual(['OBJECTID', 'Route', 'FIBER_SYMBOLS', 'Fiber_Label']);
    });

    it('tags custom-URL ArcGIS imports and ignores unmatched URLs', () => {
        const url = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
        const ds = { id: 'a', source: { format: 'arcgis-rest' } };
        expect(markDatasetForUdotFiberStyle(ds, url)).toEqual({ key: 'fiber', id: 6 });
        expect(ds._udotFiberLayerKey).toBe('fiber');
        expect(ds._applyUdotFiberStyle).toBe(true);
        expect(ds.source.url).toBe(url);
        expect(markDatasetForUdotFiberStyle({ id: 'b', source: {} }, 'https://example.com/FeatureServer/0')).toBeNull();
    });

    it('applies the Fiber style pack only when the custom-URL flag is set', () => {
        const styles = new Map();
        const mapService = {
            getLayerStyle: (id) => styles.get(id) || null,
            setLayerStyle: (id, style) => { styles.set(id, style); },
            restyleLayer: (id, _ds, style) => { styles.set(id, style); },
            getLayerRecord: () => null
        };
        const fiberUrl = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
        const untagged = {
            id: 'untagged',
            type: 'spatial',
            source: { url: fiberUrl, format: 'arcgis-rest' },
            geojson: { type: 'FeatureCollection', features: [] }
        };
        applyImportLayerStyles(untagged, { mapService, getLayers: () => [untagged] });
        expect(mapService.getLayerStyle('untagged')).toBeNull();

        const tagged = {
            id: 'tagged',
            type: 'spatial',
            source: { url: fiberUrl, format: 'arcgis-rest' },
            geojson: { type: 'FeatureCollection', features: [] }
        };
        markDatasetForUdotFiberStyle(tagged, fiberUrl);
        applyImportLayerStyles(tagged, { mapService, getLayers: () => [tagged] });
        const applied = mapService.getLayerStyle('tagged');
        expect(applied.mode).toBe('smart');
        expect(applied.smart.visualVariables[0].field).toBe('FIBER_SYMBOLS');
        expect(isSmartStyleActive(applied)).toBe(true);
        expect(resolveUdotFiberStyleForDataset(tagged)?._udotFiber.layerKey).toBe('fiber');
    });
});
