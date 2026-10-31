import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ARCGIS_BACKOFF_BASE_MS,
    ARCGIS_BACKOFF_JITTER_MS,
    computeArcgisRetryDelayMs,
    arcgisFetchJson,
    arcgisQueryAllEsriFeatures,
    arcgisQueryFeatureCount,
    arcgisQueryGeoJsonPages,
    arcgisResolveLayerAttribution
} from '../js/arcgis/rest-client.js';
import { AppError } from '../js/core/error-handler.js';
import { ArcGISRestImporter } from '../js/arcgis/rest-importer.js';

const fetchMock = vi.hoisted(() => vi.fn());

function stubFetchMock() {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
}

describe('computeArcgisRetryDelayMs', () => {
    it('stays within exponential base plus jitter bounds', () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const exp = Math.min(8000, ARCGIS_BACKOFF_BASE_MS * (2 ** attempt));
            for (let i = 0; i < 20; i += 1) {
                const delay = computeArcgisRetryDelayMs(attempt, () => 0.5);
                expect(delay).toBeGreaterThanOrEqual(exp);
                expect(delay).toBeLessThanOrEqual(exp + ARCGIS_BACKOFF_JITTER_MS);
            }
        }
    });
});

describe('arcgisFetchJson retries and errors', () => {
    beforeEach(() => {
        stubFetchMock();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function jsonResponse(body, status = 200, headers = {}) {
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (k) => headers[k.toLowerCase()] ?? null },
            json: async () => body
        };
    }

    it('retries 500 then succeeds on 200', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({}, 500))
            .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

        const data = await arcgisFetchJson('https://example.com/layer?f=json', {
            timeoutMs: 5000,
            maxRetries: 3
        });
        expect(data.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('honors Retry-After on 429', async () => {
        vi.useFakeTimers();
        fetchMock
            .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '2' }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

        const promise = arcgisFetchJson('https://example.com/x', { maxRetries: 3, timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(2000);
        await promise;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it.each([400, 403])('does not retry HTTP %i', async (status) => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, status));
        await expect(
            arcgisFetchJson('https://example.com/x', { maxRetries: 3 })
        ).rejects.toBeInstanceOf(AppError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([498, 499])('does not retry Esri error code %i in HTTP 200', async (code) => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code, message: 'token' } }, 200));
        await expect(arcgisFetchJson('https://example.com/x')).rejects.toBeInstanceOf(AppError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries HTTP 200 with Esri 500 error JSON', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ error: { code: 500, message: 'server' } }, 200))
            .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

        await arcgisFetchJson('https://example.com/x', { maxRetries: 3, timeoutMs: 5000 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry HTTP 200 with Esri 400 error JSON', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 400, message: 'bad' } }, 200));
        await expect(arcgisFetchJson('https://example.com/x')).rejects.toBeInstanceOf(AppError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('times out when the request does not finish', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation((_url, { signal }) => new Promise((_, reject) => {
            signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
            });
        }));

        const promise = arcgisFetchJson('https://example.com/slow', { timeoutMs: 50, maxRetries: 0 });
        await vi.advanceTimersByTimeAsync(60);
        await expect(promise).rejects.toBeInstanceOf(AppError);
        vi.useRealTimers();
    });

    it('abort stops retries', async () => {
        const ctrl = new AbortController();
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

        const promise = arcgisFetchJson('https://example.com/x', {
            signal: ctrl.signal,
            maxRetries: 5,
            timeoutMs: 5000
        });
        await Promise.resolve();
        ctrl.abort();
        await expect(promise).rejects.toBeInstanceOf(AppError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('arcgisQueryAllEsriFeatures paging', () => {
    beforeEach(() => {
        stubFetchMock();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const LAYER = 'https://example.com/FeatureServer/0';

    function okJson(body) {
        return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
    }

    it('pages on exceededTransferLimit without duplicates', async () => {
        fetchMock.mockImplementation((url) => {
            const parsed = new URL(url);
            if (parsed.searchParams.get('returnCountOnly')) {
                return Promise.resolve(okJson({ count: 1200 }));
            }
            const offset = Number(parsed.searchParams.get('resultOffset') || 0);
            const size = 500;
            const remaining = 1200 - offset;
            const len = Math.min(size, remaining);
            const features = Array.from({ length: len }, (_, i) => ({
                attributes: { OBJECTID: offset + i + 1 }
            }));
            return Promise.resolve(okJson({
                features,
                exceededTransferLimit: offset + len < 1200
            }));
        });

        const collected = [];
        await arcgisQueryAllEsriFeatures({
            layerUrl: LAYER,
            layerMeta: {
                maxRecordCount: 1000,
                objectIdField: 'OBJECTID',
                capabilities: { supportsPagination: true, supportsResultOffset: true }
            },
            query: { where: '1=1', outFields: '*' },
            onPage: (page) => collected.push(...page)
        });

        const ids = collected.map((f) => f.attributes.OBJECTID);
        expect(ids).toHaveLength(1200);
        expect(new Set(ids).size).toBe(1200);
    });

    it('uses objectId batch fallback when pagination is unsupported', async () => {
        fetchMock.mockImplementation((url) => {
            const parsed = new URL(url);
            if (parsed.searchParams.get('returnIdsOnly') === 'true') {
                return Promise.resolve(okJson({ objectIds: [1, 2, 3] }));
            }
            if (parsed.searchParams.get('objectIds')) {
                const ids = parsed.searchParams.get('objectIds').split(',').map(Number);
                return Promise.resolve(okJson({
                    features: ids.map((id) => ({ attributes: { OBJECTID: id } }))
                }));
            }
            return Promise.reject(new Error(`unexpected ${url}`));
        });

        const collected = [];
        await arcgisQueryAllEsriFeatures({
            layerUrl: LAYER,
            layerMeta: {
                maxRecordCount: 1000,
                objectIdField: 'OBJECTID',
                capabilities: { supportsPagination: false, supportsResultOffset: true }
            },
            query: { where: '1=1', outFields: '*' },
            onPage: (page) => collected.push(...page)
        });

        expect(collected.map((f) => f.attributes.OBJECTID)).toEqual([1, 2, 3]);
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes('returnIdsOnly=true'))).toBe(true);
    });

    it('reports truncated when feature cap is hit', async () => {
        fetchMock.mockImplementation((url) => {
            const parsed = new URL(url);
            const offset = Number(parsed.searchParams.get('resultOffset') || 0);
            const features = Array.from({ length: 500 }, (_, i) => ({
                attributes: { OBJECTID: offset + i + 1 }
            }));
            return Promise.resolve(okJson({ features, exceededTransferLimit: true }));
        });

        const result = await arcgisQueryAllEsriFeatures({
            layerUrl: LAYER,
            layerMeta: {
                maxRecordCount: 1000,
                objectIdField: 'OBJECTID',
                capabilities: { supportsPagination: true, supportsResultOffset: true }
            },
            query: { where: '1=1' },
            featureCap: 600,
            enforceCapWhenCountUnknown: true
        });

        expect(result.featureCount).toBe(600);
        expect(result.truncated).toBe(true);
        expect(result.capped).toBe(true);
    });
});

describe('arcgisQueryFeatureCount', () => {
    beforeEach(() => {
        stubFetchMock();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the same where and geometry as the feature query', async () => {
        const geometry = { xmin: 1, ymin: 2, xmax: 3, ymax: 4, spatialReference: { wkid: 4326 } };
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ count: 42 })
        });

        await arcgisQueryFeatureCount('https://example.com/FeatureServer/0', {
            where: "NAME = 'x'",
            geometry,
            geometryType: 'esriGeometryEnvelope',
            spatialRel: 'esriSpatialRelIntersects',
            inSR: '4326',
            outFields: 'OBJECTID',
            returnGeometry: false
        });

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get('where')).toBe("NAME = 'x'");
        expect(JSON.parse(url.searchParams.get('geometry'))).toEqual(geometry);
        expect(url.searchParams.get('returnCountOnly')).toBe('true');
    });

    it('fail closed when count request fails', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            headers: { get: () => null },
            json: async () => ({})
        });

        const result = await arcgisQueryFeatureCount('https://example.com/layer', { where: '1=1' }, {
            maxRetries: 0
        });
        expect(result.countFailed).toBe(true);
        expect(result.count).toBeNull();
    });
});

