import { describe, expect, it } from 'vitest';
import {
    BASEMAP_CATEGORIES,
    getAllBasemapKeys,
    getBasemapCategory,
    getBasemapConfig,
    getCategoryDefaultKey,
    isSatelliteBasemap
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

    it('returns tile configs for known keys', () => {
        expect(getBasemapConfig('voyager')?.tiles?.length).toBeGreaterThan(0);
        expect(getBasemapConfig('satellite-labels')?.overlayTiles?.length).toBeGreaterThan(0);
        expect(getBasemapConfig('missing')).toBeNull();
    });

    it('detects satellite-category basemaps', () => {
        expect(isSatelliteBasemap('satellite')).toBe(true);
        expect(isSatelliteBasemap('satellite-labels')).toBe(true);
        expect(isSatelliteBasemap('voyager')).toBe(false);
        expect(isSatelliteBasemap('dark-matter')).toBe(false);
    });
});
