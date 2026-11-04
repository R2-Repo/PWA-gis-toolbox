import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { bootApp } from '../helpers/app.js';
import { mockLayerUrl } from '../helpers/arcgis-mock-client.js';
import { attachNetworkGuard, assertNoUnexpectedBlocks } from '../helpers/network-guard.js';

const fixturePath = path.join(process.cwd(), 'tests/fixtures/e2e/dual-screen-point.pmtiles');
const fixtureBytes = readFileSync(fixturePath);

/** @type {Map<string, import('../helpers/network-guard.js').NetworkGuardState>} */
const networkByTest = new Map();

test.beforeEach(async ({ context }, testInfo) => {
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
    await context.route('**/dual-screen-point.pmtiles', async (route) => {
        const request = route.request();
        const header = request.headers().range || '';
        const match = /bytes=(\d+)-(\d*)/.exec(header);
        if (match) {
            const start = Number(match[1]);
            const end = match[2] ? Number(match[2]) : fixtureBytes.length - 1;
            const slice = fixtureBytes.subarray(start, Math.min(end + 1, fixtureBytes.length));
            await route.fulfill({
                status: 206,
                headers: {
                    'content-type': 'application/octet-stream',
                    'content-length': String(slice.length),
                    'content-range': `bytes ${start}-${start + slice.length - 1}/${fixtureBytes.length}`,
                    'accept-ranges': 'bytes',
                    'access-control-allow-origin': '*'
                },
                body: slice
            });
            return;
        }
        await route.fulfill({
            status: 200,
            headers: {
                'content-type': 'application/octet-stream',
                'content-length': String(fixtureBytes.length),
                'accept-ranges': 'bytes',
                'access-control-allow-origin': '*'
            },
            body: fixtureBytes
        });
    });
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (guard) assertNoUnexpectedBlocks(guard);
});

async function renderedCount(page, layerIds) {
    return page.evaluate(async (ids) => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        if (!map) return 0;
        const present = ids.filter((id) => map.getLayer?.(id));
        if (!present.length) return 0;
        await new Promise((resolve) => {
            if (map.loaded()) resolve();
            else map.once('idle', () => resolve());
        });
        return map.queryRenderedFeatures({ layers: present }).length;
    }, layerIds);
}

