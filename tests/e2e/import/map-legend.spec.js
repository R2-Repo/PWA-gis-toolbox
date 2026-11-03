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

test('@tune map legend follows visible layers and class labels', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await importLocalFile(page, fixturePath);
    await dismissOpenModals(page);

    const legend = page.locator('[data-map-legend="true"]');
    await expect(legend).toBeVisible();

    const layerIds = await page.locator('.layer-item[data-id]').evaluateAll((els) => (
        els.map((el) => el.getAttribute('data-id'))
    ));
    expect(layerIds.length).toBeGreaterThan(1);
    const legendIds = await legend.locator('.map-legend-entry').evaluateAll((els) => (
        els.map((el) => el.getAttribute('data-layer-id'))
    ));
    expect(legendIds).toEqual(layerIds);

    const lines = page.locator('.layer-item[data-id]').filter({ hasText: 'Lines' });
    const linesId = await lines.getAttribute('data-id');
    await lines.locator('button[title="Hide layer"]').click();
    await expect(legend.locator(`[data-layer-id="${linesId}"]`)).toHaveCount(0);
    await expect(legend.locator('.map-legend-entry')).toHaveCount(layerIds.length - 1);

    const polygons = page.locator('.layer-item[data-id]').filter({ hasText: 'Polygons' });
    await polygons.click();
    const polygonId = await polygons.getAttribute('data-id');
    const panel = page.locator('.style-panel');
    await panel.locator('[aria-label="Symbology"]').selectOption('unique');
    await panel.getByRole('button', { name: 'Use name' }).click();
    const label = panel.locator('[aria-label^="Label for"]').first();
    await expect(label).toBeVisible();
    await label.fill('Renamed class');
    const entry = legend.locator(`[data-layer-id="${polygonId}"]`);
    await expect(entry).toHaveAttribute('data-symbology', 'unique');
    await expect(entry).toContainText('Renamed class');
    await expect(entry).toContainText('Polygons');
});
