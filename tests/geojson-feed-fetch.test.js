import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJsonWithLimits, readJsonBodyWithByteCap } from '../js/arcgis/rest-client.js';
import { LIMITS } from '../js/import/import-limits.js';

describe('GeoJSON feed bounded fetch', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('times out slow feeds', async () => {
        vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
                reject(init.signal.reason || new DOMException('Aborted', 'TimeoutError'));
            });
        }));

        await expect(fetchJsonWithLimits('https://example.test/slow.geojson', {
            timeoutMs: 20,
            maxBytes: LIMITS.geojsonFeedMaxBytes
        })).rejects.toMatchObject({ category: 'TIMEOUT' });
    });

    it('honors caller abort', async () => {
        const ctrl = new AbortController();
        vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
            });
        }));

        const pending = fetchJsonWithLimits('https://example.test/feed.geojson', {
            signal: ctrl.signal,
            timeoutMs: 5_000,
            maxBytes: LIMITS.geojsonFeedMaxBytes
        });
        ctrl.abort();
        await expect(pending).rejects.toMatchObject({ category: 'TIMEOUT' });
    });

    it('rejects bodies over the byte cap while streaming', async () => {
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(LIMITS.geojsonFeedMaxBytes));
                controller.enqueue(new Uint8Array(1));
                controller.close();
            }
        });
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://example.test/huge.geojson',
            body
        });

        await expect(fetchJsonWithLimits('https://example.test/huge.geojson', {
            timeoutMs: 5_000,
            maxBytes: LIMITS.geojsonFeedMaxBytes
        })).rejects.toMatchObject({ category: 'OUT_OF_MEMORY' });
    });

    it('returns parsed JSON for normal feeds', async () => {
        const payload = JSON.stringify({ type: 'FeatureCollection', features: [] });
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://example.test/ok.geojson',
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(payload));
                    controller.close();
                }
            })
        });

        const data = await fetchJsonWithLimits('https://example.test/ok.geojson', {
            timeoutMs: 5_000,
            maxBytes: LIMITS.geojsonFeedMaxBytes
        });
        expect(data.type).toBe('FeatureCollection');
    });

    it('readJsonBodyWithByteCap enforces cap on string bodies', async () => {
        const huge = 'x'.repeat(LIMITS.geojsonFeedMaxBytes + 1);
        await expect(readJsonBodyWithByteCap({
            body: null,
            text: async () => huge,
            url: 'https://example.test/x'
        }, LIMITS.geojsonFeedMaxBytes)).rejects.toMatchObject({ category: 'OUT_OF_MEMORY' });
    });
});