test('REST and PMTiles match in the pop-out map', async ({ page }) => {
    test.setTimeout(180_000);
    await bootApp(page, '/');
    const serviceUrl = mockLayerUrl('mock/FeatureServer/5');
    const pmtilesUrl = `${new URL(page.url()).origin}/fixtures/dual-screen-point.pmtiles`;

    await page.evaluate(async ({ serviceUrl: url, pmtilesUrl: tilesUrl }) => {
        const state = globalThis.__gisE2eState;
        const map = globalThis.__gisE2eMapService;
        const service = {
            id: 'live-points',
            name: 'Mock Picture Points',
            type: 'service',
            visible: true,
            service: {
                kind: 'arcgis-featureserver',
                url,
                refreshMs: 0,
                opacity: 1,
                style: {
                    mode: 'simple',
                    strokeColor: '#112233',
                    fillColor: '#112233',
                    strokeWidth: 2,
                    strokeOpacity: 1,
                    fillOpacity: 1,
                    pointSize: 8,
                    pointSymbol: 'circle',
                    labels: {
                        enabled: true,
                        field: 'NAME',
                        placement: 'point',
                        minZoom: 0,
                        maxZoom: 24,
                        size: 12,
                        color: '#111111',
                        haloColor: '#ffffff',
                        haloWidth: 1
                    }
                }
            },
            source: { format: 'live-service', url },
            geojson: { type: 'FeatureCollection', features: [] }
        };
        const pmtiles = {
            id: 'pmt-e2e',
            name: 'PMTiles fixture',
            type: 'pmtiles',
            visible: true,
            pmtiles: { url: tilesUrl, sourceLayer: 'features' },
            source: { format: 'pmtiles', url: tilesUrl },
            schema: { geometryType: 'Point', featureCount: 1 }
        };
        state.addLayer(service, { activate: true });
        state.addLayer(pmtiles);
        map.setLayerStyle('pmt-e2e', {
            mode: 'simple',
            strokeColor: '#336699',
            fillColor: '#336699',
            strokeWidth: 2,
            strokeOpacity: 1,
            fillOpacity: 1,
            pointSize: 7,
            pointSymbol: 'circle',
            labels: {
                enabled: true,
                field: 'NAME',
                placement: 'point',
                minZoom: 0,
                maxZoom: 24,
                size: 12,
                color: '#111111',
                haloColor: '#ffffff',
                haloWidth: 1
            }
        });
        await map.addServiceLayer(service, 0, { fit: false });
        await map.addLayer(pmtiles, 1, { fit: false });
    }, { serviceUrl, pmtilesUrl });

    await expect.poll(() => page.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        const src = map?.getSource?.('svc-src-live-points');
        return src?._data?.features?.length || 0;
    }), { timeout: 30_000 }).toBeGreaterThan(0);

    const popupPromise = page.waitForEvent('popup');
    await page.locator('#btn-dual-screen').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForFunction(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        return !!(map && (map.loaded?.() || map.isStyleLoaded?.()));
    }, null, { timeout: 30_000 });

    await expect.poll(() => popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        return {
            service: !!map?.getLayer?.('svc-lyr-live-points-circle'),
            glyph: !!map?.getLayer?.('svc-lyr-live-points-pms-glyph'),
            labels: !!map?.getLayer?.('svc-live-points-labels'),
            pmtiles: !!map?.getLayer?.('pmt-e2e-point'),
            pmtilesLabels: !!map?.getLayer?.('pmt-e2e-labels'),
            features: map?.getSource?.('svc-src-live-points')?._data?.features?.length || 0
        };
    }), { timeout: 40_000 }).toMatchObject({
        service: true,
        glyph: true,
        labels: true,
        pmtiles: true,
        pmtilesLabels: true,
        features: 2
    });

    await popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        map.fitBounds([[-112.2, 40.2], [-111.2, 41.2]], { padding: 40, duration: 0 });
    });
    const serviceLayers = ['svc-lyr-live-points-circle', 'svc-lyr-live-points-pms-glyph'];
    await expect.poll(() => renderedCount(popup, serviceLayers), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => renderedCount(popup, ['pmt-e2e-point']), { timeout: 20_000 }).toBeGreaterThan(0);

    const popupText = await popup.evaluate(() => {
        const svc = globalThis.__gisE2eMapService;
        const map = svc.getMap();
        const layers = ['svc-lyr-live-points-pms-glyph', 'svc-lyr-live-points-circle'].filter((id) => map.getLayer(id));
        const feature = map.queryRenderedFeatures({ layers })[0];
        svc.showPopup(
            { type: 'Feature', geometry: feature.geometry, properties: { ...feature.properties } },
            { id: 'live-points', name: 'Mock Picture Points' },
            { lng: -111.5, lat: 40.5 }
        );
        return document.querySelector('.maplibregl-popup')?.innerText || '';
    });
    expect(popupText).toMatch(/Feature/);

    const pmtilesPopup = await popup.evaluate(() => {
        const svc = globalThis.__gisE2eMapService;
        const map = svc.getMap();
        const feature = map.queryRenderedFeatures({ layers: ['pmt-e2e-point'] })[0];
        svc.showPopup(
            { type: 'Feature', geometry: feature.geometry, properties: { ...feature.properties } },
            { id: 'pmt-e2e', name: 'PMTiles fixture' },
            { lng: -111.89, lat: 40.76 }
        );
        return document.querySelector('.maplibregl-popup')?.innerText || '';
    });
    expect(pmtilesPopup).toContain('Feature 1');

    await page.evaluate(async () => {
        const state = globalThis.__gisE2eState;
        const map = globalThis.__gisE2eMapService;
        const service = state.getLayers().find((layer) => layer.id === 'live-points');
        service.service.style = {
            ...service.service.style,
            fillColor: '#aa1144',
            strokeColor: '#aa1144'
        };
        await map.addServiceLayer(service, 0, { fit: false });
        const tiles = state.getLayers().find((layer) => layer.id === 'pmt-e2e');
        const style = map.getLayerStyle('pmt-e2e') || {};
        map.restyleLayer('pmt-e2e', tiles, { ...style, fillColor: '#00aa44', strokeColor: '#00aa44' });
        service._activeFilter = {
            rules: [{ field: 'NAME', operator: 'equals', value: 'Feature 1' }],
            logic: 'AND'
        };
        await map.syncWorkspaceAttributeFilter(service);
        tiles._activeFilter = {
            rules: [{ field: 'NAME', operator: 'equals', value: 'missing' }],
            logic: 'AND'
        };
        await map.syncWorkspaceAttributeFilter(tiles);
        await map.refreshServiceLayer('live-points');
    });

    await expect.poll(() => popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        try {
            return map?.getPaintProperty?.('svc-lyr-live-points-circle', 'circle-color') || '';
        } catch {
            return '';
        }
    }), { timeout: 20_000 }).toBe('#aa1144');

    await expect.poll(() => popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        try {
            return map?.getPaintProperty?.('pmt-e2e-point', 'circle-color') || '';
        } catch {
            return '';
        }
    }), { timeout: 20_000 }).toBe('#00aa44');

    await expect.poll(() => renderedCount(popup, serviceLayers), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => renderedCount(popup, ['pmt-e2e-point']), { timeout: 20_000 }).toBe(0);

    await page.evaluate(() => {
        globalThis.__gisE2eMapService.removeLayer('live-points');
        globalThis.__gisE2eMapService.removeLayer('pmt-e2e');
        globalThis.__gisE2eState.removeLayer('live-points');
        globalThis.__gisE2eState.removeLayer('pmt-e2e');
    });

    await expect.poll(() => popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        return {
            service: !!map?.getLayer?.('svc-lyr-live-points-circle'),
            pmtiles: !!map?.getLayer?.('pmt-e2e-point')
        };
    })).toEqual({ service: false, pmtiles: false });
});
