import path from 'node:path';
import { test, expect } from '@playwright/test';
import { bootApp } from '../helpers/app.js';
import {
    importArcgisRestUrl,
    startArcgisImportAndCancel,
    assertLonLat4326
} from '../helpers/arcgis-import.js';
import {
    mockLayerUrl,
    resetArcgisMockRequests,
    readArcgisMockRequests,
    filterMockRequests
} from '../helpers/arcgis-mock-client.js';
import { exportActiveLayerGeoJSON, readLayerListFeatureCount } from '../helpers/probe.js';
import { installLongTaskObserver, buildPerfRow, importWallMs } from '../helpers/perf.js';
import {
    attachNetworkGuard,
    assertNoUnexpectedBlocks
} from '../helpers/network-guard.js';
import { installE2eBrowserShims } from '../helpers/e2e-browser-shims.js';

const downloadDir = path.join(process.cwd(), 'test-results/e2e-downloads/rest-full');

test.describe.configure({ mode: 'serial' });

/** @type {Map<string, import('../helpers/network-guard.js').NetworkGuardState>} */
const networkByTest = new Map();

test.beforeEach(async ({ context, request }, testInfo) => {
    await installE2eBrowserShims(context);
    installLongTaskObserver(context);
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
    await resetArcgisMockRequests(request);
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (guard) assertNoUnexpectedBlocks(guard);
});

test('@full rest paged layer 2500 features', async ({ page, request }, testInfo) => {
    test.setTimeout(360_000);
    await bootApp(page, '/');
    const timing = await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/3'), {
        timeoutMs: 300_000
    });
    expect(await readLayerListFeatureCount(page, 'Mock Paged Points')).toBe(2500);

    const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, 'paged'));
    expect(exported.features).toHaveLength(2500);
    assertLonLat4326(exported);
    const ids = exported.features.map((f) => f.properties.OBJECTID);
    expect(new Set(ids).size).toBe(2500);

    const reqs = await readArcgisMockRequests(request);
    const featureQueries = filterMockRequests(reqs, /\/query\?/).filter((r) => {
        const u = new URL(r.url, 'http://127.0.0.1');
        return (
            u.searchParams.get('returnCountOnly') !== 'true'
            && u.searchParams.get('returnIdsOnly') !== 'true'
        );
    });
    const offsets = featureQueries.map((r) => {
        const u = new URL(r.url, 'http://127.0.0.1');
        return u.searchParams.get('resultOffset') ?? '0';
    });
    expect(offsets).toContain('0');
    expect(offsets).toContain('1000');
    expect(offsets).toContain('2000');

    const perfRow = await buildPerfRow(page, {
        fixtureId: 'rest-mock-paged-2500',
        importMs: importWallMs(timing)
    });
    testInfo.annotations.push({ type: 'perf-row', description: JSON.stringify(perfRow) });
});

test('@full rest objectId batch paging', async ({ page, request }) => {
    test.setTimeout(180_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/7'));
    expect(await readLayerListFeatureCount(page, 'Mock ObjectId Batch')).toBe(5);

    const reqs = await readArcgisMockRequests(request);
    expect(filterMockRequests(reqs, /returnIdsOnly=true/).length).toBeGreaterThan(0);
    expect(filterMockRequests(reqs, /objectIds=/).length).toBeGreaterThan(0);
});

test('@full rest slow query cancel', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await startArcgisImportAndCancel(page, mockLayerUrl('error-slow/FeatureServer/0'));
    const layers = await page.locator('.layer-list-items .layer-item').count();
    expect(layers).toBe(0);
});
