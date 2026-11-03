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

async function polygonLayerId(page) {
    return page.locator('.layer-item[data-id]').filter({ hasText: 'Polygons' }).getAttribute('data-id');
}

async function readLayer(page, id) {
    return page.evaluate((layerId) => {
        const svc = globalThis.__gisE2eMapService;
        const style = svc.getLayerStyle(layerId);
        const map = svc.getMap?.();
        const vv = style?.smart?.visualVariables?.[0] || null;
        const fillId = `${layerId}-fill`;
        return {
            mode: style?.mode || null,
            field: vv?.field || null,
            type: vv?.type || null,
            label: vv?.classes?.[0]?.label || null,
            fill: map?.getLayer?.(fillId) ? map.getPaintProperty(fillId, 'fill-color') : null
        };
    }, id);
}

test('@tune symbology type dropdown', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importLocalFile(page, fixturePath);
    await dismissOpenModals(page);

    const polygonItem = page.locator('.layer-item[data-id]').filter({ hasText: 'Polygons' });
    await polygonItem.click();
    const polygonId = await polygonItem.getAttribute('data-id');
    const panel = page.locator('.style-panel');
    const symbology = panel.locator('[aria-label="Symbology"]');
    await expect(symbology).toHaveValue('single');
    await expect(symbology.locator('option')).toHaveText([
        'Single symbol',
        'Unique values',
        'Graduated colors',
        'Graduated size'
    ]);
    await expect(panel).not.toContainText('Smart');
    await expect(panel).not.toContainText('Color by');
    await expect(panel).not.toContainText('Styling rule');
    await expect(panel).not.toContainText('Update from data');
    await expect(panel).not.toContainText('Default style');
    await expect(panel.locator('.symbology-symbol')).toContainText('Symbol');
    await expect(panel.locator('.symbology-highlight')).toContainText('Highlight');
    await expect(panel.locator('.symbology-highlight')).toContainText('does not hide features');

    await symbology.selectOption('graduated-colors');
    await expect(panel.locator('[data-symbology-preview="true"]')).toBeVisible();
    await expect(panel.locator('[aria-label="Field"]')).toHaveValue('');
    await page.waitForTimeout(400);
    const untouched = await readLayer(page, polygonId);
    expect(untouched.field).toBeNull();
    expect(untouched.type).toBeNull();

    await symbology.selectOption('unique');
    await expect(panel.getByRole('button', { name: 'Use name' })).toBeVisible();
    await panel.getByRole('button', { name: 'Use name' }).click();
    await expect(panel.getByRole('button', { name: 'Reclassify' })).toBeVisible();
    const label = panel.locator('[aria-label^="Label for"]').first();
    await expect(label).toBeVisible();
    await label.fill('Renamed class');
    await page.waitForTimeout(500);
    const classified = await readLayer(page, polygonId);
    expect(classified.mode).toBe('smart');
    expect(classified.field).toBe('name');
    expect(classified.type).toBe('unique');
    expect(classified.label).toBe('Renamed class');

    await page.locator('.layer-item[data-id]').filter({ hasText: 'Lines' }).click();
    await page.evaluate((layerId) => {
        const svc = globalThis.__gisE2eMapService;
        const rec = svc.getLayerRecord(layerId);
        const dataset = {
            id: layerId,
            name: 'polygon-multipart - Polygons',
            type: 'spatial',
            geojson: rec?.geojson?.type === 'FeatureCollection'
                ? rec.geojson
                : { type: 'FeatureCollection', features: rec?.geojson?.features || [] },
            schema: { geometryType: 'Polygon', fields: [{ name: 'name', type: 'string', selected: true }] }
        };
        svc.restyleLayer(layerId, dataset, {
            mode: 'smart',
            strokeColor: '#336699',
            fillColor: '#336699',
            strokeWidth: 2,
            strokeOpacity: 0.8,
            fillOpacity: 0.3,
            pointSize: 6,
            pointSymbol: 'circle',
            smart: {
                defaultStyle: {
                    strokeColor: '#336699',
                    fillColor: '#336699',
                    strokeWidth: 2,
                    strokeOpacity: 0.8,
                    fillOpacity: 0.3
                },
                visualVariables: [{
                    id: 'vv-e2e',
                    type: 'unique',
                    field: 'name',
                    channel: 'fill',
                    defaultColor: '#94a3b8',
                    classes: [
                        { value: 'Poly', label: 'Poly parcel', color: '#ff00aa', style: {} },
                        { value: 'Multi poly', label: 'Multi', color: '#00cc88', style: {} }
                    ]
                }],
                filterRules: []
            }
        });
    }, polygonId);
    const painted = await readLayer(page, polygonId);
    expect(JSON.stringify(painted.fill)).toContain('#ff00aa');

    await polygonItem.click();
    await expect(panel.locator('[aria-label="Symbology"]')).toHaveValue('unique');
    await expect(panel.locator('[aria-label="Field"]')).toHaveValue('name');
    await expect(panel.locator('[aria-label="Label for Poly"]')).toHaveValue('Poly parcel');
    const afterOpen = await readLayer(page, polygonId);
    expect(afterOpen.fill).toEqual(painted.fill);
});
