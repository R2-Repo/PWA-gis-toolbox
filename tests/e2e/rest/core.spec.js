import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { bootApp, dismissOpenModals, dismissToasts } from '../helpers/app.js';
import {
    importArcgisRestUrl,
    expectArcgisImportError,
    importArcgisRestUrlExpectFailure,
    assertLonLat4326,
    readSessionArcgisStyle
} from '../helpers/arcgis-import.js';
import {
    mockLayerUrl,
    resetArcgisMockRequests,
    readArcgisMockRequests,
    filterMockRequests
} from '../helpers/arcgis-mock-client.js';
import { exportActiveLayerGeoJSON, readLayerListFeatureCount } from '../helpers/probe.js';
import { assertFeatureCollection } from '../helpers/geo-assert.js';
import { installLongTaskObserver, buildPerfRow, importWallMs } from '../helpers/perf.js';
import {
    attachNetworkGuard,
    assertNoUnexpectedBlocks
} from '../helpers/network-guard.js';
import { installE2eBrowserShims } from '../helpers/e2e-browser-shims.js';

const downloadDir = path.join(process.cwd(), 'test-results/e2e-downloads/rest');

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
    if (guard) {
        assertNoUnexpectedBlocks(guard);
        const logPath = path.join(process.cwd(), 'test-results/gis-report/network-log.jsonl');
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.appendFile(
            logPath,
            `${JSON.stringify({
                test: testInfo.title,
                basemapBlocked: guard.basemapBlocked,
                telemetryBlocked: guard.telemetryBlocked,
                unexpectedBlocked: guard.unexpectedBlocked
            })}\n`
        );
    }
});

async function runArcgisFailure(page, layerKey) {
    await bootApp(page, '/');
    await dismissToasts(page);
    await dismissOpenModals(page);
    await page.locator('#btn-import').click();
    await page.getByRole('button', { name: 'ArcGIS REST' }).click();
    await page.locator('#arcgis-custom-url-react').fill(mockLayerUrl(layerKey));
    await page.locator('#arcgis-custom-import-react').click();
    await expectArcgisImportError(page);
}

test('@tune rest mock points import', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    const timing = await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/0'));
    await dismissOpenModals(page);

    expect(await readLayerListFeatureCount(page, 'Mock Points')).toBe(3);
    const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, 'points'));
    assertFeatureCollection(exported, {
        featureCount: 3,
        geometryTypes: ['Point'],
        fields: { NAME: 'string', SCORE: 'number' }
    });
    assertLonLat4326(exported);

    const perfRow = await buildPerfRow(page, {
        fixtureId: 'rest-mock-points',
        importMs: importWallMs(timing)
    });
    testInfo.annotations.push({ type: 'perf-row', description: JSON.stringify(perfRow) });
});

test('@tune rest mock polyline import', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/1'));
    expect(await readLayerListFeatureCount(page, 'Mock Polylines')).toBe(2);
    const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, 'lines'));
    assertFeatureCollection(exported, {
        featureCount: 2,
        geometryTypes: ['LineString'],
        fields: { CARTO_CODE: 'string' }
    });
    assertLonLat4326(exported);
});

test('@tune rest mock polygon import', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/2'));
    expect(await readLayerListFeatureCount(page, 'Mock Polygons')).toBe(1);
    const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, 'polys'));
    assertFeatureCollection(exported, {
        featureCount: 1,
        geometryTypes: ['Polygon']
    });
    assertLonLat4326(exported);
});

test('@tune rest polygon labelingInfo labels the polygon', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await page.evaluate(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        if (map && !map.getStyle()?.glyphs) {
            map.setGlyphs(`${location.origin}/glyphs/{fontstack}/{range}.pbf`);
        }
    });
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/2'));
    await dismissOpenModals(page);

    const mapState = await page.evaluate(async () => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        if (!map) return { ok: false, reason: 'no-map' };
        await new Promise((resolve) => {
            if (map.loaded()) resolve();
            else map.once('idle', () => resolve());
        });
        const label = (map.getStyle()?.layers || []).find((layer) => {
            const id = String(layer.id);
            return id.endsWith('-labels') && !id.endsWith('-line-labels');
        });
        return {
            ok: true,
            id: label?.id || null,
            placement: label?.layout?.['symbol-placement'] || null,
            filter: label?.filter || null,
            field: label?.layout?.['text-field'] || null
        };
    });

    expect(mapState.ok).toBe(true);
    expect(mapState.id).toMatch(/-labels$/);
    expect(mapState.placement).toBe('point');
    expect(JSON.stringify(mapState.filter)).toContain('Polygon');
    expect(JSON.stringify(mapState.filter)).toContain('MultiPolygon');
    expect(JSON.stringify(mapState.field)).toContain('NAME');
});

