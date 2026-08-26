import { describe, expect, it } from 'vitest';
import { hasResolvedCartoApiKey, withCartoKey } from '../js/map/carto-key.js';

describe('carto-key', () => {
    it('leaves URLs unchanged when no key is provided', () => {
        const url = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
        expect(withCartoKey(url, '')).toBe(url);
        expect(withCartoKey(url, null)).toBe(url);
    });

    it('appends key to a clean URL', () => {
        const url = withCartoKey('https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json', 'abc');
        expect(url).toContain('key=abc');
        expect(url.startsWith('https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json')).toBe(true);
    });

    it('replaces an existing key parameter', () => {
        const url = withCartoKey(
            'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json?key=old',
            'new'
        );
        expect(url).toContain('key=new');
        expect(url).not.toContain('key=old');
    });

    it('keeps glyph template braces intact', () => {
        const url = withCartoKey(
            'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
            'abc'
        );
        expect(url).toBe('https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf?key=abc');
    });

    it('reports whether a build-time key is present', () => {
        expect(typeof hasResolvedCartoApiKey()).toBe('boolean');
    });
});
