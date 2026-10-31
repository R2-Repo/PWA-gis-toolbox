import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ArcGISRestImporter,
    arcgisResponseExceededTransferLimit,
    closeRing,
    esriRingsToGeoJSON
} from '../js/arcgis/rest-importer.js';
import { ringIsClockwise } from '../js/import/stream/shp-stream-parser.js';

// Esri / shapefile: clockwise exteriors, counter-clockwise holes.
const CW_OUTER = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
const CCW_HOLE = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
const CW_OUTER_FAR = [[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]];
const CCW_HOLE_FAR = [[22, 22], [28, 22], [28, 28], [22, 28], [22, 22]];
const CW_ISLAND = [[3, 3], [3, 5], [5, 5], [5, 3], [3, 3]];

function expectRfc7946Polygon(geom) {
    expect(geom.type).toBe('Polygon');
    expect(ringIsClockwise(geom.coordinates[0])).toBe(false);
    for (let i = 1; i < geom.coordinates.length; i++) {
        expect(ringIsClockwise(geom.coordinates[i])).toBe(true);
    }
}

describe('esriRingsToGeoJSON', () => {
    it('converts a single exterior ring', () => {
        const geom = esriRingsToGeoJSON([CW_OUTER]);
        expectRfc7946Polygon(geom);
        expect(geom.coordinates).toHaveLength(1);
    });

    it('builds a donut (outer + hole)', () => {
        const geom = esriRingsToGeoJSON([CW_OUTER, CCW_HOLE]);
        expectRfc7946Polygon(geom);
        expect(geom.coordinates).toHaveLength(2);
    });

    it('separates two exteriors into MultiPolygon', () => {
        const geom = esriRingsToGeoJSON([CW_OUTER, CW_OUTER_FAR]);
        expect(geom.type).toBe('MultiPolygon');
        expect(geom.coordinates).toHaveLength(2);
        expect(geom.coordinates.every((poly) => poly.length === 1)).toBe(true);
    });

    it('assigns each hole to the correct exterior', () => {
        const geom = esriRingsToGeoJSON([CW_OUTER, CW_OUTER_FAR, CCW_HOLE, CCW_HOLE_FAR]);
        expect(geom.type).toBe('MultiPolygon');
        expect(geom.coordinates).toHaveLength(2);
        const near = geom.coordinates.find((poly) => poly.length === 2 && ringIsClockwise(poly[1]));
        const far = geom.coordinates.find((poly) => poly !== near && poly.length === 2);
        expect(near[1]).toEqual(expect.arrayContaining([[2, 2]]));
        expect(far[1]).toEqual(expect.arrayContaining([[22, 22]]));
    });

    it('keeps an island inside a hole as its own polygon', () => {
        const geom = esriRingsToGeoJSON([CW_OUTER, CCW_HOLE, CW_ISLAND]);
        expect(geom.type).toBe('MultiPolygon');
        expect(geom.coordinates).toHaveLength(2);
        const withHole = geom.coordinates.find((poly) => poly.length === 2);
        const islandOnly = geom.coordinates.find((poly) => poly.length === 1);
        expect(withHole).toBeTruthy();
        expect(islandOnly).toBeTruthy();
        expect(ringIsClockwise(islandOnly[0])).toBe(false);
    });

    it('classifies reversed winding via containment', () => {
        const reversedOuter = CW_OUTER.slice().reverse();
        const reversedHole = CCW_HOLE.slice().reverse();
        const geom = esriRingsToGeoJSON([reversedOuter, reversedHole]);
        expectRfc7946Polygon(geom);
        expect(geom.coordinates).toHaveLength(2);
    });

    it('closes unclosed rings', () => {
        const open = CW_OUTER.slice(0, -1);
        const geom = esriRingsToGeoJSON([open]);
        expectRfc7946Polygon(geom);
        const closed = geom.coordinates[0];
        expect(closed[0]).toEqual(closed[closed.length - 1]);
    });

    it('returns null for empty or degenerate rings', () => {
        expect(esriRingsToGeoJSON([])).toBeNull();
        expect(esriRingsToGeoJSON([[]])).toBeNull();
        expect(esriRingsToGeoJSON([[[0, 0], [1, 1], [0, 0]]])).toBeNull();
    });

    it('closeRing is idempotent', () => {
        const once = closeRing(CW_OUTER.slice(0, -1));
        expect(once[0]).toEqual(once[once.length - 1]);
        expect(closeRing(once)).toEqual(once);
    });
});