test('@tune rest map server layer import', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/MapServer/0'));
    expect(await readLayerListFeatureCount(page, 'Mock Map Point')).toBe(2);
});

test('@tune rest mercator layer metadata yields 4326 coords', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/6'));
    const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, 'mercator'));
    assertLonLat4326(exported);
    expect(exported.features).toHaveLength(2);
});

test('@tune rest drawingInfo renderer stored on layer', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/4'));
    await page.waitForTimeout(3500);
    const style = await readSessionArcgisStyle(page);
    expect(style?.mode).toBe('smart');
    expect(style?.smart?.visualVariables?.[0]?.field).toBe('CARTO_CODE');
});

test('@tune rest picture marker glyph on features', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/5'));
    const exported = await exportActiveLayerGeoJSON(page, path.join(downloadDir, 'pms'));
    const withGlyph = exported.features.filter((f) => f.properties?._udotGlyph);
    expect(withGlyph.length).toBeGreaterThan(0);
});

test('@tune rest picture marker icons render on map', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('mock/FeatureServer/5'));
    await page.waitForTimeout(3500);

    const mapState = await page.evaluate(async () => {
        const mapService = globalThis.__gisE2eMapService;
        const map = mapService?.getMap?.();
        if (!map) return { ok: false, reason: 'no-map' };
        await new Promise((resolve) => {
            if (map.loaded()) resolve();
            else map.once('idle', () => resolve());
        });
        const style = map.getStyle();
        const glyphLayer = style.layers.find((l) => String(l.id).endsWith('-pms-glyph'));
        const imageId = exportedGlyphIdFromStyle(style);
        const rendered = map.queryRenderedFeatures(undefined, {
            layers: glyphLayer ? [glyphLayer.id] : []
        });
        return {
            ok: true,
            glyphLayerId: glyphLayer?.id || null,
            hasImage: imageId ? map.hasImage(imageId) : false,
            imageId,
            renderedGlyphs: rendered.length
        };

        function exportedGlyphIdFromStyle(styleObj) {
            const sources = styleObj.sources || {};
            for (const src of Object.values(sources)) {
                if (src?.type !== 'geojson' || !src.data?.features?.length) continue;
                const hit = src.data.features.find((f) => f.properties?._udotGlyph);
                if (hit?.properties?._udotGlyph) return hit.properties._udotGlyph;
            }
            return null;
        }
    });

    expect(mapState.ok).toBe(true);
    expect(mapState.glyphLayerId).toMatch(/-pms-glyph$/);
    expect(mapState.hasImage).toBe(true);
    expect(mapState.imageId).toMatch(/^arcgis-pms-/);
    expect(mapState.renderedGlyphs).toBeGreaterThan(0);
});

test('@tune rest error http 500 metadata', async ({ page }) => {
    test.setTimeout(90_000);
    await runArcgisFailure(page, 'error-http500/FeatureServer/0');
});

test('@tune rest error esri 498 metadata', async ({ page }) => {
    test.setTimeout(90_000);
    await runArcgisFailure(page, 'error-esri498/FeatureServer/0');
});

test('@tune rest error esri 400 query', async ({ page }) => {
    test.setTimeout(90_000);
    await bootApp(page, '/');
    await importArcgisRestUrlExpectFailure(page, mockLayerUrl('error-esri400/FeatureServer/0'));
});

test('@tune rest empty layer import', async ({ page }) => {
    test.setTimeout(90_000);
    await bootApp(page, '/');
    await importArcgisRestUrl(page, mockLayerUrl('error-empty/FeatureServer/0'));
    expect(await readLayerListFeatureCount(page, 'Empty')).toBe(0);
});

test('@tune rest malformed query json surfaces error', async ({ page }) => {
    test.setTimeout(90_000);
    await bootApp(page, '/');
    await importArcgisRestUrlExpectFailure(page, mockLayerUrl('error-malformed/FeatureServer/0'));
});
