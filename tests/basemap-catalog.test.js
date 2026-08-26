import { describe, expect, it } from 'vitest';
import {
    BASEMAP_CATEGORIES,
    getAllBasemapKeys,
    getBasemapCategory,
    getBasemapConfig,
    getCategoryDefaultKey,
    isCartoVectorBasemap,
    isSatelliteBasemap,
    usesCartoVector
} from '../js/map/basemap-catalog.js';

describe('basemap-catalog', () => {
    it('exposes default keys per category', () => {
        expect(getCategoryDefaultKey('map')).toBe('voyager');
        expect(getCategoryDefaultKey('satellite')).toBe('satellite');
        expect(BASEMAP_CATEGORIES.map.defaultKey).toBe('voyager');
        expect(BASEMAP_CATEGORIES.satellite.defaultKey).toBe('satellite');
    });

    it('resolves categories for defaults and alternates', () => {
        expect(getBasemapCategory('voyager')).toBe('map');
        expect(getBasemapCategory('dark-matter')).toBe('map');
        expect(getBasemapCategory('positron')).toBe('map');
        expect(getBasemapCategory('satellite')).toBe('satellite');
        expect(getBasemapCategory('satellite-labels')).toBe('satellite');
        expect(getBasemapCategory('unknown')).toBeNull();
    });

    it('includes starter alternates in the flat key list', () => {
        const keys = getAllBasemapKeys();
        expect(keys).toContain('voyager');
        expect(keys).toContain('dark-matter');
        expect(keys).toContain('positron');
        expect(keys).toContain('satellite');
        expect(keys).toContain('satellite-labels');
        expect(keys).toHaveLength(5);
    });

    it('returns vector configs for map keys and raster tiles for satellite', () => {
        expect(getBasemapConfig('voyager')?.kind).toBe('carto-vector');
        expect(getBasemapConfig('voyager')?.styleUrl).toContain('voyager-gl-style');
        expect(getBasemapConfig('satellite')?.tiles?.length).toBeGreaterThan(0);
        expect(getBasemapConfig('satellite-labels')?.kind).toBe('hybrid');
        expect(getBasemapConfig('satellite-labels')?.overlayStyleUrl).toContain('voyager-gl-style');
        expect(getBasemapConfig('satellite-labels')?.overlayTiles).toBeUndefined();
        expect(getBasemapConfig('missing')).toBeNull();
        expect(isCartoVectorBasemap('voyager')).toBe(true);
        expect(usesCartoVector('satellite-labels')).toBe(true);
        expect(isCartoVectorBasemap('satellite')).toBe(false);
    });

    it('detects satellite-category basemaps', () => {
        expect(isSatelliteBasemap('satellite')).toBe(true);
        expect(isSatelliteBasemap('satellite-labels')).toBe(true);
        expect(isSatelliteBasemap('voyager')).toBe(false);
        expect(isSatelliteBasemap('dark-matter')).toBe(false);
    });
});