describe('copyrightText on import', () => {
    beforeEach(() => {
        stubFetchMock();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reaches layer attribution from layer metadata', async () => {
        const layerUrl = 'https://example.com/arcgis/rest/services/mock/FeatureServer/0';
        fetchMock.mockImplementation((url) => {
            const u = String(url);
            if (u.includes('returnCountOnly')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    json: async () => ({ count: 1 })
                });
            }
            if (u.startsWith(layerUrl)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    json: async () => ({
                        name: 'Layer',
                        fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }],
                        geometryType: 'esriGeometryPoint',
                        copyrightText: '© Example Agency',
                        objectIdField: 'OBJECTID'
                    })
                });
            }
            return Promise.reject(new Error(u));
        });

        const importer = new ArcGISRestImporter();
        await importer.fetchMetadata(layerUrl);
        expect(importer.getMetadata().copyrightText).toBe('© Example Agency');

        fetchMock.mockImplementation((url) => {
            if (!String(url).includes('/query?')) return Promise.reject(new Error(url));
            return Promise.resolve({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: async () => ({
                    features: [{ geometry: { x: 1, y: 2 }, attributes: { OBJECTID: 1 } }]
                })
            });
        });

        const dataset = await importer.downloadFeatures({ useWorkspace: false });
        expect(dataset.attribution).toBe('© Example Agency');
    });

    it('arcgisResolveLayerAttribution falls back to service copyright', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ copyrightText: '© Service' })
        });
        const text = await arcgisResolveLayerAttribution(
            'https://example.com/FeatureServer/3',
            {},
            { timeoutMs: 5000 }
        );
        expect(text).toBe('© Service');
    });
});

describe('arcgisQueryGeoJsonPages', () => {
    beforeEach(() => {
        stubFetchMock();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns geojson features across pages', async () => {
        fetchMock.mockImplementation((url) => {
            const offset = Number(new URL(url).searchParams.get('resultOffset') || 0);
            const features = offset === 0
                ? [{ type: 'Feature', properties: { id: 1 } }]
                : [{ type: 'Feature', properties: { id: 2 } }];
            return Promise.resolve({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: async () => ({
                    type: 'FeatureCollection',
                    features,
                    exceededTransferLimit: offset === 0
                })
            });
        });

        const { features } = await arcgisQueryGeoJsonPages({
            layerUrl: 'https://example.com/FeatureServer/0',
            query: { where: '1=1', outFields: '*' },
            maxFeatures: 10
        });
        expect(features).toHaveLength(2);
    });
});
