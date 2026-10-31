import { describe, expect, it, beforeEach } from 'vitest';
import {
    reprojectCoordinate,
    reprojectDataset,
    reprojectFeatureCollection
} from '../js/crs/reproject.js';
import {
    CrsReprojectError,
    assertFiniteReprojectOutput,
    requireRegisteredReprojectCrs
} from '../js/crs/reproject-crs.js';
import { registerWkt, resetCrsRegistryForTests } from '../js/crs/registry.js';
import { reprojectLayer } from '../js/tools/reproject.js';
import { handleError } from '../js/core/error-handler.js';

function makeDataset(coords, crs = 'EPSG:26912') {
    return {
        name: 'test-layer',
        geojson: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: coords },
                properties: {}
            }]
        },
        schema: { crs, fields: [] }
    };
}

describe('CRS reprojection guards', () => {
    beforeEach(() => {
        resetCrsRegistryForTests();
    });

    it('rejects unknown EPSG on source and target', async () => {
        await expect(
            reprojectCoordinate([-111.5, 40.5], 'EPSG:99999', 'EPSG:4326')
        ).rejects.toMatchObject({
            name: 'CrsReprojectError',
            details: { side: 'source', crs: 'EPSG:99999' }
        });

        await expect(
            reprojectCoordinate([-111.5, 40.5], 'EPSG:4326', 'EPSG:88888')
        ).rejects.toMatchObject({
            name: 'CrsReprojectError',
            details: { side: 'target', crs: 'EPSG:88888' }
        });
    });

    it('rejects null, undefined, and empty CRS', async () => {
        for (const bad of [null, undefined, '', '   ']) {
            await expect(requireRegisteredReprojectCrs(bad, 'source')).rejects.toMatchObject({
                name: 'CrsReprojectError',
                details: { side: 'source', reason: 'missing' }
            });
            await expect(requireRegisteredReprojectCrs(bad, 'target')).rejects.toMatchObject({
                name: 'CrsReprojectError',
                details: { side: 'target', reason: 'missing' }
            });
        }
    });

    it('rejects malformed custom WKT registration', async () => {
        await expect(registerWkt('CUSTOM:broken', 'NOT VALID WKT')).rejects.toMatchObject({
            name: 'AppError',
            details: { reason: 'malformed' }
        });
    });

    it('rejects unrecognized proj4-like strings not in local registry', async () => {
        await expect(
            reprojectCoordinate([0, 0], '+proj=utm +zone=99 +datum=NAD83 +units=m +no_defs', 'EPSG:4326')
        ).rejects.toMatchObject({
            name: 'CrsReprojectError',
            details: { side: 'source', reason: 'unregistered' }
        });
    });

    it('detects non-finite output coordinates', () => {
        expect(() => assertFiniteReprojectOutput([NaN, 40], 'EPSG:4326', 'EPSG:3857'))
            .toThrow(CrsReprojectError);
        expect(() => assertFiniteReprojectOutput([0, Infinity], 'EPSG:4326', 'EPSG:3857'))
            .toThrow(CrsReprojectError);
    });

    it('preserves valid WGS84 → Web Mercator and UTM transforms', async () => {
        const merc = await reprojectCoordinate([-111.5, 40.5], 'EPSG:4326', 'EPSG:3857');
        expect(merc[0]).toBeCloseTo(-12412123.22, 0);
        expect(merc[1]).toBeCloseTo(4938869.18, 0);

        const utm = await reprojectCoordinate([-111.5, 40.5], 'EPSG:4326', 'EPSG:26912');
        expect(utm[0]).toBeCloseTo(457632.99, 0);
        expect(utm[1]).toBeCloseTo(4483374.79, 0);
    });

    it('rejects reproject when projected layer lacks schema CRS but caller passes WGS84 default', async () => {
        const ds = makeDataset([500000, 4500000], undefined);
        delete ds.schema.crs;

        await expect(
            reprojectDataset(ds, { fromCrs: 'EPSG:4326', toCrs: 'EPSG:4326' })
        ).rejects.toMatchObject({
            name: 'CrsReprojectError',
            details: { side: 'source', reason: 'missing' }
        });
    });

    it('surfaces typed errors through the Reproject tool wrapper', async () => {
        const ds = makeDataset([-111.5, 40.5], 'EPSG:4326');

        await expect(
            reprojectLayer(ds, { fromCrs: 'EPSG:4326', toCrs: 'EPSG:404040' })
        ).rejects.toMatchObject({
            name: 'CrsReprojectError',
            details: { side: 'target' }
        });

        try {
            await reprojectLayer(ds, { fromCrs: 'EPSG:4326', toCrs: 'EPSG:404040' });
        } catch (e) {
            const handled = handleError(e, 'GISTools', 'Reproject');
            expect(handled.technical).toMatch(/target/i);
            expect(handled.technical).toMatch(/EPSG:404040/i);
        }
    });

    it('still reprojects feature collections for valid preset CRS pairs', async () => {
        const fc = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-111.5, 40.5] },
                properties: {}
            }]
        };
        const out = await reprojectFeatureCollection(fc, 'EPSG:4326', 'EPSG:3857');
        const [x, y] = out.features[0].geometry.coordinates;
        expect(x).toBeCloseTo(-12412123.22, 0);
        expect(y).toBeCloseTo(4938869.18, 0);
    });
});
