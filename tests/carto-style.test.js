import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CARTO_LAYER_PREFIX,
    clearCartoStyleCache,
    isBasemapOwnedLayerId,
    isCartoBasemapLayerId,
    loadCartoVectorStyle,
    prepareCartoStyle
} from '../js/map/carto-style.js';

const SAMPLE_STYLE = {
    glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/sprite',
    sources: {
        carto: {
            type: 'vector',
            url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json'
        }
    },
    layers: [
        {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#fbf8f3' }
        },
        {
            id: 'water',
            type: 'fill',
            source: 'carto',
            paint: { 'fill-color': '#7dd3fc', 'fill-opacity': 1 }
        },
        {
            id: 'building',
            type: 'fill',
            source: 'carto'
        },
        {
            id: 'place_city',
            type: 'symbol',
            source: 'carto',
            layout: { 'text-field': '{name}' }
        }
    ]
};

describe('carto-style', () => {
    afterEach(() => {
        clearCartoStyleCache();
        vi.unstubAllGlobals();
    });

    it('prefixes sources and layers and drops the CARTO background', () => {
        const prepared = prepareCartoStyle(SAMPLE_STYLE);
        expect(prepared.backgroundColor).toBe('#fbf8f3');
        expect(prepared.sources[`${CARTO_LAYER_PREFIX}carto`]).toMatchObject({ type: 'vector' });
        expect(prepared.layers.map((layer) => layer.id)).toEqual([
            `${CARTO_LAYER_PREFIX}water`,
            `${CARTO_LAYER_PREFIX}building`,
            `${CARTO_LAYER_PREFIX}place_city`
        ]);
        expect(prepared.layers[0].source).toBe(`${CARTO_LAYER_PREFIX}carto`);
        expect(prepared.layers.some((layer) => layer.type === 'background')).toBe(false);
    });

    it('keeps symbol layers only when labelsOnly is set', () => {
        const prepared = prepareCartoStyle(SAMPLE_STYLE, { labelsOnly: true });
        expect(prepared.layers).toHaveLength(1);
        expect(prepared.layers[0].id).toBe(`${CARTO_LAYER_PREFIX}place_city`);
        expect(prepared.layers[0].type).toBe('symbol');
    });

    it('identifies owned basemap layer ids', () => {
        expect(isCartoBasemapLayerId('basemap-v-water')).toBe(true);
        expect(isCartoBasemapLayerId('roads-line')).toBe(false);
        expect(isBasemapOwnedLayerId('basemap-backdrop')).toBe(true);
        expect(isBasemapOwnedLayerId('basemap-tone-wash')).toBe(true);
        expect(isBasemapOwnedLayerId('hillshade')).toBe(false);
    });

    it('loads and caches a fetched style', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => SAMPLE_STYLE
        }));
        const first = await loadCartoVectorStyle('https://example.test/style.json', { fetchImpl });
        const second = await loadCartoVectorStyle('https://example.test/style.json', { fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
        expect(first.layers[0].id).toBe(`${CARTO_LAYER_PREFIX}water`);
    });
});
