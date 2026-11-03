import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { bootApp, dismissOpenModals } from '../helpers/app.js';
import { importLocalFile } from '../helpers/import.js';
import { attachNetworkGuard, assertNoUnexpectedBlocks } from '../helpers/network-guard.js';
import { installE2eBrowserShims } from '../helpers/e2e-browser-shims.js';

const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../fixtures/e2e/polygon-multipart.geojson'
);

/** @type {Map<string, { basemapBlocked: string[], unexpectedBlocked: string[] }>} */
const networkByTest = new Map();

test.beforeEach(async ({ context }, testInfo) => {
    await installE2eBrowserShims(context);
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (!guard) return;
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
});

/** Offline e2e styles omit glyphs; a same-origin URL lets text layers attach without remote fonts. */
async function allowLocalTextGlyphs(page) {
    await page.evaluate(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        if (map && !map.getStyle()?.glyphs) {
            map.setGlyphs(`${location.origin}/glyphs/{fontstack}/{range}.pbf`);
        }
    });
}

async function readLabelLayers(page) {
    return page.evaluate(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        const layers = map?.getStyle?.()?.layers || [];
        return layers
            .filter((layer) => {
                const id = String(layer.id);
                return id.endsWith('-labels') || id.endsWith('-line-labels');
            })
            .map((layer) => ({
                id: layer.id,
                filter: layer.filter,
                placement: layer.layout?.['symbol-placement'] || null
            }));
    });
}

async function assertStylingPanel(page) {
    const headers = page.locator('#output-panel-content > .panel-section > .panel-section-header');
    await expect(headers.nth(0)).toContainText('Symbology');
    await expect(headers.nth(0)).not.toHaveClass(/collapsed/);
    await expect(headers.nth(1)).toContainText('Labels');
    await expect(headers.nth(2)).toContainText('Visibility');
    await expect(headers.nth(3)).toContainText('Data Preview');
    await expect(headers.nth(4)).toContainText('Output Schema');
    await expect(headers.nth(5)).toContainText('Export');

    const visibilityHeader = page.locator('.visibility-panel .panel-section-header');
    if (await visibilityHeader.evaluate((el) => el.classList.contains('collapsed'))) {
        await visibilityHeader.click();
    }
    const visibility = page.locator('.visibility-panel');
    await expect(visibility).toContainText('Layer visible at...');
    await expect(visibility).toContainText('Labels visible at...');
}

async function enableLabels(page) {
    const header = page.locator('.labels-panel .panel-section-header');
    await header.waitFor({ state: 'visible', timeout: 30_000 });
    if (await header.evaluate((el) => el.classList.contains('collapsed'))) {
        await header.click();
    }
    const checkbox = page.locator('.labels-panel input[type="checkbox"]').first();
    if (!(await checkbox.isChecked())) {
        await page.locator('.labels-panel').getByText('Show labels').click();
    }
}

test('@tune polygon and multipart labels', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await allowLocalTextGlyphs(page);
    await importLocalFile(page, fixturePath);
    await dismissOpenModals(page);

    await page.locator('.layer-item').filter({ hasText: 'Polygons' }).click();
    await assertStylingPanel(page);
    await enableLabels(page);
    await expect(page.locator('.labels-panel')).not.toContainText('Min zoom');
    await expect(page.locator('.labels-panel')).not.toContainText('Max zoom');
    await expect(page.locator('.labels-panel')).toContainText('Labels at an interior point');
    await page.waitForFunction(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        return (map?.getStyle?.()?.layers || []).some((layer) => {
            const id = String(layer.id);
            return id.endsWith('-labels') && !id.endsWith('-line-labels');
        });
    });
    const polygonLabels = await readLabelLayers(page);
    const polygonLayer = polygonLabels.find((layer) => layer.id.endsWith('-labels') && !layer.id.endsWith('-line-labels'));
    expect(polygonLayer?.placement).toBe('point');
    const polygonFilter = JSON.stringify(polygonLayer?.filter);
    expect(polygonFilter).toContain('Polygon');
    expect(polygonFilter).toContain('MultiPolygon');

    await page.locator('.layer-item').filter({ hasText: 'Lines' }).click();
    await enableLabels(page);
    await expect(page.locator('.labels-panel')).toContainText('Labels follow line geometry');
    await page.waitForFunction(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        return (map?.getStyle?.()?.layers || []).some((layer) => String(layer.id).endsWith('-line-labels'));
    });
    const lineLabels = await readLabelLayers(page);
    const lineLayer = lineLabels.find((layer) => layer.id.endsWith('-line-labels'));
    expect(lineLayer?.placement).toBe('line');
    expect(JSON.stringify(lineLayer?.filter)).toContain('MultiLineString');

    await page.locator('.layer-item').filter({ hasText: 'Points' }).click();
    await enableLabels(page);
    await expect(page.locator('.labels-panel')).toContainText('Labels at point locations');
    await page.waitForFunction(() => {
        const svc = globalThis.__gisE2eMapService;
        const map = svc?.getMap?.();
        const pointId = (svc?.getLayerIds?.() || []).find((id) => {
            const types = (svc.getLayerRecord?.(id)?.geojson?.features || []).map((f) => f.geometry?.type);
            return types.includes('MultiPoint');
        });
        return pointId ? !!map?.getLayer?.(`${pointId}-labels`) : false;
    });
    const pointLayer = (await readLabelLayers(page)).find((layer) => layer.id.includes('-labels')
        && !layer.id.endsWith('-line-labels')
        && JSON.stringify(layer.filter || '').includes('MultiPoint'));
    expect(pointLayer?.placement).toBe('point');
});
