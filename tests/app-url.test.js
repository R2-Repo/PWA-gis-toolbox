import { describe, expect, it } from 'vitest';
import { parseAppUrl, hasRecognizedAppUrlConfig } from '../js/url/app-url-parser.js';
import { buildAppUrl, encodeLiveUrlEntry, parseLiveEntry, resolveAppUrlMapInit } from '../js/url/app-url-builder.js';
import { _resetAppUrlDetectorCache } from '../js/url/app-url-detector.js';

describe('app-url parser', () => {
    it('parses compact view param', () => {
        const config = parseAppUrl('?view=8,-111.5,40.2,45,120');
        expect(config.view).toEqual({
            zoom: 8,
            center: [-111.5, 40.2],
            pitch: 45,
            bearing: 120
        });
    });

    it('parses bounds and chrome params', () => {
        const config = parseAppUrl('?bounds=-112.1,39.5,-111.0,40.5&padding=40&basemap=satellite&dim=3d&panel=none');
        expect(config.bounds).toEqual([-112.1, 39.5, -111.0, 40.5]);
        expect(config.padding).toBe(40);
        expect(config.basemap).toBe('satellite');
        expect(config.dim).toBe('3d');
        expect(config.panel).toBe('none');
    });

    it('parses alternate basemap keys', () => {
        const config = parseAppUrl('?basemap=dark-matter');
        expect(config.basemap).toBe('dark-matter');
    });

    it('normalizes unknown basemap keys to voyager', () => {
        const config = parseAppUrl('?basemap=not-a-real-basemap');
        expect(config.basemap).toBe('voyager');
    });

    it('parses live param without map preset bootstrap', () => {
        const config = parseAppUrl('?live=firewatch');
        expect(config.map).toBeUndefined();
        expect(config.live).toEqual(['firewatch']);
    });

    it('detects recognized config', () => {
        expect(hasRecognizedAppUrlConfig(parseAppUrl('?view=7,-111,40'))).toBe(true);
        expect(hasRecognizedAppUrlConfig({})).toBe(false);
    });
});

describe('app-url builder', () => {
    it('round-trips view config', () => {
        const config = {
            basemap: 'satellite',
            dim: '3d',
            panel: 'right',
            view: { zoom: 9, center: [-111.1, 40.1], pitch: 30, bearing: 45 }
        };
        const url = buildAppUrl(config, 'https://example.test/app');
        const parsed = parseAppUrl(url.split('?')[1] ? `?${url.split('?')[1]}` : '');
        expect(parsed.basemap).toBe('satellite');
        expect(parsed.dim).toBe('3d');
        expect(parsed.panel).toBe('right');
        expect(parsed.view?.zoom).toBe(9);
        expect(parsed.view?.center).toEqual([-111.1, 40.1]);
    });

    it('encodes and parses inline live URLs', () => {
        const entry = encodeLiveUrlEntry('https://example.com/FeatureServer/0');
        const parsed = parseLiveEntry(entry);
        expect(parsed).toEqual({
            type: 'url',
            url: 'https://example.com/FeatureServer/0'
        });
    });

    it('resolves map init from bounds', () => {
        const init = resolveAppUrlMapInit({
            bounds: [-112, 39, -111, 40],
            dim: '3d',
            basemap: 'satellite'
        });
        expect(init.enable3D).toBe(true);
        expect(init.basemap).toBe('satellite');
        expect(init.bounds).toEqual([-112, 39, -111, 40]);
    });
});

describe('app-url detector cache', () => {
    it('resets cache for tests', () => {
        _resetAppUrlDetectorCache();
        expect(true).toBe(true);
    });
});
