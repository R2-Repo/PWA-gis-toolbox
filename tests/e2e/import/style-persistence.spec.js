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

async function readStyle(page, layerId) {
    return page.evaluate((id) => {
        const style = globalThis.__gisE2eMapService?.getLayerStyle?.(id);
        const variable = style?.smart?.visualVariables?.[0] || null;
        const classes = variable?.classes || [];
        const target = classes.find((cls) => cls?.value === 'Poly' || cls?.label === 'Kept parcel') || null;
        const fillId = `${id}-fill`;
        const map = globalThis.__gisE2eMapService?.getMap?.();
        return {
            mode: style?.mode || null,
            field: variable?.field || null,
            type: variable?.type || null,
            label: target?.label || null,
            color: target?.color || null,
            fill: map?.getLayer?.(fillId) ? map.getPaintProperty(fillId, 'fill-color') : null
        };
    }, layerId);
}

async function restoreSession(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__gisE2eMapService?.getMap?.(), null, { timeout: 60_000 });
    const closeGuide = page.locator('.modal-overlay--splash .close-modal');
    await closeGuide.first().waitFor({ state: 'visible', timeout: 60_000 });
    await closeGuide.first().click();
    await page.getByText('Restore Previous Session?').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('.modal-footer .confirm-btn').click();
}

test('@tune symbology survives reload, filter, and re-import', async ({ page }) => {
    test.setTimeout(180_000);
    await bootApp(page, '/');
    await importLocalFile(page, fixturePath);
    await dismissOpenModals(page);

    const polygonItem = page.locator('.layer-item[data-id]').filter({ hasText: 'Polygons' });
    await polygonItem.click();
    const polygonId = await polygonItem.getAttribute('data-id');
    const panel = page.locator('.style-panel');
    await panel.locator('[aria-label="Symbology"]').selectOption('unique');
    await panel.getByRole('button', { name: 'Use name' }).click();
    const label = panel.locator('[aria-label="Label for Poly"]');
    await expect(label).toBeVisible();
    await label.fill('Kept parcel');
    await panel.locator('[aria-label="Color for Poly"]').fill('#ff00aa');
    await page.waitForTimeout(2500);

    const styled = await readStyle(page, polygonId);
    expect(styled.mode).toBe('smart');
    expect(styled.field).toBe('name');
    expect(styled.label).toBe('Kept parcel');
    expect(String(styled.color).toLowerCase()).toBe('#ff00aa');
    expect(JSON.stringify(styled.fill)).toContain('#ff00aa');

    await restoreSession(page);
    await page.locator(`.layer-item[data-id="${polygonId}"]`).click();
    await expect(panel.locator('[aria-label="Symbology"]')).toHaveValue('unique');
    await expect(panel.locator('[aria-label="Label for Poly"]')).toHaveValue('Kept parcel');
    const reloaded = await readStyle(page, polygonId);
    expect(reloaded.label).toBe('Kept parcel');
    expect(String(reloaded.color).toLowerCase()).toBe('#ff00aa');
    expect(JSON.stringify(reloaded.fill)).toContain('#ff00aa');

    const toolsHeader = page.locator('.panel-section-header', { hasText: 'Layer Data Tools' });
    await toolsHeader.scrollIntoViewIfNeeded();
    if (await toolsHeader.evaluate((el) => el.classList.contains('collapsed'))) {
        await toolsHeader.click();
    }
    await page.locator('[data-app-action="openFilterBuilder"]').click();
    await page.locator('.rule-field').selectOption('name');
    await page.locator('.rule-op').selectOption('equals');
    await page.locator('.rule-val').fill('Poly');
    await page.getByRole('button', { name: 'Apply Filter' }).click();
    const filteredItem = page.locator(`.layer-item[data-id="${polygonId}"]`);
    await expect(filteredItem).toContainText('FILTERED');
    await expect(filteredItem).toContainText(/1 features/);
    const filtered = await readStyle(page, polygonId);
    expect(filtered.label).toBe('Kept parcel');
    expect(String(filtered.color).toLowerCase()).toBe('#ff00aa');
    expect(JSON.stringify(filtered.fill)).toContain('#ff00aa');

    await importLocalFile(page, fixturePath);
    await dismissOpenModals(page);
    const afterImport = await readStyle(page, polygonId);
    expect(afterImport.mode).toBe('smart');
    expect(afterImport.field).toBe('name');
    expect(afterImport.label).toBe('Kept parcel');
    expect(String(afterImport.color).toLowerCase()).toBe('#ff00aa');
    const layerCount = await page.locator('.layer-item[data-id]').count();
    expect(layerCount).toBeGreaterThan(3);
});