describe('arcgisResponseExceededTransferLimit', () => {
    it('reads top-level and properties flags', () => {
        expect(arcgisResponseExceededTransferLimit({ exceededTransferLimit: true })).toBe(true);
        expect(arcgisResponseExceededTransferLimit({ properties: { exceededTransferLimit: true } })).toBe(true);
        expect(arcgisResponseExceededTransferLimit({ exceededTransferLimit: false })).toBe(false);
        expect(arcgisResponseExceededTransferLimit({})).toBe(false);
    });
});

describe('ArcGISRestImporter.downloadFeatures paging', () => {
    const LAYER_URL = 'https://example.com/arcgis/rest/services/mock/FeatureServer/0';
    let fetchMock;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function makeFeature(id) {
        return {
            geometry: { x: id, y: id },
            attributes: { OBJECTID: id }
        };
    }

    function stubLayer(totalFeatures, options = {}) {
        const {
            pageSize = 500,
            flagInProperties = false,
            shortFinalWithoutFlag = false
        } = options;
        const importer = new ArcGISRestImporter();
        importer.metadata = {
            name: 'Mock',
            url: LAYER_URL,
            maxRecordCount: 1000,
            objectIdField: 'OBJECTID',
            geometryType: 'Point',
            fields: [{ name: 'OBJECTID', type: 'number' }],
            totalCount: totalFeatures
        };

        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/query?')) {
                return Promise.reject(new Error(`Unexpected fetch: ${url}`));
            }
            const parsed = new URL(url);
            const offset = Number(parsed.searchParams.get('resultOffset') || 0);
            const remaining = totalFeatures - offset;
            let pageLen = Math.min(pageSize, remaining);
            if (shortFinalWithoutFlag && remaining > 0 && remaining < pageSize) {
                pageLen = remaining;
            }
            const features = [];
            for (let i = 0; i < pageLen; i++) {
                features.push(makeFeature(offset + i + 1));
            }
            const exceeded = offset + pageLen < totalFeatures;
            const payload = { features };
            if (flagInProperties) {
                payload.properties = { exceededTransferLimit: exceeded };
            } else {
                payload.exceededTransferLimit = exceeded;
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => payload
            });
        });

        return importer;
    }

    it('pages through size-capped responses until all 2500 features are loaded', async () => {
        const importer = stubLayer(2500);
        const dataset = await importer.downloadFeatures({
            useWorkspace: false,
            returnGeometry: true
        });
        const ids = dataset.geojson.features.map((f) => f.properties.OBJECTID);
        expect(ids).toHaveLength(2500);
        expect(new Set(ids).size).toBe(2500);
        expect(Math.min(...ids)).toBe(1);
        expect(Math.max(...ids)).toBe(2500);

        const queryCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/query?'));
        expect(queryCalls).toHaveLength(5);
        expect(new URL(queryCalls[4][0]).searchParams.get('resultOffset')).toBe('2000');
    });

    it('honors exceededTransferLimit under properties (geojson-style envelope)', async () => {
        const importer = stubLayer(1200, { pageSize: 500, flagInProperties: true });
        const dataset = await importer.downloadFeatures({ useWorkspace: false });
        expect(dataset.geojson.features).toHaveLength(1200);
    });

    it('stops on a short final page without exceededTransferLimit', async () => {
        const importer = stubLayer(450, { pageSize: 500, shortFinalWithoutFlag: true });
        const dataset = await importer.downloadFeatures({ useWorkspace: false });
        expect(dataset.geojson.features).toHaveLength(450);
        const queryCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/query?'));
        expect(queryCalls).toHaveLength(1);
    });

    it('adds stable orderByFields on the objectId when paging', async () => {
        const importer = stubLayer(100);
        await importer.downloadFeatures({ useWorkspace: false });
        const queryUrl = fetchMock.mock.calls.find(([u]) => String(u).includes('/query?'))[0];
        expect(new URL(queryUrl).searchParams.get('orderByFields')).toBe('OBJECTID');
    });
});
